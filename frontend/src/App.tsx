import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ethers } from 'ethers';
import { createClient, type RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import Header from './components/Header';
import StatsBar from './components/StatsBar';
import PixelCanvas from './components/PixelCanvas';
import TokenPanel from './components/TokenPanel';
import PixelActions from './components/PixelActions';
import OwnedPixels from './components/OwnedPixels';
import EditProfileModal from './components/EditProfileModal';
import type { DraftPixel, CanvasData } from './types';
import ProgressBar from './components/ProgressBar';
import LiveFreezeFeed from './components/LiveFreezeFeed';
import AirdropClaim from './components/AirdropClaim';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useFundWallet } from '@privy-io/react-auth';
import { polygon } from 'viem/chains';
import { Palette, Snowflake, Gift, Pencil, Construction, CreditCard, AlertTriangle, ChevronLeft} from 'lucide-react';
import Tutorial, { hasSeenTutorial } from './components/Tutorial';
import { PRESET_COLORS } from './components/palette';

export const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS;
export const CANVAS_W         = 32000;
export const CANVAS_H         = 31250;
export const TARGET_CHAIN_ID  = import.meta.env.VITE_TARGET_CHAIN_ID;
export const INDEXER_URL = import.meta.env.VITE_INDEXER_URL;
if (!INDEXER_URL) console.error('VITE_INDEXER_URL is missing — indexer calls will fail.');

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const network = ethers.Network.from(Number(TARGET_CHAIN_ID)); // gère bien le format hex "0x89"

// Provider RPC public partagé par tout le module (lecture seule).
const sharedRpcProvider = new ethers.JsonRpcProvider(
  `${INDEXER_URL}/rpc`,
  network,
  { batchMaxCount: 1, staticNetwork: network }
);
// RPC publique officielle Polygon Amoy — sans clé, safe à exposer,
// utilisée uniquement par MetaMask pour wallet_addEthereumChain.
const PUBLIC_ADD_CHAIN_RPC_URL = 'https://rpc-amoy.polygon.technology';
// ── Interfaces ────────────────────────────────────────────────────────────────
interface AppNotification {
  msg: React.ReactNode;
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
  inputs: [
    { internalType: "uint256", name: "amount", type: "uint256" },
    { internalType: "uint256", name: "minRevenue", type: "uint256" }
  ],
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
  {
  inputs: [], name: "claim", outputs: [], stateMutability: "nonpayable", type: "function"
},
{
  inputs: [{ internalType: "address", name: "account", type: "address" }],
  name: "hasClaimed",
  outputs: [{ internalType: "bool", name: "", type: "bool" }],
  stateMutability: "view", type: "function"
},
{
  inputs: [{ internalType: "address", name: "account", type: "address" }],
  name: "frozenCountByAddress",
  outputs: [{ internalType: "uint64", name: "", type: "uint64" }],
  stateMutability: "view", type: "function"
},
// À ajouter dans le tableau ABI existant
{
  inputs: [], name: "MIN_PAINT_HOLD",
  outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
  stateMutability: "view", type: "function"
},
{
  inputs: [], name: "MIN_FROZEN_COUNT",
  outputs: [{ internalType: "uint64", name: "", type: "uint64" }],
  stateMutability: "view", type: "function"
},
{
  inputs: [], name: "AIRDROP_AMOUNT",
  outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
  stateMutability: "view", type: "function"
},
{
  inputs: [], name: "MAX_CLAIMANTS",
  outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
  stateMutability: "view", type: "function"
},
{
  inputs: [], name: "totalClaimants",
  outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
  stateMutability: "view", type: "function"
},
{
  inputs: [], name: "UNLOCK_FREEZE_THRESHOLD",
  outputs: [{ internalType: "uint64", name: "", type: "uint64" }],
  stateMutability: "view", type: "function"
},
];

const APP_CONFIG = { title: 'CryptoPixel' };
const PREMINE_TOKENS = 2_000_000n;

const hexToUint24 = (hex: string): number => parseInt(hex.replace('#', ''), 16);
const toPixelId   = (x: number, y: number): number => y * CANVAS_W + x;
const pixelKey    = (x: number, y: number): string => `${x}-${y}`;


const toPublicSupplyTokens = (totalSupplyWei: bigint, totalFrozenPixels: bigint): bigint => {
  const virtualTokens = totalSupplyWei / BigInt(1e18) + totalFrozenPixels;
  return virtualTokens > PREMINE_TOKENS ? virtualTokens - PREMINE_TOKENS : 0n;
};

// ── Notification color helpers ────────────────────────────────────────────────
const notifBg = (type: AppNotification['type']) => {
  if (type === 'success') return 'var(--color-green-dim)';
  if (type === 'error')   return 'var(--color-red-dim)';
  return 'var(--bg-surface)';
};
const notifBorder = (type: AppNotification['type']) => {
  if (type === 'success') return 'var(--color-green)';
  if (type === 'error')   return 'var(--color-red)';
  return 'var(--color-primary)';
};
const withIcon = (icon: React.ReactNode, text: string) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
    {icon}{text}
  </span>
);

// ── Fee overrides Amoy ──────────────────────────────────────────────────────
// Helper PARTAGÉ par tous les appels d'écriture (buy/sell/freeze/freezeBatch).
// Sur Amoy, l'estimation renvoyée par provider.getFeeData() peut être
// largement en dessous du minimum réellement exigé par les validateurs
// (~25 gwei de tip au moment où on écrit ça). On impose donc un PLANCHER
// plutôt que de faire confiance à l'estimation brute + un simple buffer
// relatif — un buffer de +30% sur une estimation déjà trop basse (ex: 1.5
// gwei) reste sous le minimum réseau, d'où l'erreur "gas tip cap below
// minimum" qu'on voyait sur freezePixel, puis sur buyTokens/sellTokens qui
// n'avaient encore aucun override.
const AMOY_MIN_PRIORITY_FEE = ethers.parseUnits("30", "gwei"); // marge au-dessus du minimum connu de 25 gwei
const IS_MAINNET_CHAIN = TARGET_CHAIN_ID === '0x89';
const BUY_GAS_LIMIT_ESTIMATE = 300_000n;

async function getFeeOverrides(): Promise<{ maxPriorityFeePerGas: bigint; maxFeePerGas: bigint }> {
  const feeData = await sharedRpcProvider.getFeeData();
  const estimatedTip = feeData.maxPriorityFeePerGas
    ? feeData.maxPriorityFeePerGas * 130n / 100n // +30% buffer sur l'estimation
    : 0n;

  // Sur mainnet, pas de plancher artificiel : le tip dépend de la
  // congestion réelle du réseau et varie trop pour qu'une constante ait
  // du sens (contrairement à Amoy où le plancher validateur est fixe et
  // connu ~25 gwei). On fait confiance à l'estimation bufferée.
  const tip = IS_MAINNET_CHAIN
    ? estimatedTip
    : (estimatedTip > AMOY_MIN_PRIORITY_FEE ? estimatedTip : AMOY_MIN_PRIORITY_FEE);

  // maxFeePerGas explicite plutôt que laissé au wallet : baseFee courant
  // (ou fallback) + le tip qu'on vient de calculer, avec une marge pour
  // absorber une variation du baseFee entre l'estimation et l'inclusion.
  const baseFee = feeData.gasPrice ?? ethers.parseUnits("50", "gwei");
  const maxFee = baseFee * 2n + tip;

  return { maxPriorityFeePerGas: tip, maxFeePerGas: maxFee };
}

export default function App() {

  const [account, setAccount]             = useState<string | null>(null);
  const [signer, setSigner]               = useState<ethers.Signer | null>(null);
  const [readContract, setReadContract]   = useState<ethers.Contract | null>(null);
  const [writeContract, setWriteContract] = useState<ethers.Contract | null>(null);
  const [showFrozenOverlay, setShowFrozenOverlay] = useState(false);
  const [zoneMode, setZoneMode]           = useState(false);
  const [drafts, setDrafts]               = useState<DraftPixel[]>([]);
  const [clearZoneSignal, setClearZoneSignal] = useState(0);
  const [freezeEvents, setFreezeEvents] = useState<{ batchId: number; events: { x: number; y: number; owner: string; color: string }[] } | null>(null);
  const freezeBatchIdRef = useRef(0);
  const [paintedCount, setPaintedCount] = useState<number | null>(null);

// dans le composant App :
const { login, logout, authenticated, ready } = usePrivy();
const { wallets } = useWallets();


useEffect(() => {
  if (!ready || !authenticated || account) return;
  const connectPrivyWallet = async () => {
    // useWallets() retourne TOUS les wallets connectés (embarqué Privy +
    // wallets externes détectés comme MetaMask). On cible explicitement
    // le wallet Privy pour ne jamais se faire écraser par MetaMask.
    const wallet = wallets.find(w => w.walletClientType === 'privy');
    if (!wallet) return;
    try {
      const provider = await wallet.getEthereumProvider();
      const browserProvider = new ethers.BrowserProvider(provider);
      const address = wallet.address;
      await initWeb3(browserProvider, address);
      showNotification("Connected with Google!", "success");
    } catch (err) {
      console.error("Privy connect error", err);
      showNotification("Google connection failed", "error");
    }
  };
  connectPrivyWallet();
}, [ready, authenticated, wallets, account]);

  // ── Gestion du thème ──────────────────────────────────────────────────────
const [theme, setTheme] = useState<string>(
  () => localStorage.getItem('cp-theme') || 'dark'
);
const [accent, setAccent] = useState<string>(
  () => localStorage.getItem('cp-accent') || 'default'
);
 useEffect(() => {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('cp-theme', theme);
}, [theme]);
useEffect(() => {
    if (!hasSeenTutorial()) setShowTutorial(true);
  }, []);
useEffect(() => {
  document.documentElement.setAttribute('data-accent', accent);
  localStorage.setItem('cp-accent', accent);
}, [accent]);

  const [tokenBalance, setTokenBalance]       = useState('0');
  const [polBalance, setPolBalance] = useState<string>('0');
  const [totalSupply, setTotalSupply]         = useState('0');
  const [publicSupplyTokens, setPublicSupplyTokens] = useState<bigint>(0n);
  const [totalFrozen, setTotalFrozen]         = useState('0');
  const [airdropUnlocked, setAirdropUnlocked] = useState(false);
  const [hasClaimedAirdrop, setHasClaimedAirdrop] = useState(false);
  const [canvasData, setCanvasData]           = useState<CanvasData | null>(null);
  const [loadingCanvas, setLoadingCanvas]     = useState(false);
  const [selectedPixel, setSelectedPixel]     = useState<{ x: number; y: number } | null>(null);
  const [selectedColor, setSelectedColor]     = useState('#00d4ff');
  const [activeTab, setActiveTab]             = useState('actions');
  const [isSidebarOpen, setIsSidebarOpen]     = useState(true);
  const [txStatus, setTxStatus]               = useState<string | null>(null);
  const [notification, setNotification]       = useState<AppNotification | null>(null);
  const [leaderboard, setLeaderboard]         = useState<LeaderboardItem[]>([]);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [isLoadingLeaderboard, setIsLoadingLeaderboard] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const loadRequestIdRef        = useRef(0);
  const loadAbortControllerRef        = useRef<AbortController | null>(null);
  const pendingRealtimeEvents   = useRef<CanvasRealtimePayload[]>([]);
  // Regroupe les events Realtime reçus dans la même frame d'écran pour
  // n'appliquer qu'un seul setCanvasData par frame, même si plusieurs
  // joueurs peignent en même temps (évite un re-render par event isolé).
  // À REMPLACER PAR :
  const pendingBatchRef = useRef<CanvasRealtimePayload[]>([]);
  const batchRafRef     = useRef<number | null>(null);
  // Même logique de batching que ci-dessus, mais pour le canal "pixel"
  // (freezes). Avant : chaque INSERT déclenchait un setCanvasData + redraw
  // complet immédiat, donc un freeze batch de 200 pixels ou plusieurs
  // joueurs qui freezent en même temps pouvaient provoquer des dizaines
  // de re-renders/redraws dans la même frame.
  const pendingFrozenBatchRef = useRef<{ x: number; y: number; color: string; owner: string }[]>([]);
  const frozenBatchRafRef     = useRef<number | null>(null);
  const readContractRef         = useRef<ethers.Contract | null>(null);
  const accountRef              = useRef<string | null>(null);
  const isBuyingRef  = useRef(false);
  const isSellingRef = useRef(false);
  const feasibilityCacheRef = useRef<{ owned: number; locked: number; ts: number } | null>(null);
  // Pixels freezés optimistiquement côté client, en attente que l'indexer
  // les fasse apparaître dans frozen_tiles. Sans ça, un handleLoadSlice
  // déclenché par un pan/zoom écrase l'état optimiste avec une lecture
  // backend pas encore à jour, et le pixel redevient "sélectionnable"
  // dans la zone de freeze.
  const recentlyFrozenRef = useRef<Map<string, { color: string; owner: string; ts: number }>>(new Map());
  const RECENTLY_FROZEN_TTL_MS = 90_000; // filet si l'indexer traîne vraiment

// ── Notifications ─────────────────────────────────────────────────────────
  const showNotification = useCallback((msg: React.ReactNode, type: AppNotification['type'] = 'info') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 5000);
  }, []);

  const handleToggleZoneMode = useCallback(() => setZoneMode(prev => !prev), []);
  const handleToggleSidebar = useCallback(() => setIsSidebarOpen(v => !v), []);
  const handleToggleFrozenOverlay = useCallback(() => setShowFrozenOverlay(v => !v), []);

  const handlePixelsPainted = useCallback((paintedPixels: DraftPixel[]) => {
    setCanvasData(prev => {
      if (!prev) return prev;
      const newColors = [...prev.colors];
      for (const p of paintedPixels) {
        const dx = p.x - prev.startX;
        const dy = p.y - prev.startY;
        if (dx >= 0 && dx < prev.w && dy >= 0 && dy < prev.h) {
          newColors[dy * prev.w + dx] = p.color;
        }
      }
      return { ...prev, colors: newColors };
    });
  }, []);

   const checkPaintFeasibility = useCallback(async (
  pixelsToPaint: DraftPixel[]
): Promise<{ lockedToSacrifice: number }> => {
  if (!account) return { lockedToSacrifice: 0 };
  const painter = account.toLowerCase();
  const ids = pixelsToPaint.map(p => p.id);

  const CACHE_TTL_MS = 4000;
  const now = Date.now();
  const cached = feasibilityCacheRef.current;
  let owned: number;
  let locked: number;

  if (cached && now - cached.ts < CACHE_TTL_MS) {
    owned = cached.owned;
    locked = cached.locked;
  } else {
    // On récupère les IDs bruts (pas juste un count) pour pouvoir exclure
    // ceux en attente de purge post-freeze (voir pending_purges) — sinon
    // un pixel qui vient d'être frozen compte encore dans le quota
    // off-chain pendant la fenêtre de sécurité anti-reorg.
    const { data: ownedRows } = await supabase
      .from('offchain_canvas').select('id, is_locked').eq('painter', painter);
    const ownedIds  = (ownedRows || []).map(r => r.id);
    const lockedIds = (ownedRows || []).filter(r => r.is_locked).map(r => r.id);

    let pendingIds = new Set<string>();
    if (ownedIds.length > 0) {
      const { data: pendingRows } = await supabase
  .rpc('get_pending_purge_ids', { p_ids: ownedIds });
      pendingIds = new Set((pendingRows || []).map((r: { id: string }) => r.id));
    }

    owned  = ownedIds.filter(id => !pendingIds.has(id)).length;
    locked = lockedIds.filter(id => !pendingIds.has(id)).length;
    feasibilityCacheRef.current = { owned, locked, ts: now };
  }

  const { data: alreadyOwnedRows } = await supabase
    .from('offchain_canvas').select('id').eq('painter', painter).in('id', ids);
  const alreadyOwnedIds = new Set((alreadyOwnedRows || []).map(r => r.id));
  const newPixelsCount  = ids.filter(id => !alreadyOwnedIds.has(id)).length;

  const currentUsable     = Number(tokenBalance);
  const unlockedAvailable = owned - locked;
  const ownedAfter        = owned + newPixelsCount;

  if (ownedAfter <= currentUsable) return { lockedToSacrifice: 0 };

  const deficit = ownedAfter - currentUsable;
  return { lockedToSacrifice: Math.max(0, deficit - unlockedAvailable) };
}, [account, tokenBalance]);

  const handleSavePixels = useCallback(async () => {
  if (!account) return showNotification("Connect your wallet before painting!", "error");
  if (drafts.length === 0) return showNotification("Your cart is empty!", "error");
  if (!signer) return showNotification("Wallet not initialized, please reconnect.", "error");
  const doSave = async () => {
    try {
      const signerObj = signer;
      const address   = account;
      const pixelsToSave = drafts.map(p => ({ ...p, id: `${p.x}-${p.y}`, color: p.color.toString() }));
      const timestamp = Math.floor(Date.now() / 1000);
      const pixelHash = pixelsToSave.map(p => `${p.x},${p.y}:${p.color}`).sort().join(",");
      const message   = `CryptoPixel paint\naddress:${address.toLowerCase()}\npixels:${pixelHash}\nt:${timestamp}`;
      const signature = await signerObj.signMessage(message);
      const response  = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paint-pixels`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
  },
  body: JSON.stringify({ address, pixels: pixelsToSave, signature, timestamp }),
});
      const result = await response.json();
      if (result.success) {
        showNotification(withIcon(<Palette size={16} />, `${pixelsToSave.length} pixel(s) painted!`), "success");
        handlePixelsPainted(pixelsToSave);
        setDrafts([]);
        feasibilityCacheRef.current = null;
      } else {
        showNotification("Error: " + result.error, "error");
      }
    } catch (err) {
      console.error("Error saving :", err);
      showNotification("Transaction cancelled.", "error");
    }
  };

  const feasibility = await checkPaintFeasibility(drafts);
  if (feasibility.lockedToSacrifice > 0) {
    setPendingPaint({ execute: doSave, lockedToSacrifice: feasibility.lockedToSacrifice });
    return;
  }
  await doSave();
}, [account, drafts, signer, showNotification, handlePixelsPainted, checkPaintFeasibility]);

  // Mise à jour purement locale du state après un freeze réussi on-chain.
  // Aucun appel réseau : la vraie source de vérité (mapping frozenPixels
  // du contrat, répliquée en DB par l'indexer Ponder) écrasera de toute
  // façon ce state au prochain handleLoadSlice ou event realtime — ceci
  // ne sert qu'à donner un retour visuel instantané à l'utilisateur, sans
  // dépendre d'un droit d'écriture direct sur offchain_canvas (retiré à
  // anon/authenticated lors du hardening de la DB).
  const handlePixelsFrozen = useCallback((frozenPixels: DraftPixel[], owner: string) => {
  const now = Date.now();
  for (const p of frozenPixels) {
    recentlyFrozenRef.current.set(pixelKey(p.x, p.y), { color: p.color, owner, ts: now });
  }
  setCanvasData(prev => {
    if (!prev) return prev;
    const colors = [...prev.colors];
    const owners = [...prev.owners];
    const frozen = [...prev.frozen];
    const frozenOwners = [...prev.frozenOwners];
    let changed = false;
    for (const p of frozenPixels) {
      const dx = p.x - prev.startX;
      const dy = p.y - prev.startY;
      if (dx < 0 || dx >= prev.w || dy < 0 || dy >= prev.h) continue;
      const idx = dy * prev.w + dx;
      colors[idx] = p.color;
      owners[idx] = owner;
      frozen[idx] = true;
      frozenOwners[idx] = owner;
      changed = true;
    }
    if (!changed) return prev;
    return { ...prev, colors, owners, frozen, frozenOwners, _v: (prev._v ?? 0) + 1 };
  });
}, []);

const applyRealtimeEvent = useCallback((prev: CanvasData, payload: CanvasRealtimePayload): CanvasData => {
    if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
      const p = payload.new as OffchainCanvasRow;
      const dx = p.x - prev.startX;
      const dy = p.y - prev.startY;
      if (dx < 0 || dx >= prev.w || dy < 0 || dy >= prev.h) return prev;
      const idx = dy * prev.w + dx;
      const colors = [...prev.colors];
      const owners = [...prev.owners];
      // offchain_canvas.color est maintenant un smallint (index palette) —
      // Realtime renvoie donc un nombre, pas du hex, contrairement à
      // ponder_public.pixel. On reconvertit avant de stocker.
      const colorIndex = typeof p.color === 'number' ? p.color : Number(p.color);
      colors[idx] = PRESET_COLORS[colorIndex] ?? PRESET_COLORS[0];
      owners[idx] = p.painter;
      return { ...prev, colors, owners, _v: (prev._v ?? 0) + 1 };
    }
    if (payload.eventType === 'DELETE') {
      const p = payload.old as Partial<OffchainCanvasRow>;

      let x = p.x;
      let y = p.y;

      // Fallback : payload.old tronqué — parser depuis l'id "x-y"
      if (x === undefined || y === undefined) {
        const rawId = p.id;
        if (rawId) {
          const [xStr, yStr] = rawId.split('-');
          const parsedX = parseInt(xStr, 10);
          const parsedY = parseInt(yStr, 10);
          if (!isNaN(parsedX) && !isNaN(parsedY)) {
            x = parsedX;
            y = parsedY;
          }
        }
      }

      if (x === undefined || y === undefined) {
        console.warn('[Realtime DELETE] impossible de résoudre x/y, ni via payload.old ni via id', p);
        return prev;
      }

      const dx = x - prev.startX;
      const dy = y - prev.startY;
      if (dx < 0 || dx >= prev.w || dy < 0 || dy >= prev.h) return prev;
      const idx = dy * prev.w + dx;
      // Ce DELETE peut venir du nettoyage post-freeze de l'indexer (purge
      // offchain_canvas). Si le pixel est déjà marqué frozen (l'INSERT sur
      // `pixel` est arrivé avant ce DELETE), ne pas l'effacer — sinon on
      // écrase un pixel légitimement frozen avec du vide.
      if (prev.frozen[idx]) return prev;
      const colors = [...prev.colors];
      const owners = [...prev.owners];
      colors[idx] = null;
      owners[idx] = null;
      return { ...prev, colors, owners, _v: (prev._v ?? 0) + 1 };
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
          pendingBatchRef.current.push(payload);
          if (batchRafRef.current === null) {
            batchRafRef.current = requestAnimationFrame(() => {
              batchRafRef.current = null;
              const batch = pendingBatchRef.current;
              pendingBatchRef.current = [];

              // Delta du compte total dérivé du même batch — évite un
              // second channel + un refetch réseau (voir ex-StatsBar).
              let delta = 0;
              for (const p of batch) {
                if (p.eventType === 'INSERT') delta += 1;
                else if (p.eventType === 'DELETE') delta -= 1;
              }
              if (delta !== 0) {
                setPaintedCount(prev => prev === null ? prev : Math.max(0, prev + delta));
              }

              setCanvasData(prev => {
                if (!prev) {
                  // Cap dur pour éviter une croissance non bornée si la
                  // connexion est lente ou qu'il y a un pic d'activité
                  // pendant que canvasData n'est pas encore prêt — on ne
                  // garde que les events les plus récents.
                  pendingRealtimeEvents.current = [...pendingRealtimeEvents.current, ...batch].slice(-1000);
                  return prev;
                }
                return batch.reduce((acc, p) => applyRealtimeEvent(acc, p), prev);
              });
            });
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      if (batchRafRef.current !== null) cancelAnimationFrame(batchRafRef.current);
      pendingBatchRef.current = [];
    };
  }, [applyRealtimeEvent]);

  // Compte des pixels peints — fetch initial au montage, puis les
  // variations sont dérivées localement des events déjà reçus par le
  // channel canvas-live-updates (voir plus bas), pour éviter de refaire
  // un select count(*) sur toute la table à chaque changement. Un
  // re-sync complet toutes les 24h (ou au retour de focus si la dernière
  // sync date de plus de 24h) sert de filet contre un drift éventuel si
  // un event Realtime a été manqué (déconnexion WebSocket, etc.).
  const lastPaintedCountSyncRef = useRef(0);
  useEffect(() => {
    let cancelled = false;
    const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

    const syncPaintedCount = async (attempt = 0) => {
      try {
        const { count, error } = await supabase
          .from('offchain_canvas')
          .select('*', { count: 'estimated', head: true });
        if (cancelled) return;
        if (error) throw error;
        setPaintedCount(count ?? 0);
        lastPaintedCountSyncRef.current = Date.now();
      } catch (err) {
        if (cancelled) return;
        if (attempt < 2) {
          setTimeout(() => syncPaintedCount(attempt + 1), 1500);
          return;
        }
        console.error('Error syncing painted count', err);
        setPaintedCount(prev => prev !== null ? prev : 0);
      }
    };

    syncPaintedCount();
    const intervalId = setInterval(syncPaintedCount, SYNC_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastPaintedCountSyncRef.current >= SYNC_INTERVAL_MS) {
        syncPaintedCount();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

useEffect(() => {
  const channel = supabase
  .channel('frozen-live-updates')
  .on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'freeze_events' },
    (payload) => {
        const p = payload.new as { x: number; y: number; color: string; owner: string };
        // Batching rAF (même pattern que canvas-live-updates) : avant, chaque
        // INSERT déclenchait un setCanvasData + redraw immédiat. Un freeze
        // batch de 200 pixels ou plusieurs joueurs simultanés pouvaient donc
        // provoquer des dizaines de redraws complets dans la même frame.
        pendingFrozenBatchRef.current.push({ x: p.x, y: p.y, color: p.color, owner: p.owner.toLowerCase() });
        if (frozenBatchRafRef.current === null) {
          frozenBatchRafRef.current = requestAnimationFrame(() => {
            frozenBatchRafRef.current = null;
            const batch = pendingFrozenBatchRef.current;
            pendingFrozenBatchRef.current = [];
            if (batch.length === 0) return;

           // On notifie TOUS les pixels freezés de la frame (pas seulement
            // le dernier) — LiveFreezeFeed plafonne lui-même l'affichage à
            // ~10 toasts simultanés, donc pas de risque de flood visuel même
            // sur un freezeBatch on-chain de 200 pixels d'un coup.
            setFreezeEvents({
              batchId: ++freezeBatchIdRef.current,
              events: batch.map(p => ({ x: p.x, y: p.y, owner: p.owner, color: p.color })),
            });

            setCanvasData(prev => {
              if (!prev) return prev;
              const colors = [...prev.colors];
              const owners = [...prev.owners];
              const frozen = [...prev.frozen];
              const frozenOwners = [...prev.frozenOwners];
              let changed = false;
              for (const p of batch) {
                const dx = p.x - prev.startX;
                const dy = p.y - prev.startY;
                if (dx < 0 || dx >= prev.w || dy < 0 || dy >= prev.h) continue;
                const idx = dy * prev.w + dx;
                colors[idx] = p.color;
                owners[idx] = p.owner;
                frozen[idx] = true;
                frozenOwners[idx] = p.owner;
                changed = true;
              }
              if (!changed) return prev;
              return { ...prev, colors, owners, frozen, frozenOwners, _v: (prev._v ?? 0) + 1 };
            });
          });
        }
      }
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
    if (frozenBatchRafRef.current !== null) cancelAnimationFrame(frozenBatchRafRef.current);
    pendingFrozenBatchRef.current = [];
  };
}, []);

  const IS_MAINNET = TARGET_CHAIN_ID === '0x89'; // 137 = Polygon mainnet
  const { fundWallet } = useFundWallet();

  // ── Réseau ────────────────────────────────────────────────────────────────
const checkNetwork = useCallback(async (browserProvider: ethers.BrowserProvider) => {
  const eth = window.ethereum;
  if (!eth) return;
  try {
    const network    = await browserProvider.getNetwork();
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
    rpcUrls: [PUBLIC_ADD_CHAIN_RPC_URL],
    blockExplorerUrls: [import.meta.env.VITE_BLOCK_EXPLORER_URL],
  }],
});
        }
      }
    }
  } catch (err) { console.error("Network check failed", err); }
}, [showNotification]);

  const refreshPolBalance = useCallback(async () => {
  if (!account) { setPolBalance('0'); return; }
  try {
    const provider = signer?.provider ?? sharedRpcProvider;
    const bal = await provider.getBalance(account);
    setPolBalance(ethers.formatEther(bal));
  } catch (e) {
    console.error("Error fetching POL balance", e);
  }
}, [account, signer]);

useEffect(() => { refreshPolBalance(); }, [refreshPolBalance]);

  // ── Refresh données chain ─────────────────────────────────────────────────
  const refreshChainData = useCallback(async (contract: ethers.Contract, userAccount: string, attempt = 0): Promise<void> => {
  try {
    const [supply, bal, frozen, airdrop, claimed] = await Promise.all([
      contract.totalSupply(),
      contract.balanceOf(userAccount),
      contract.totalFrozenPixels(),
      contract.isAirdropUnlocked(),
      contract.hasClaimed(userAccount),
    ]);
setTotalSupply(ethers.formatEther(supply));
    setTokenBalance(ethers.formatEther(bal));
    setTotalFrozen(frozen.toString());
    setAirdropUnlocked(airdrop);
    setHasClaimedAirdrop(claimed);
    setPublicSupplyTokens(toPublicSupplyTokens(BigInt(supply.toString()), BigInt(frozen.toString())));
  } catch (e) {
    console.error("Error refreshing chain data", e);
    if (attempt < 2) {
      await new Promise(r => setTimeout(r, 1500));
      return refreshChainData(contract, userAccount, attempt + 1);
    }
    // Dernier recours : lit directement via un RPC public dédié plutôt
    // que via le provider MetaMask, qui peut avoir un souci ponctuel.
    try {
      const fallbackContract = new ethers.Contract(CONTRACT_ADDRESS, ABI, sharedRpcProvider);
      const [supply, bal, frozen, airdrop] = await Promise.all([
        fallbackContract.totalSupply(),
        fallbackContract.balanceOf(userAccount),
        fallbackContract.totalFrozenPixels(),
        fallbackContract.isAirdropUnlocked(),
      ]);
      setTotalSupply(ethers.formatEther(supply));
      setTokenBalance(ethers.formatEther(bal));
      setTotalFrozen(frozen.toString());
      setAirdropUnlocked(airdrop);
      setPublicSupplyTokens(toPublicSupplyTokens(BigInt(supply.toString()), BigInt(frozen.toString())));
    } catch (e2) {
      console.error("Fallback refresh also failed", e2);
    }
  }
}, []);

  useEffect(() => { readContractRef.current = readContract; }, [readContract]);
  useEffect(() => { accountRef.current = account; }, [account]);

  useEffect(() => {
    const loadPublicStats = async () => {
try {
        const publicContract = new ethers.Contract(CONTRACT_ADDRESS, ABI, sharedRpcProvider);
        const [supply, frozen] = await Promise.all([
          publicContract.totalSupply(),
          publicContract.totalFrozenPixels(),
        ]);
        setTotalSupply(ethers.formatEther(supply));
        setTotalFrozen(frozen.toString());
        setPublicSupplyTokens(toPublicSupplyTokens(BigInt(supply.toString()), BigInt(frozen.toString())));
      } catch (e) { console.error("Error loading public stats", e); }
    };
    if (!account) loadPublicStats();
  }, [account]);

  // ── Sync stats entre onglets ────────────────────────────────────────────
  // Chaque onglet ne lit la chain qu'au chargement initial ; sans ce polling,
  // un achat/freeze fait dans un autre onglet reste invisible ici jusqu'au
  // refresh manuel. On refetch périodiquement, et surtout dès que l'onglet
  // redevient actif (cas le plus fréquent : switch d'onglet après une action).
  useEffect(() => {
    const refresh = () => {
      const rc = readContractRef.current;
      const ac = accountRef.current;
      if (rc && ac) {
        refreshChainData(rc, ac);
      } else {
        const publicContract = new ethers.Contract(CONTRACT_ADDRESS, ABI, sharedRpcProvider);
        Promise.all([publicContract.totalSupply(), publicContract.totalFrozenPixels()])
          .then(([supply, frozen]) => {
            setTotalSupply(ethers.formatEther(supply));
            setTotalFrozen(frozen.toString());
            setPublicSupplyTokens(toPublicSupplyTokens(BigInt(supply.toString()), BigInt(frozen.toString())));
          })
          .catch(e => console.error("Error polling public stats", e));
      }
    };

    const intervalId = setInterval(refresh, 20000);
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', refresh);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', refresh);
    };
  }, [refreshChainData]);

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
  }, [refreshChainData, checkNetwork]);

const handleConnect = useCallback(async () => {
  const eth = window.ethereum;
  if (!eth) { showNotification("MetaMask not found!", "error"); return; }
  try {
    await eth.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] });
    const accounts = await eth.request({ method: 'eth_accounts' }) as string[];
    if (!accounts?.[0]) { showNotification("No account selected", "error"); return; }
    const browserProvider = new ethers.BrowserProvider(eth);
    await initWeb3(browserProvider, accounts[0]);
    showNotification("Wallet connected!", "success");
  } catch { showNotification("Connection rejected", "error"); }
}, [showNotification, initWeb3]);

const handleDisconnect = useCallback(async () => {
  if (authenticated) {
    await logout();
  }
  setAccount(null);
  setSigner(null);
  setTokenBalance('0');
  setTotalFrozen('0');
  setReadContract(null);
  setWriteContract(null);
}, [authenticated, logout]);

  useEffect(() => {
    const eth = window.ethereum;
    if (!eth) return;
    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      if (accounts.length > 0) {
        initWeb3(new ethers.BrowserProvider(eth), accounts[0]);
      } else {
        handleDisconnect();
      }
    };
    eth.on('accountsChanged', onAccountsChanged);
    eth.on('chainChanged', () => window.location.reload());
    return () => { eth.removeListener('accountsChanged', onAccountsChanged); };
  }, [initWeb3]);

const runTx = useCallback(async (
  txFunc: (overrides?: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }) => Promise<ethers.ContractTransactionResponse>,
  successMsg?: React.ReactNode,
  onConfirmed?: (txHash: string) => Promise<void>
): Promise<boolean> => {
    if (!writeContract) return false;
    setTxStatus('pending');
    showNotification("Please confirm in your wallet...", "pending");
    try {
      // Retry sur l'ENVOI initial lui-même, pas seulement sur la confirmation :
      // le RPC public Amoy peut échouer de façon intermittente dès
      // eth_sendTransaction ("RPC endpoint not found or unavailable"), avant
      // même d'atteindre la négociation de gas ou le minage. On ne retry
      // que sur cette erreur réseau précise — pas sur un rejet utilisateur
      // ou une erreur applicative (NotEnoughTokens, etc.), qui doivent
      // remonter immédiatement sans boucle inutile.
      let tx: ethers.ContractTransactionResponse | null = null;
      let sendAttempts = 0;
      // Sur testnet (Amoy), le floor est précalculé dès le 1er essai car
      // l'estimation MetaMask tombe quasi systématiquement sous le plancher
      // validateur réel (~25 gwei) — sans ça, le 1er essai échouait presque
      // à chaque tx. Sur mainnet, on laisse MetaMask estimer librement au
      // 1er essai ; le floor ne sert que de filet de secours si le retry
      // détecte un rejet "underpriced" (cf. catch plus bas).
      let feeFallback: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } | undefined =
        IS_MAINNET_CHAIN ? undefined : await getFeeOverrides();
      while (!tx && sendAttempts < 3) {
        try {
          tx = await txFunc(feeFallback);
        } catch (sendErr: unknown) {
          const e = sendErr as { code?: string; message?: string };
          const isUnderpriced = e.message?.includes('tip cap') || e.message?.includes('max fee per gas less than') || e.message?.includes('transaction underpriced') || e.message?.includes('replacement fee too low');
          const isRpcUnavailable = !isUnderpriced && (e.message?.includes('RPC endpoint') || e.message?.includes('could not coalesce error'));
          sendAttempts++;
          if (isRpcUnavailable && sendAttempts < 3) {
            console.warn(`eth_sendTransaction RPC unavailable, retry ${sendAttempts}/3...`);
            showNotification(`Network hiccup, retrying (${sendAttempts}/3)...`, "pending");
            await new Promise(res => setTimeout(res, 2000));
            } else if (isUnderpriced && sendAttempts < 3) {
            console.warn(`Wallet gas suggestion too low, retrying with computed fee floor (${sendAttempts}/3)...`);
            showNotification(`Network congestion detected, adjusting gas and retrying (${sendAttempts}/3)...`, "pending");
            feeFallback = await getFeeOverrides();
          } else {
            throw sendErr;
          }
        }
      }
      if (!tx) throw new Error('Transaction submission failed after 3 attempts.');

      setTxStatus('mining');
      showNotification("Transaction sent! Waiting for confirmation...", "pending");
      let receipt: ethers.TransactionReceipt | null = null;
let attempts = 0;
while (!receipt && attempts < 5) {
  try {
    receipt = await tx.wait();
  } catch (waitErr: unknown) {
    const e = waitErr as { code?: string; message?: string };
    if (e.code === 'UNKNOWN_ERROR' && e.message?.includes('RPC endpoint')) {
      attempts++;
      console.warn(`tx.wait() RPC timeout, retry ${attempts}/5...`);
      await new Promise(res => setTimeout(res, 3000));
    } else {
      throw waitErr;
    }
  }
}
if (!receipt) throw new Error('Transaction confirmation timeout after 5 attempts.');

      // Hook exécuté immédiatement après confirmation, AVANT tout le reste :
      // ferme la fenêtre entre le nouvel état on-chain et le nettoyage
      // off-chain, sans dépendre du prochain passage async de l'indexer.
      if (onConfirmed) {
        const txHash = tx?.hash || receipt?.hash || "";
        if (txHash) {
          try { await onConfirmed(txHash); } catch (e) { console.error('[onConfirmed] enforcement failed', e); }
        }
      }

      setTxStatus('success');
      showNotification(successMsg || "Transaction confirmed!", "success");
      const rc = readContractRef.current;
      const ac = accountRef.current;
      if (rc && ac) await refreshChainData(rc, ac);
      refreshPolBalance();
      return true;
    } catch (err: unknown) {
      console.error(err);
      setTxStatus('error');
      const e = err as { reason?: string; message?: string; code?: string; receipt?: { status?: number | string | null } };
      let msg = e.reason || e.message || "Transaction failed";
      const minedButReverted = e.code === 'CALL_EXCEPTION' && e.receipt != null;
      if (minedButReverted) {
        msg = "This pixel was just frozen by someone else a moment before your transaction. Please pick another pixel.";
      } else if (e.code === 'CALL_EXCEPTION' || msg.includes('estimateGas')) {
        msg = "Not enough MATIC to cover the transaction cost.";
      } else if (msg.includes('NotEnoughTokens'))    msg = "Not enough PAINT tokens.";
      else if (msg.includes('SlippageExceeded'))   msg = "Price moved too fast — try again.";
      else if (msg.includes('PixelAlreadyFrozen')) msg = "This pixel is already frozen.";
      else if (msg.includes('user rejected'))      msg = "Transaction cancelled.";
      else if (msg.includes('RPC endpoint') || msg.includes('could not coalesce error')) msg = "Network connection issue — please try again.";
      showNotification(msg, "error");
      return false;
    }
  }, [writeContract, refreshChainData, refreshPolBalance, showNotification]);
// Attend que le solde POL on-chain atteigne au moins `minWei`, en pollant
// régulièrement. Les achats par carte ne sont pas instantanés côté Privy,
// donc on ne peut pas juste enchaîner les 2 tx sans vérifier la réception réelle.
const waitForPolBalance = useCallback(async (
  provider: ethers.JsonRpcProvider,
  address: string,
  minWei: bigint,
  { intervalMs = 4000, maxAttempts = 45 } = {}
): Promise<boolean> => {
  for (let i = 0; i < maxAttempts; i++) {
    const bal = await provider.getBalance(address);
    if (bal >= minWei) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}, []);

// Ouvre une modale d'avertissement (frais + délai) et attend le choix de l'utilisateur
// avant de lancer le flow de paiement Privy.
const confirmFundingWithUser = useCallback((amount: string): Promise<boolean> => {
  return new Promise(resolve => {
    setPendingFunding({ amount, resolve });
  });
}, []);

// Si le solde est insuffisant, propose à l'utilisateur de choisir entre
// payer par carte (si mainnet) ou annuler pour déposer du POL manuellement.
const ensureSufficientPol = useCallback(async (requiredWei: bigint): Promise<boolean> => {
  if (!account) return false;
  const provider = sharedRpcProvider;
  const currentBalance = await provider.getBalance(account);
  const { maxFeePerGas } = await getFeeOverrides();
  const gasBuffer = maxFeePerGas * BUY_GAS_LIMIT_ESTIMATE;
  const target = requiredWei + gasBuffer;

  if (currentBalance >= target) return true;

  const missing = target - currentBalance;
  const amountToBuy = (parseFloat(ethers.formatEther(missing)) * 1.15).toFixed(4);

  if (!IS_MAINNET) {
    showNotification(
      `Not enough POL balance (missing ~${amountToBuy} POL). Deposit testnet POL on ${account} via the Amoy faucet.`,
      "error"
    );
    return false;
  }

  const userConfirmed = await confirmFundingWithUser(amountToBuy);
  if (!userConfirmed) {
    showNotification("Buy cancelled.", "info");
    return false;
  }

  await fundWallet({ address: account, options: { chain: polygon, amount: amountToBuy } });

  showNotification("Waiting for POL receipt", "pending");
  const received = await waitForPolBalance(provider, account, target);
  if (!received) {
    showNotification("The POL are not arrived yet. Try the purchase again in a few minutes.", "error");
    return false;
  }
  refreshPolBalance();
  showNotification("POL received! Purchasing PAINT tokens", "success");
  return true;
}, [account, IS_MAINNET, fundWallet, refreshPolBalance, showNotification, confirmFundingWithUser, waitForPolBalance]);

  // ── Buy / Sell ────────────────────────────────────────────────────────────
const handleBuyTokens = useCallback(async (amount: string) => {
  if (isBuyingRef.current) return;
  isBuyingRef.current = true;
  try {
    const n = parseInt(amount, 10);
    if (!readContract || !writeContract || isNaN(n)) return;
    const buyAmt = BigInt(n);
    const [supply, frozen] = await Promise.all([
      readContract.totalSupply(),
      readContract.totalFrozenPixels(),
    ]);
    const publicSupplyTokens = toPublicSupplyTokens(BigInt(supply.toString()), BigInt(frozen.toString()));
    const costWei = await readContract.getPrice(publicSupplyTokens, buyAmt);
    const maxCost = costWei * 103n / 100n;

    const ok = await ensureSufficientPol(maxCost);
    if (!ok) return;

    await runTx(
        async (overrides) => {
        return writeContract.buyTokens(buyAmt, maxCost, { value: maxCost, ...overrides });
      },
      `Successfully purchased ${n} PAINT tokens!`
    );
  } finally {
    isBuyingRef.current = false;
  }
}, [readContract, writeContract, ensureSufficientPol, runTx]);

const checkSellFeasibility = useCallback(async (sellAmt: bigint): Promise<{ deficit: number; unlockedAvailable: number; lockedToSacrifice: number }> => {
  if (!account) return { deficit: 0, unlockedAvailable: 0, lockedToSacrifice: 0 };
  const painter = account.toLowerCase();

  const { data: ownedRows } = await supabase
    .from('offchain_canvas').select('id, is_locked').eq('painter', painter);
  const ownedIds  = (ownedRows || []).map(r => r.id);
  const lockedIds = (ownedRows || []).filter(r => r.is_locked).map(r => r.id);

  let pendingIds = new Set<string>();
  if (ownedIds.length > 0) {
    const { data: pendingRows } = await supabase
  .rpc('get_pending_purge_ids', { p_ids: ownedIds });
    pendingIds = new Set((pendingRows || []).map((r: { id: string }) => r.id));
  }

  const effectiveOwned = ownedIds.filter(id => !pendingIds.has(id)).length;
  const lockedCount    = lockedIds.filter(id => !pendingIds.has(id)).length;

  const currentUsable     = Number(tokenBalance);
  const usableAfterSell   = currentUsable - Number(sellAmt);
  const required          = effectiveOwned;
  const unlockedAvailable = effectiveOwned - lockedCount;

  if (usableAfterSell >= required) {
    return { deficit: 0, unlockedAvailable, lockedToSacrifice: 0 };
  }

  const deficit = required - usableAfterSell;
  const lockedToSacrifice = Math.max(0, deficit - unlockedAvailable);

  return { deficit, unlockedAvailable, lockedToSacrifice };
}, [account, tokenBalance]);


  const [pendingSell, setPendingSell] = useState<{ amount: string; lockedToSacrifice: number } | null>(null);
  const [showGoogleWarning, setShowGoogleWarning] = useState(false);
  const [pendingFunding, setPendingFunding] = useState<{ amount: string; resolve: (v: boolean) => void } | null>(null);
  const [pendingPaint, setPendingPaint] = useState<{ execute: () => Promise<void>; lockedToSacrifice: number } | null>(null);

  const executeSell = useCallback(async (amount: string) => {
  try {
    const n = parseInt(amount, 10);
    if (!readContract || !writeContract || isNaN(n)) return;
    const sellAmt = BigInt(n);

    const [supply, frozen] = await Promise.all([
      readContract.totalSupply(),
      readContract.totalFrozenPixels(),
    ]);
    const publicSupplyTokens = toPublicSupplyTokens(BigInt(supply.toString()), BigInt(frozen.toString()));
    const supplyAfterTokens  = publicSupplyTokens - sellAmt;
    const expectedRevenue    = await readContract.getPrice(supplyAfterTokens, sellAmt);
    const minRevenue         = expectedRevenue * 97n / 100n;

    const success = await runTx(
      async (overrides) => {
        return writeContract.sellTokens(sellAmt, minRevenue, overrides ?? {});
      },
      `Successfully sold ${n} PAINT tokens!`,
      async (txHash: string) => {
        const enforceAddr = account!.toLowerCase();
        await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/enforce-pixel-quota`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ address: enforceAddr, txHash }),
        });
      }
    );

    if (success) {
      feasibilityCacheRef.current = null;
      showNotification("Sale confirmed! Surplus pixels cleaned up instantly.", "info");
    }
  } finally {
    isSellingRef.current = false;
  }
}, [readContract, writeContract, runTx, account, showNotification]);



const handleSellTokens = useCallback(async (amount: string) => {
  if (isSellingRef.current) return;
  isSellingRef.current = true;
  const n = parseInt(amount, 10);
  if (!readContract || !writeContract || isNaN(n)) { isSellingRef.current = false; return; }
  const sellAmt = BigInt(n);

  const feasibility = await checkSellFeasibility(sellAmt);

  if (feasibility.lockedToSacrifice > 0) {
    setPendingSell({ amount, lockedToSacrifice: feasibility.lockedToSacrifice });
    return;
  }

  await executeSell(amount);
  isSellingRef.current = false;
}, [readContract, writeContract, checkSellFeasibility, executeSell]);

const handleClaimAirdrop = useCallback(async () => {
  if (!writeContract) return;
  await runTx(
    async (overrides) => {
     return writeContract.claim(overrides ?? {});
    },
    withIcon(<Gift size={16} />, "Airdrop claimed with success!")
  );
}, [writeContract, runTx]);

  // ── Freeze ────────────────────────────────────────────────────────────────
const handleFreezePixel = useCallback(async (x: number, y: number) => {
  if (!writeContract || !account || !readContract) return;
  await runTx(
     async (overrides) => {
     return writeContract.freezePixel(toPixelId(x, y), hexToUint24(selectedColor), overrides ?? {});
    },
    withIcon(<Snowflake size={16} />, `Pixel (${x}, ${y}) frozen permanently!`),
    async () => {
      handlePixelsFrozen([{ id: pixelKey(x, y), x, y, color: selectedColor }], account.toLowerCase());
    }
  );
}, [writeContract, account, readContract, runTx, selectedColor, handlePixelsFrozen]);

// ── Freeze Batch ──────────────────────────────────────────────────────────
 const handleFreezeBatch = useCallback(async (pixelsToFreeze: DraftPixel[]): Promise<boolean> => {
    if (!writeContract || !account || pixelsToFreeze.length === 0) return false;
    // Idem freeze unitaire : mise à jour locale déplacée dans onConfirmed
    // pour réduire la fenêtre de race avec le DELETE realtime de l'indexer.
    const success = await runTx(
       async (overrides) => {
       return writeContract.freezeBatch(
          pixelsToFreeze.map(p => toPixelId(p.x, p.y)),
          pixelsToFreeze.map(p => hexToUint24(p.color)),
          overrides ?? {}
        );
      },
      withIcon(<Snowflake size={16} />, `${pixelsToFreeze.length} pixel(s) frozen permanently!`),
      async () => {
        handlePixelsFrozen(pixelsToFreeze, account.toLowerCase());
      }
    );
    return success;
  }, [writeContract, account, runTx, handlePixelsFrozen]);
  
// ── Canvas Load ───────────────────────────────────────────────────────────
  const handleLoadSlice = useCallback(async (startX: number, startY: number, w: number, h: number) => {
    const requestId = ++loadRequestIdRef.current;

    // Annule la requête HTTP précédente encore en vol avant d'en lancer une nouvelle
    loadAbortControllerRef.current?.abort();
    const controller = new AbortController();
    loadAbortControllerRef.current = controller;

    setLoadingCanvas(true);
    try {
      const accountParam = account ? `&account=${account.toLowerCase()}` : '';
      const res = await fetch(
        `${INDEXER_URL}/canvas-slice-binary?startX=${startX}&startY=${startY}&w=${w}&h=${h}${accountParam}`,
        { signal: controller.signal }
      );
      if (!res.ok) throw new Error('binary slice fetch failed');
      if (requestId !== loadRequestIdRef.current) return;
      const buf = new DataView(await res.arrayBuffer());

      const colors: (string | null)[]       = new Array(w * h).fill(null);
      const owners: (string | null)[]       = new Array(w * h).fill(null);
      const frozen: boolean[]               = new Array(w * h).fill(false);
      const frozenOwners: (string | null)[] = new Array(w * h).fill(null);

      for (let off = 0; off < buf.byteLength; off += 5) {
        const x = buf.getUint16(off, true);
        const y = buf.getUint16(off + 2, true);
        const flags = buf.getUint8(off + 4);
        const localX = x - startX, localY = y - startY;
        if (localX < 0 || localX >= w || localY < 0 || localY >= h) continue;
        const idx = localY * w + localX;
        colors[idx] = PRESET_COLORS[flags & 0x1F];
        const isFrozen = !!(flags & 0x20);
        const isOwner  = !!(flags & 0x40);
        frozen[idx] = isFrozen;
        owners[idx] = isOwner ? account : null;
        frozenOwners[idx] = isFrozen && isOwner ? account : null;
      }

      // Purge les entrées expirées, puis réapplique par-dessus tout pixel
      // freezé récemment mais que le backend ne reflète pas encore —
      // empêche un pixel qu'on vient de freezer de "redevenir" libre
      // (et donc re-sélectionnable dans une zone) le temps que l'indexer
      // rattrape son retard.
      for (const [key, v] of recentlyFrozenRef.current) {
        if (Date.now() - v.ts > RECENTLY_FROZEN_TTL_MS) recentlyFrozenRef.current.delete(key);
      }
      for (let yy = startY; yy < startY + h; yy++) {
        for (let xx = startX; xx < startX + w; xx++) {
          const key = pixelKey(xx, yy);
          const pending = recentlyFrozenRef.current.get(key);
          if (!pending) continue;
          const idx = (yy - startY) * w + (xx - startX);
          if (frozen[idx]) {
            recentlyFrozenRef.current.delete(key); // l'indexer a rattrapé, plus besoin
          } else {
            colors[idx] = pending.color;
            owners[idx] = pending.owner;
            frozen[idx] = true;
            frozenOwners[idx] = pending.owner;
          }
        }
      }

      setCanvasData({ colors, owners, frozen, frozenOwners, startX, startY, w, h, _v: 0 });

      if (pendingRealtimeEvents.current.length > 0) {
        const pending = [...pendingRealtimeEvents.current];
        pendingRealtimeEvents.current = [];
        setCanvasData(prev => {
          if (!prev) return prev;
          return pending.reduce((acc, payload) => applyRealtimeEvent(acc, payload), prev);
        });
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return; // annulation volontaire, pas une vraie erreur
      console.error("Error loading canvas slice", e);
      showNotification("Failed to load canvas data", "error");
    } finally {
      if (requestId === loadRequestIdRef.current) setLoadingCanvas(false);
    }
  }, [account, applyRealtimeEvent, showNotification]);

  // ── Leaderboard ───────────────────────────────────────────────────────────
const fetchLeaderboard = useCallback(async () => {
  setIsLoadingLeaderboard(true);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(`${INDEXER_URL}/burners?limit=100`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error('Indexer unreachable');
    const data  = await res.json();
    const items = data?.burners || [];
    if (items.length === 0) {
      showNotification("No frozen pixels yet — be the first!", "info");
      setLeaderboard([]);
      setShowLeaderboard(false);
      return;
    }
    setLeaderboard(items.map((b: BurnerApiItem) => ({
      rank: b.rank, address: b.address, totalFrozen: Number(b.totalFrozen),
      pseudo: b.pseudo || '', message: b.message || '',
      twitter: b.twitter || '', instagram: b.instagram || '',
      telegram: b.telegram || '', discord: b.discord || '',
    })));
    setShowLeaderboard(true);
  } catch (err) {
    console.error("Leaderboard error:", err);
    showNotification("Could not load leaderboard.", "error");
  } finally {
    setIsLoadingLeaderboard(false);
  }
}, [showNotification]);

const handleSelectPixel = useCallback((p: { x: number; y: number }) => {
    setSelectedPixel(prev =>
      prev && prev.x === p.x && prev.y === p.y ? null : p
    );
  }, []);

  const handleOpenEditProfile = useCallback(() => setShowEditProfile(true), []);
  const handleCloseEditProfile = useCallback(() => setShowEditProfile(false), []);
  const handleProfileSaved = useCallback(() => {
  showNotification(withIcon(<Pencil size={16} />, "Profile saved successfully!"), "success");
  if (showLeaderboard) fetchLeaderboard();
}, [showNotification, showLeaderboard, fetchLeaderboard]);
  const handleOpenGoogleWarning = useCallback(() => setShowGoogleWarning(true), []);
  const handleCloseLeaderboard = useCallback(() => setShowLeaderboard(false), []);
  const handleClearDrafts = useCallback(() => {
    setDrafts([]);
    setSelectedPixel(null);
    setClearZoneSignal(v => v + 1);
      }, []);

      if (!CONTRACT_ADDRESS) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        height: '100vh', fontFamily: 'sans-serif',
        background: 'var(--bg-app)', color: 'var(--color-red)',
      }}>
        <h1>Configuration error</h1>
        <p style={{ color: 'var(--text-muted)' }}>VITE_CONTRACT_ADDRESS is missing. Check your .env file.</p>
      </div>
    );
  }

  // ── Maintenance mode ──────────────────────────────────────────────────────
  if (import.meta.env.VITE_MAINTENANCE_MODE === 'true') {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        height: '100vh', fontFamily: 'sans-serif',
        background: 'var(--bg-app)', color: 'var(--text-primary)',
      }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
            <Construction size={28} /> almost ready
        </h1>
        <p style={{ color: 'var(--text-muted)' }}>CryptoPixel will be available soon...</p>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
<Header
  account={account}
  tokenBalance={tokenBalance}
  onConnect={handleConnect}
  onGoogleConnect={handleOpenGoogleWarning}
  onDisconnect={handleDisconnect}
  txStatus={txStatus}
  config={APP_CONFIG}
  onOpenLeaderboard={fetchLeaderboard}
  leaderboard={leaderboard}
  showLeaderboard={showLeaderboard}
  onCloseLeaderboard={handleCloseLeaderboard}
  onReplayTutorial={() => setShowTutorial(true)}
  isLoadingLeaderboard={isLoadingLeaderboard}
  hasClaimedAirdrop={hasClaimedAirdrop}
  signer={signer}
  theme={theme}
  setTheme={setTheme}
  accent={accent}
  setAccent={setAccent}
  polBalance={polBalance}
/>

      <LiveFreezeFeed freezeBatch={freezeEvents} />

        <StatsBar
        totalSupply={totalSupply}
        totalFrozen={totalFrozen}
        paintedCount={paintedCount}
        showFrozenOverlay={showFrozenOverlay}
        onToggleFrozenOverlay={handleToggleFrozenOverlay}
      />

      <div style={{ padding: '8px 20px' }}>
        <ProgressBar
          totalFrozen={Number(totalFrozen)}
          airdropUnlocked={airdropUnlocked}
        />
      </div>

     

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>

        {/* ── Canvas zone ─────────────────────────────────────────────── */}
        <div style={{ flex: 1, height: '100%', position: 'relative', background: 'var(--bg-app)' }}>
          <PixelCanvas
            canvasData={canvasData}
            loadingCanvas={loadingCanvas}
            selectedPixel={selectedPixel}
            selectedColor={selectedColor}
            account={account}
            onSelectPixel={handleSelectPixel}
            onLoadSlice={handleLoadSlice}
            readContract={readContract}
            onPixelsPainted={handlePixelsPainted}
            onFreezeBatch={handleFreezeBatch}
            onOpenEditProfile={handleOpenEditProfile}
            showFrozenOverlay={showFrozenOverlay}
            zoneMode={zoneMode}
            draftPixels={drafts}
            onToggleZoneMode={handleToggleZoneMode}
            onDraftPixelsChange={setDrafts}
            clearZoneSignal={clearZoneSignal}
          />
        </div>

        {/* ── Sidebar ──────────────────────────────────────────────────── */}
        <div style={{ position: 'relative', display: 'flex', zIndex: 10 }}>

          {/* Toggle button */}
          <button onClick={handleToggleSidebar}
            style={{
              position: 'absolute', left: -32, top: '50%',
              transform: 'translateY(-50%)', width: 32, height: 60,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-primary)',
              borderRight: 'none', borderRadius: '8px 0 0 8px',
              color: 'var(--color-primary)', cursor: 'pointer', fontSize: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `-4px 0 16px var(--shadow-default)`, transition: 'all 0.2s', zIndex: 20,
            }}
          >
            <span style={{ display: 'inline-flex', transform: isSidebarOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.3s' }}>
              <ChevronLeft size={16} />
            </span>
          </button>

          {/* Panel */}
          <div style={{
            width: isSidebarOpen ? 360 : 0,
            opacity: isSidebarOpen ? 1 : 0,
            pointerEvents: isSidebarOpen ? 'auto' : 'none',
            borderLeft: isSidebarOpen ? '1px solid var(--border-primary)' : 'none',
            background: 'var(--bg-surface)',
            display: 'flex', flexDirection: 'column',
            transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)', overflow: 'hidden',
          }}>

            {/* Tabs */}
<div style={{ display: 'flex', borderBottom: '1px solid var(--border-primary)' }}>
  {['actions', 'trade', 'my-pixels', 'airdrop'].map(tab => (
    <button key={tab} onClick={() => setActiveTab(tab)} style={{
      flex: 1, padding: 12,
      background: activeTab === tab ? 'var(--bg-hover)' : 'transparent',
      border: 'none',
      color: activeTab === tab ? 'var(--color-primary)' : 'var(--text-muted)',
      fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
    }}>
      {tab === 'airdrop' ? (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
    <Gift size={16} /> Airdrop
  </span>
) : (
  { actions: 'Actions', trade: 'Market', 'my-pixels': 'My Pixels' }[tab]
)}
    </button>
  ))}
</div>

            {/* Tab content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 16, minWidth: 360 }}>
              {activeTab === 'actions' && (
                <PixelActions
                  selectedPixel={selectedPixel}
                  selectedColor={selectedColor}
                  onColorChange={setSelectedColor}
                  account={account}
                  onFreeze={handleFreezePixel}
                  txStatus={txStatus}
                  readContract={readContract}
                  tokenBalance={tokenBalance}
                  hasClaimedAirdrop={hasClaimedAirdrop}
                  zoneMode={zoneMode}
                  draftsCount={drafts.length}
                  onClearDrafts={handleClearDrafts}
                  onSavePixels={handleSavePixels}
                  onToggleZoneMode={handleToggleZoneMode}
                />
              )}
              {activeTab === 'trade' && (
                <TokenPanel
                  account={account}
                  tokenBalance={tokenBalance}
                  publicSupplyTokens={publicSupplyTokens}
                  readContract={readContract}
                  onBuy={handleBuyTokens}
                  onSell={handleSellTokens}
                  txStatus={txStatus}
                />
              )}
              {activeTab === 'my-pixels' && (
                <OwnedPixels
                account={account}
                signer={signer}
                supabase={supabase}
                onSelectPixel={setSelectedPixel}
                selectedPixel={selectedPixel}
                />
              )}
              {activeTab === 'airdrop' && (
                <AirdropClaim
                  account={account}
                  readContract={readContract}
                  totalFrozen={Number(totalFrozen)}
                  txStatus={txStatus}
                  onClaim={handleClaimAirdrop}
                />
              )}
            </div>
          </div>
        </div>
      </div>
     

      {/* ── Notification toast ───────────────────────────────────────────── */}
      {notification && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          padding: '12px 22px',
          background: notifBg(notification.type),
          border: `1px solid ${notifBorder(notification.type)}`,
          borderRadius: 12, color: 'var(--text-primary)', zIndex: 1000,
          boxShadow: `0 4px 20px var(--shadow-default)`, backdropFilter: 'blur(8px)',
        }}>
          {notification.msg}
        </div>
      )}
    {/* ── Avertissement connexion Google ───────────────────────────────── */}
{showGoogleWarning && (
  <div style={{
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000,
  }}>
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border-primary)',
      borderRadius: 12, padding: 24, maxWidth: 400, textAlign: 'center',
    }}>
      <h3 style={{ margin: '0 0 8px', color: 'var(--text-primary)' }}>Connected with Google</h3>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12, textAlign: 'left' }}>
        By connecting with Google, a <strong>crypto wallet</strong> is automatically created for you.
      </p>
      <ul style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'left', paddingLeft: 18, marginBottom: 16 }}>
        <li>This wallet has a real address and holds real tokens/POL.</li>
        <li>You will need to fund this wallet with POL (via card, Apple Pay or Google Pay) to interact with the canvas.</li>
        <li>Your key is managed securely by our provider (Privy) — we do not have direct access to it.</li>
        <li>Using the same Google account will allow you to retrieve the same wallet and your history.</li>
      </ul>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
        <button
          onClick={() => setShowGoogleWarning(false)}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border-default)', background: 'var(--bg-surface-2)', color: 'var(--text-primary)', cursor: 'pointer' }}
        >
          Cancel
        </button>
        <button
          onClick={() => { setShowGoogleWarning(false); login(); }}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-primary)', background: 'var(--color-primary-dim)', color: 'var(--color-primary)', cursor: 'pointer', fontWeight: 600 }}
        >
          I understand, continue
        </button>
      </div>
    </div>
  </div>
)}

{/* ── Avertissement paiement carte / Apple Pay / Google Pay ────────── */}
{pendingFunding && (
  <div style={{
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000,
  }}>
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border-primary)',
      borderRadius: 12, padding: 24, maxWidth: 400, textAlign: 'center',
    }}>
      <CreditCard size={28} style={{ marginBottom: 8 }} color="var(--color-primary)" />
      <h3 style={{ margin: '0 0 8px', color: 'var(--text-primary)' }}>Purchase of {pendingFunding.amount} POL</h3>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12, textAlign: 'left' }}>
        You will be redirected to our payment provider (card, Apple Pay or Google Pay).
      </p>
      <ul style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'left', paddingLeft: 18, marginBottom: 16 }}>
        <li><strong>fees apply</strong> (usually between 1% and 4.5% depending on the payment method), displayed before confirmation.</li>
        <li>The receipt of POL <strong>is not instant</strong> — from a few seconds to several minutes, sometimes more depending on the payment method chosen.</li>
        <li>Your PAINT purchase will start automatically upon receipt of funds.</li>
      </ul>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
        <button
          onClick={() => { pendingFunding.resolve(false); setPendingFunding(null); }}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border-default)', background: 'var(--bg-surface-2)', color: 'var(--text-primary)', cursor: 'pointer' }}
        >
          Cancel
        </button>
        <button
          onClick={() => { pendingFunding.resolve(true); setPendingFunding(null); }}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-primary)', background: 'var(--color-primary-dim)', color: 'var(--color-primary)', cursor: 'pointer', fontWeight: 600 }}
        >
          Continue
        </button>
      </div>
    </div>
  </div>
)}

      {pendingSell && (
  <div style={{
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000,
  }}>
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border-primary)',
      borderRadius: 12, padding: 24, maxWidth: 380, textAlign: 'center',
    }}>
      <AlertTriangle size={28} style={{ marginBottom: 8 }} color="var(--color-red)" />
      <h3 style={{ margin: '0 0 8px', color: 'var(--text-primary)' }}>Pixels locked in game</h3>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
        This sell will decrease your balance below your number of painted pixels.{' '}
        <strong>{pendingSell.lockedToSacrifice} pixel(s) locked</strong> will be removed from the canvas,
        due to insufficient non-locked pixels. Continue anyway?
      </p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
        <button
          onClick={() => { isSellingRef.current = false; setPendingSell(null); }}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border-default)', background: 'var(--bg-surface-2)', color: 'var(--text-primary)', cursor: 'pointer' }}
        >
          Cancel
        </button>
        <button
          onClick={async () => {
            const amt = pendingSell.amount;
            setPendingSell(null);
            await executeSell(amt);
          }}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-red)', background: 'var(--color-red-dim)', color: 'var(--color-red)', cursor: 'pointer', fontWeight: 600 }}
        >
          Sell anyway
        </button>
      </div>
    </div>
  </div>
)}

{pendingPaint && (
  <div style={{
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000,
  }}>
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border-primary)',
      borderRadius: 12, padding: 24, maxWidth: 380, textAlign: 'center',
    }}>
      <AlertTriangle size={28} style={{ marginBottom: 8 }} color="var(--color-red)" />
      <h3 style={{ margin: '0 0 8px', color: 'var(--text-primary)' }}>Pixels locked in game</h3>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
        Painting these pixels will exceed your PAINT balance.{' '}
        <strong>{pendingPaint.lockedToSacrifice} pixel(s) locked</strong> will be removed from the canvas,
        due to insufficient non-locked pixels. Continue anyway?
      </p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
        <button
          onClick={() => setPendingPaint(null)}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border-default)', background: 'var(--bg-surface-2)', color: 'var(--text-primary)', cursor: 'pointer' }}
        >
          Cancel
        </button>
        <button
          onClick={async () => {
            const exec = pendingPaint.execute;
            setPendingPaint(null);
            await exec();
          }}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-red)', background: 'var(--color-red-dim)', color: 'var(--color-red)', cursor: 'pointer', fontWeight: 600 }}
        >
          Paint anyway
        </button>
      </div>
    </div>
  </div>
)}

{/* ── Edit profile modal ───────────────────────────────────────────── */}
      {showEditProfile && (
  <EditProfileModal
    account={account}
    signer={signer}
    onClose={handleCloseEditProfile}
    onSaved={handleProfileSaved}
  />
)}

      {/* ── Tutorial ──────────────────────────────────────────────────────── */}
      {showTutorial && (
        <Tutorial onClose={() => setShowTutorial(false)} />
      )}
    </div>
  );
}