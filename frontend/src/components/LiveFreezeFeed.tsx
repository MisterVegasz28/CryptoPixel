import React, { useEffect, useState, useRef } from 'react';
import { Snowflake } from 'lucide-react';
import { shortAddr } from '../lib/format';

const MAX_VISIBLE = 10; // plafond d'affichage simultané, quelle que soit la taille du batch reçu
const LIFETIME_MS = 6000;

interface FreezeEvent {
  id: string;
  x: number;
  y: number;
  owner: string;
  color: string;
}

interface IncomingFreezeEvent { x: number; y: number; owner: string; color: string; }
interface IncomingFreezeBatch { batchId: number; events: IncomingFreezeEvent[]; }

function LiveFreezeFeed({ freezeBatch }: { freezeBatch: IncomingFreezeBatch | null }) {
  const [events, setEvents] = useState<FreezeEvent[]>([]);
  const idCounter = useRef(0);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const lastBatchIdRef = useRef(0);

  useEffect(() => {
    if (!freezeBatch || freezeBatch.batchId === lastBatchIdRef.current) return;
    lastBatchIdRef.current = freezeBatch.batchId;

    // Chaque event du batch devient une entrée distincte de la feed —
    // toutes ajoutées en un seul setEvents (donc un seul re-render), mais
    // chacune garde sa propre durée de vie / son propre timer d'expiration,
    // exactement comme avant quand on traitait un event à la fois.
    const newEntries: FreezeEvent[] = freezeBatch.events.map(e => {
      idCounter.current++;
      return { id: `${idCounter.current}`, x: e.x, y: e.y, owner: e.owner, color: e.color };
    });

    setEvents(prev => [...newEntries, ...prev].slice(0, MAX_VISIBLE));

    newEntries.forEach(entry => {
      const t = setTimeout(() => {
        setEvents(prev => prev.filter(e => e.id !== entry.id));
        timers.current.delete(t);
      }, LIFETIME_MS);
      timers.current.add(t);
    });
  }, [freezeBatch]);

  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear(); }, []);

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
          <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            froze ({e.x}, {e.y}) <Snowflake size={12} color="#7dd3fc" />
          </span>
        </div>
      ))}
    </div>
  );
}
export default React.memo(LiveFreezeFeed);