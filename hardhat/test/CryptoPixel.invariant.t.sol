// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "forge-std/Test.sol";
import {CryptoPixel} from "../contracts/CryptoPixelV7.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// ═══════════════════════════════════════════════════════════════════════
/// CONFIG REQUISE DANS foundry.toml POUR UN VRAI STRESS TEST MILLIONS-TX
/// ═══════════════════════════════════════════════════════════════════════
///
///   [invariant]
///   runs             = 50        # nombre de runs indépendants
///   depth             = 20000    # nombre d'appels handler PAR run
///   fail_on_revert    = false    # les reverts attendus (ex: pas encore unlock) sont catch() dans le handler
///   call_override     = false
///   dictionary_weight = 40
///
/// Avec depth=20000 et un batch moyen ~100 pixels (bound 1..200 ci-dessous),
/// une seule séquence peut freezer jusqu'à ~2M pixels. Avec plusieurs runs
/// qui accumulent (le state N'EST PAS reset entre les runs d'un même test
/// invariant tant que tu restes dans le même setUp() — Foundry redéploie en
/// fait un nouvel état à chaque run), le franchissement RÉEL de
/// UNLOCK_FREEZE_THRESHOLD (10M) dépendra de la chance du fuzzer.
///
/// ⚠️ Pour être CERTAIN de franchir 10M de pixels frozen réels au moins une
/// fois, préfère le test dédié `test_FreezeAtScale_FULL_10M` du fichier
/// CryptoPixelScale.t.sol : c'est une boucle déterministe, pas un fuzz.
/// Ce fichier-ci reste focalisé sur la découverte de bugs de LOGIQUE via
/// des séquences aléatoires variées (buy/sell/freeze/claim/sweep/pause/
/// guardian/rescue mélangés), pas sur la volumétrie brute.
/// ═══════════════════════════════════════════════════════════════════════

/// @notice Token ERC20 minimal pour fuzzer rescueERC20() avec un vrai token
///         différent de PAINT.
contract MockERC20Invariant is ERC20 {
    constructor() ERC20("MockInv", "MOCKI") {
        _mint(msg.sender, 1_000_000_000 ether);
    }
}

/// @notice Handler : encapsule TOUTES les actions externes du contrat et les
///         borne à des valeurs réalistes, pour que le fuzzer explore des
///         séquences valides (buy/sell/freeze/freezeBatch/claim/sweep/
///         pause/unpause/setGuardian/rescueERC20) plutôt que de spammer
///         des reverts triviaux.
contract CryptoPixelHandler is Test {
    CryptoPixel public cp;
    MockERC20Invariant public mockToken;
    address public deployer; // = owner() = premineHolder au déploiement (immuable)
    address public currentGuardian; // suit la rotation via setGuardian
    address[] public actors;

    // Compteurs de debug, utiles pour vérifier que le fuzzer explore bien
    // tous les chemins (visibles via forge-std si tu ajoutes des console.log).
    uint256 public freezeBatchCalls;
    uint256 public claimCalls;
    uint256 public sweepCalls;
    uint256 public pauseCalls;
    uint256 public unpauseCalls;
    uint256 public guardianRotations;
    uint256 public rescueCalls;

    // Compteur cumulé de pixels frozen via freezeBatch, pour suivre
    // combien de "volume" le fuzzer a réellement poussé à travers le
    // contrat sur l'ensemble d'un run (utile pour juger si depth/runs
    // dans foundry.toml sont suffisants pour approcher le seuil réel).
    uint256 public totalPixelsFrozenByHandler;

    constructor(CryptoPixel _cp, address _deployer) {
        cp = _cp;
        deployer = _deployer;
        currentGuardian = _deployer; // guardian initial = deployer
        mockToken = new MockERC20Invariant();
        for (uint256 i = 0; i < 10; i++) {
            actors.push(address(uint160(0x1000 + i)));
        }
    }

    function buy(uint256 actorSeed, uint256 amount) public {
        address actor = actors[actorSeed % actors.length];
        amount = bound(amount, 1, 50); // en tokens, pas en wei

        uint256 cost = cp.getPrice(0, amount); // approximation haute pour le funding
        vm.deal(actor, cost * 2);

        vm.prank(actor);
        try cp.buyTokens{value: cost * 2}(amount, type(uint256).max) {} catch {}
    }

    function sell(uint256 actorSeed, uint256 amount) public {
        address actor = actors[actorSeed % actors.length];
        uint256 bal = cp.balanceOf(actor) / 1e18;
        if (bal == 0) return;
        amount = bound(amount, 1, bal);

        vm.prank(actor);
        try cp.sellTokens(amount, 0) {} catch {}
    }

    function freeze(uint256 actorSeed, uint32 pixelId, uint24 color) public {
        address actor = actors[actorSeed % actors.length];
        if (cp.balanceOf(actor) < 1e18) return;
        if (color == 0) color = 1;

        vm.prank(actor);
        try cp.freezePixel(pixelId, color) {} catch {}
    }

    /// @notice Freeze un lot de pixels d'un coup — exercice un chemin de
    ///         code différent (boucle, coût cumulé) de freeze().
    /// @dev    Bound relevé à 1..200 (= MAX_BATCH_FREEZE, contre 1..20
    ///         avant) : sur une profondeur (`depth`) élevée en foundry.toml,
    ///         ça permet au fuzzer de faire progresser totalFrozenPixels
    ///         beaucoup plus vite par appel, et donc d'avoir une vraie
    ///         chance de franchir UNLOCK_FREEZE_THRESHOLD (10M) au moins
    ///         une fois sur l'ensemble des runs, sans pour autant le
    ///         garantir déterministiquement (voir note en tête de fichier).
    function freezeBatch(uint256 actorSeed, uint32 pixelIdStart, uint8 batchLenSeed) public {
        address actor = actors[actorSeed % actors.length];

        uint256 batchLen = bound(uint256(batchLenSeed), 1, 200); // = MAX_BATCH_FREEZE
        uint256 balTokens = cp.balanceOf(actor) / 1e18;
        if (balTokens < batchLen) return;

        uint32[] memory pixelIds = new uint32[](batchLen);
        uint24[] memory colors = new uint24[](batchLen);
        for (uint256 i = 0; i < batchLen; i++) {
            pixelIds[i] = pixelIdStart + uint32(i);
            colors[i] = 1;
        }

        vm.prank(actor);
        try cp.freezeBatch(pixelIds, colors) {
            freezeBatchCalls++;
            totalPixelsFrozenByHandler += batchLen;
        } catch {}
    }

    /// @notice Réclame l'airdrop si l'acteur est éligible. Ne force rien :
    ///         si isAirdropUnlocked est encore false, ça revert et catch,
    ///         c'est la séquence buy+freeze du fuzzer qui doit naturellement
    ///         amener le seuil UNLOCK_FREEZE_THRESHOLD à être franchi.
    function claim(uint256 actorSeed) public {
        address actor = actors[actorSeed % actors.length];

        vm.prank(actor);
        try cp.claim() {
            claimCalls++;
        } catch {}
    }

    /// @notice Avance le temps et tente un sweep du reliquat de premine.
    ///         warp est borné pour ne pas exploser le timestamp au-delà du
    ///         raisonnable, mais suffisant pour dépasser SWEEP_DELAY (~2 ans).
    function sweep(uint256 warpSeed, address to) public {
        uint256 warpAmount = bound(warpSeed, 0, 3 * 365 days);
        vm.warp(block.timestamp + warpAmount);

        if (to == address(0)) to = deployer;

        vm.prank(deployer); // deployer = owner() initialement (pas de transferOwnership dans ce test)
        try cp.sweepUnclaimedPremine(to) {
            sweepCalls++;
        } catch {}
    }

    /// @notice Met le contrat en pause, via le guardian courant (peut avoir
    ///         tourné suite à un rotateGuardian précédent dans la séquence).
    function pause() public {
        vm.prank(currentGuardian);
        try cp.pause() {
            pauseCalls++;
        } catch {}
    }

    /// @notice Lève la pause, via le guardian courant.
    function unpause() public {
        vm.prank(currentGuardian);
        try cp.unpause() {
            unpauseCalls++;
        } catch {}
    }

    /// @notice Fait tourner le guardian vers un nouvel acteur aléatoire.
    ///         setGuardian est onlyOwner : seul deployer peut réussir cet
    ///         appel. On met à jour currentGuardian uniquement en cas de
    ///         succès, pour que pause()/unpause() ciblent la bonne adresse
    ///         dans les appels suivants de la même séquence.
    function rotateGuardian(uint256 actorSeed) public {
        address newGuardian = actors[actorSeed % actors.length];

        vm.prank(deployer);
        try cp.setGuardian(newGuardian) {
            currentGuardian = newGuardian;
            guardianRotations++;
        } catch {}
    }

    /// @notice Envoie un montant aléatoire de mockToken vers le contrat
    ///         (simulant un dépôt accidentel), puis tente de le rescue.
    function rescueMockToken(uint256 amount, address to) public {
        amount = bound(amount, 0, mockToken.balanceOf(address(this)));
        if (amount > 0) {
            mockToken.transfer(address(cp), amount);
        }
        if (to == address(0)) to = deployer;

        vm.prank(deployer); // rescueERC20 est onlyOwner
        try cp.rescueERC20(address(mockToken), to, amount) {
            rescueCalls++;
        } catch {}
    }
}

contract CryptoPixelInvariantTest is Test {
    CryptoPixel public cp;
    CryptoPixelHandler public handler;

    function setUp() public {
        cp = new CryptoPixel();
        handler = new CryptoPixelHandler(cp, address(this));
        targetContract(address(handler));
    }

    /// @notice L'INVARIANT CLÉ : le contrat doit toujours pouvoir honorer
    ///         le rachat de tous les tokens actifs au prix de la bonding
    ///         curve, quelle que soit la séquence d'actions passée —
    ///         y compris freezeBatch, claim, et sweep après vm.warp.
    function invariant_solvency() public view {
        uint256 publicSupply = cp.totalSupply() - cp.PREMINE_AMOUNT()
            + (uint256(cp.totalFrozenPixels()) * 1e18);
        // reproduit _publicSupply() depuis l'extérieur (fonction internal)

        uint256 frozen = cp.totalFrozenPixels();
        uint256 frozenVal = frozen * 1e18;
        uint256 activeSupply = publicSupply > frozenVal ? publicSupply - frozenVal : 0;
        uint256 activeTokens = (activeSupply + 1e18 - 1) / 1e18;

        uint256 requiredLiquidity = cp.getPrice(frozen, activeTokens);

        assertGe(
            address(cp).balance,
            requiredLiquidity,
            "INSOLVENCY: le contrat ne peut plus honorer le rachat de tous les tokens actifs"
        );
    }

    /// @notice Le lock du premine ne doit jamais permettre au solde de
    ///         premineHolder de descendre sous lockedPremine[premineHolder],
    ///         même après des claims et un sweep.
    function invariant_premine_lock_holds() public view {
        address holder = cp.premineHolder();
        assertGe(
            cp.balanceOf(holder),
            cp.lockedPremine(holder),
            "PREMINE LOCK BREACH"
        );
    }

    /// @notice Le nombre de claimants ne doit jamais dépasser le plafond,
    ///         et le nombre de pixels frozen ne doit jamais dépasser TOTAL_PIXELS.
    function invariant_caps_respected() public view {
        assertLe(cp.totalClaimants(), cp.MAX_CLAIMANTS(), "CLAIMANTS CAP BREACH");
        assertLe(cp.totalFrozenPixels(), cp.TOTAL_PIXELS(), "FROZEN PIXELS CAP BREACH");
    }

    /// @notice L'owner() du contrat ne doit JAMAIS changer au cours du fuzz :
    ///         Ownable2Step exige un flux en 2 étapes (transferOwnership +
    ///         acceptOwnership côté nouveau owner) que le handler n'invoque
    ///         jamais. Si owner() bougeait quand même, ce serait une faille
    ///         de contrôle d'accès majeure.
    function invariant_owner_never_changes() public view {
        assertEq(cp.owner(), address(this), "OWNER CHANGED UNEXPECTEDLY");
    }

    /// @notice Le guardian actuel du contrat doit toujours correspondre à
    ///         ce que le handler pense avoir fixé en dernier (aucune
    ///         rotation silencieuse ou non autorisée n'a pu se produire).
    function invariant_guardian_matches_handler_tracking() public view {
        assertEq(
            cp.guardian(),
            handler.currentGuardian(),
            "GUARDIAN DESYNC: rotation non trackee ou non autorisee"
        );
    }

    /// @notice rescueERC20 ne doit jamais pouvoir toucher au solde PAINT du
    ///         contrat lui-même (protection CannotRescuePixel) : le solde
    ///         PAINT détenu par le contrat CryptoPixel doit rester nul
    ///         (aucun mécanisme légitime n'envoie de PAINT au contrat).
    function invariant_contract_never_holds_own_token() public view {
        assertEq(cp.balanceOf(address(cp)), 0, "LE CONTRAT DETIENT SON PROPRE TOKEN");
    }

    /// @notice Utilitaire de fin de run : affiche la couverture des chemins
    ///         de code exercés par le fuzzer, ET le volume cumulé de pixels
    ///         frozen poussés via le handler sur ce run (utile pour juger
    ///         si depth/runs approchent réellement du seuil de 10M, ou si
    ///         ça reste très en-dessous — dans ce cas, seul le test
    ///         déterministe de CryptoPixelScale.t.sol garantit le passage
    ///         réel du seuil).
    function invariant_callSummary() public view {
        console.log("freezeBatchCalls          :", handler.freezeBatchCalls());
        console.log("totalPixelsFrozenByHandler:", handler.totalPixelsFrozenByHandler());
        console.log("claimCalls                :", handler.claimCalls());
        console.log("sweepCalls                :", handler.sweepCalls());
        console.log("pauseCalls                :", handler.pauseCalls());
        console.log("unpauseCalls              :", handler.unpauseCalls());
        console.log("guardianRotations         :", handler.guardianRotations());
        console.log("rescueCalls               :", handler.rescueCalls());
        console.log("cp.totalFrozenPixels()    :", cp.totalFrozenPixels());
        console.log("cp.isAirdropUnlocked()    :", cp.isAirdropUnlocked());
        assertTrue(true);
    }
}
