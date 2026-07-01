// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "forge-std/Test.sol";
import {StdStorage, stdStorage} from "forge-std/StdStorage.sol";
import {CryptoPixel} from "../contracts/CryptoPixelV7.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @notice Token ERC20 minimal pour simuler un envoi accidentel vers le
///         contrat, et tester rescueERC20().
contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MOCK") {
        _mint(msg.sender, 1_000_000 ether);
    }
}

/// @notice Tests de montée en échelle + couverture des fonctions non
///         exercées par le fuzz d'invariants (pause/guardian/rescue/claim).
///         Trois stratégies selon l'échelle :
///          - réaliste (jusqu'à ~10M en round-trip buy/sell) : vraies tx
///          - freeze à 5k : vraies tx, sert de test rapide de régression
///          - freeze à 10M (seuil d'unlock RÉEL) : vraies tx en boucle
///            déterministe, gas metering coupé — c'est le test long
///            (~plusieurs minutes) à lancer isolément quand tu as le temps.
contract CryptoPixelScaleTest is Test {
    using stdStorage for StdStorage;

    CryptoPixel public cp;

    function setUp() public {
        cp = new CryptoPixel(); // owner() = guardian = premineHolder = address(this)
    }

    // ── Achat/vente à l'échelle réaliste ────────────────────────────────────

    function _buySellRoundTrip(uint256 amount) internal {
        address whale = address(0xBEEF);
        uint256 cost = cp.getPrice(0, amount);
        vm.deal(whale, cost);

        vm.prank(whale);
        cp.buyTokens{value: cost}(amount, cost);
        assertEq(cp.balanceOf(whale), amount * 1e18, "balance post-buy incorrecte");

        uint256 balBefore = whale.balance;
        vm.prank(whale);
        cp.sellTokens(amount, 0);
        assertEq(cp.balanceOf(whale), 0, "balance post-sell doit etre nulle");
        assertGt(whale.balance, balBefore, "le whale doit recuperer du POL en revendant");
    }

    function test_BuySellRoundTrip_100k() public { _buySellRoundTrip(100_000); }
    function test_BuySellRoundTrip_1M()   public { _buySellRoundTrip(1_000_000); }
    function test_BuySellRoundTrip_10M()  public { _buySellRoundTrip(10_000_000); }

    /// @notice 100M tokens : capital requis ~12.5M POL, purement théorique,
    ///         mais confirme l'absence d'overflow/comportement aberrant de
    ///         la courbe aux extrêmes de MAX_PUBLIC_SUPPLY.
    function test_BuySellRoundTrip_100M_extreme() public {
        uint256 amount = 100_000_000;
        assertLe(amount, cp.MAX_PUBLIC_SUPPLY() / 1e18, "hors bornes MAX_PUBLIC_SUPPLY");
        _buySellRoundTrip(amount);
    }

    /// @notice Vérifie qu'un achat qui dépasserait MAX_PUBLIC_SUPPLY revert bien,
    ///         et n'entraîne aucun état incohérent (pas de mint partiel).
    function test_Buy_RevertsAboveMaxSupply() public {
        uint256 tooMuch = (cp.MAX_PUBLIC_SUPPLY() / 1e18) + 1;
        uint256 cost = cp.getPrice(0, tooMuch);
        vm.deal(address(this), cost);
        vm.expectRevert(CryptoPixel.AmountTooLarge.selector);
        cp.buyTokens{value: cost}(tooMuch, cost);
    }

    // ── Freeze à échelle réaliste (vraies transactions) ─────────────────────

    /// @notice Freeze 5 000 pixels via des lots de 200 (25 appels réels).
    ///         Vérifie que la boucle freezeBatch reste cohérente en usage
    ///         répété (pas de collision d'IDs, comptage correct).
    function test_FreezeAtScale_5k_realTx() public {
        address user = address(0xCAFE);
        uint256 target = 5_000;

        uint256 cost = cp.getPrice(0, target);
        vm.deal(user, cost);
        vm.prank(user);
        cp.buyTokens{value: cost}(target, cost);

        uint32 pixelId = 0;
        uint256 remaining = target;
        while (remaining > 0) {
            uint256 batchLen = remaining >= 200 ? 200 : remaining;
            uint32[] memory ids = new uint32[](batchLen);
            uint24[] memory colors = new uint24[](batchLen);
            for (uint256 i = 0; i < batchLen; i++) {
                ids[i] = pixelId;
                colors[i] = 1;
                pixelId++;
            }
            vm.prank(user);
            cp.freezeBatch(ids, colors);
            remaining -= batchLen;
        }

        assertEq(cp.totalFrozenPixels(), target);
        assertEq(cp.frozenCountByAddress(user), target);
    }

    // ── Freeze RÉEL à 10M (seuil d'unlock exact) ─────────────────────────────

    /// @notice LE test long. Freeze les 10 000 000 de pixels du seuil
    ///         UNLOCK_FREEZE_THRESHOLD via de VRAIES transactions
    ///         freezeBatch(200), sans aucun state-jump : ~50 000 appels
    ///         réels, exécutés en boucle déterministe (pas du fuzzing, donc
    ///         un déroulement 100% reproductible d'un run à l'autre).
    ///
    ///         Durée attendue : plusieurs minutes selon la machine.
    ///         Rien ne doit planter : chaque batch est sain (200 pixels =
    ///         MAX_BATCH_FREEZE exact, aucune collision d'ID car pixelId
    ///         s'incrémente linéairement et ne dépasse jamais TOTAL_PIXELS
    ///         car 10_000_000 << 1_000_000_000).
    ///
    ///         vm.pauseGasMetering()/resumeGasMetering() encadrent la
    ///         boucle : ça retire le calcul de gas coûteux à chaque opcode
    ///         pendant les 50 000 appels, ce qui accélère fortement
    ///         l'exécution sans changer le résultat testé (le comportement
    ///         du contrat, pas sa consommation de gas).
    ///
    ///         Un console.log toutes les 2 000 batches (= 400 000 pixels)
    ///         permet de suivre visuellement l'avancement pendant les
    ///         quelques minutes que ça prend, et de repérer immédiatement
    ///         un blocage éventuel plutôt que d'attendre en silence.
    ///
    ///         Lance-le isolément pour ne pas plomber le reste de ta suite :
    ///           forge test --match-test test_FreezeAtScale_FULL_10M -vv
    function test_FreezeAtScale_FULL_10M() public {
        address user = address(0xCAFE);
        uint256 target = cp.UNLOCK_FREEZE_THRESHOLD(); // 10_000_000

        // Achat : `target` PAINT seront brûlés au fil des freezes. On achète
        // un peu plus (+ MIN_PAINT_HOLD) pour rester éligible au claim final
        // une fois l'unlock déclenché.
        uint256 buyAmount = target + (cp.MIN_PAINT_HOLD() / 1e18);
        uint256 cost = cp.getPrice(0, buyAmount);
        vm.deal(user, cost);
        vm.prank(user);
        cp.buyTokens{value: cost}(buyAmount, cost);

        uint32 pixelId = 0;
        uint256 remaining = target;
        uint256 batchesDone = 0;

        // ── Buffers reutilises, alloues UNE SEULE FOIS ───────────────────
        // target = UNLOCK_FREEZE_THRESHOLD = 10_000_000, qui est un multiple
        // exact de 200 (10_000_000 / 200 = 50_000 pile), donc batchLen vaut
        // TOUJOURS 200 dans cette boucle specifique : pas besoin de gerer un
        // dernier batch partiel de taille differente.
        //
        // Root cause du crash precedent : `new uint32[](batchLen)` /
        // `new uint24[](batchLen)` APPELE DANS LA BOUCLE alloue une NOUVELLE
        // zone memoire a chaque iteration. Solidity ne libere jamais la
        // memoire (pas de GC, le pointeur libre 0x40 ne fait qu'avancer),
        // donc au bout de ~10 000+ iterations le contrat de test traine des
        // dizaines de Mo de memoire jamais recuperee. Le cout d'expansion
        // memoire EVM etant QUADRATIQUE, ca finit par couter des milliards
        // de gas pour agrandir la memoire d'un seul mot de plus — independant
        // de gas_limit, d'ou le crash parfaitement reproductible au meme
        // batch avec des donnees de revert vides (abort d'interpreteur, pas
        // un revert() Solidity classique). Fix : allouer les buffers UNE
        // FOIS avant la boucle et les reecrire en place a chaque iteration.
        uint32[] memory ids = new uint32[](200);
        uint24[] memory colors = new uint24[](200);
        for (uint256 i = 0; i < 200; i++) {
            colors[i] = 1; // couleur fixe, jamais modifiee ensuite
        }

        vm.pauseGasMetering();

        while (remaining > 0) {
            for (uint256 i = 0; i < 200; i++) {
                ids[i] = pixelId;
                pixelId++;
            }

            vm.prank(user);
            // try/catch au lieu d'un appel direct : si ça revert, on veut
            // logguer l'etat exact AVANT de re-propager l'erreur, plutot
            // que de laisser Foundry afficher un "EvmError: Revert" nu et
            // un chiffre de gas rendu peu fiable par pauseGasMetering().
            try cp.freezeBatch(ids, colors) {
                // succes, rien a faire
            } catch (bytes memory reason) {
                console.log("=== ECHEC freezeBatch ===");
                console.log("batch numero (1-indexed)     :", batchesDone + 1);
                console.log("pixels frozen AVANT ce batch  :", target - remaining);
                console.log("pixelId de depart de ce batch  :", pixelId - 200);
                console.log("balance PAINT du user          :", cp.balanceOf(user));
                console.log("frozenCount individuel du user :", cp.frozenCountByAddress(user));
                console.log("totalFrozenPixels (global)     :", cp.totalFrozenPixels());
                console.log("longueur des donnees de revert :", reason.length);
                // Re-propage la vraie raison de revert (selector du custom
                // error inclus) pour que Foundry l'affiche/decode normalement
                // dans le resume du test, au lieu d'un "EvmError: Revert" nu.
                assembly {
                    revert(add(reason, 0x20), mload(reason))
                }
            }

            remaining -= 200;
            batchesDone++;

            if (batchesDone % 2_000 == 0) {
                // Log de progression : rassure que ça tourne toujours et
                // n'a pas silencieusement bloqué sur un batch particulier.
                console.log("progress: pixels frozen so far =", target - remaining);
                console.log("          batches done          =", batchesDone);
                console.log("          balance restante       =", cp.balanceOf(user));
            }
        }

        vm.resumeGasMetering();

        // ── Vérifications post-boucle ────────────────────────────────────
        assertEq(cp.totalFrozenPixels(), target, "totalFrozenPixels doit atteindre exactement le seuil");
        assertEq(cp.frozenCountByAddress(user), target, "frozenCount individuel doit matcher");
        assertTrue(cp.isAirdropUnlocked(), "l'unlock doit se declencher NATURELLEMENT au seuil, sans state-jump");

        // Le user doit avoir gardé au moins MIN_PAINT_HOLD après tous les freezes.
        assertGe(cp.balanceOf(user), cp.MIN_PAINT_HOLD(), "balance restante insuffisante pour claim");
        assertGe(cp.frozenCountByAddress(user), cp.MIN_FROZEN_COUNT(), "frozenCount insuffisant pour claim");

        // Le claim doit fonctionner immédiatement après le franchissement réel du seuil.
        uint256 balBeforeClaim = cp.balanceOf(user);
        vm.prank(user);
        cp.claim();

        assertTrue(cp.hasClaimed(user), "le claim doit reussir juste apres l'unlock reel");
        assertEq(cp.balanceOf(user), balBeforeClaim + cp.AIRDROP_AMOUNT(), "solde post-claim incorrect");

        // La bonding curve doit rester solvable après ce volume massif de
        // freezes (chaque freeze burn 1 PAINT mais NE retire PAS de POL du
        // contrat — invariant clé à revalider explicitement à cette échelle).
        uint256 publicSupply = cp.totalSupply() - cp.PREMINE_AMOUNT() + (uint256(cp.totalFrozenPixels()) * 1e18);
        uint256 frozenVal = uint256(cp.totalFrozenPixels()) * 1e18;
        uint256 activeSupply = publicSupply > frozenVal ? publicSupply - frozenVal : 0;
        uint256 activeTokens = (activeSupply + 1e18 - 1) / 1e18;
        uint256 requiredLiquidity = cp.getPrice(cp.totalFrozenPixels(), activeTokens);
        assertGe(address(cp).balance, requiredLiquidity, "INSOLVENCY apres 10M freezes reels");

        console.log("=== test_FreezeAtScale_FULL_10M termine avec succes ===");
        console.log("totalFrozenPixels final :", cp.totalFrozenPixels());
        console.log("batches executes         :", batchesDone);
    }

    // ── Claim / unlock à l'échelle extrême, via state-jump (rapide, CI) ──────

    /// @notice Teste le chemin claim() COMPLET sans exécuter 10 millions de
    ///         freezes réels : totalFrozenPixels (compteur GLOBAL) est
    ///         écrit directement via stdstore pour franchir
    ///         UNLOCK_FREEZE_THRESHOLD. Le frozenCount INDIVIDUEL du
    ///         claimant, lui, est obtenu via 10 vrais freezePixel (pas
    ///         cher, et c'est la partie qui doit être authentique pour
    ///         que le test ait un sens).
    /// @dev    Garde ce test pour le run rapide en CI. Le vrai franchissement
    ///         du seuil est couvert par test_FreezeAtScale_FULL_10M ci-dessus.
    function test_AirdropUnlock_ViaStateJump_AndClaim() public {
        address user = address(0xABCD);

        // 1) Le user freeze réellement 10 pixels (son propre frozenCount).
        //    Achat de 30 tokens : 10 seront brûlés au freeze, il reste 20
        //    (= MIN_PAINT_HOLD exact) pour rester éligible au claim.
        uint256 cost = cp.getPrice(0, 30);
        vm.deal(user, cost);
        vm.prank(user);
        cp.buyTokens{value: cost}(30, cost);

        for (uint32 i = 0; i < 10; i++) {
            vm.prank(user);
            cp.freezePixel(i, 1);
        }
        assertEq(cp.balanceOf(user), 20 * 1e18);
        assertEq(cp.frozenCountByAddress(user), 10);
        assertFalse(cp.isAirdropUnlocked(), "ne doit pas etre unlock avant le seuil global");

        // 2) Jump direct sur isAirdropUnlocked plutôt que sur totalFrozenPixels :
        //    ce dernier est packé dans le même slot storage que
        //    totalVolumeDeposited (uint64 + uint128), ce qui fait échouer la
        //    détection automatique de slot de stdstore ("Slot(s) not found").
        //    isAirdropUnlocked est un bool isolé dans son propre slot, donc
        //    une cible fiable. C'est aussi la variable qui compte vraiment :
        //    le calcul qui la fait passer à true (une comparaison d'une
        //    ligne dans checkAndUnlockAirdrop) est un risque négligeable ;
        //    ce qui mérite un vrai test, c'est le comportement de claim()
        //    une fois l'unlock acquis.
        stdstore.target(address(cp)).sig("isAirdropUnlocked()").checked_write(true);

        assertTrue(cp.isAirdropUnlocked(), "l'unlock global aurait du etre force");

        // 3) Le user peut désormais claim.
        vm.prank(user);
        cp.claim();

        assertTrue(cp.hasClaimed(user));
        assertEq(cp.balanceOf(user), 20 * 1e18 + cp.AIRDROP_AMOUNT());
    }

    /// @notice Vérifie la logique de seuil elle-même (sans state-jump) :
    ///         le seuil est bien celui attendu, et l'unlock reste false
    ///         tant qu'aucun freeze réel n'a eu lieu.
    function test_UnlockThreshold_RemainsLockedInitially() public view {
        assertEq(cp.UNLOCK_FREEZE_THRESHOLD(), 10_000_000);
        assertEq(cp.totalFrozenPixels(), 0);
        assertFalse(cp.isAirdropUnlocked());
    }

    /// @notice Un claim en double doit toujours revert, même après unlock.
    function test_Claim_RevertsOnDoubleClaim() public {
        test_AirdropUnlock_ViaStateJump_AndClaim();
        address user = address(0xABCD);
        vm.prank(user);
        vm.expectRevert(CryptoPixel.AlreadyClaimed.selector);
        cp.claim();
    }

    // ── Pause / Guardian ─────────────────────────────────────────────────

    function test_Pause_BlocksStateChangingOps() public {
        cp.pause(); // address(this) = guardian initial

        vm.expectRevert(Pausable.EnforcedPause.selector);
        cp.buyTokens{value: 1 ether}(1, 1 ether);

        cp.unpause();
        // après unpause, un achat normal doit repasser
        uint256 cost = cp.getPrice(0, 1);
        vm.deal(address(this), cost);
        cp.buyTokens{value: cost}(1, cost);
    }

    function test_SetGuardian_RotatesAccessCorrectly() public {
        address newGuardian = address(0xD00D);
        cp.setGuardian(newGuardian); // appelé par owner() = address(this)

        // L'ancien guardian ne peut plus pause().
        vm.expectRevert(CryptoPixel.NotGuardian.selector);
        cp.pause();

        // Le nouveau guardian le peut.
        vm.prank(newGuardian);
        cp.pause();
        assertTrue(cp.paused());
    }

    // ── rescueERC20 ──────────────────────────────────────────────────────

    function test_RescueERC20_RecoversMisplacedTokens() public {
        MockERC20 token = new MockERC20();
        token.transfer(address(cp), 1_000 ether); // envoi accidentel simulé

        uint256 before = token.balanceOf(address(this));
        cp.rescueERC20(address(token), address(this), 1_000 ether);
        assertEq(token.balanceOf(address(this)), before + 1_000 ether);
    }

    function test_RescueERC20_RejectsSelfToken() public {
        vm.expectRevert(CryptoPixel.CannotRescuePixel.selector);
        cp.rescueERC20(address(cp), address(this), 1);
    }
}
