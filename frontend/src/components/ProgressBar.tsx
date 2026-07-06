// ── ProgressBar.tsx ──────────────────────────────────────────────────────────
import React from 'react';

const TOTAL_PIXELS = 1_000_000_000;
const UNLOCK_THRESHOLD = 10_000_000;
// On donne artificiellement plus de place visuelle à la phase 1 (0→10M)
// pour qu'elle reste lisible, puis on compresse la phase 2 (10M→1B).
const PHASE1_VISUAL_WIDTH = 30; // % de la barre dédiés à la phase 1
const PHASE2_VISUAL_WIDTH = 70; // % dédiés à la phase 2

interface ProgressBarProps {
  totalFrozen: number;
  airdropUnlocked: boolean;
}

function ProgressBar({ totalFrozen, airdropUnlocked }: ProgressBarProps) {
  const phase1Progress = Math.min(totalFrozen / UNLOCK_THRESHOLD, 1) * PHASE1_VISUAL_WIDTH;
  const phase2Progress = totalFrozen > UNLOCK_THRESHOLD
    ? Math.min((totalFrozen - UNLOCK_THRESHOLD) / (TOTAL_PIXELS - UNLOCK_THRESHOLD), 1) * PHASE2_VISUAL_WIDTH
    : 0;
  const fillWidth = phase1Progress + phase2Progress;

  return (
    <div style={{ width: '100%' }}>
      <div style={{
        position: 'relative', height: 10, borderRadius: 6,
        background: 'var(--bg-surface-2)', overflow: 'hidden',
        border: '1px solid var(--border-default)',
      }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${fillWidth}%`,
          background: airdropUnlocked
            ? 'linear-gradient(90deg, var(--color-green), var(--color-primary))'
            : 'linear-gradient(90deg, var(--color-primary), var(--color-purple))',
          transition: 'width 0.4s ease',
        }} />
        {/* Marqueur du seuil airdrop, toujours à la frontière visuelle des 2 phases */}
        <div style={{
          position: 'absolute', left: `${PHASE1_VISUAL_WIDTH}%`, top: -2, bottom: -2,
          width: 2, background: 'var(--text-primary)', opacity: 0.6,
        }} title={`Airdrop unlock: ${UNLOCK_THRESHOLD.toLocaleString()} pixels`} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>
          {totalFrozen.toLocaleString()} / {TOTAL_PIXELS.toLocaleString()} frozen
        </span>
        <span style={{ fontSize: 10, color: airdropUnlocked ? 'var(--color-green)' : 'var(--text-faint)' }}>
          {airdropUnlocked ? '✅ Airdrop unlocked' : `🔒 Unlocks at ${UNLOCK_THRESHOLD.toLocaleString()}`}
        </span>
      </div>
    </div>
  );
}
export default React.memo(ProgressBar);