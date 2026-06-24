import React, { useState, useEffect, useCallback } from 'react';
import { SupabaseClient } from '@supabase/supabase-js';

interface PixelItem {
  id: string;
  x: number;
  y: number;
  color: string;
  isFrozen: boolean;
}

interface SelectedPixel {
  x: number;
  y: number;
}

interface OwnedPixelsProps {
  account: string | null;
  supabase: SupabaseClient;
  onSelectPixel: (pixel: SelectedPixel) => void;
  selectedPixel: SelectedPixel | null;
}

export default function OwnedPixels({ account, supabase, onSelectPixel, selectedPixel }: OwnedPixelsProps) {
  const [pixels, setPixels]   = useState<PixelItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch]   = useState('');
  const [page, setPage]       = useState(0);
  const PAGE_SIZE = 20;

  const fetchOwnedPixels = useCallback(async () => {
    if (!account || !supabase) return;
    setLoading(true);
    try {
      const { data: ownedRows, error } = await supabase
        .from('offchain_canvas')
        .select('id, x, y, color')
        .eq('painter', account.toLowerCase())
        .order('updated_at', { ascending: false });
      if (error) throw error;

      const { data: frozenRows, error: frozenError } = await supabase
        .from('pixel')
        .select('id, x, y, color')
        .eq('owner', account.toLowerCase());
      if (frozenError) throw frozenError;

      const frozenSet = new Set((frozenRows || []).map((p: { id?: string; x: number; y: number }) =>
        p.id ?? `${p.x}-${p.y}`
      ));

      const frozenPixels: PixelItem[] = (frozenRows || []).map((p: { id?: string; x: number; y: number; color: string }) => ({
        id: p.id ?? `${p.x}-${p.y}`,
        x: p.x, y: p.y, color: p.color,
        isFrozen: true,
      }));

      const paintedPixels: PixelItem[] = (ownedRows || [])
        .filter((p: { id: string }) => !frozenSet.has(p.id))
        .map((p: { id: string; x: number; y: number; color: string }) => ({ ...p, isFrozen: false }));

      setPixels([...frozenPixels, ...paintedPixels]);
    } catch (e) {
      console.error('Error fetching owned pixels', e);
      setPixels([]);
    } finally {
      setLoading(false);
    }
  }, [account, supabase]);

  useEffect(() => {
    fetchOwnedPixels();
  }, [fetchOwnedPixels]);

  const filtered = pixels.filter(p => {
    if (!search) return true;
    return `${p.x},${p.y}`.includes(search) || p.id.includes(search);
  });

  const paginated  = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      <div style={{
        padding: '10px 14px',
        background: 'linear-gradient(135deg, rgba(0,212,255,0.06), rgba(168,85,247,0.06))',
        border: '1px solid rgba(0,212,255,0.12)',
        borderRadius: 10,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 2 }}>My Pixel Tiles</div>
        <div style={{ fontSize: 11, color: '#9ca3af' }}>
          {loading ? 'Loading...' : `You own ${pixels.length} pixel${pixels.length !== 1 ? 's' : ''}`}
        </div>
      </div>

      <input
        type="text"
        placeholder="Filter by X,Y or id..."
        value={search}
        onChange={e => { setSearch(e.target.value); setPage(0); }}
        style={{
          width: '100%', background: '#12121a',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 8, padding: '8px 12px',
          color: '#fff', fontSize: 12, outline: 'none',
        }}
      />

      {loading ? (
        <div style={{ textAlign: 'center', color: '#4b5563', fontSize: 12, padding: '20px 0' }}>
          Loading your pixels...
        </div>
      ) : (
        <>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 8, maxHeight: 260, overflowY: 'auto', paddingRight: 4,
          }}>
            {paginated.map(p => {
              const isSelected = selectedPixel?.x === p.x && selectedPixel?.y === p.y;
              return (
                <button
                  key={p.id}
                  onClick={() => onSelectPixel({ x: p.x, y: p.y })}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4,
                    padding: '8px 10px',
                    background: isSelected ? 'rgba(0,212,255,0.12)' : '#12121a',
                    border: isSelected ? '1px solid #00d4ff' : '1px solid rgba(255,255,255,0.05)',
                    borderRadius: 8, cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{
                        width: 10, height: 10, borderRadius: 2, flexShrink: 0,
                        background: p.color || '#333',
                        border: '1px solid rgba(255,255,255,0.1)',
                      }} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: isSelected ? '#00d4ff' : '#fff' }}>
                        ({p.x}, {p.y})
                      </span>
                    </div>
                    {p.isFrozen ? (
                      <span style={{ fontSize: 9, color: '#c084fc', fontWeight: 700 }} title="Frozen on-chain — permanent">❄️</span>
                    ) : (
                      <span style={{ fontSize: 9, color: '#6b7280' }} title="Painted off-chain — repaint anytime">🎨</span>
                    )}
                  </div>
                  <span style={{ fontSize: 10, color: '#4b5563', fontFamily: "'Space Mono', monospace" }}>
                    {p.isFrozen ? 'Frozen' : 'Painted'}
                  </span>
                </button>
              );
            })}

            {!loading && filtered.length === 0 && (
              <div style={{ gridColumn: 'span 2', textAlign: 'center', color: '#4b5563', fontSize: 12, padding: '20px 0' }}>
                {pixels.length === 0 ? 'No pixels yet — paint one!' : 'No pixels match your search.'}
              </div>
            )}
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4 }}>
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                style={{
                  background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.2)',
                  color: '#00d4ff', borderRadius: 6, padding: '4px 10px',
                  cursor: 'pointer', fontSize: 12, opacity: page === 0 ? 0.4 : 1,
                }}
              >←</button>
              <span style={{ fontSize: 11, color: '#6b7280', fontFamily: "'Space Mono', monospace" }}>
                {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                style={{
                  background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.2)',
                  color: '#00d4ff', borderRadius: 6, padding: '4px 10px',
                  cursor: 'pointer', fontSize: 12, opacity: page >= totalPages - 1 ? 0.4 : 1,
                }}
              >→</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}