import React, { useState, useEffect } from 'react';
import { SupabaseClient } from '@supabase/supabase-js';

interface StatsBarProps {
  totalSupply: string | number | null;
  totalFrozen: string | number | null;
  account: string | null;
  supabase: SupabaseClient | null;
  showFrozenOverlay: boolean;
  onToggleFrozenOverlay: () => void;
}

export default function StatsBar({ totalSupply, totalFrozen, supabase, showFrozenOverlay, onToggleFrozenOverlay }: StatsBarProps) {
  const [paintedCount, setPaintedCount] = useState<number | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    const fetchCount = async () => {
      try {
        const { count, error } = await supabase
          .from('offchain_canvas')
          .select('*', { count: 'exact', head: true });
        if (cancelled) return;
        if (error) {
          console.error('Supabase Error (fetchCount):', error.message);
          setPaintedCount(prev => prev !== null ? prev : 0);
          return;
        }
        setPaintedCount(count ?? 0);
      } catch (err) {
        if (!cancelled) {
          console.error('Network Exception (fetchCount):', err);
          setPaintedCount(prev => prev !== null ? prev : 0);
        }
      }
    };

    fetchCount();

    const channel = supabase
      .channel('public:offchain_canvas:stats')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'offchain_canvas' }, () => {
        fetchCount();
      })
      .subscribe((status, err) => {
        if (err) console.error('Erreur de souscription Realtime :', err);
      });

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [supabase]);

  const formatSupply = (val: string | number | null | undefined): string => {
    if (val === undefined || val === null) return '0';
    try { return parseFloat(val.toString()).toFixed(0); }
    catch { return '0'; }
  };

  const stats = [
    { label: 'Total PAINT Supply', value: formatSupply(totalSupply), color: 'var(--color-primary)', icon: '◈' },
    { label: 'Painted Pixels',     value: paintedCount === null ? '...' : paintedCount, color: '#ec4899', icon: '🎨' },
    { label: 'Frozen Pixels',      value: totalFrozen || '0', color: 'var(--color-purple)', icon: '❄' },
  ];

  return (
    <div style={{
      display: 'flex', gap: 0,
      background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--border-primary)',
      height: 50, width: '100%', flexShrink: 0,
    }}>
      {stats.map((s, i) => (
        <div key={i} style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 10, padding: '0 20px',
          borderRight: i < stats.length - 1 ? '1px solid var(--border-default)' : 'none',
        }}>
          <span style={{ fontSize: 14, color: s.color }}>{s.icon}</span>
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
                }}
              >
                {showFrozenOverlay ? '❄️ ON' : '❄️ OFF'}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}