// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title CryptoPixel V4
 * @notice Bonding curve PAINT token. Canvas off-chain (Supabase).
 *         freezePixel / freezeBatch sont les seules actions canvas on-chain :
 *         brûlent 1 PAINT par pixel, pixel(s) permanent(s) et immuables — y compris pour le propriétaire.
 */
contract CryptoPixel is ERC20, Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ── Custom Errors ─────────────────────────────────────────────────────────
    error ZeroAmount();
    error MaxSupplyReached();
    error SlippageExceeded();
    error InsufficientPayment();
    error RefundFailed();
    error PublicSupplyUnderflow();
    error InsufficientLiquidity();
    error TransferFailed();
    error NotEnoughTokens();
    error NotOwner();
    error PixelAlreadyFrozen();
    error OutOfBounds();
    error NoSurplus();
    error WithdrawFailed();
    error EmptyList();
    error TooManyRecipients();
    error InsufficientPremine();
    error InvalidRecipient();
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

    // ── Constantes ────────────────────────────────────────────────────────────
    uint256 public constant MAX_SUPPLY     = 1_000_000_000 * 1e18;
    uint32 public constant TOTAL_PIXELS = 1_000_000_000;
    uint256 public constant PREMINE_AMOUNT = 300_000 * 1e18;
    uint256 public constant MAX_PUBLIC_SUPPLY = MAX_SUPPLY - PREMINE_AMOUNT;

    uint256 public constant START_PRICE = 0.1 ether;
    uint256 public constant PRICE_SLOPE = 0.0000000005 ether;

    uint256 public constant unlockThreshold   = 100_000_000 ether;

    uint256 public constant MAX_BATCH_FREEZE = 200;

    // ── Stockage frozen pixels ────────────────────────────────────────────────
    // Seuls les pixels frozen sont stockés on-chain
    struct FrozenPixel {
        address owner;   // 160 bits
        uint24  color;   // 24 bits  — couleur au moment du freeze, immuable pour toujours
    }
    mapping(uint32 => FrozenPixel) public frozenPixels;

    // ── Compteurs & volume ────────────────────────────────────────────────────
    uint64  public totalFrozenPixels;
    uint128 public totalVolumeDeposited;

    // ── Airdrop & Lock ────────────────────────────────────────────────────────
    mapping(address => uint256) public lockedPremine;
    bool    public isAirdropUnlocked;

    // ── Events ───────────────────────────────────────────────────────────────
    event PixelFrozen    (uint32 indexed pixelId, address indexed owner, uint24 color);
    event TokensBought   (address indexed buyer,  uint256 amount, uint256 cost);
    event TokensSold     (address indexed seller, uint256 amount, uint256 revenue);
    event AirdropUnlocked(string reason);
    event AirdropDistributed(uint256 recipientCount, uint256 amountPerUser);

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor() ERC20("CryptoPixel", "PAINT") Ownable(msg.sender) {
        uint256 marketingPart = 200_000 * 1e18;
        uint256 teamPart      =  100_000 * 1e18;
        uint256 totalPremine  = marketingPart + teamPart;

        _mint(msg.sender, totalPremine);
        lockedPremine[msg.sender] = marketingPart;
    }

    receive() external payable { revert DirectDepositRejected(); }

    // ── Admin ─────────────────────────────────────────────────────────────────
    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function renounceOwnership() public pure override {
        revert RenounceOwnershipDisabled();
    }

    function distributeAirdrop(address[] calldata recipients, uint256 amountPerUser) external onlyOwner {
        if (amountPerUser == 0) revert ZeroAmount();
        uint256 len = recipients.length;
        if (len == 0) revert EmptyList();
        if (len > 150) revert TooManyRecipients();

        uint256 total = len * amountPerUser;
        uint256 ownerLocked = lockedPremine[msg.sender];
        if (ownerLocked < total) revert InsufficientPremine();
        unchecked { lockedPremine[msg.sender] = ownerLocked - total; }

        for (uint256 i = 0; i < len; ) {
            address rec = recipients[i];
            if (rec == address(0)) revert InvalidRecipient();
            unchecked { lockedPremine[rec] += amountPerUser; }
            _transfer(msg.sender, rec, amountPerUser);
            unchecked { ++i; }
        }
        emit AirdropDistributed(len, amountPerUser);
    }

    function rescueERC20(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(this)) revert CannotRescuePixel();
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
    }

   // ── Airdrop unlock ────────────────────────────────────────────────────────
    function checkAndUnlockAirdrop() public returns (bool) {
        if (isAirdropUnlocked) return true;
        
        // On vérifie le volume en MATIC (totalVolumeDeposited)
        if (totalVolumeDeposited >= unlockThreshold) {
            isAirdropUnlocked = true;
            emit AirdropUnlocked("Volume Milestone Reached");
            return true;
        }
        return false;
    }

    // ── ERC20 override (locked premine) ───────────────────────────────────────
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && !isAirdropUnlocked) {
            uint256 locked = lockedPremine[from];
            if (locked > 0) {
                uint256 bal = balanceOf(from);
                if (bal < value) revert InsufficientBalance();
                unchecked { if (bal - value < locked) revert TokensLocked(); }
            }
        }
        super._update(from, to, value);
    }

    // ── Bonding curve ─────────────────────────────────────────────────────────
    function getPrice(uint256 supplyInTokens, uint256 amountInTokens) public pure returns (uint256) {
        return (START_PRICE * amountInTokens)
             + ((PRICE_SLOPE * ((2 * supplyInTokens * amountInTokens) + (amountInTokens * amountInTokens))) / 2);
    }

    function _publicSupply() internal view returns (uint256) {
        unchecked {
            uint256 virtualSupply = totalSupply()
                + (uint256(totalFrozenPixels) * 1e18);
            return (virtualSupply <= PREMINE_AMOUNT) ? 0 : virtualSupply - PREMINE_AMOUNT;
        }
    }

    function buyTokens(uint256 amount, uint256 maxCost) external payable nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (amount > MAX_PUBLIC_SUPPLY / 1e18) revert AmountTooLarge();

        uint256 tokenAmount;
        unchecked { tokenAmount = amount * 1e18; }

        uint256 publicSupply = _publicSupply();
        if (publicSupply + tokenAmount > MAX_PUBLIC_SUPPLY) revert MaxSupplyReached();

        uint256 cost = getPrice(publicSupply / 1e18, amount);
        if (cost > maxCost) revert SlippageExceeded();
        if (msg.value < cost) revert InsufficientPayment();

        uint256 newVol = uint256(totalVolumeDeposited) + cost;
        if (newVol > type(uint128).max) revert VolumeOverflow();
        totalVolumeDeposited = uint128(newVol);

        _mint(msg.sender, tokenAmount);
        emit TokensBought(msg.sender, amount, cost);
        checkAndUnlockAirdrop();

        if (msg.value > cost) {
            uint256 refund;
            unchecked { refund = msg.value - cost; }
            (bool success, ) = payable(msg.sender).call{value: refund}("");
            if (!success) revert RefundFailed();
        }
    }

    function sellTokens(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (amount > MAX_PUBLIC_SUPPLY / 1e18) revert AmountTooLarge();

        uint256 tokenAmount;
        unchecked { tokenAmount = amount * 1e18; }

        checkAndUnlockAirdrop();
        uint256 publicSupply = _publicSupply();
        if (publicSupply < tokenAmount) revert PublicSupplyUnderflow();

        uint256 revenue;
        unchecked { revenue = getPrice((publicSupply - tokenAmount) / 1e18, amount); }

        if (address(this).balance < revenue) revert InsufficientLiquidity();

        uint256 vol = totalVolumeDeposited;
        if (vol > revenue) {
            unchecked { totalVolumeDeposited = uint128(vol - revenue); }
        } else {
            totalVolumeDeposited = 0;
        }

        _burn(msg.sender, tokenAmount);
        emit TokensSold(msg.sender, amount, revenue);

        (bool success, ) = payable(msg.sender).call{value: revenue}("");
        if (!success) revert TransferFailed();
    }

    // ── Freeze pixel — action canvas on-chain (unitaire) ──────────────────────
    function freezePixel(uint32 pixelId, uint24 color) external nonReentrant whenNotPaused {
        if (pixelId >= TOTAL_PIXELS) revert OutOfBounds(); // Sécurité vitale
        if (color == 0) revert InvalidColor(); // Empêche les pixels transparents
        if (frozenPixels[pixelId].owner != address(0)) revert PixelAlreadyFrozen();
        if (balanceOf(msg.sender) < 1e18) revert NotEnoughTokens();

        // Le _burn va appeler _update. Si l'utilisateur tente d'utiliser
        // son airdrop verrouillé, la transaction va échouer avec TokensLocked().
        _burn(msg.sender, 1e18);
        
        frozenPixels[pixelId] = FrozenPixel({ owner: msg.sender, color: color });
        unchecked { totalFrozenPixels++; }
        emit PixelFrozen(pixelId, msg.sender, color);
    }

    // ── Freeze pixels — action canvas on-chain (lot, une seule transaction) ───
    // Brûle 1 PAINT par pixel, en une seule signature. Couleurs définitivement
    // immuables, comme pour freezePixel — aucune fonction de modification n'existe.
    function freezeBatch(uint32[] calldata pixelIds, uint24[] calldata colors) external nonReentrant whenNotPaused {
        uint256 len = pixelIds.length;
        if (len == 0) revert EmptyList();
        if (len != colors.length) revert ArrayLengthMismatch();
        if (len > MAX_BATCH_FREEZE) revert BatchTooLarge();

        uint256 totalCost;
        unchecked { totalCost = len * 1e18; }
        if (balanceOf(msg.sender) < totalCost) revert NotEnoughTokens();

        for (uint256 i = 0; i < len; ) {
            uint32 pixelId = pixelIds[i];
            uint24 color   = colors[i];

            if (pixelId >= TOTAL_PIXELS) revert OutOfBounds();
            if (color == 0) revert InvalidColor();
            if (frozenPixels[pixelId].owner != address(0)) revert PixelAlreadyFrozen();

            frozenPixels[pixelId] = FrozenPixel({ owner: msg.sender, color: color });
            emit PixelFrozen(pixelId, msg.sender, color);

            unchecked { ++i; }
        }

        unchecked { totalFrozenPixels += uint64(len); }

        // Le _burn va appeler _update. Si l'utilisateur tente d'utiliser
        // son airdrop verrouillé, la transaction va échouer avec TokensLocked().
        _burn(msg.sender, totalCost);
    }

    // ── Getters ───────────────────────────────────────────────────────────────
    function getFrozenPixel(uint32 pixelId) external view returns (address, uint24) {
        FrozenPixel memory p = frozenPixels[pixelId];
        return (p.owner, p.color);
    }

    function withdrawCommission() external onlyOwner {
        uint256 publicSupply = _publicSupply();
        uint256 frozen = totalFrozenPixels;
        uint256 frozenVal;
        unchecked { frozenVal = frozen * 1e18; }

        uint256 activeSupply = (publicSupply > frozenVal) ? publicSupply - frozenVal : 0;
        uint256 activeTokens;
        unchecked { activeTokens = (activeSupply + 1e18 - 1) / 1e18; }

        uint256 requiredLiquidity = getPrice(frozen, activeTokens);
        uint256 currentBalance = address(this).balance;

        if (currentBalance <= requiredLiquidity) revert NoSurplus();
        uint256 surplus;
        unchecked { surplus = currentBalance - requiredLiquidity; }

        (bool success, ) = payable(owner()).call{value: surplus}("");
        if (!success) revert WithdrawFailed();
    }
}