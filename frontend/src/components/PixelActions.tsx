import React, { useState, useEffect } from 'react';
import { Contract } from 'ethers';
import { CANVAS_W, CANVAS_H, INDEXER_URL } from '../App';

const PRESET_COLORS = [
  '#ff0000', '#ff6600', '#ffcc00', '#00ff00',
  '#00ffff', '#0066ff', '#9900ff', '#ff00ff',
  '#ffffff', '#cccccc', '#888888', '#444444',
  '#00d4ff', '#a855f7', '#ec4899', '#f59e0b',
];

type SocialKey = 'twitter' | 'instagram' | 'telegram' | 'discord';

const SOCIAL_ICONS: Record<SocialKey, string>  = { twitter: '𝕏', instagram: '📷', telegram: '✈️', discord: '🎮' };
const SOCIAL_LABELS: Record<SocialKey, string> = { twitter: 'Twitter / X', instagram: 'Instagram', telegram: 'Telegram', discord: 'Discord' };

function shortAddr(a: string): string {
  if (!a) return '';
  return a.slice(0, 6) + '...' + a.slice(-4);
}

interface OwnerProfile {
  pseudo?: string;
  message?: string;
  twitter?: string;
  instagram?: string;
  telegram?: string;
  discord?: string;
}

interface FrozenInfo { owner: string | null; }
interface SelectedPixel { x: number; y: number; }

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
  onPaint: (x: number, y: number) => Promise<void>;
  txStatus: string | null;
  readContract: Contract | null;
  tokenBalance: string;
  onToggleZoneMode: () => void;
  zoneMode: boolean;
  draftsCount: number;
  onClearDrafts: () => void;
  onSavePixels: () => void;
  airdropUnlocked: boolean;
}

export default function PixelActions({
  selectedPixel, selectedColor, onColorChange, account,
  onFreeze, txStatus, readContract, tokenBalance, onToggleZoneMode, zoneMode,
  draftsCount, onClearDrafts, onSavePixels,
}: PixelActionsProps) {
  const [frozenInfo, setFrozenInfo]             = useState<FrozenInfo | null>(null);
  const [loadingDetail, setLoadingDetail]       = useState(false);
  const [ownerProfile, setOwnerProfile]         = useState<OwnerProfile | null>(null);
  const [showOwnerPopover, setShowOwnerPopover] = useState(false);

  const isBusy = txStatus === 'pending' || txStatus === 'mining';
  const px = selectedPixel?.x ?? null;
  const py = selectedPixel?.y ?? null;
  const isValidCoord = px !== null && py !== null && px >= 0 && px < CANVAS_W && py >= 0 && py < CANVAS_H;

  useEffect(() => {
    if (!readContract || !isValidCoord) { setFrozenInfo(null); return; }
    let active = true;
    (async () => {
      setLoadingDetail(true);
      try {
        const pixelId = (py as number) * CANVAS_W + (px as number);
        const [owner] = await readContract.getFrozenPixel(pixelId);
        if (active) setFrozenInfo({ owner: owner === '0x0000000000000000000000000000000000000000' ? null : owner });
      } catch (e) { console.error('Error reading frozen pixel', e); }
      finally { if (active) setLoadingDetail(false); }
    })();
    return () => { active = false; };
  }, [px, py, readContract, txStatus]);

  const isFrozen  = !!frozenInfo?.owner;
  const isOwner   = isFrozen && account && frozenInfo!.owner!.toLowerCase() === account.toLowerCase();
  const hasTokens = parseFloat(tokenBalance) >= 1;

  useEffect(() => {
    if (!isFrozen || !frozenInfo?.owner) { setOwnerProfile(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${INDEXER_URL}/burners/${frozenInfo.owner!.toLowerCase()}`);
        if (res.status === 404) { if (!cancelled) setOwnerProfile(null); return; }
        if (!res.ok) throw new Error('Failed to load owner profile');
        if (!cancelled) setOwnerProfile(await res.json());
      } catch (e) {
        console.error('Error loading owner profile', e);
        if (!cancelled) setOwnerProfile(null);
      }
    })();
    return () => { cancelled = true; };
  }, [isFrozen, frozenInfo?.owner]);

  const hasProfileContent = ownerProfile && (
    ownerProfile.message || ownerProfile.twitter || ownerProfile.instagram ||
    ownerProfile.telegram || ownerProfile.discord
  );

 return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Palette ─────────────────────────────────────────────────────── */}
      <div>
        <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
          SELECT COLOR
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 6 }}>
          {PRESET_COLORS.map(c => (
            <button
              key={c}
              onClick={() => onColorChange(c)}
              style={{
                width: '100%', aspectRatio: '1', background: c,
                border: selectedColor.toLowerCase() === c.toLowerCase()
                  ? '2px solid var(--text-primary)'
                  : '1px solid rgba(0,0,0,0.5)',
                borderRadius: 4, cursor: 'pointer',
                transform: selectedColor.toLowerCase() === c.toLowerCase() ? 'scale(1.1)' : 'none',
                transition: 'all 0.1s',
              }}
            />
          ))}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
          Used when you paint (free, in the canvas panel) or freeze (permanent, on-chain) a pixel.
        </div>
      </div>

      {/* ── Panier peinture ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, width: '100%', marginBottom: 12 }}>
        <button
          onClick={onClearDrafts}
          title="Vider le panier"
          style={{
            padding: '9px 12px',
            background: 'var(--bg-surface)',
            color: 'var(--color-red)',
            border: '1px solid rgba(239,68,68,0.4)',
            borderRadius: 8, cursor: 'pointer',
          }}
        >
          🗑️
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
          }}
        >
          🎨 Peindre ({draftsCount})
        </button>
      </div>

      {/* ── Statut pixel — déplacé sous le bouton Peindre pour ne plus le décaler ── */}
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
              style={{ color: 'var(--color-purple)', cursor: hasProfileContent ? 'help' : 'default' }}
              onMouseEnter={() => hasProfileContent && setShowOwnerPopover(true)}
              onMouseLeave={() => setShowOwnerPopover(false)}
            >
              ❄️ Frozen {isOwner ? '(you own this)' : (
                <>
                  by{' '}
                  {ownerProfile?.pseudo
                    ? <span style={{ color: 'var(--color-purple)', fontWeight: 700 }}>{ownerProfile.pseudo}</span>
                    : shortAddr(frozenInfo!.owner!)
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

      {/* ── Actions Freeze ───────────────────────────────────────────────── */}
      {!isFrozen && isValidCoord && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button
              onClick={() => onFreeze(px as number, py as number)}
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
              <span>❄️</span><span>FREEZE PIXEL</span>
            </button>

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
              <span>{zoneMode ? '✕' : '🔲'}</span>
              <span>{zoneMode ? 'ANNULER ZONE' : 'FREEZE ZONE'}</span>
            </button>
          </div>

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