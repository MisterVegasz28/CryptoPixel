import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ethers, type Eip1193Provider } from 'ethers';
import { createClient, type RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import Header from './components/Header';
import StatsBar from './components/StatsBar';
import PixelCanvas from './components/PixelCanvas';
import TokenPanel from './components/TokenPanel';
import PixelActions from './components/PixelActions';
import OwnedPixels from './components/OwnedPixels';
import EditProfileModal from './components/EditProfileModal';
import type { DraftPixel, CanvasData } from './types';

interface EthereumProvider extends Eip1193Provider {
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export const CONTRACT_ADDRESS  = import.meta.env.VITE_CONTRACT_ADDRESS;
export const CANVAS_W = 32000;
export const CANVAS_H = 31250;
export const TARGET_CHAIN_ID   = import.meta.env.VITE_TARGET_CHAIN_ID;

export const INDEXER_URL = import.meta.env.VITE_INDEXER_URL || 'http://localhost:42069';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ── Interfaces ────────────────────────────────────────────────────────────────
interface AppNotification {
  msg: string;
  type: 'info' | 'success' | 'error' | 'pending';
}

interface LeaderboardItem {
  rank: number;
  address: string;
  totalFrozen: number;
  pseudo: string;
  message: string;
  twitter: string;
  instagram: string;
  telegram: string;
  discord: string;
}

interface OffchainCanvasRow {
  id: string;
  x: number;
  y: number;
  color: string;
  painter: string;
}
type CanvasRealtimePayload = RealtimePostgresChangesPayload<OffchainCanvasRow>;

interface BurnerApiItem {
  rank: number;
  address: string;
  totalFrozen: string | number;
  pseudo?: string;
  message?: string;
  twitter?: string;
  instagram?: string;
  telegram?: string;
  discord?: string;
}

// ── ABI V3 ────────────────────────────────────────────────────────────────────
const ABI = [
  {
    inputs: [{ internalType: "uint256", name: "amount", type: "uint256" }, { internalType: "uint256", name: "maxCost", type: "uint256" }],
    name: "buyTokens", outputs: [], stateMutability: "payable", type: "function"
  },
  {
    inputs: [{ internalType: "uint256", name: "amount", type: "uint256" }],
    name: "sellTokens", outputs: [], stateMutability: "nonpayable", type: "function"
  },
  {
    inputs: [
      { internalType: "uint32", name: "pixelId", type: "uint32" },
      { internalType: "uint24", name: "color",   type: "uint24" }
    ],
    name: "freezePixel", outputs: [], stateMutability: "nonpayable", type: "function"
  },
  {
    inputs: [{ internalType: "uint32", name: "pixelId", type: "uint32" }],
    name: "getFrozenPixel",
    outputs: [
      { internalType: "address", name: "", type: "address" },
      { internalType: "uint24",  name: "", type: "uint24"  }
    ],
    stateMutability: "view", type: "function"
  },
  {
    inputs: [], name: "totalSupply",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view", type: "function"
  },
  {
    inputs: [{ internalType: "address", name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view", type: "function"
  },
  {
    inputs: [
      { internalType: "uint256", name: "supplyInTokens",  type: "uint256" },
      { internalType: "uint256", name: "amountInTokens", type: "uint256" }
    ],
    name: "getPrice",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "pure", type: "function"
  },
  {
    inputs: [], name: "totalFrozenPixels",
    outputs: [{ internalType: "uint64", name: "", type: "uint64" }],
    stateMutability: "view", type: "function"
  },
  {
    inputs: [], name: "isAirdropUnlocked",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view", type: "function"
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "lockedPremine",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view", type: "function"
  },
  {
    inputs: [
      { internalType: "uint32[]", name: "pixelIds", type: "uint32[]" },
      { internalType: "uint24[]", name: "colors",   type: "uint24[]" }
    ],
    name: "freezeBatch",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
];

const GAS_OVERRIDE = import.meta.env.VITE_OVERRIDE_GAS === 'true'
  ? { maxPriorityFeePerGas: ethers.parseUnits("30", "gwei"), maxFeePerGas: ethers.parseUnits("30", "gwei") }
  : {};
const PREMINE_TOKENS = 2_500_000n;

const hexToUint24 = (hex: string): number => parseInt(hex.replace('#', ''), 16);
const toPixelId   = (x: number, y: number): number => y * CANVAS_W + x;
const pixelKey    = (x: number, y: number): string => `${x}-${y}`;

const toPublicSupplyTokens = (totalSupplyWei: bigint): bigint => {
  const supplyTokens = totalSupplyWei / BigInt(1e18);
  return supplyTokens > PREMINE_TOKENS ? supplyTokens - PREMINE_TOKENS : 0n;
};

const buildPaintMessage = (address: string, pixels: DraftPixel[], timestamp: number): string => {
  const pixelHash = pixels
    .map(p => `${p.x},${p.y}:${p.color}`)
    .sort()
    .join(",");
  return `CryptoPixel paint\naddress:${address.toLowerCase()}\npixels:${pixelHash}\nt:${timestamp}`;
};

export default function App() {
  const [account, setAccount]         = useState<string | null>(null);
  const [signer, setSigner]           = useState<ethers.Signer | null>(null);
  const [readContract, setReadContract]   = useState<ethers.Contract | null>(null);
  const [writeContract, setWriteContract] = useState<ethers.Contract | null>(null);
  const [showFrozenOverlay, setShowFrozenOverlay] = useState(false);
  const [zoneMode, setZoneMode] = useState(false);
  const [drafts, setDrafts] = useState<DraftPixel[]>([]);

  // ── Gestion du thème ───────────────────────────────────────────────────────
  const [theme, setTheme] = useState<string>(
    () => localStorage.getItem('cp-theme') || 'dark'
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cp-theme', theme);
  }, [theme]);

  const handleSavePixels = async () => {
    if (!account) return alert("Connecte ton wallet avant de peindre !");
    if (drafts.length === 0) return alert("Ton panier est vide !");
    if (!window.ethereum) return alert("MetaMask n'est pas installé !");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signerObj = await provider.getSigner();
      const address = await signerObj.getAddress();
      const pixelsToSave = drafts.map(p => ({ ...p, id: `${p.x}-${p.y}`, color: p.color.toString() }));
      const timestamp = Math.floor(Date.now() / 1000);
      const pixelHash = pixelsToSave.map(p => `${p.x},${p.y}:${p.color}`).sort().join(",");
      const message = `CryptoPixel paint\naddress:${address.toLowerCase()}\npixels:${pixelHash}\nt:${timestamp}`;
      const signature = await signerObj.signMessage(message);
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paint-pixels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, pixels: pixelsToSave, signature, timestamp })
      });
      const result = await response.json();
      if (result.success) {
        showNotification(`${pixelsToSave.length} pixel(s) peint(s) ! 🎨`, "success");
        handlePixelsPainted(pixelsToSave);
        setDrafts([]);
      } else {
        showNotification("Erreur : " + result.error, "error");
      }
    } catch (err) {
      console.error("Erreur sauvegarde :", err);
      showNotification("Transaction annulée.", "error");
    }
  };

  const [tokenBalance, setTokenBalance]   = useState('0');
  const [totalSupply, setTotalSupply]     = useState('0');
  const [totalFrozen, setTotalFrozen]     = useState('0');
  const [airdropUnlocked, setAirdropUnlocked] = useState(false);

  const [canvasData, setCanvasData]       = useState<CanvasData | null>(null);
  const [loadingCanvas, setLoadingCanvas] = useState(false);

  const [selectedPixel, setSelectedPixel] = useState<{ x: number; y: number } | null>(null);
  const [selectedColor, setSelectedColor] = useState('#00d4ff');
  const [activeTab, setActiveTab]         = useState('actions');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [txStatus, setTxStatus]           = useState<string | null>(null);
  const [notification, setNotification]   = useState<AppNotification | null>(null);

  const [leaderboard, setLeaderboard]               = useState<LeaderboardItem[]>([]);
  const [showLeaderboard, setShowLeaderboard]       = useState(false);
  const [isLoadingLeaderboard, setIsLoadingLeaderboard] = useState(false);
  const [showEditProfile, setShowEditProfile]       = useState(false);

  const loadRequestIdRef = useRef(0);
  const pendingRealtimeEvents = useRef<CanvasRealtimePayload[]>([]);

  // ── Notifications ──────────────────────────────────────────────────────────
  const showNotification = (msg: string, type: AppNotification['type'] = 'info') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 5000);
  };

  const handlePixelsPainted = useCallback((paintedPixels: DraftPixel[]) => {
    setCanvasData(prev => {
      if (!prev) return prev;
      const newColors = [...prev.colors];
      for (const p of paintedPixels) {
        const dx = p.x - prev.startX;
        const dy = p.y - prev.startY;
        if (dx >= 0 && dx < prev.w && dy >= 0 && dy < prev.h) {
          const idx = dy * prev.w + dx;
          newColors[idx] = p.color;
        }
      }
      return { ...prev, colors: newColors };
    });
  }, []);

  const applyRealtimeEvent = useCallback((prev: CanvasData, payload: CanvasRealtimePayload): CanvasData => {
    if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
      const p = payload.new as OffchainCanvasRow;
      const dx = p.x - prev.startX;
      const dy = p.y - prev.startY;
      if (dx < 0 || dx >= prev.w || dy < 0 || dy >= prev.h) return prev;
      const idx = dy * prev.w + dx;
      const updatedColors = [...prev.colors];
      const updatedOwners = [...prev.owners];
      updatedColors[idx] = p.color;
      updatedOwners[idx] = p.painter;
      return { ...prev, colors: updatedColors, owners: updatedOwners };
    }
    if (payload.eventType === 'DELETE') {
      const p = payload.old as Partial<OffchainCanvasRow>;
      if (p.x === undefined || p.y === undefined) return prev;
      const dx = p.x - prev.startX;
      const dy = p.y - prev.startY;
      if (dx < 0 || dx >= prev.w || dy < 0 || dy >= prev.h) return prev;
      const idx = dy * prev.w + dx;
      const updatedColors = [...prev.colors];
      const updatedOwners = [...prev.owners];
      updatedColors[idx] = null;
      updatedOwners[idx] = null;
      return { ...prev, colors: updatedColors, owners: updatedOwners };
    }
    return prev;
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel('canvas-live-updates')
      .on<OffchainCanvasRow>(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'offchain_canvas' },
        (payload: CanvasRealtimePayload) => {
          console.log('Changement en direct reçu !', payload);
          setCanvasData(prev => {
            if (!prev) {
              pendingRealtimeEvents.current.push(payload);
              return prev;
            }
            return applyRealtimeEvent(prev, payload);
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [applyRealtimeEvent]);

  // ── Réseau ─────────────────────────────────────────────────────────────────
  const checkNetwork = async (browserProvider: ethers.BrowserProvider) => {
    const eth = window.ethereum;
    if (!eth) return;
    try {
      const network = await browserProvider.getNetwork();
      const chainIdHex = '0x' + network.chainId.toString(16);
      if (chainIdHex !== TARGET_CHAIN_ID) {
        showNotification("Wrong network! Switching to Polygon Amoy...", "error");
        try {
          await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: TARGET_CHAIN_ID }] });
        } catch (switchError: unknown) {
          if ((switchError as { code?: number }).code === 4902) {
            await eth.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: TARGET_CHAIN_ID,
                chainName: import.meta.env.VITE_CHAIN_NAME,
                nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
                rpcUrls: [import.meta.env.VITE_RPC_URL],
                blockExplorerUrls: [import.meta.env.VITE_BLOCK_EXPLORER_URL],
              }],
            });
          }
        }
      }
    } catch (err) { console.error("Network check failed", err); }
  };

  // ── Refresh données chain ──────────────────────────────────────────────────
  const refreshChainData = useCallback(async (contract: ethers.Contract, userAccount: string) => {
    try {
      const [supply, bal, frozen, airdrop] = await Promise.all([
        contract.totalSupply(),
        contract.balanceOf(userAccount),
        contract.totalFrozenPixels(),
        contract.isAirdropUnlocked(),
      ]);
      setTotalSupply(ethers.formatEther(supply));
      setTokenBalance(ethers.formatEther(bal));
      setTotalFrozen(frozen.toString());
      setAirdropUnlocked(airdrop);
    } catch (e) { console.error("Error refreshing chain data", e); }
  }, []);

  // Lecture publique sans wallet
  useEffect(() => {
    const loadPublicStats = async () => {
      try {
        const publicProvider = new ethers.JsonRpcProvider(import.meta.env.VITE_RPC_URL);
        const publicContract = new ethers.Contract(CONTRACT_ADDRESS, ABI, publicProvider);
        const [supply, frozen] = await Promise.all([
          publicContract.totalSupply(),
          publicContract.totalFrozenPixels(),
        ]);
        setTotalSupply(ethers.formatEther(supply));
        setTotalFrozen(frozen.toString());
      } catch (e) {
        console.error("Error loading public stats", e);
      }
    };
    if (!account) loadPublicStats();
  }, [account]);

  const initWeb3 = useCallback(async (browserProvider: ethers.BrowserProvider, userAccount: string) => {
    setAccount(userAccount);
    await checkNetwork(browserProvider);
    const rContract = new ethers.Contract(CONTRACT_ADDRESS, ABI, browserProvider);
    setReadContract(rContract);
    const s = await browserProvider.getSigner();
    setSigner(s);
    const wContract = new ethers.Contract(CONTRACT_ADDRESS, ABI, s);
    setWriteContract(wContract);
    await refreshChainData(rContract, userAccount);
  }, [refreshChainData]);

  const handleConnect = async () => {
    const eth = window.ethereum;
    if (!eth) { showNotification("MetaMask not found!", "error"); return; }
    try {
      await eth.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] });
      const accounts = await eth.request({ method: 'eth_accounts' }) as string[];
      const browserProvider = new ethers.BrowserProvider(eth);
      await initWeb3(browserProvider, accounts[0]);
      showNotification("Wallet connected!", "success");
    } catch { showNotification("Connection rejected", "error"); }
  };

  const handleDisconnect = () => {
    setAccount(null);
    setSigner(null);
    setTokenBalance('0');
    setTotalFrozen('0');
    setReadContract(null);
    setWriteContract(null);
  };

  useEffect(() => {
    const eth = window.ethereum;
    if (!eth) return;
    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      if (accounts.length > 0) {
        const bp = new ethers.BrowserProvider(eth);
        initWeb3(bp, accounts[0]);
      } else {
        handleDisconnect();
      }
    };
    eth.on('accountsChanged', onAccountsChanged);
    eth.on('chainChanged', () => window.location.reload());
    return () => { eth.removeListener('accountsChanged', onAccountsChanged); };
  }, [initWeb3]);

  const runTx = async (txFunc: () => Promise<{ wait: () => Promise<unknown> }>, successMsg?: string): Promise<boolean> => {
    if (!writeContract) return false;
    setTxStatus('pending');
    showNotification("Please confirm in your wallet...", "pending");
    try {
      const tx = await txFunc();
      setTxStatus('mining');
      showNotification("Transaction sent! Waiting for confirmation...", "pending");
      await tx.wait();
      setTxStatus('success');
      showNotification(successMsg || "Transaction confirmed!", "success");
      if (readContract && account) await refreshChainData(readContract, account);
      return true;
    } catch (err: unknown) {
      console.error(err);
      setTxStatus('error');

      const e = err as { reason?: string; message?: string; code?: string };
      let msg = e.reason || e.message || "Transaction failed";
      if (e.code === 'CALL_EXCEPTION' || msg.includes('estimateGas')) {
        msg = "Not enough MATIC to cover the transaction cost.";
      } else if (msg.includes('NotEnoughTokens')) {
        msg = "Not enough PAINT tokens.";
      } else if (msg.includes('SlippageExceeded')) {
        msg = "Price moved too fast — try again.";
      } else if (msg.includes('PixelAlreadyFrozen')) {
        msg = "This pixel is already frozen.";
      } else if (msg.includes('user rejected')) {
        msg = "Transaction cancelled.";
      }

      showNotification(msg, "error");
      return false;
    }
  };

  // ── Buy / Sell ─────────────────────────────────────────────────────────────
  const handleBuyTokens = async (amount: string) => {
  const n = parseInt(amount, 10);
  if (!readContract || !writeContract || isNaN(n)) return;
  const buyAmt = BigInt(n);
  const supply = await readContract.totalSupply();
  const publicSupplyTokens = toPublicSupplyTokens(supply);
  const costWei = await readContract.getPrice(publicSupplyTokens, buyAmt);
  const maxCost = costWei * 110n / 100n;
  await runTx(
    () => writeContract.buyTokens(buyAmt, maxCost, { value: maxCost, ...GAS_OVERRIDE }),
    `Successfully purchased ${n} PAINT tokens!`
  );
};

  const handleSellTokens = async (amount: string) => {
  const n = parseInt(amount, 10);
  if (!writeContract || isNaN(n)) return;
  const success = await runTx(
    () => writeContract.sellTokens(BigInt(n), GAS_OVERRIDE),
    `Successfully sold ${n} PAINT tokens!`
  );
    if (success) {
      showNotification("Sale confirmed! Your oldest pixels are being released...", "info");
    }
  };

  // ── Paint ──────────────────────────────────────────────────────────────────
  const handlePaintPixel = async (x: number, y: number) => {
    if (!account || !signer) return;
    try {
      const pixelPayload: DraftPixel[] = [{ id: `${x}-${y}`, x, y, color: selectedColor }];
      const timestamp    = Math.floor(Date.now() / 1000);
      const message      = buildPaintMessage(account, pixelPayload, timestamp);
      const signature    = await (signer as ethers.Signer & { signMessage: (msg: string) => Promise<string> }).signMessage(message);

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paint-pixels`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ address: account.toLowerCase(), pixels: pixelPayload, timestamp, signature }),
        }
      );
      const result = await res.json();
      if (!res.ok || result.error) throw new Error(result.error || 'Edge Function error');

      showNotification(`Pixel (${x}, ${y}) painted! 🎨`, "success");

      if (canvasData) {
        const dx = x - canvasData.startX;
        const dy = y - canvasData.startY;
        if (dx >= 0 && dx < canvasData.w && dy >= 0 && dy < canvasData.h) {
          const idx = dy * canvasData.w + dx;
          const newColors = [...canvasData.colors];
          newColors[idx] = selectedColor;
          setCanvasData(prev => prev ? { ...prev, colors: newColors } : prev);
        }
      }
    } catch (err: unknown) {
      console.error("Paint error:", err);
      showNotification((err as Error).message || "Failed to paint pixel", "error");
    }
  };

  // ── Freeze ─────────────────────────────────────────────────────────────────
  const handleFreezePixel = async (x: number, y: number) => {
    if (!writeContract || !account) return;
    const pixelId = toPixelId(x, y);
    const color   = hexToUint24(selectedColor);

    const success = await runTx(
      () => writeContract.freezePixel(pixelId, color, GAS_OVERRIDE),
      `Pixel (${x}, ${y}) frozen permanently! ❄️`
    );

    if (success) {
      try {
        const { error } = await supabase.from('offchain_canvas').upsert({
          id: pixelKey(x, y), x, y,
          color: selectedColor,
          painter: account.toLowerCase(),
          updated_at: Math.floor(Date.now() / 1000),
        });
        if (error) console.error("Supabase sync after freeze failed:", error);
      } catch (err) {
        console.error("Supabase upsert after freeze:", err);
      }
    }
  };

  // ── Freeze Batch ───────────────────────────────────────────────────────────
  const handleFreezeBatch = async (pixelsToFreeze: DraftPixel[]): Promise<boolean> => {
    if (!writeContract || !account || pixelsToFreeze.length === 0) return false;

    const pixelIds = pixelsToFreeze.map(p => toPixelId(p.x, p.y));
    const colors   = pixelsToFreeze.map(p => hexToUint24(p.color));

    const success = await runTx(
      () => writeContract.freezeBatch(pixelIds, colors, GAS_OVERRIDE),
      `${pixelsToFreeze.length} pixel(s) frozen permanently! ❄️`
    );

    if (success) {
      try {
        const { error } = await supabase.from('offchain_canvas').upsert(
          pixelsToFreeze.map(p => ({
            id: pixelKey(p.x, p.y), x: p.x, y: p.y,
            color: p.color,
            painter: account.toLowerCase(),
            updated_at: Math.floor(Date.now() / 1000),
          }))
        );
        if (error) console.error("Supabase sync after batch freeze failed:", error);
      } catch (err) {
        console.error("Supabase upsert after batch freeze:", err);
      }
    }
    return success;
  };

  // ── Canvas Load ────────────────────────────────────────────────────────────
  const handleLoadSlice = useCallback(async (startX: number, startY: number, w: number, h: number) => {
    const requestId = ++loadRequestIdRef.current;
    setLoadingCanvas(true);
    try {
      const [{ data, error }, { data: frozenRows, error: frozenError }] = await Promise.all([
        supabase
          .from('offchain_canvas')
          .select('id, x, y, color, painter')
          .gte('x', startX).lt('x', startX + w)
          .gte('y', startY).lt('y', startY + h),
        supabase
          .from('pixel')
          .select('x, y, owner, color')
          .gte('x', startX).lt('x', startX + w)
          .gte('y', startY).lt('y', startY + h),
      ]);
      if (error) throw error;
      if (frozenError) throw frozenError;

      if (requestId !== loadRequestIdRef.current) return;

      const colorMap: Record<string, string> = {};
      const ownerMap: Record<string, string> = {};
      for (const row of (data || [])) {
        colorMap[row.id] = row.color;
        ownerMap[row.id] = row.painter;
      }
      const frozenOwnerMap: Record<string, string> = {};
      for (const row of (frozenRows || [])) {
        frozenOwnerMap[pixelKey(row.x, row.y)] = row.owner.toLowerCase();
      }
      const frozenColorMap: Record<string, string> = {};
      for (const row of (frozenRows || [])) {
        frozenColorMap[pixelKey(row.x, row.y)] = row.color;
      }

      const colors: (string | null)[]       = [];
      const owners: (string | null)[]       = [];
      const frozen: boolean[]               = [];
      const frozenOwners: (string | null)[] = [];

      for (let yy = startY; yy < startY + h; yy++) {
        for (let xx = startX; xx < startX + w; xx++) {
          const key = pixelKey(xx, yy);
          colors.push(colorMap[key] || frozenColorMap[key] || null);
          owners.push(ownerMap[key] || frozenOwnerMap[key] || null);
          const fOwner = frozenOwnerMap[key] || null;
          frozen.push(!!fOwner);
          frozenOwners.push(fOwner);
        }
      }

      setCanvasData({ colors, owners, frozen, frozenOwners, startX, startY, w, h });

      if (pendingRealtimeEvents.current.length > 0) {
        const pending = [...pendingRealtimeEvents.current];
        pendingRealtimeEvents.current = [];
        setCanvasData(prev => {
          if (!prev) return prev;
          let result = prev;
          for (const payload of pending) {
            result = applyRealtimeEvent(result, payload);
          }
          return result;
        });
      }
    } catch (e) {
      console.error("Error loading canvas slice", e);
      showNotification("Failed to load canvas data", "error");
    } finally {
      if (requestId === loadRequestIdRef.current) setLoadingCanvas(false);
    }
  }, [applyRealtimeEvent]);

  // ── Leaderboard ────────────────────────────────────────────────────────────
  const fetchLeaderboard = async () => {
    setIsLoadingLeaderboard(true);
    showNotification("Loading leaderboard...", "info");
    try {
      const res = await fetch(`${INDEXER_URL}/burners?limit=10`);
      if (!res.ok) throw new Error('Indexer unreachable');
      const data = await res.json();
      const items = data?.burners || [];

      if (items.length === 0) {
        showNotification("No frozen pixels yet — be the first!", "info");
        setLeaderboard([]);
        setShowLeaderboard(false);
        return;
      }

      setLeaderboard(items.map((b: BurnerApiItem) => ({
        rank: b.rank,
        address: b.address,
        totalFrozen: Number(b.totalFrozen),
        pseudo: b.pseudo || '',
        message: b.message || '',
        twitter: b.twitter || '',
        instagram: b.instagram || '',
        telegram: b.telegram || '',
        discord: b.discord || '',
      })));
      setShowLeaderboard(true);
    } catch (err) {
      console.error("Leaderboard error:", err);
      showNotification("Could not load leaderboard.", "error");
    } finally {
      setIsLoadingLeaderboard(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Header
        account={account}
        tokenBalance={tokenBalance}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        txStatus={txStatus}
        config={{ title: 'CryptoPixel' }}
        onOpenLeaderboard={fetchLeaderboard}
        leaderboard={leaderboard}
        showLeaderboard={showLeaderboard}
        onCloseLeaderboard={() => setShowLeaderboard(false)}
        isLoadingLeaderboard={isLoadingLeaderboard}
        airdropUnlocked={airdropUnlocked}
        signer={signer}
        theme={theme}
        setTheme={setTheme}
      />

      <StatsBar
        totalSupply={totalSupply}
        totalFrozen={totalFrozen}
        account={account}
        supabase={supabase}
        showFrozenOverlay={showFrozenOverlay}
        onToggleFrozenOverlay={() => setShowFrozenOverlay(v => !v)}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
        <div style={{ flex: 1, height: '100%', position: 'relative', background: '#07070a' }}>
          <PixelCanvas
            canvasData={canvasData}
            loadingCanvas={loadingCanvas}
            selectedPixel={selectedPixel}
            selectedColor={selectedColor}
            account={account}
            onSelectPixel={setSelectedPixel}
            onLoadSlice={handleLoadSlice}
            readContract={readContract}
            onPixelsPainted={handlePixelsPainted}
            onFreezeBatch={handleFreezeBatch}
            onOpenEditProfile={() => setShowEditProfile(true)}
            onToggleZoneMode={() => setZoneMode(prev => !prev)}
            showFrozenOverlay={showFrozenOverlay}
            zoneMode={zoneMode}
            draftPixels={drafts}
            onDraftPixelsChange={setDrafts}
          />
        </div>

        <div style={{ position: 'relative', display: 'flex', zIndex: 10 }}>
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            style={{
              position: 'absolute', left: -32, top: '50%',
              transform: 'translateY(-50%)', width: 32, height: 60,
              background: '#0d0d14', border: '1px solid rgba(0,212,255,0.2)',
              borderRight: 'none', borderRadius: '8px 0 0 8px',
              color: '#00d4ff', cursor: 'pointer', fontSize: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '-4px 0 16px rgba(0,0,0,0.3)', transition: 'all 0.2s', zIndex: 20,
            }}
          >
            <span style={{ transform: isSidebarOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.3s' }}>◀</span>
          </button>

          <div style={{
            width: isSidebarOpen ? 360 : 0, opacity: isSidebarOpen ? 1 : 0,
            pointerEvents: isSidebarOpen ? 'auto' : 'none',
            borderLeft: isSidebarOpen ? '1px solid rgba(0,212,255,0.1)' : 'none',
            background: '#0d0d14', display: 'flex', flexDirection: 'column',
            transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)', overflow: 'hidden',
          }}>
            <div style={{ display: 'flex', borderBottom: '1px solid rgba(0,212,255,0.1)' }}>
              {['actions', 'trade', 'my-pixels'].map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)} style={{
                  flex: 1, padding: 12,
                  background: activeTab === tab ? 'rgba(0,212,255,0.08)' : 'transparent',
                  border: 'none', color: activeTab === tab ? '#00d4ff' : '#6b7280',
                  fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
                }}>
                  {{ actions: 'Actions', trade: 'Market', 'my-pixels': 'My Pixels' }[tab]}
                </button>
              ))}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 16, minWidth: 360 }}>
              {activeTab === 'actions' && (
                <PixelActions
                  selectedPixel={selectedPixel}
                  selectedColor={selectedColor}
                  onColorChange={setSelectedColor}
                  account={account}
                  onPaint={handlePaintPixel}
                  onFreeze={handleFreezePixel}
                  txStatus={txStatus}
                  readContract={readContract}
                  tokenBalance={tokenBalance}
                  airdropUnlocked={airdropUnlocked}
                  onToggleZoneMode={() => setZoneMode(prev => !prev)}
                  zoneMode={zoneMode}
                  draftsCount={drafts.length}
                  onClearDrafts={() => setDrafts([])}
                  onSavePixels={handleSavePixels}
                />
              )}
              {activeTab === 'trade' && (
                <TokenPanel
                  account={account}
                  tokenBalance={tokenBalance}
                  readContract={readContract}
                  onBuy={handleBuyTokens}
                  onSell={handleSellTokens}
                  txStatus={txStatus}
                />
              )}
              {activeTab === 'my-pixels' && (
                <OwnedPixels
                  account={account}
                  supabase={supabase}
                  onSelectPixel={setSelectedPixel}
                  selectedPixel={selectedPixel}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {notification && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          padding: '12px 22px',
          background: notification.type === 'success' ? 'rgba(34,197,94,0.15)' : notification.type === 'error' ? 'rgba(239,68,68,0.15)' : 'rgba(18,18,26,0.95)',
          border: `1px solid ${notification.type === 'success' ? '#22c55e' : notification.type === 'error' ? '#ef4444' : '#00d4ff'}`,
          borderRadius: 12, color: '#fff', zIndex: 1000,
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)',
        }}>
          {notification.msg}
        </div>
      )}

      {showEditProfile && (
        <EditProfileModal
          account={account}
          signer={signer}
          onClose={() => setShowEditProfile(false)}
          onSaved={() => {
            showNotification("Profile saved successfully! ✏️", "success");
            if (showLeaderboard) fetchLeaderboard();
          }}
        />
      )}
    </div>
  );
}