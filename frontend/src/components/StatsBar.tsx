import React from 'react';
import { TrendingUp, Palette, Snowflake } from 'lucide-react';

interface StatsBarProps {
  totalSupply: string | number | null;
  totalFrozen: string | number | null;
  paintedCount: number | null;
  showFrozenOverlay: boolean;
  onToggleFrozenOverlay: () => void;
}

export default function StatsBar({ totalSupply, totalFrozen, paintedCount, showFrozenOverlay, onToggleFrozenOverlay }: StatsBarProps) {
  const formatSupply = (val: string | number | null | undefined): string => {
    if (val === undefined || val === null) return '0';
    try { return parseFloat(val.toString()).toFixed(0); }
    catch { return '0'; }
  };

  const stats = [
    { label: 'Total PAINT Supply', value: formatSupply(totalSupply), color: 'var(--color-primary)', icon: TrendingUp },
    {
      label: 'Painted Pixels',
      value: paintedCount === null ? '...' : paintedCount + (Number(totalFrozen) || 0),
      color: '#ec4899', icon: Palette
    },
    { label: 'Frozen Pixels', value: totalFrozen || '0', color: 'var(--color-purple)', icon: Snowflake },
  ];

  return (
    <div style={{
      display: 'flex', gap: 0,
      background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--border-primary)',
      height: 50, width: '100%', flexShrink: 0,
    }}>
      {stats.map((s, i) => (
        <div key={s.label} style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 10, padding: '0 20px',
          borderRight: i < stats.length - 1 ? '1px solid var(--border-default)' : 'none',
        }}>
          <span style={{ display: 'inline-flex', color: s.color }}><s.icon size={16} /></span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
            <div>
              <div style={{
                fontSize: 9, color: 'var(--text-muted)',
                textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em',
              }}>
                {s.label}
              </div>
              <div style={{
                fontSize: 13, fontWeight: 700,
                color: 'var(--text-primary)',
                fontFamily: "'Space Mono', monospace",
              }}>
                {s.value}
              </div>
            </div>
            {s.label === 'Frozen Pixels' && (
              <button
                onClick={onToggleFrozenOverlay}
                style={{
                  marginLeft: 'auto', padding: '3px 10px', fontSize: 10, fontWeight: 700,
                  fontFamily: "'Space Mono', monospace", cursor: 'pointer', borderRadius: 6,
                  border: showFrozenOverlay
                    ? '1px solid var(--color-purple-border)'
                    : '1px solid var(--border-default)',
                  background: showFrozenOverlay
                    ? 'var(--color-purple-dim)'
                    : 'var(--bg-hover)',
                  color: showFrozenOverlay ? 'var(--color-purple)' : 'var(--text-muted)',
                  transition: 'all 0.2s',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                <Snowflake size={11} /> {showFrozenOverlay ? 'ON' : 'OFF'}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}