import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { SupabaseClient } from '@supabase/supabase-js';
import type { Signer } from 'ethers';
import { PRESET_COLORS } from './palette';
import { Snowflake, Palette, Lock, Unlock } from 'lucide-react';

interface PixelItem {
  id: string;
  x: number;
  y: number;
  color: string;
  isFrozen: boolean;
  isLocked: boolean;
}

interface SelectedPixel { x: number; y: number; }

interface OwnedPixelsProps {
  account: string | null;
  signer: Signer | null;
  supabase: SupabaseClient;
  onSelectPixel: (pixel: SelectedPixel) => void;
  selectedPixel: SelectedPixel | null;
}

function OwnedPixels({ account, signer, supabase, onSelectPixel, selectedPixel }: OwnedPixelsProps) {
  const [pixels, setPixels] = useState<PixelItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [exactTotal, setExactTotal] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [applyingLock, setApplyingLock] = useState(false);
  const PAGE_SIZE = 20;
  const [searchResults, setSearchResults] = useState<PixelItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const frozenPixels = useMemo(() => pixels.filter(p => p.isFrozen), [pixels]);


  const fetchOwnedPixels = useCallback(async () => {
    if (!account || !supabase) return;
    setLoading(true);
    try {
      const { data: ownedRows, error } = await supabase
        .from('offchain_canvas').select('id, x, y, color, is_locked')
        .eq('painter', account.toLowerCase())
        .order('updated_at', { ascending: false })
        .limit(500);   // ← nouveau : cap sur les pixels peints les plus récents
      if (error) throw error;

      const { data: frozenRows, error: frozenError } = await supabase
        .from('frozen_tiles').select('x, y, color')
        .eq('owner', account.toLowerCase());
      if (frozenError) throw frozenError;

      const frozenSet = new Set((frozenRows || []).map(
        (p: { x: number; y: number }) => `${p.x}-${p.y}`
      ));

      const frozenPixels: PixelItem[] = (frozenRows || []).map(
        (p: { x: number; y: number; color: string }) => ({
          id: `${p.x}-${p.y}`, x: p.x, y: p.y, color: p.color, isFrozen: true, isLocked: false,
        })
      );

      const paintedPixels: PixelItem[] = (ownedRows || [])
        .filter((p: { id: string }) => !frozenSet.has(p.id))
        .map((p: { id: string; x: number; y: number; color: number; is_locked: boolean }) => ({
          id: p.id, x: p.x, y: p.y, color: PRESET_COLORS[p.color] ?? PRESET_COLORS[0], isFrozen: false, isLocked: !!p.is_locked,
        }));

      setPixels([...paintedPixels, ...frozenPixels]);
    } catch (e) {
      console.error('Error fetching owned pixels', e);
      setPixels([]);
    } finally {
      setLoading(false);
    }
  }, [account, supabase]);

  useEffect(() => { fetchOwnedPixels(); }, [fetchOwnedPixels]);

  useEffect(() => {
    if (!account) { setExactTotal(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const { count: paintedCount, error: paintedError } = await supabase
          .from('offchain_canvas')
          .select('id', { count: 'exact', head: true })
          .eq('painter', account.toLowerCase());
        if (paintedError) throw paintedError;

        if (!cancelled) setExactTotal(frozenPixels.length + (paintedCount ?? 0));
      } catch (e) {
        console.error('Error fetching exact pixel count', e);
        if (!cancelled) setExactTotal(null);
      }
    })();
    return () => { cancelled = true; };
  }, [account, supabase, frozenPixels]);

  useEffect(() => {
    if (!search.trim() || !account) { setSearchResults(null); return; }
    const normalized = search.trim().replace(',', '-');
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const frozenSet = new Set(pixels.filter(p => p.isFrozen).map(p => p.id));
        const { data, error } = await supabase
          .from('offchain_canvas')
          .select('id, x, y, color, is_locked')
          .eq('painter', account.toLowerCase())
          .ilike('id', `%${normalized}%`)
          .order('updated_at', { ascending: false })
          .limit(100);
        if (error) throw error;
        const results: PixelItem[] = (data || [])
          .filter(r => !frozenSet.has(r.id))
          .map(r => ({ id: r.id, x: r.x, y: r.y, color: PRESET_COLORS[r.color] ?? PRESET_COLORS[0], isFrozen: false, isLocked: !!r.is_locked }));
        setSearchResults(results);
      } catch (e) {
        console.error('Search error', e);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [search, account, pixels]);

  const toggleSelectMode = () => {
    setSelectMode(v => !v);
    setSelectedIds(new Set());
  };

  const toggleSelectPixel = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const applyBatchLock = async (locked: boolean) => {
    if (!account || !signer || selectedIds.size === 0 || applyingLock) return;
    setApplyingLock(true);
    try {
      const pixelIds = [...selectedIds];
      const timestamp = Math.floor(Date.now() / 1000);
      const domain = { name: 'CryptoPixel', version: '1', chainId: Number(import.meta.env.VITE_TARGET_CHAIN_ID), verifyingContract: '0x0000000000000000000000000000000000000000' };
      const types = {
        LockBatch: [
          { name: 'painter', type: 'address' },
          { name: 'pixelIds', type: 'string[]' },
          { name: 'locked', type: 'bool' },
          { name: 'timestamp', type: 'uint256' },
        ],
      };
      const value = { painter: account.toLowerCase(), pixelIds, locked, timestamp };
      const signature = await signer.signTypedData(domain, types, value);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      let res: Response;
      try {
        res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/toggle-pixels-lock-batch`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ address: account.toLowerCase(), pixelIds, locked, signature, timestamp }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      const result = await res.json();
      if (!res.ok || result.error) throw new Error(result.error || 'Batch lock error');

      setPixels(prev => prev.map(p => selectedIds.has(p.id) ? { ...p, isLocked: locked } : p));
      setSelectedIds(new Set());
      setSelectMode(false);
    } catch (err) {
      console.error('Batch lock error', err);
    } finally {
      setApplyingLock(false);
    }
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return pixels;
    const frozenMatches = frozenPixels.filter(p => `${p.x},${p.y}`.includes(search) || p.id.includes(search));
    return [...(searchResults ?? []), ...frozenMatches];
  }, [search, pixels, frozenPixels, searchResults]);

  const paginated = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);
  const totalPages = useMemo(() => Math.ceil(filtered.length / PAGE_SIZE), [filtered]);
  const lockedCount = useMemo(() => pixels.filter(p => p.isLocked).length, [pixels]);

  const paginationBtn = (disabled: boolean): React.CSSProperties => ({
    background: 'var(--color-primary-dim)',
    border: '1px solid var(--color-primary-border)',
    color: 'var(--color-primary)',
    borderRadius: 6, padding: '4px 10px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 12, opacity: disabled ? 0.4 : 1,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ── Header stats ─────────────────────────────────────────────────── */}
      <div style={{
        padding: '10px 14px',
        background: 'linear-gradient(135deg, var(--color-primary-dim), var(--color-purple-dim))',
        border: '1px solid var(--border-primary)',
        borderRadius: 10,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>My Pixel Tiles</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            {loading
              ? 'Loading...'
              : <>You own {exactTotal ?? pixels.length} pixel{(exactTotal ?? pixels.length) !== 1 ? 's' : ''}{lockedCount > 0 && (<> — <Lock size={10} style={{ verticalAlign: 'middle' }} /> {lockedCount}</>)}</>}
          </div>
        </div>
        <button
          onClick={toggleSelectMode}
          style={{
            fontSize: 11, padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
            background: selectMode ? 'var(--color-primary)' : 'var(--bg-surface-2)',
            color: selectMode ? '#fff' : 'var(--text-primary)',
            border: '1px solid var(--border-default)',
          }}
        >
          {selectMode ? 'Cancel' : 'Select'}
        </button>
      </div>

      {/* ── Filtre ───────────────────────────────────────────────────────── */}
      <input
        type="text"
        placeholder="Filter by X,Y or id..."
        value={search}
        onChange={e => { setSearch(e.target.value); setPage(0); }}
        style={{
          width: '100%',
          background: 'var(--bg-surface-2)',
          border: '1px solid var(--border-default)',
          borderRadius: 8, padding: '8px 12px',
          color: 'var(--text-primary)', fontSize: 12, outline: 'none',
        }}
      />

      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--text-faint)', fontSize: 12, padding: '20px 0' }}>
          Loading your pixels...
        </div>
      ) : searching ? (
        <div style={{ textAlign: 'center', color: 'var(--text-faint)', fontSize: 12, padding: '20px 0' }}>
          Searching...
        </div>
      ) : (
        <>
          {/* ── Grille pixels ────────────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, maxHeight: 260, overflowY: 'auto', paddingRight: 4 }}>
            {paginated.map(p => {
              const isSelected = selectedPixel?.x === p.x && selectedPixel?.y === p.y;
              const isChecked = selectedIds.has(p.id);
              const selectable = selectMode && !p.isFrozen;
              return (
                <button
                  key={p.id}
                  onClick={(e) => selectable ? toggleSelectPixel(e, p.id) : onSelectPixel({ x: p.x, y: p.y })}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4,
                    padding: '8px 10px',
                    background: isChecked ? 'var(--color-primary-dim)' : isSelected ? 'var(--color-primary-dim)' : 'var(--bg-surface-2)',
                    border: isChecked
                      ? '1px solid var(--color-primary)'
                      : isSelected
                        ? '1px solid var(--color-primary)'
                        : p.isLocked ? '1px solid var(--color-purple, #a855f7)' : '1px solid var(--border-default)',
                    borderRadius: 8, cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                    opacity: selectMode && p.isFrozen ? 0.5 : 1,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {selectable && (
                        <input type="checkbox" checked={isChecked} readOnly style={{ pointerEvents: 'none' }} />
                      )}
                      <div style={{
                        width: 10, height: 10, borderRadius: 2, flexShrink: 0,
                        background: p.color || 'var(--bg-surface)',
                        border: '1px solid var(--border-default)',
                      }} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: (isSelected || isChecked) ? 'var(--color-primary)' : 'var(--text-primary)' }}>
                        ({p.x}, {p.y})
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {p.isFrozen
                        ? <span style={{ display: 'inline-flex' }} title="Frozen on-chain — permanent"><Snowflake size={11} color="var(--color-purple)" /></span>
                        : <span style={{ display: 'inline-flex' }} title="Painted off-chain — repaint anytime"><Palette size={11} color="var(--text-muted)" /></span>
                      }
                      {!p.isFrozen && p.isLocked && (
                        <span style={{ display: 'inline-flex' }} title="Locked — protected first from automatic sacrifice">
                          <Lock size={11} color="var(--color-purple, #a855f7)" />
                        </span>
                      )}
                    </div>
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: "'Space Mono', monospace" }}>
                    {p.isFrozen ? 'Frozen' : p.isLocked ? 'Painted · Locked' : 'Painted'}
                  </span>
                </button>
              );
            })}

            {!loading && filtered.length === 0 && (
              <div style={{ gridColumn: 'span 2', textAlign: 'center', color: 'var(--text-faint)', fontSize: 12, padding: '20px 0' }}>
                {pixels.length === 0 ? 'No pixels yet — paint one!' : 'No pixels match your search.'}
              </div>
            )}
          </div>

          {/* ── Barre d'action sélection multiple ──────────────────────────── */}
          {selectMode && selectedIds.size > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              padding: '8px 10px', background: 'var(--bg-surface-2)',
              border: '1px solid var(--border-primary)', borderRadius: 8,
            }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{selectedIds.size} selected</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => applyBatchLock(true)}
                  disabled={applyingLock}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '6px 10px', borderRadius: 6, cursor: applyingLock ? 'wait' : 'pointer', background: 'var(--color-purple-dim, #a855f733)', border: '1px solid var(--color-purple, #a855f7)', color: 'var(--color-purple, #a855f7)' }}
                >
                  <Lock size={12} /> Lock
                </button>
                <button
                  onClick={() => applyBatchLock(false)}
                  disabled={applyingLock}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '6px 10px', borderRadius: 6, cursor: applyingLock ? 'wait' : 'pointer', background: 'var(--bg-surface)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                >
                  <Unlock size={12} /> Unlock
                </button>
              </div>
            </div>
          )}

          {/* ── Pagination ───────────────────────────────────────────────── */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4 }}>
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={paginationBtn(page === 0)}>←</button>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Space Mono', monospace" }}>
                {page + 1} / {totalPages}
              </span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={paginationBtn(page >= totalPages - 1)}>→</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default React.memo(OwnedPixels);