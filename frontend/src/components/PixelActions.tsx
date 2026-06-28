import React, { useState, useEffect } from 'react';
import { Contract } from 'ethers';
import { CANVAS_W, CANVAS_H, INDEXER_URL } from '../App';

const PRESET_COLORS = [
  '#ff0000', '#ff6600', '#ffcc00', '#00ff00',
  '#00ffff', '#0066ff', '#9900ff', '#ff00ff',
  '#ffffff', '#cccccc', '#888888', '#444444',
  '#00d4ff', '#a855f7', '#ec4899', '#f59e0b'
];

type SocialKey = 'twitter' | 'instagram' | 'telegram' | 'discord';

const SOCIAL_ICONS: Record<SocialKey, string> = {
  twitter: '𝕏',
  instagram: '📷',
  telegram: '✈️',
  discord: '🎮',
};

const SOCIAL_LABELS: Record<SocialKey, string> = {
  twitter: 'Twitter / X',
  instagram: 'Instagram',
  telegram: 'Telegram',
  discord: 'Discord',
};

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

interface FrozenInfo {
  owner: string | null;
}

interface SelectedPixel {
  x: number;
  y: number;
}

// ── Popover profil du owner d'un pixel frozen ─────────────────────────────────
function OwnerPopover({ profile }: { profile: OwnerProfile }) {
  const socials = (['twitter', 'instagram', 'telegram', 'discord'] as SocialKey[]).filter(key => profile[key]);
  const hasContent = profile.message || socials.length > 0;
  if (!hasContent) return null;

  return (
    <div
      style={{
        position: 'absolute', left: 0, top: '100%', marginTop: 6,
        width: 220, zIndex: 200,
        background: '#0d0d14', border: '1px solid #a855f7',
        borderRadius: 12, padding: '12px 14px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        pointerEvents: 'none',
      }}
    >
      {profile.message && (
        <p style={{ color: '#d1d5db', fontSize: 11, lineHeight: 1.5, margin: '0 0 8px 0' }}>
          {profile.message}
        </p>
      )}
      {socials.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {socials.map(key => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
              <span>{SOCIAL_ICONS[key]}</span>
              <span style={{ color: '#6b7280' }}>{SOCIAL_LABELS[key]}:</span>
              <span style={{ color: '#00d4ff', fontFamily: "'Space Mono', monospace" }}>{profile[key]}</span>
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
  onFreeze, txStatus, readContract, tokenBalance, onToggleZoneMode, zoneMode, draftsCount,
  onClearDrafts,
  onSavePixels
}: PixelActionsProps) {
  const [frozenInfo, setFrozenInfo]         = useState<FrozenInfo | null>(null);
  const [loadingDetail, setLoadingDetail]   = useState(false);
  const [ownerProfile, setOwnerProfile]     = useState<OwnerProfile | null>(null);
  const [showOwnerPopover, setShowOwnerPopover] = useState(false);

  const isBusy = txStatus === 'pending' || txStatus === 'mining';

  const px = selectedPixel?.x ?? null;
  const py = selectedPixel?.y ?? null;

  const isValidCoord =
    px !== null && py !== null &&
    px >= 0 && px < CANVAS_W &&
    py >= 0 && py < CANVAS_H;

  useEffect(() => {
    if (!readContract || !isValidCoord) { setFrozenInfo(null); return; }
    let active = true;
    const load = async () => {
      setLoadingDetail(true);
      try {
        const pixelId = (py as number) * CANVAS_W + (px as number);
        const [owner] = await readContract.getFrozenPixel(pixelId);
        if (active) {
          setFrozenInfo({
            owner: owner === '0x0000000000000000000000000000000000000000' ? null : owner,
          });
        }
      } catch (e) { console.error('Error reading frozen pixel', e); }
      finally { if (active) setLoadingDetail(false); }
    };
    load();
    return () => { active = false; };
  }, [px, py, readContract, txStatus]);

  const isFrozen = !!frozenInfo?.owner;
  const isOwner  = isFrozen && account && frozenInfo!.owner!.toLowerCase() === account.toLowerCase();
  const hasTokens = parseFloat(tokenBalance) >= 1;

  useEffect(() => {
    if (!isFrozen || !frozenInfo?.owner) { setOwnerProfile(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${INDEXER_URL}/burners/${frozenInfo.owner!.toLowerCase()}`);
        if (res.status === 404) { if (!cancelled) setOwnerProfile(null); return; }
        if (!res.ok) throw new Error('Failed to load owner profile');
        const data: OwnerProfile = await res.json();
        if (!cancelled) setOwnerProfile(data);
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

      {/* Couleurs */}
      <div>
        <label style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, display: 'block', marginBottom: 6 }}>SELECT COLOR</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 6 }}>
          {PRESET_COLORS.map(c => (
            <button key={c} onClick={() => onColorChange(c)}
              style={{
                width: '100%', aspectRatio: '1', background: c,
                border: selectedColor.toLowerCase() === c.toLowerCase() ? '2px solid #fff' : '1px solid rgba(0,0,0,0.5)',
                borderRadius: 4, cursor: 'pointer',
                transform: selectedColor.toLowerCase() === c.toLowerCase() ? 'scale(1.1)' : 'none', transition: 'all 0.1s'
              }} />
          ))}
        </div>
        <div style={{ fontSize: 10, color: '#6b7280', marginTop: 6 }}>
          Used when you paint (free, in the canvas panel) or freeze (permanent, on-chain) a pixel.
        </div>
      </div>

      {/* Statut du pixel */}
      {isValidCoord && (
        <div
          style={{
            position: 'relative',
            padding: 10, borderRadius: 8, fontSize: 12,
            background: isFrozen ? 'rgba(168,85,247,0.06)' : 'rgba(255,255,255,0.02)',
            border: `1px solid ${isFrozen ? 'rgba(168,85,247,0.2)' : 'rgba(255,255,255,0.05)'}`,
          }}
        >
          {loadingDetail ? (
            <span style={{ color: '#6b7280' }}>Checking pixel status...</span>
          ) : isFrozen ? (
            <span
              style={{ color: '#c084fc', cursor: hasProfileContent ? 'help' : 'default' }}
              onMouseEnter={() => hasProfileContent && setShowOwnerPopover(true)}
              onMouseLeave={() => setShowOwnerPopover(false)}
            >
              ❄️ Frozen {isOwner
                ? '(you own this)'
                : (
                  <>
                    by{' '}
                    {ownerProfile?.pseudo ? (
                      <span style={{ color: '#a855f7', fontWeight: 700 }}>{ownerProfile.pseudo}</span>
                    ) : (
                      shortAddr(frozenInfo!.owner!)
                    )}
                  </>
                )
              }
              {!isOwner && hasProfileContent && showOwnerPopover && ownerProfile && (
                <OwnerPopover profile={ownerProfile} />
              )}
            </span>
          ) : (
            <span style={{ color: '#6b7280' }}>This pixel is not frozen yet — paint it freely or freeze it to make it permanent.</span>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, width: '100%', marginBottom: '12px' }}>
        <button
          onClick={onClearDrafts}
          style={{
            background: 'rgba(10, 10, 20, 0.85)',
            padding: '9px 12px',
            color: '#ef4444',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: 8,
            cursor: 'pointer'
          }}
          title="Vider le panier"
        >
          🗑️
        </button>
        <button
          onClick={onSavePixels}
          style={{
            flex: 1,
            padding: '9px 24px',
            background: 'linear-gradient(135deg, #a855f7, #9333ea)',
            border: 'none',
            borderRadius: 8,
            color: '#fff',
            fontFamily: "'Space Mono', monospace",
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(168, 85, 247, 0.4)'
          }}
        >
          🎨 Peindre ({draftsCount})
        </button>
      </div>

      {/* Panneau d'actions Freeze (On-chain) */}
      {!isFrozen && isValidCoord &&(
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button
              onClick={() => onFreeze(px as number, py as number)}
              disabled={!account || isBusy || !isValidCoord || loadingDetail || !hasTokens}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                padding: '10px 4px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.3)', color: '#c084fc',
                opacity: (!account || isBusy || !isValidCoord || loadingDetail || !hasTokens) ? 0.5 : 1
              }}
            >
              <span>❄️</span> <span>FREEZE PIXEL</span>
            </button>

            <button
              onClick={() => { onToggleZoneMode(); }}
              disabled={!account || isBusy}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                padding: '10px 4px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                background: zoneMode ? 'rgba(0, 212, 255, 0.2)' : 'rgba(0, 212, 255, 0.1)',
                border: zoneMode ? '1px solid #00d4ff' : '1px solid rgba(0, 212, 255, 0.3)', color: '#00d4ff',
                opacity: (!account || isBusy) ? 0.5 : 1
              }}
            >
              <span>{zoneMode ? '✕' : '🔲'}</span>
              <span>{zoneMode ? 'ANNULER ZONE' : 'FREEZE ZONE'}</span>
            </button>
          </div>

          {!hasTokens && account && (
            <div style={{ fontSize: 10, color: '#f87171', textAlign: 'center' }}>
              Need 1+ PAINT token(s) to freeze
            </div>
          )}
          <div style={{ fontSize: 10, color: '#6b7280', textAlign: 'center', lineHeight: 1.4 }}>
            Freezing burns PAINT and requires POL gas. Permanent on-chain ownership.
          </div>
        </div>
      )}
    </div>
  );
}