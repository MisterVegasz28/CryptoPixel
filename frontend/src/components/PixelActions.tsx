import React, { useState, useEffect, useRef } from 'react';
import { PRESET_COLORS } from '../components/palette';
import { Camera, Send, Gamepad2, Trash2, Palette, Snowflake, Square, X, Gift } from 'lucide-react';
import { CANVAS_W, CANVAS_H, INDEXER_URL } from '../App';
import FreezeConfirmPanel from './FreezeConfirmPanel';
import { shortAddr } from '../lib/format';

type SocialKey = 'twitter' | 'instagram' | 'telegram' | 'discord';

const SOCIAL_ICONS: Record<SocialKey, React.ReactNode> = {
  twitter: <span style={{ fontWeight: 700 }}>𝕏</span>,
  instagram: <Camera size={12} />,
  telegram: <Send size={12} />,
  discord: <Gamepad2 size={12} />,
};
const SOCIAL_LABELS: Record<SocialKey, string> = { twitter: 'Twitter / X', instagram: 'Instagram', telegram: 'Telegram', discord: 'Discord' };

interface OwnerProfile {
  pseudo?: string;
  message?: string;
  twitter?: string;
  instagram?: string;
  telegram?: string;
  discord?: string;
}

interface PixelInfo { frozen: boolean; owner: string | null; }
interface SelectedPixel { x: number; y: number; }
interface RemoteStatus { frozen: boolean; owner: string | null; }

// ── Popover profil ────────────────────────────────────────────────────────────
function OwnerPopover({ profile }: { profile: OwnerProfile }) {
  const socials = (['twitter', 'instagram', 'telegram', 'discord'] as SocialKey[]).filter(k => profile[k]);
  if (!profile.message && socials.length === 0) return null;

  return (
    <div style={{
      position: 'absolute', left: 0, top: '100%', marginTop: 6,
      width: 220, zIndex: 200,
      background: 'var(--bg-surface)',
      border: '1px solid var(--color-purple-border)',
      borderRadius: 12, padding: '12px 14px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
      pointerEvents: 'none',
    }}>
      {profile.message && (
        <p style={{ color: 'var(--text-secondary)', fontSize: 11, lineHeight: 1.5, margin: '0 0 8px 0' }}>
          {profile.message}
        </p>
      )}
      {socials.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {socials.map(key => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
              <span>{SOCIAL_ICONS[key]}</span>
              <span style={{ color: 'var(--text-muted)' }}>{SOCIAL_LABELS[key]}:</span>
              <span style={{ color: 'var(--color-primary)', fontFamily: "'Space Mono', monospace" }}>{profile[key]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface PixelActionsProps {
  selectedPixel: SelectedPixel | null;
  selectedColor: string;
  onColorChange: (color: string) => void;
  account: string | null;
  onFreeze: (x: number, y: number) => void;
  txStatus: string | null;
  pixelInfo: PixelInfo | null; // null = pas encore connu localement (canvasData absent ou pixel hors de la slice chargée)
  tokenBalance: string;
  onToggleZoneMode: () => void;
  zoneMode: boolean;
  draftsCount: number;
  onClearDrafts: () => void;
  onSavePixels: () => void;
  hasClaimedAirdrop: boolean;
}

function PixelActions({
  selectedPixel, selectedColor, onColorChange, account,
  onFreeze, txStatus, pixelInfo, tokenBalance, onToggleZoneMode, zoneMode,
  draftsCount, onClearDrafts, onSavePixels, hasClaimedAirdrop,
}: PixelActionsProps) {
  const [remoteStatus, setRemoteStatus] = useState<RemoteStatus | null>(null);
  const [ownerProfile, setOwnerProfile] = useState<OwnerProfile | null>(null);
  const [showOwnerPopover, setShowOwnerPopover] = useState(false);
  const [confirmingFreeze, setConfirmingFreeze] = useState(false);
  // Cache session : un freeze étant permanent (aucune fonction unfreeze
  // côté contrat), une fois l'owner d'un pixel tiers résolu via l'indexer,
  // pas besoin de le revérifier à chaque rechargement de slice pendant un
  // pan/zoom — canvasData, lui, "oublie" les adresses tierces à chaque
  // reload car le binaire ne transporte que ton propre flag isOwner.
  const resolvedCacheRef = useRef<Map<string, RemoteStatus>>(new Map());
  const isBusy = txStatus === 'pending' || txStatus === 'mining';
  const px = selectedPixel?.x ?? null;
  const py = selectedPixel?.y ?? null;
  const isValidCoord = px !== null && py !== null && px >= 0 && px < CANVAS_W && py >= 0 && py < CANVAS_H;

  useEffect(() => { setConfirmingFreeze(false); }, [px, py]);

  // Interroge l'indexer dans deux cas seulement :
  // 1) pixelInfo === null → le pixel sélectionné est hors de la fenêtre
  //    canvasData actuellement chargée (ex: saut via "Go to…" ou leaderboard,
  //    avant que la nouvelle slice n'arrive) → statut totalement inconnu.
  // 2) pixelInfo.frozen === true mais owner === null → gelé par un tiers
  //    dont l'adresse n'a jamais transité localement (cas déjà couvert avant).
  // Dans tous les autres cas (connu localement, non gelé OU gelé avec owner
  // connu), canvasData fait foi — plus frais qu'un poll indexer — et on ne
  // requête rien.
  useEffect(() => {
    setRemoteStatus(null);
    if (!isValidCoord) return;
    const pixelId = `${px}-${py}`;

    // pixelInfo (canvasData) est la source la plus fraîche quand elle a une
    // réponse complète — on s'en sert directement et on alimente le cache
    // au passage, pour que le prochain reload de slice n'ait plus à refetch.
    if (pixelInfo?.frozen && pixelInfo.owner) {
      resolvedCacheRef.current.set(pixelId, { frozen: true, owner: pixelInfo.owner });
      return;
    }
    // Un pixel signalé "non gelé" par canvasData n'est PAS mis en cache :
    // il peut légitimement être gelé par quelqu'un d'autre entre deux
    // sélections, donc il doit rester re-vérifiable à chaque fois.
    if (pixelInfo && !pixelInfo.frozen) return;

    // pixelInfo === null (hors slice chargée) OU frozen sans owner connu
    // (tiers jamais croisé cette session) : on regarde d'abord le cache
    // avant de retaper l'indexer.
    const cached = resolvedCacheRef.current.get(pixelId);
    if (cached) { setRemoteStatus(cached); return; }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${INDEXER_URL}/graphql`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `query($id: String!) { pixel(id: $id) { owner } }`,
            variables: { id: pixelId },
          }),
        });
        const { data } = await res.json();
        if (cancelled) return;
        const resolved: RemoteStatus = data?.pixel
          ? { frozen: true, owner: data.pixel.owner ?? null }
          : { frozen: false, owner: null };
        if (resolved.frozen) resolvedCacheRef.current.set(pixelId, resolved); // seul "frozen" est définitif
        setRemoteStatus(resolved);
      } catch (e) { console.error('Error fetching pixel status', e); }
    })();
    return () => { cancelled = true; };
  }, [pixelInfo, isValidCoord, px, py]);

  const isFrozen = pixelInfo !== null ? pixelInfo.frozen : !!remoteStatus?.frozen;
  const ownerAddr = pixelInfo !== null
    ? (pixelInfo.owner ?? remoteStatus?.owner ?? null)
    : (remoteStatus?.owner ?? null);
  const isOwner = isFrozen && account && ownerAddr && ownerAddr.toLowerCase() === account.toLowerCase();
  // "En cours de vérification" tant qu'on n'a ni donnée locale fiable, ni
  // réponse indexer — couvre la fenêtre du hic (slice pas encore chargée)
  // ET le cas historique (owner d'un pixel gelé pas encore connu).
  const loadingDetail = isValidCoord
    && (pixelInfo === null || (pixelInfo.frozen && !pixelInfo.owner))
    && remoteStatus === null;
  const hasTokens = parseFloat(tokenBalance) >= 1;

  useEffect(() => {
    if (!isFrozen || !ownerAddr) { setOwnerProfile(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(`${INDEXER_URL}/burners/${ownerAddr.toLowerCase()}`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.status === 404) { if (!cancelled) setOwnerProfile(null); return; }
        if (!res.ok) throw new Error('Failed to load owner profile');
        if (!cancelled) setOwnerProfile(await res.json());
      } catch (e) {
        console.error('Error loading owner profile', e);
        if (!cancelled) setOwnerProfile(null);
      }
    })();
    return () => { cancelled = true; };
  }, [isFrozen, ownerAddr]);

  const hasProfileContent = ownerProfile && (
    ownerProfile.message || ownerProfile.twitter || ownerProfile.instagram ||
    ownerProfile.telegram || ownerProfile.discord
  );

  const paletteButtons = React.useMemo(() => {
    return PRESET_COLORS.map(c => {
      const isSelected = selectedColor.toLowerCase() === c.toLowerCase();
      return (
        <button
          key={c}
          onClick={() => onColorChange(c)}
          aria-label={`Couleur ${c}`}
          style={{
            width: '100%', aspectRatio: '1', background: c,
            border: isSelected ? '2px solid var(--text-primary)' : '1px solid rgba(0,0,0,0.5)',
            borderRadius: 4, cursor: 'pointer',
            transform: isSelected ? 'scale(1.1)' : 'none',
            transition: 'all 0.1s',
          }}
        />
      );
    });
  }, [selectedColor, onColorChange]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Palette ─────────────────────────────────────────────────────── */}
      <div>
        <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
          SELECT COLOR
        </label>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
          Used when you paint (free, in the canvas panel) or freeze (permanent, on-chain) a pixel.
        </div>
      </div>

      {/* ── Panier peinture ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, width: '100%', marginBottom: 12 }}>
        <button
          onClick={onClearDrafts}
          title="Clear cart"
          style={{
            padding: '9px 12px',
            background: 'var(--bg-surface)',
            color: 'var(--color-red)',
            border: '1px solid rgba(239,68,68,0.4)',
            borderRadius: 8, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Trash2 size={16} />
        </button>
        <button
          onClick={onSavePixels}
          style={{
            flex: 1, padding: '9px 24px',
            background: 'linear-gradient(135deg, var(--color-purple), #9333ea)',
            border: 'none', borderRadius: 8,
            color: '#fff',
            fontFamily: "'Space Mono', monospace",
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
            boxShadow: '0 4px 12px var(--color-purple-dim)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          <Palette size={16} /> Paint ({draftsCount})
        </button>
      </div>

      {/* ── Badge airdrop réussi ─────────────────────────────────────────── */}
      {hasClaimedAirdrop && (
        <div
          title="Has succeeded their airdrop"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
            padding: '4px 10px', borderRadius: 20, cursor: 'help',
            background: 'var(--color-green-dim)',
            border: '1px solid var(--color-green-border)',
            color: 'var(--color-green)',
            fontSize: 11, fontWeight: 700,
          }}
        >
          <Gift size={12} /> Airdrop claimed
        </div>
      )}

      {/* ── Statut pixel ─────────────────────────────────────────────────── */}
      {isValidCoord && (
        <div style={{
          position: 'relative',
          padding: 10, borderRadius: 8, fontSize: 12,
          background: isFrozen ? 'var(--color-purple-dim)' : 'var(--bg-hover)',
          border: `1px solid ${isFrozen ? 'var(--color-purple-border)' : 'var(--border-default)'}`,
        }}>
          {loadingDetail ? (
            <span style={{ color: 'var(--text-muted)' }}>Checking pixel status...</span>
          ) : isFrozen ? (
            <span
              style={{ color: 'var(--color-purple)', cursor: hasProfileContent ? 'help' : 'default', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              onMouseEnter={() => hasProfileContent && setShowOwnerPopover(true)}
              onMouseLeave={() => setShowOwnerPopover(false)}
            >
              <Snowflake size={13} /> Frozen {isOwner ? '(you own this)' : (
                <>
                  by{' '}
                  {ownerProfile?.pseudo
                    ? <span style={{ color: 'var(--color-purple)', fontWeight: 700 }}>{ownerProfile.pseudo}</span>
                    : shortAddr(ownerAddr!)
                  }
                </>
              )}
              {!isOwner && hasProfileContent && showOwnerPopover && ownerProfile && (
                <OwnerPopover profile={ownerProfile} />
              )}
            </span>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>
              This pixel is not frozen yet — paint it freely or freeze it to make it permanent.
            </span>
          )}
        </div>
      )}

      {/* ── Palette (toujours visible pour choisir sa couleur avant de peindre) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 6 }}>
        {paletteButtons}
      </div>

      {/* ── Actions Freeze ───────────────────────────────────────────────── */}
      {!isFrozen && isValidCoord && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

          {confirmingFreeze ? (
            <FreezeConfirmPanel
              title="FREEZE PIXEL"
              pixelCount={1}
              cost={1}
              inline
              onCancel={() => setConfirmingFreeze(false)}
              onConfirm={() => { setConfirmingFreeze(false); onFreeze(px as number, py as number); }}
            />
          ) : (
            <button
              onClick={() => setConfirmingFreeze(true)}
              disabled={!account || isBusy || !isValidCoord || loadingDetail || !hasTokens}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                padding: '10px 4px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                background: 'var(--color-purple-dim)',
                border: '1px solid var(--color-purple-border)',
                color: 'var(--color-purple)',
                opacity: (!account || isBusy || !isValidCoord || loadingDetail || !hasTokens) ? 0.5 : 1,
              }}
            >
              <Snowflake size={18} /><span>FREEZE PIXEL</span>
            </button>
          )}

          <button
            onClick={onToggleZoneMode}
            disabled={!account || isBusy}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
              padding: '10px 4px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
              background: zoneMode ? 'var(--color-primary-dim)' : 'var(--color-primary-dim)',
              border: zoneMode ? '1px solid var(--color-primary)' : '1px solid var(--color-primary-border)',
              color: 'var(--color-primary)',
              opacity: (!account || isBusy) ? 0.5 : 1,
            }}
          >
            {zoneMode ? <X size={18} /> : <Square size={18} />}
            <span>{zoneMode ? 'CANCEL ZONE' : 'FREEZE ZONE'}</span>
          </button>

          {!hasTokens && account && (
            <div style={{ fontSize: 10, color: 'var(--color-red)', textAlign: 'center' }}>
              Need 1+ PAINT token(s) to freeze
            </div>
          )}
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.4 }}>
            Freezing burns PAINT and requires POL gas. Permanent on-chain ownership.
          </div>
        </div>
      )}
    </div>
  );
}
export default React.memo(PixelActions);