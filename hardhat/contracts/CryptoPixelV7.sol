// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/Address.sol";

/**
 * @title  CryptoPixel V7
 * @author rapport payant
 * @notice Bonding curve PAINT token. Canvas off-chain (Supabase).
 *         freezePixel / freezeBatch sont les seules actions canvas on-chain :
 *         brûlent 1 PAINT par pixel, pixel(s) permanent(s) et immuables.
 *
 *         Airdrop automatique : une fois le milestone de pixels frozen
 *         atteint, chaque adresse ayant ≥ 20 PAINT ET ≥ 10 pixels frozen
 *         peut réclamer 10 PAINT. Plafonné à 200 000 adresses.
 * @dev    V7 — Changements suite à l'audit SolidityScan du 30/06/2026 :
 *
 *         [M001 - FIX] Le critère d'unlock par volume POL a été entièrement
 *         retiré : il était manipulable de façon atomique via flashloan
 *         (achat massif + revente immédiate dans la même transaction).
 *         Seul le critère "pixels frozen" déclenche désormais l'unlock,
 *         car il nécessite un burn réel et irréversible de PAINT.
 *
 *         [M002 - FIX] Le premine n'est plus rattaché à owner(). Une adresse
 *         dédiée et immuable, premineHolder, est fixée une fois pour toutes
 *         au déploiement et sert de référence pour claim() et
 *         sweepUnclaimedPremine(). Un transferOwnership() (ex: passage à un
 *         TimelockController/Safe) ne casse donc plus la distribution de
 *         l'airdrop ni ne bloque définitivement le reliquat de premine.
 *         ⚠️ Important : le lock étant permanent et lié à premineHolder,
 *         déployer ce contrat directement depuis l'adresse de garde finale
 *         (ex: le Safe) est recommandé plutôt que depuis un EOA de deploy,
 *         car les tokens premine ne peuvent structurellement sortir de
 *         premineHolder que via claim() ou sweepUnclaimedPremine().
 *
 *         Issues gas/info SolidityScan également traitées (détail dans le
 *         changelog livré séparément). Les 14 constantes restent `public`
 *         (contrairement à la suggestion gas G011 du scanner) car
 *         l'indexer et le frontend en dépendent via l'ABI on-chain.
 */
contract CryptoPixel is ERC20, Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using Address for address payable;

    // ── Custom Errors ─────────────────────────────────────────────────────────
    error ZeroAmount();
    error MaxSupplyReached();
    error SlippageExceeded();
    error InsufficientPayment();
    error PublicSupplyUnderflow();
    error InsufficientLiquidity();
    error NotEnoughTokens();
    error PixelAlreadyFrozen();
    error OutOfBounds();
    error NoSurplus();
    error EmptyList();
    error CannotRescuePixel();
    error ZeroAddress();
    error InsufficientBalance();
    error TokensLocked();
    error DirectDepositRejected();
    error AmountTooLarge();
    error RenounceOwnershipDisabled();
    error VolumeOverflow();
    error InvalidColor();
    error ArrayLengthMismatch();
    error BatchTooLarge();
    error AirdropNotUnlocked();
    error AirdropFull();
    error AlreadyClaimed();
    error NotEnoughPaint();
    error NotEnoughFrozen();
    error InsufficientAirdropReserve();
    error NotGuardian();
    error SweepTooEarly();
    error NothingToSweep();

    // ── Constantes ────────────────────────────────────────────────────────────
    // G011 — laissées en `public` (et non `private` comme suggéré par
    // SolidityScan) : l'indexer/le frontend en dépendent pour lire ces
    // valeurs on-chain via l'ABI, donc le gain de gas marginal ne vaut pas
    // la casse d'infra que provoquerait leur retrait des getters.
    uint256 public constant MAX_SUPPLY        = 1_000_000_000 * 1e18;
    uint32  public constant TOTAL_PIXELS      = 1_000_000_000;

    // Premine : 2 000 000 marketing (airdrop)
    uint256 public constant PREMINE_AMOUNT    = 2_000_000 * 1e18;
    uint256 public constant MAX_PUBLIC_SUPPLY = MAX_SUPPLY - PREMINE_AMOUNT;

    // Bonding curve
    uint256 public constant START_PRICE  = 0.1 ether;
    uint256 public constant PRICE_SLOPE  = 500_000_000;

    // Milestone de déverrouillage de l'airdrop : uniquement les pixels
    // frozen (le critère volume POL a été retiré — il nécessitait un délai
    // de confirmation anti-flashloan jugé inutilement complexe pour ce projet).
    uint64  public constant UNLOCK_FREEZE_THRESHOLD = 10_000_000; // pixels frozen

    uint256 public constant MAX_BATCH_FREEZE = 200;

    // Airdrop
    uint256 public constant AIRDROP_AMOUNT   = 10 * 1e18;  // 10 PAINT par adresse
    uint256 public constant MIN_PAINT_HOLD   = 20 * 1e18;  // 20 PAINT minimum en portefeuille
    uint64  public constant MIN_FROZEN_COUNT = 10;          // 10 pixels frozen minimum
    uint256 public constant MAX_CLAIMANTS    = 200_000;     // 200 000 × 10 = 2 000 000 PAINT

    // Sweep
    uint256 public constant SWEEP_DELAY = 730 days; // ~2 ans

    // ── Stockage frozen pixels ────────────────────────────────────────────────
    /// @notice Pixel gelé : propriétaire et couleur, immuables pour toujours.
    struct FrozenPixel {
        address owner;  // 160 bits
        uint24  color;  // 24 bits — immuable pour toujours
    }
    /// @notice pixelId => pixel gelé correspondant (owner == address(0) si non gelé).
    mapping(uint32 pixelId => FrozenPixel pixel) public frozenPixels;

    // G010 — frozenCountByAddress + hasClaimed combinés dans une seule struct
    // / un seul mapping, ce qui permet de partager le même slot de storage
    // (un uint64 + un bool tiennent dans 32 bytes) et donc d'économiser une
    // SSTORE/SLOAD à chaque fois que claim() touche les deux à la fois.
    // L'interface publique (frozenCountByAddress(address), hasClaimed(address))
    // est préservée via les getters explicites ci-dessous : aucune rupture
    // d'ABI pour le frontend/les intégrations existantes.
    struct AddressData {
        uint64 frozenCount;
        bool   claimed;
    }
    mapping(address account => AddressData data) private _addressData;

    /// @notice Nombre de pixels gelés par une adresse (condition d'éligibilité airdrop).
    function frozenCountByAddress(address account) external view returns (uint64) {
        return _addressData[account].frozenCount;
    }

    /// @notice Indique si une adresse a déjà réclamé l'airdrop.
    function hasClaimed(address account) external view returns (bool) {
        return _addressData[account].claimed;
    }

    // ── Compteurs & volume ────────────────────────────────────────────────────
    /// @notice Nombre total de pixels gelés sur l'ensemble du canvas.
    uint64  public totalFrozenPixels;
    /// @notice Volume total (net) de POL déposé via buyTokens/sellTokens (statistique uniquement, n'est plus utilisé pour l'unlock de l'airdrop).
    uint128 public totalVolumeDeposited;

    // ── Premine lock ──────────────────────────────────────────────────────────
    /// @notice account => montant de PAINT verrouillé (premine), tant que > 0.
    mapping(address account => uint256 amount) public lockedPremine;
    /// @notice true une fois qu'un des deux milestones d'unlock est atteint.
    bool public isAirdropUnlocked;

    // [M002] Adresse dédiée et immuable détenant le premine, indépendante de
    // owner(). Fixée une fois pour toutes au déploiement : un transfert
    // d'ownership ultérieur (ex: vers un TimelockController) ne déplace
    // jamais la référence utilisée par claim() / sweepUnclaimedPremine().
    address public immutable premineHolder;

    // ── Airdrop claim tracking ────────────────────────────────────────────────
    /// @notice Nombre total d'adresses ayant réclamé l'airdrop.
    uint256 public totalClaimants;

    // ── Guardian ──────────────────────────────────────────────────────────────
    /// @notice Adresse habilitée à pause()/unpause() instantanément.
    address public guardian;

    // ── Sweep timestamp ───────────────────────────────────────────────────────
    /// @notice Horodatage de déploiement, sert de référence pour SWEEP_DELAY.
    uint256 public immutable deployedAt;

    // ── Events ───────────────────────────────────────────────────────────────
    event PixelFrozen        (uint32 indexed pixelId, address indexed owner, uint24 color);
    event BatchPixelFrozen   (address indexed owner, uint32[] pixelIds, uint24[] colors);
    event TokensBought       (address indexed buyer,  uint256 amount, uint256 cost);
    event TokensSold         (address indexed seller, uint256 amount, uint256 revenue);
    event AirdropUnlocked    (string reason);
    event AirdropClaimed     (address indexed claimer, uint256 amount);
    event ERC20Rescued       (address indexed token, address indexed to, uint256 amount);
    event CommissionWithdrawn(address indexed to, uint256 amount);
    event GuardianUpdated    (address indexed oldGuardian, address indexed newGuardian);
    event PremineSwept       (address indexed to, uint256 amount);

    /// @notice Initialise le token, mint le premine, et fixe guardian/premineHolder.
    /// @dev    G006 — constructeur payable : économise ~10 opcodes. Tout POL
    ///         envoyé par erreur lors du déploiement reste captable plus tard
    ///         via le mécanisme de surplus de withdrawCommission().
    constructor() payable ERC20("CryptoPixel", "PAINT") Ownable(msg.sender) {
        deployedAt     = block.timestamp;
        guardian       = msg.sender; // à transférer au guardian opérationnel juste après déploiement
        premineHolder  = msg.sender; // ⚠️ voir note de tête de fichier : déployer depuis l'adresse de garde finale est recommandé

        // 2 000 000 PAINT réservés aux claims airdrop, tout verrouillé jusqu'au milestone
        _mint(premineHolder, PREMINE_AMOUNT);
        lockedPremine[premineHolder] = PREMINE_AMOUNT;
    }

    receive() external payable { revert DirectDepositRejected(); }

    // ── Guardian ──────────────────────────────────────────────────────────────
    modifier onlyGuardian() {
        if (msg.sender != guardian) revert NotGuardian();
        _;
    }

    /// @notice Met à jour le guardian habilité à pause()/unpause().
    /// @dev    Passe par onlyOwner (= TimelockController en prod), donc tout
    ///         changement de guardian respecte quand même le délai du timelock.
    function setGuardian(address newGuardian) external onlyOwner {
        if (newGuardian == address(0)) revert ZeroAddress();
        // G002 — évite une SSTORE + un event no-op si la valeur ne change pas
        if (newGuardian == guardian) return;
        emit GuardianUpdated(guardian, newGuardian);
        guardian = newGuardian;
    }

    // ── Admin ─────────────────────────────────────────────────────────────────
    /// @notice Met le contrat en pause (frein d'urgence, instantané).
    function pause() external onlyGuardian { _pause(); }

    /// @notice Lève la pause (frein d'urgence, instantané).
    function unpause() external onlyGuardian { _unpause(); }

    /// @inheritdoc Ownable
    function renounceOwnership() public pure override {
        revert RenounceOwnershipDisabled();
    }

    /// @notice Permet à l'owner de récupérer des ERC20 envoyés par erreur au contrat.
    function rescueERC20(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(this)) revert CannotRescuePixel();
        if (to == address(0))       revert ZeroAddress();
        if (amount == 0)            revert ZeroAmount();
        IERC20(token).safeTransfer(to, amount);
        emit ERC20Rescued(token, to, amount);
    }

    // ── Sweep du premine non réclamé ──────────────────────────────────────────
    /// @notice Récupère le reliquat de premine si MAX_CLAIMANTS n'est jamais atteint.
    /// @dev    Passe par onlyOwner (= TimelockController en prod), donc soumis
    ///         au délai du timelock — ce n'est pas une action d'urgence, la
    ///         communauté doit pouvoir voir venir un sweep massif avant
    ///         qu'il ne s'exécute. [M002] La source des fonds est toujours
    ///         premineHolder, jamais owner(), donc indépendante de tout
    ///         transfert d'ownership passé ou futur.
    function sweepUnclaimedPremine(address to) external onlyOwner {
        if (block.timestamp < deployedAt + SWEEP_DELAY) revert SweepTooEarly();
        if (to == address(0)) revert ZeroAddress();

        uint256 remaining = lockedPremine[premineHolder];
        if (remaining == 0) revert NothingToSweep();

        // Déverrouille avant le transfert pour que _update laisse passer
        lockedPremine[premineHolder] = 0;
        _transfer(premineHolder, to, remaining);

        emit PremineSwept(to, remaining);
    }

    // ── Airdrop unlock ────────────────────────────────────────────────────────
    /// @notice Vérifie et, le cas échéant, déclenche l'unlock de l'airdrop.
    /// @dev    Seul le critère "pixels frozen" déclenche l'unlock (un burn
    ///         réel et irréversible de PAINT, non manipulable en une seule
    ///         transaction). Le critère volume POL a été retiré.
    function checkAndUnlockAirdrop() internal returns (bool) {
        if (isAirdropUnlocked) return true;

        if (totalFrozenPixels >= UNLOCK_FREEZE_THRESHOLD) {
            isAirdropUnlocked = true;
            emit AirdropUnlocked("Freeze Milestone Reached");
            return true;
        }

        return false;
    }

    // ── Airdrop claim (self-service) ──────────────────────────────────────────
    /// @notice Permet à une adresse éligible de réclamer 10 PAINT.
    function claim() external nonReentrant {
        if (!isAirdropUnlocked)                                  revert AirdropNotUnlocked();
        if (totalClaimants >= MAX_CLAIMANTS)                     revert AirdropFull();

        AddressData storage data = _addressData[msg.sender];
        if (data.claimed)                                        revert AlreadyClaimed();
        if (balanceOf(msg.sender) < MIN_PAINT_HOLD)              revert NotEnoughPaint();
        if (data.frozenCount < MIN_FROZEN_COUNT)                 revert NotEnoughFrozen();

        // [M002] La réserve d'airdrop est toujours lue depuis premineHolder,
        // jamais depuis owner() — indépendant de tout transfert d'ownership.
        if (balanceOf(premineHolder) < AIRDROP_AMOUNT) revert InsufficientAirdropReserve();

        data.claimed = true;
        unchecked { totalClaimants++; }

        // Décrémente le lock marketing au fil des claims
        // Pas d'overflow possible : totalClaimants < MAX_CLAIMANTS garantit
        // que la somme totale des claims ne dépasse pas marketingPart (2 000 000 PAINT)
        lockedPremine[premineHolder] -= AIRDROP_AMOUNT;

        _transfer(premineHolder, msg.sender, AIRDROP_AMOUNT);
        emit AirdropClaimed(msg.sender, AIRDROP_AMOUNT);
    }

    // ── ERC20 override (locked premine) ───────────────────────────────────────
    /// @inheritdoc ERC20
    /// @dev Le verrou est permanent : il ne dépend pas de isAirdropUnlocked.
    ///      Le seul moyen de faire baisser lockedPremine est le décrément
    ///      dans claim(), donc seuls les claims utilisateurs peuvent faire
    ///      sortir des tokens du wallet premine — jamais un transfert libre.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0)) {
            uint256 locked = lockedPremine[from];
            if (locked != 0) {
                uint256 bal = balanceOf(from);
                if (bal < value) revert InsufficientBalance();
                unchecked { if (bal - value < locked) revert TokensLocked(); }
            }
        }
        super._update(from, to, value);
    }

    // ── Bonding curve ─────────────────────────────────────────────────────────
    /// @notice Calcule le coût de `amountInTokens` tokens à partir de `supplyInTokens`.
    function getPrice(uint256 supplyInTokens, uint256 amountInTokens) public pure returns (uint256) {
        return (START_PRICE * amountInTokens)
             + ((PRICE_SLOPE * ((2 * supplyInTokens * amountInTokens) + (amountInTokens * amountInTokens))) >> 1);
    }

    /// @dev Réintègre virtuellement les pixels frozen (burnés) dans le calcul
    ///      du prix afin que la bonding curve ne s'effondre pas après un freeze.
    function _publicSupply() internal view returns (uint256) {
        unchecked {
            uint256 virtualSupply = totalSupply() + (uint256(totalFrozenPixels) * 1e18);
            return (virtualSupply <= PREMINE_AMOUNT) ? 0 : virtualSupply - PREMINE_AMOUNT;
        }
    }

    // ── Buy ───────────────────────────────────────────────────────────────────
    /// @notice Achète `amount` tokens PAINT le long de la bonding curve.
    function buyTokens(uint256 amount, uint256 maxCost) external payable nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (amount > MAX_PUBLIC_SUPPLY / 1e18) revert AmountTooLarge();

        uint256 tokenAmount;
        unchecked { tokenAmount = amount * 1e18; }

        uint256 publicSupply = _publicSupply();
        if (publicSupply + tokenAmount > MAX_PUBLIC_SUPPLY) revert MaxSupplyReached();

        uint256 cost = getPrice(publicSupply / 1e18, amount);
        if (cost > maxCost)    revert SlippageExceeded();
        if (msg.value < cost)  revert InsufficientPayment();

        uint256 newVol = uint256(totalVolumeDeposited) + cost;
        if (newVol > type(uint128).max) revert VolumeOverflow();
        totalVolumeDeposited = uint128(newVol);

        _mint(msg.sender, tokenAmount);
        emit TokensBought(msg.sender, amount, cost);
        checkAndUnlockAirdrop();

        if (msg.value > cost) {
            uint256 refund;
            unchecked { refund = msg.value - cost; }
            payable(msg.sender).sendValue(refund);
        }
    }

    // ── Sell ──────────────────────────────────────────────────────────────────
    /// @notice Revend `amount` tokens PAINT le long de la bonding curve.
    /// @dev minRevenue = 0 désactive la protection anti-slippage / sandwich.
    function sellTokens(uint256 amount, uint256 minRevenue) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (amount > MAX_PUBLIC_SUPPLY / 1e18) revert AmountTooLarge();

        uint256 tokenAmount;
        unchecked { tokenAmount = amount * 1e18; }

        checkAndUnlockAirdrop();
        uint256 publicSupply = _publicSupply();
        if (publicSupply < tokenAmount) revert PublicSupplyUnderflow();

        // M004 — overflow impossible : publicSupply >= tokenAmount garanti
        // par le check ci-dessus. La soustraction (seule opération concernée)
        // est isolée dans son propre bloc unchecked, getPrice() reste appelée
        // avec son arithmétique interne normalement vérifiée.
        uint256 supplyAfter;
        unchecked { supplyAfter = publicSupply - tokenAmount; }
        uint256 revenue = getPrice(supplyAfter / 1e18, amount);

        if (revenue < minRevenue) revert SlippageExceeded();
        if (address(this).balance < revenue) revert InsufficientLiquidity();

        uint256 vol = totalVolumeDeposited;
        if (vol > revenue) {
            unchecked { totalVolumeDeposited = uint128(vol - revenue); }
        } else {
            delete totalVolumeDeposited;
        }

        _burn(msg.sender, tokenAmount);
        emit TokensSold(msg.sender, amount, revenue);

        payable(msg.sender).sendValue(revenue);
    }

    // ── Freeze pixel (unitaire) ───────────────────────────────────────────────
    /// @notice Brûle 1 PAINT pour geler définitivement un pixel à une couleur.
    function freezePixel(uint32 pixelId, uint24 color) external nonReentrant whenNotPaused {
        if (pixelId >= TOTAL_PIXELS)                            revert OutOfBounds();
        if (color == 0)                                         revert InvalidColor();
        if (frozenPixels[pixelId].owner != address(0))          revert PixelAlreadyFrozen();
        if (balanceOf(msg.sender) < 1e18)                       revert NotEnoughTokens();

        // ✅ CEI : burn avant les écritures storage
        _burn(msg.sender, 1e18);

        // G001 — écriture champ par champ via un storage pointer plutôt qu'un
        // literal de struct complet : les deux champs tiennent dans le même
        // slot (address + uint24), donc une seule SSTORE au final, mais ceci
        // documente explicitement l'intention et évite toute construction
        // intermédiaire en mémoire.
        FrozenPixel storage p = frozenPixels[pixelId];
        p.owner = msg.sender;
        p.color = color;

        unchecked {
            totalFrozenPixels++;
            _addressData[msg.sender].frozenCount++;
        }
        emit PixelFrozen(pixelId, msg.sender, color);
        checkAndUnlockAirdrop();
    }

    // ── Freeze batch (lot) ────────────────────────────────────────────────────
    /// @notice Brûle len PAINT pour geler définitivement un lot de pixels.
    function freezeBatch(uint32[] calldata pixelIds, uint24[] calldata colors) external nonReentrant whenNotPaused {
        uint256 len = pixelIds.length;
        if (len == 0)               revert EmptyList();
        if (len != colors.length)   revert ArrayLengthMismatch();
        if (len > MAX_BATCH_FREEZE) revert BatchTooLarge();

        uint256 totalCost;
        unchecked { totalCost = len * 1e18; }
        if (balanceOf(msg.sender) < totalCost) revert NotEnoughTokens();

        // ✅ CEI : burn avant les écritures storage
        _burn(msg.sender, totalCost);

        for (uint256 i = 0; i < len; ) {
            uint32 pixelId = pixelIds[i];
            uint24 color   = colors[i];

            if (pixelId >= TOTAL_PIXELS)                   revert OutOfBounds();
            if (color == 0)                                revert InvalidColor();

            FrozenPixel storage p = frozenPixels[pixelId];
            if (p.owner != address(0)) revert PixelAlreadyFrozen();
            p.owner = msg.sender;
            p.color = color;

            unchecked { ++i; }
        }

        unchecked {
            totalFrozenPixels += uint64(len);
            _addressData[msg.sender].frozenCount += uint64(len);
        }

        // G007 (legacy) — un seul event pour le batch entier au lieu de N
        // events dans la boucle.
        emit BatchPixelFrozen(msg.sender, pixelIds, colors);
        checkAndUnlockAirdrop();
    }

    // ── Getters ───────────────────────────────────────────────────────────────

    /// @notice Retourne le propriétaire et la couleur d'un pixel gelé.
    function getFrozenPixel(uint32 pixelId) external view returns (address, uint24) {
        FrozenPixel storage p = frozenPixels[pixelId];
        return (p.owner, p.color);
    }

    // ── Commission owner ──────────────────────────────────────────────────────
    /// @notice Retire le surplus de POL au-delà de la liquidité requise par la bonding curve.
    function withdrawCommission() external onlyOwner {
        uint256 publicSupply = _publicSupply();
        uint256 frozen = totalFrozenPixels;

        uint256 frozenVal;
        unchecked { frozenVal = frozen * 1e18; }

        uint256 activeSupply = (publicSupply > frozenVal) ? publicSupply - frozenVal : 0;

        // FIX : réintègre les tokens premine déjà distribués via claim(), qui
        // sont désormais des soldes réels et vendables, pas du premine verrouillé.
        uint256 claimedAirdropTokens = totalClaimants * AIRDROP_AMOUNT;
        activeSupply += claimedAirdropTokens;
        
        uint256 activeTokens;
        unchecked { activeTokens = (activeSupply + 1e18 - 1) / 1e18; }

        uint256 requiredLiquidity = getPrice(frozen, activeTokens);
        uint256 currentBalance = address(this).balance;

        if (currentBalance <= requiredLiquidity) revert NoSurplus();

        uint256 surplus;
        unchecked { surplus = currentBalance - requiredLiquidity; }

        address ownerAddr = owner();
        payable(ownerAddr).sendValue(surplus);
        emit CommissionWithdrawn(ownerAddr, surplus);
    }
}
