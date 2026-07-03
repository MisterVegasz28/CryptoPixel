// ── LiveFreezeFeed.tsx ───────────────────────────────────────────────────────
import React, { useEffect, useState, useRef } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

interface FreezeEvent {
  id: string; // clé unique pour l'animation (x-y + timestamp)
  x: number;
  y: number;
  owner: string;
  color: string;
}

function shortAddr(a: string): string {
  return a.slice(0, 6) + '...' + a.slice(-4);
}

export default function LiveFreezeFeed({ supabase }: { supabase: SupabaseClient }) {
  const [events, setEvents] = useState<FreezeEvent[]>([]);
  const idCounter = useRef(0);

  useEffect(() => {
    const channel = supabase
      .channel('freeze-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pixel' }, (payload) => {
        const p = payload.new as { x: number; y: number; owner: string; color: string };
        idCounter.current++;
        const entry: FreezeEvent = { id: `${idCounter.current}`, x: p.x, y: p.y, owner: p.owner, color: p.color };
        setEvents(prev => [entry, ...prev].slice(0, 5)); // garde les 5 derniers max
        // auto-suppression après 6s
        setTimeout(() => {
          setEvents(prev => prev.filter(e => e.id !== entry.id));
        }, 6000);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase]);

  if (events.length === 0) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 24, left: 24, zIndex: 900,
      display: 'flex', flexDirection: 'column', gap: 6, pointerEvents: 'none',
    }}>
      {events.map(e => (
        <div key={e.id} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
          borderRadius: 20, padding: '6px 12px', fontSize: 11,
          animation: 'feedSlideIn 0.3s ease',
        }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: e.color }} />
          <span style={{ color: 'var(--text-primary)', fontFamily: "'Space Mono', monospace" }}>
            {shortAddr(e.owner)}
          </span>
          <span style={{ color: 'var(--text-muted)' }}>froze ({e.x}, {e.y}) ❄️</span>
        </div>
      ))}
    </div>
  );
}