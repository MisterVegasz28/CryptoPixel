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
 * @title  CryptoPixel V5
 * @notice Bonding curve PAINT token. Canvas off-chain (Supabase).
 *         freezePixel / freezeBatch sont les seules actions canvas on-chain :
 *         brûlent 1 PAINT par pixel, pixel(s) permanent(s) et immuables.
 *
 *         Airdrop automatique : une fois le milestone atteint (volume POL OU
 *         pixels frozen), chaque adresse ayant ≥ 20 PAINT ET ≥ 10 pixels frozen
 *         peut réclamer 10 PAINT. Plafonné à 200 000 adresses.
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

    // ── Constantes ────────────────────────────────────────────────────────────
    uint256 public constant MAX_SUPPLY        = 1_000_000_000 * 1e18;
    uint32  public constant TOTAL_PIXELS      = 1_000_000_000;

    // Premine : 2 000 000 marketing (airdrop) + 500 000 team = 2 500 000
    uint256 public constant PREMINE_AMOUNT    = 2_500_000 * 1e18;
    uint256 public constant MAX_PUBLIC_SUPPLY = MAX_SUPPLY - PREMINE_AMOUNT;

    // Bonding curve
    uint256 public constant START_PRICE  = 0.1 ether;
    uint256 public constant PRICE_SLOPE  = 500_000_000;

    // Milestones de déverrouillage (l'un OU l'autre suffit)
    uint256 public constant UNLOCK_VOLUME_THRESHOLD = 100_000_000 ether; // POL déposés
    uint64  public constant UNLOCK_FREEZE_THRESHOLD = 10_000_000;        // pixels frozen

    uint256 public constant MAX_BATCH_FREEZE = 200;

    // Airdrop
    uint256 public constant AIRDROP_AMOUNT   = 10 * 1e18;  // 10 PAINT par adresse
    uint256 public constant MIN_PAINT_HOLD   = 20 * 1e18;  // 20 PAINT minimum en portefeuille
    uint64  public constant MIN_FROZEN_COUNT = 10;          // 10 pixels frozen minimum
    uint256 public constant MAX_CLAIMANTS    = 200_000;     // 200 000 × 10 = 2 000 000 PAINT

    // ── Stockage frozen pixels ────────────────────────────────────────────────
    struct FrozenPixel {
        address owner;  // 160 bits
        uint24  color;  // 24 bits — immuable pour toujours
    }
    mapping(uint32 => FrozenPixel) public frozenPixels;

    // ── Compteurs & volume ────────────────────────────────────────────────────
    uint64  public totalFrozenPixels;
    uint128 public totalVolumeDeposited;

    // ── Freeze par adresse (éligibilité airdrop) ──────────────────────────────
    mapping(address => uint64) public frozenCountByAddress;

    // ── Premine lock ──────────────────────────────────────────────────────────
    mapping(address => uint256) public lockedPremine;
    bool public isAirdropUnlocked;

    // ── Airdrop claim tracking ────────────────────────────────────────────────
    mapping(address => bool) public hasClaimed;
    uint256 public totalClaimants;

    // ── Events ───────────────────────────────────────────────────────────────
    event PixelFrozen       (uint32 indexed pixelId, address indexed owner, uint24 color);
    // G007 — un seul event pour tout le batch au lieu de N events dans la boucle
    event BatchPixelFrozen  (address indexed owner, uint32[] pixelIds, uint24[] colors);
    event TokensBought      (address indexed buyer,  uint256 amount, uint256 cost);
    event TokensSold        (address indexed seller, uint256 amount, uint256 revenue);
    event AirdropUnlocked   (string reason);
    event AirdropClaimed    (address indexed claimer, uint256 amount);
    // L002 — events manquants ajoutés
    event ERC20Rescued      (address indexed token, address indexed to, uint256 amount);
    event CommissionWithdrawn(address indexed to, uint256 amount);

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor() ERC20("CryptoPixel", "PAINT") Ownable(msg.sender) {
        uint256 marketingPart = 2_000_000 * 1e18; // réservé aux claims airdrop
        uint256 teamPart      =   500_000 * 1e18; // équipe, libre de suite
        uint256 totalPremine  = marketingPart + teamPart;

        _mint(msg.sender, totalPremine);

        // Seule la part marketing est verrouillée jusqu'au milestone
        lockedPremine[msg.sender] = marketingPart;
    }

    receive() external payable { revert DirectDepositRejected(); }

    // ── Admin ─────────────────────────────────────────────────────────────────
    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function renounceOwnership() public pure override {
        revert RenounceOwnershipDisabled();
    }

    // L001 — ajout du check amount != 0
    // L002 — ajout de l'event ERC20Rescued
    function rescueERC20(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(this)) revert CannotRescuePixel();
        if (to == address(0))       revert ZeroAddress();
        if (amount == 0)            revert ZeroAmount();   // L001 fix
        IERC20(token).safeTransfer(to, amount);
        emit ERC20Rescued(token, to, amount);              // L002 fix
    }

    // ── Airdrop unlock ────────────────────────────────────────────────────────
    function checkAndUnlockAirdrop() internal returns (bool) {
        if (isAirdropUnlocked) return true;
        if (
            totalVolumeDeposited >= UNLOCK_VOLUME_THRESHOLD ||
            totalFrozenPixels    >= UNLOCK_FREEZE_THRESHOLD
        ) {
            isAirdropUnlocked = true;
            emit AirdropUnlocked("Milestone Reached");
            return true;
        }
        return false;
    }

    // ── Airdrop claim (self-service) ──────────────────────────────────────────
    function claim() external nonReentrant {
        if (!isAirdropUnlocked)                                  revert AirdropNotUnlocked();
        if (totalClaimants >= MAX_CLAIMANTS)                     revert AirdropFull();
        if (hasClaimed[msg.sender])                              revert AlreadyClaimed();
        if (balanceOf(msg.sender) < MIN_PAINT_HOLD)              revert NotEnoughPaint();
        if (frozenCountByAddress[msg.sender] < MIN_FROZEN_COUNT) revert NotEnoughFrozen();

        // G014 — cache owner() pour éviter plusieurs SLOADs
        address ownerAddr = owner();
        if (balanceOf(_owner) < AIRDROP_AMOUNT) revert InsufficientAirdropReserve();

        hasClaimed[msg.sender] = true;
        unchecked { totalClaimants++; }

        // Décrémente le lock marketing au fil des claims
        // Pas d'overflow possible : totalClaimants < MAX_CLAIMANTS garantit
        // que la somme totale des claims ne dépasse pas marketingPart (2 000 000 PAINT)
        lockedPremine[_owner] -= AIRDROP_AMOUNT;

        _transfer(_owner, msg.sender, AIRDROP_AMOUNT);
        emit AirdropClaimed(msg.sender, AIRDROP_AMOUNT);
    }

    // ── ERC20 override (locked premine) ───────────────────────────────────────
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && !isAirdropUnlocked) {
            uint256 locked = lockedPremine[from];
            // G003 — != 0 moins cher que > 0 pour les unsigned integers
            if (locked != 0) {
                uint256 bal = balanceOf(from);
                if (bal < value) revert InsufficientBalance();
                unchecked { if (bal - value < locked) revert TokensLocked(); }
            }
        }
        super._update(from, to, value);
    }

    // ── Bonding curve ─────────────────────────────────────────────────────────
    function getPrice(uint256 supplyInTokens, uint256 amountInTokens) public pure returns (uint256) {
        // G011 — >> 1 (SHR, 3 gas) au lieu de / 2 (DIV, 5 gas)
        return (START_PRICE * amountInTokens)
             + ((PRICE_SLOPE * ((2 * supplyInTokens * amountInTokens) + (amountInTokens * amountInTokens))) >> 1);
    }

    function _publicSupply() internal view returns (uint256) {
        unchecked {
            uint256 virtualSupply = totalSupply() + (uint256(totalFrozenPixels) * 1e18);
            return (virtualSupply <= PREMINE_AMOUNT) ? 0 : virtualSupply - PREMINE_AMOUNT;
        }
    }

    // ── Buy ───────────────────────────────────────────────────────────────────
    function buyTokens(uint256 amount, uint256 maxCost) external payable nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (amount > MAX_PUBLIC_SUPPLY / 1e18) revert AmountTooLarge();

        // M002 — overflow impossible : amount est borné par MAX_PUBLIC_SUPPLY / 1e18
        // donc amount * 1e18 ≤ MAX_PUBLIC_SUPPLY ≈ 9.975e26 << uint256.max
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
            // M002 — overflow impossible : garanti par le check msg.value > cost ci-dessus
            unchecked { refund = msg.value - cost; }
            payable(msg.sender).sendValue(refund);
        }
    }

    // ── Sell ──────────────────────────────────────────────────────────────────
    function sellTokens(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (amount > MAX_PUBLIC_SUPPLY / 1e18) revert AmountTooLarge();

        // M002 — même raisonnement que buyTokens
        uint256 tokenAmount;
        unchecked { tokenAmount = amount * 1e18; }

        checkAndUnlockAirdrop();
        uint256 publicSupply = _publicSupply();
        if (publicSupply < tokenAmount) revert PublicSupplyUnderflow();

        uint256 revenue;
        // M002 — overflow impossible : publicSupply >= tokenAmount garanti par le check ci-dessus
        unchecked { revenue = getPrice((publicSupply - tokenAmount) / 1e18, amount); }

        if (address(this).balance < revenue) revert InsufficientLiquidity();

        uint256 vol = totalVolumeDeposited;
        if (vol > revenue) {
            unchecked { totalVolumeDeposited = uint128(vol - revenue); }
        } else {
            // G005 — delete plus gas-efficient que = 0 (libère le storage slot)
            delete totalVolumeDeposited;
        }

        _burn(msg.sender, tokenAmount);
        emit TokensSold(msg.sender, amount, revenue);

        payable(msg.sender).sendValue(revenue);
    }

    // ── Freeze pixel (unitaire) ───────────────────────────────────────────────
    function freezePixel(uint32 pixelId, uint24 color) external nonReentrant whenNotPaused {
        if (pixelId >= TOTAL_PIXELS)                            revert OutOfBounds();
        if (color == 0)                                         revert InvalidColor();
        if (frozenPixels[pixelId].owner != address(0))          revert PixelAlreadyFrozen();
        if (balanceOf(msg.sender) < 1e18)                       revert NotEnoughTokens();

        // ✅ CEI : burn avant les écritures storage
        _burn(msg.sender, 1e18);

        frozenPixels[pixelId] = FrozenPixel({ owner: msg.sender, color: color });
        unchecked {
            totalFrozenPixels++;
            frozenCountByAddress[msg.sender]++;
        }
        emit PixelFrozen(pixelId, msg.sender, color);
        checkAndUnlockAirdrop();
    }

    // ── Freeze batch (lot) ────────────────────────────────────────────────────
    // M001 — les deux arrays sont vérifiés : len != colors.length + len > MAX_BATCH_FREEZE
    // garantissent que tous les accès pixelIds[i] et colors[i] sont dans les bornes
    function freezeBatch(uint32[] calldata pixelIds, uint24[] calldata colors) external nonReentrant whenNotPaused {
        uint256 len = pixelIds.length;
        if (len == 0)               revert EmptyList();
        if (len != colors.length)   revert ArrayLengthMismatch();
        if (len > MAX_BATCH_FREEZE) revert BatchTooLarge();

        // M002 — overflow impossible : len ≤ MAX_BATCH_FREEZE = 200
        // donc totalCost ≤ 200 * 1e18 = 2e20 << uint256.max
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
            if (frozenPixels[pixelId].owner != address(0)) revert PixelAlreadyFrozen();

            frozenPixels[pixelId] = FrozenPixel({ owner: msg.sender, color: color });

            unchecked { ++i; }
        }

        unchecked {
            totalFrozenPixels               += uint64(len);
            frozenCountByAddress[msg.sender] += uint64(len);
        }

        // G007 — un seul event pour le batch entier au lieu de N events dans la boucle
        // Économie estimée : (N-1) × ~1300 gas sur les opcodes LOG
        emit BatchPixelFrozen(msg.sender, pixelIds, colors);
        checkAndUnlockAirdrop();
    }

    // ── Getters ───────────────────────────────────────────────────────────────

    // G015 — storage pointer au lieu de memory copy (évite des SLOADs inutiles)
    function getFrozenPixel(uint32 pixelId) external view returns (address, uint24) {
        FrozenPixel storage p = frozenPixels[pixelId];
        return (p.owner, p.color);
    }

    // ── Commission owner ──────────────────────────────────────────────────────
    // L002 — event CommissionWithdrawn ajouté
    function withdrawCommission() external onlyOwner {
        uint256 publicSupply = _publicSupply();
        uint256 frozen = totalFrozenPixels;

        // M002 — overflow impossible : frozen est uint64 (max ~1.8e19)
        // frozen * 1e18 ≤ 1.8e19 * 1e18 = 1.8e37 << uint256.max
        uint256 frozenVal;
        unchecked { frozenVal = frozen * 1e18; }

        uint256 activeSupply = (publicSupply > frozenVal) ? publicSupply - frozenVal : 0;

        // M002 — overflow impossible : activeSupply ≤ MAX_PUBLIC_SUPPLY ≈ 9.975e26
        // activeSupply + 1e18 ≈ 9.975e26 + 1e18 ≈ 9.975e26 << uint256.max
        uint256 activeTokens;
        unchecked { activeTokens = (activeSupply + 1e18 - 1) / 1e18; }

        uint256 requiredLiquidity = getPrice(frozen, activeTokens);
        uint256 currentBalance = address(this).balance;

        if (currentBalance <= requiredLiquidity) revert NoSurplus();

        uint256 surplus;
        unchecked { surplus = currentBalance - requiredLiquidity; }

        address _owner = owner();
        payable(_owner).sendValue(surplus);
        emit CommissionWithdrawn(_owner, surplus);  // L002 fix
    }
}