import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Contract } from 'ethers';
import { CANVAS_W, CANVAS_H } from '../App';
import type { DraftPixel, CanvasData } from '../types';

const MAX_ZOOM = 32;
const MIN_ZOOM = 1;
const DEFAULT_ZOOM = 4;
const DRAG_THRESHOLD = 4;
const ZOOM_SENSITIVITY = 20;
const MAX_BATCH_FREEZE = 200;
const ZOOM_BUTTONS = [
  { label: '+', delta: +1, title: 'Zoom In' },
  { label: '−', delta: -1, title: 'Zoom Out' },
] as const;

function numToHex(n: number | string): string {
  if (typeof n === 'string') return n.startsWith('#') ? n : '#' + n;
  return '#' + Number(n).toString(16).padStart(6, '0');
}

function snapZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(z)));
}
interface Dimensions { width: number; height: number; }
interface Point { x: number; y: number; }

function getClampedPan(x: number, y: number, zoom: number, dimensions: Dimensions): Point {
  const canvasPixelW = CANVAS_W * zoom;
  const canvasPixelH = CANVAS_H * zoom;
  const halfW = dimensions.width / 2;
  const halfH = dimensions.height / 2;
  return {
    x: Math.max(halfW - canvasPixelW, Math.min(halfW, x)),
    y: Math.max(halfH - canvasPixelH, Math.min(halfH, y)),
  };
}

interface ZoneRect { minX: number; maxX: number; minY: number; maxY: number; }
interface ZoneSelection { rect: ZoneRect; pixels: DraftPixel[]; }

interface PixelCanvasProps {
  canvasData: CanvasData | null;
  loadingCanvas: boolean;
  selectedPixel: Point | null;
  selectedColor: string;
  account: string | null;
  onSelectPixel: (p: Point) => void;
  onLoadSlice: (startX: number, startY: number, w: number, h: number) => void;
  readContract: Contract | null;
  onPixelsPainted: (pixels: DraftPixel[]) => void;
  onFreezeBatch?: (pixels: DraftPixel[]) => Promise<boolean>;
  onOpenEditProfile: () => void;
  showFrozenOverlay: boolean;
  zoneMode: boolean;
  onToggleZoneMode: () => void;
  draftPixels: DraftPixel[];
  clearZoneSignal?: number;
  onDraftPixelsChange: (updater: DraftPixel[] | ((prev: DraftPixel[]) => DraftPixel[])) => void;
}

function PixelCanvas({
  canvasData, selectedPixel, selectedColor, account, onSelectPixel, onLoadSlice,
  onFreezeBatch, showFrozenOverlay, zoneMode, onToggleZoneMode, clearZoneSignal,
  draftPixels, onDraftPixelsChange,
}: PixelCanvasProps) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [zoom, setZoom]             = useState(DEFAULT_ZOOM);
  const [pan, setPan]               = useState<Point>({ x: 0, y: 0 });
  const [dimensions, setDimensions] = useState<Dimensions>({ width: window.innerWidth, height: window.innerHeight });
  const [cursorStyle, setCursorStyle] = useState('grab');
  const [themeVersion, setThemeVersion] = useState(0);

  const [navX, setNavX]       = useState('');
  const [navY, setNavY]       = useState('');
  const [navOpen, setNavOpen] = useState(false);

  const [zoneDragging, setZoneDragging]   = useState(false);
  const [zoneStart, setZoneStart]         = useState<Point | null>(null);
  const [zoneEnd, setZoneEnd]             = useState<Point | null>(null);
  const [zoneSelection, setZoneSelection] = useState<ZoneSelection | null>(null);
  const [freezingBatch, setFreezingBatch] = useState(false);

  const isPanningRef     = useRef(false);
  const panStartRef      = useRef<Point>({ x: 0, y: 0 });
  const mouseDownPosRef  = useRef<Point | null>(null);
  const panRef           = useRef(pan);
  const zoomRef          = useRef(zoom);
  const dimensionsRef    = useRef(dimensions);
  const selectedPixelRef = useRef(selectedPixel);
  const canvasVersion = canvasData?._v ?? 0;

  useEffect(() => { selectedPixelRef.current = selectedPixel; }, [selectedPixel]);
  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { dimensionsRef.current = dimensions; }, [dimensions]);

  useEffect(() => {
    if (clearZoneSignal === undefined) return;
    setZoneSelection(null);
    setZoneStart(null);
    setZoneEnd(null);
    if (zoneMode && onToggleZoneMode) onToggleZoneMode();
  }, [clearZoneSignal]);

  useEffect(() => {
  const observer = new MutationObserver(() => {
    setThemeVersion(v => v + 1);
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  return () => observer.disconnect();
}, []);

 const zoneModeRef = useRef(zoneMode);
  useEffect(() => { zoneModeRef.current = zoneMode; }, [zoneMode]);

  useEffect(() => {
    if (!account) {
      onDraftPixelsChange([]);
      if (zoneModeRef.current && onToggleZoneMode) onToggleZoneMode();
      setZoneSelection(null);
      setZoneStart(null);
      setZoneEnd(null);
    }
  }, [account, onToggleZoneMode]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      setDimensions({ width: container.clientWidth, height: container.clientHeight });
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let wheelAccum = 0;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      wheelAccum += e.deltaY;
      if (Math.abs(wheelAccum) < ZOOM_SENSITIVITY) return;
      const direction = wheelAccum > 0 ? -1 : 1;
      wheelAccum = 0;
      const currentZoom = zoomRef.current;
      const newZoom = snapZoom(currentZoom + direction);
      if (newZoom === currentZoom) return;
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const ratio = newZoom / currentZoom;
      const currentPan = panRef.current;
      const newPanRaw = {
        x: mouseX - (mouseX - currentPan.x) * ratio,
        y: mouseY - (mouseY - currentPan.y) * ratio,
      };
      const clampedPan = getClampedPan(newPanRaw.x, newPanRaw.y, newZoom, dimensionsRef.current);
      zoomRef.current = newZoom;
      panRef.current = clampedPan;
      setZoom(newZoom);
      setPan(clampedPan);
    };
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  const getZoneRect = useCallback((): ZoneRect | null => {
    if (!zoneStart || !zoneEnd) return null;
    return {
      minX: Math.max(0, Math.min(zoneStart.x, zoneEnd.x)),
      maxX: Math.min(CANVAS_W - 1, Math.max(zoneStart.x, zoneEnd.x)),
      minY: Math.max(0, Math.min(zoneStart.y, zoneEnd.y)),
      maxY: Math.min(CANVAS_H - 1, Math.max(zoneStart.y, zoneEnd.y)),
    };
  }, [zoneStart, zoneEnd]);

  const finalizeZoneSelection = useCallback(() => {
    const zr = getZoneRect();
    if (!zr || !canvasData?.colors) { setZoneStart(null); setZoneEnd(null); return; }
    const pixels: DraftPixel[] = [];
    for (let yy = zr.minY; yy <= zr.maxY; yy++) {
      for (let xx = zr.minX; xx <= zr.maxX; xx++) {
        const localX = xx - canvasData.startX;
        const localY = yy - canvasData.startY;
        if (localX < 0 || localX >= canvasData.w || localY < 0 || localY >= canvasData.h) continue;
        const idx = localY * canvasData.w + localX;
        const color = canvasData.colors[idx];
        const isFrozen = !!canvasData.frozen?.[idx];
        const owner = canvasData.owners?.[idx];
        if (color && !isFrozen && owner && account && owner.toLowerCase() === account.toLowerCase()) {
          pixels.push({ id: `${xx}-${yy}`, x: xx, y: yy, color });
        }
      }
    }
    setZoneSelection({ rect: zr, pixels });
  }, [getZoneRect, canvasData, account]);

  // ── Rendu canvas ──────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Un seul getComputedStyle pour tout l'élément racine, puis on lit
    // toutes les variables dessus (au lieu de 7 appels getComputedStyle
    // redondants sur le même élément à chaque frame de dessin).
    const rootStyle = getComputedStyle(document.documentElement);
    const readVar = (name: string) => rootStyle.getPropertyValue(name).trim();
    const bgApp         = readVar('--bg-app') || '#0a0a0f';
    const colorPrimary  = readVar('--color-primary');
    const colorPrimaryDim = readVar('--color-primary-dim');
    const colorRedDim   = readVar('--color-red-dim');
    const colorPurple   = readVar('--color-purple');
    const colorGrid     = readVar('--color-grid');
    const colorDraftStroke = readVar('--color-draft-stroke');

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = bgApp;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(pan.x, pan.y);

    // Bordure canvas world
    ctx.strokeStyle = colorRedDim;
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, CANVAS_W * zoom, CANVAS_H * zoom);

    // Pixels de la vue
    if (canvasData?.colors) {
      const regionW = canvasData.w;
      canvasData.colors.forEach((colorInt, idx) => {
        if (!colorInt) return;
        const localX = idx % regionW;
        const localY = Math.floor(idx / regionW);
        const globalX = canvasData.startX + localX;
        const globalY = canvasData.startY + localY;
        ctx.fillStyle = typeof colorInt === 'number' ? numToHex(colorInt) : colorInt;
        ctx.fillRect(globalX * zoom, globalY * zoom, zoom, zoom);
        if (showFrozenOverlay && canvasData.frozen?.[idx]) {
          const px = globalX * zoom;
          const py = globalY * zoom;
          ctx.strokeStyle = colorPurple;
          ctx.lineWidth = Math.max(1.5, zoom * 0.08);
          ctx.strokeRect(px + 1, py + 1, zoom - 2, zoom - 2);
        }
      });
    }

    // Grille
    if (zoom >= 3) {
      ctx.strokeStyle = colorGrid;
      ctx.lineWidth = 1;
      const startX = Math.max(0, Math.floor(-pan.x / zoom));
      const endX   = Math.min(CANVAS_W, startX + Math.ceil(canvas.width / zoom));
      const startY = Math.max(0, Math.floor(-pan.y / zoom));
      const endY   = Math.min(CANVAS_H, startY + Math.ceil(canvas.height / zoom));
      ctx.beginPath();
      for (let x = startX; x <= endX; x++) { ctx.moveTo(x * zoom, startY * zoom); ctx.lineTo(x * zoom, endY * zoom); }
      for (let y = startY; y <= endY; y++) { ctx.moveTo(startX * zoom, y * zoom); ctx.lineTo(endX * zoom, y * zoom); }
      ctx.stroke();
    }

    // Drafts
    draftPixels.forEach(p => {
      ctx.fillStyle = typeof p.color === 'number' ? numToHex(p.color) : p.color;
      ctx.fillRect(p.x * zoom, p.y * zoom, zoom, zoom);
      ctx.strokeStyle = colorDraftStroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(p.x * zoom + 0.5, p.y * zoom + 0.5, zoom - 1, zoom - 1);
    });

    // Zone en cours de sélection
    const zr = getZoneRect();
    if (zr) {
      const rx = zr.minX * zoom, ry = zr.minY * zoom;
      const rw = (zr.maxX - zr.minX + 1) * zoom, rh = (zr.maxY - zr.minY + 1) * zoom;
      ctx.fillStyle = colorPrimaryDim;
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = colorPrimary;
      ctx.lineWidth = 2;
      ctx.strokeRect(rx, ry, rw, rh);
    }

    // Pixel sélectionné
    if (selectedPixel) {
      ctx.strokeStyle = colorPrimary;
      ctx.lineWidth = 2;
      ctx.shadowColor = colorPrimary;
      ctx.shadowBlur = 10;
      ctx.strokeRect(selectedPixel.x * zoom - 1, selectedPixel.y * zoom - 1, zoom + 2, zoom + 2);
      ctx.shadowBlur = 0;
    }
  }, [canvasData, canvasVersion, zoom, pan, dimensions, selectedPixel, draftPixels, zoneStart, zoneEnd, getZoneRect, showFrozenOverlay, themeVersion]);

  // ── Handlers souris ───────────────────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
    if (zoneMode) {
      const rect = containerRef.current!.getBoundingClientRect();
      const gridX = Math.floor((e.clientX - rect.left - panRef.current.x) / zoomRef.current);
      const gridY = Math.floor((e.clientY - rect.top  - panRef.current.y) / zoomRef.current);
      setZoneDragging(true);
      setZoneStart({ x: gridX, y: gridY });
      setZoneEnd({ x: gridX, y: gridY });
      e.preventDefault();
      return;
    }
    isPanningRef.current = true;
    panStartRef.current  = { x: e.clientX - panRef.current.x, y: e.clientY - panRef.current.y };
    setCursorStyle('grabbing');
    e.preventDefault();
  }, [zoneMode]);

  const latestMousePosRef = useRef<Point | null>(null);
const panRafIdRef        = useRef<number | null>(null);

const handleMouseMove = useCallback((e: React.MouseEvent) => {
  if (zoneDragging) {
    const rect = containerRef.current!.getBoundingClientRect();
    setZoneEnd({
      x: Math.floor((e.clientX - rect.left - panRef.current.x) / zoomRef.current),
      y: Math.floor((e.clientY - rect.top  - panRef.current.y) / zoomRef.current),
    });
    return;
  }
  if (!isPanningRef.current) return;

  // On ne stocke que la dernière position connue et on planifie au plus
  // une mise à jour de pan par frame d'écran (via rAF), au lieu de faire
  // un setPan (+ redraw complet du canvas) à chaque event mousemove brut.
  latestMousePosRef.current = { x: e.clientX, y: e.clientY };
  if (panRafIdRef.current !== null) return;
  panRafIdRef.current = requestAnimationFrame(() => {
    panRafIdRef.current = null;
    const pos = latestMousePosRef.current;
    if (!pos || !isPanningRef.current) return;
    const newX = pos.x - panStartRef.current.x;
    const newY = pos.y - panStartRef.current.y;
    const clampedPan = getClampedPan(newX, newY, zoomRef.current, dimensionsRef.current);
    panRef.current = clampedPan;
    setPan(clampedPan);
  });
}, [zoneDragging]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (zoneDragging) {
      setZoneDragging(false);
      finalizeZoneSelection();
      mouseDownPosRef.current = null;
      return;
    }
    if (!isPanningRef.current) return;
    isPanningRef.current = false;
    setCursorStyle('grab');
    if (mouseDownPosRef.current) {
      const dx = Math.abs(e.clientX - mouseDownPosRef.current.x);
      const dy = Math.abs(e.clientY - mouseDownPosRef.current.y);
      if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) {
        if (zoneMode) { mouseDownPosRef.current = null; return; }
        const rect = containerRef.current!.getBoundingClientRect();
        const gridX = Math.floor((e.clientX - rect.left - panRef.current.x) / zoomRef.current);
        const gridY = Math.floor((e.clientY - rect.top  - panRef.current.y) / zoomRef.current);
        if (gridX >= 0 && gridX < CANVAS_W && gridY >= 0 && gridY < CANVAS_H) {
          let isFrozen = false;
          if (canvasData?.colors) {
            const localX = gridX - canvasData.startX;
            const localY = gridY - canvasData.startY;
            if (localX >= 0 && localX < canvasData.w && localY >= 0 && localY < canvasData.h) {
              isFrozen = !!canvasData.frozen?.[localY * canvasData.w + localX];
            }
          }
          const isAlreadySelected = selectedPixelRef.current?.x === gridX && selectedPixelRef.current?.y === gridY;
          onSelectPixel({ x: gridX, y: gridY });
          if (isFrozen || !account || !selectedColor) return;
          if (isAlreadySelected) {
            onDraftPixelsChange(prev => prev.filter(p => !(p.x === gridX && p.y === gridY)));
          } else {
            onDraftPixelsChange(prev => {
              const without = prev.filter(p => !(p.x === gridX && p.y === gridY));
              return [...without, { id: `${gridX}-${gridY}`, x: gridX, y: gridY, color: selectedColor }];
            });
          }
        }
      }
    }
    mouseDownPosRef.current = null;
  }, [onSelectPixel, selectedColor, canvasData, account, zoneMode, zoneDragging, finalizeZoneSelection]);

  const handleMouseLeave = useCallback(() => {
  isPanningRef.current = false;
  mouseDownPosRef.current = null;
  if (panRafIdRef.current !== null) {
    cancelAnimationFrame(panRafIdRef.current);
    panRafIdRef.current = null;
  }
  setCursorStyle('grab');
}, []);

  const handleLoadVisibleRegion = useCallback(() => {
    const startX = Math.max(0, Math.floor(-pan.x / zoom) - 2);
    const startY = Math.max(0, Math.floor(-pan.y / zoom) - 2);
    const w = Math.min(Math.ceil(dimensions.width / zoom) + 4, CANVAS_W - startX);
    const h = Math.min(Math.ceil(dimensions.height / zoom) + 4, CANVAS_H - startY);
    onLoadSlice(startX, startY, w, h);
  }, [pan, zoom, dimensions, onLoadSlice]);

  useEffect(() => {
    const delay = zoom < 4 ? 800 : 300;
    const timer = setTimeout(handleLoadVisibleRegion, delay);
    return () => clearTimeout(timer);
  }, [pan, zoom, handleLoadVisibleRegion]);

  useEffect(() => {
    if (!selectedPixel) return;
    const currentPan  = panRef.current;
    const currentZoom = zoomRef.current;
    const screenX = selectedPixel.x * currentZoom + currentPan.x;
    const screenY = selectedPixel.y * currentZoom + currentPan.y;
    const margin = 60;
    if (
      screenX < margin || screenX > dimensionsRef.current.width  - margin ||
      screenY < margin || screenY > dimensionsRef.current.height - margin
    ) {
      const targetX = (dimensionsRef.current.width  / 2) - selectedPixel.x * currentZoom;
      const targetY = (dimensionsRef.current.height / 2) - selectedPixel.y * currentZoom;
      const clampedPan = getClampedPan(targetX, targetY, currentZoom, dimensionsRef.current);
      if (clampedPan.x !== currentPan.x || clampedPan.y !== currentPan.y) {
        panRef.current = clampedPan;
        setPan(clampedPan);
      }
    }
  }, [selectedPixel]);

  const handleConfirmFreezeBatch = async () => {
    if (!zoneSelection || zoneSelection.pixels.length === 0) return;
    setFreezingBatch(true);
    try {
      const success = await onFreezeBatch?.(zoneSelection.pixels);
      if (success) {
        setZoneSelection(null);
        setZoneStart(null);
        setZoneEnd(null);
        if (onToggleZoneMode) onToggleZoneMode();
        handleLoadVisibleRegion();
      }
    } finally {
      setFreezingBatch(false);
    }
  };

 const handleCancelZoneSelection = () => {
  setZoneSelection(null);
  setZoneStart(null);
  setZoneEnd(null);
  if (onToggleZoneMode) onToggleZoneMode();
};

  const handleGoToCoords = useCallback(() => {
    const x = parseInt(navX, 10);
    const y = parseInt(navY, 10);
    if (isNaN(x) || isNaN(y)) return;
    const clampedX = Math.max(0, Math.min(CANVAS_W - 1, x));
    const clampedY = Math.max(0, Math.min(CANVAS_H - 1, y));
    const targetZoom = Math.max(DEFAULT_ZOOM, zoomRef.current);
    const targetPan  = getClampedPan(
      (dimensions.width  / 2) - clampedX * targetZoom,
      (dimensions.height / 2) - clampedY * targetZoom,
      targetZoom, dimensions
    );
    zoomRef.current = targetZoom; panRef.current = targetPan;
    setZoom(targetZoom); setPan(targetPan);
    setNavOpen(false);
    onSelectPixel({ x: clampedX, y: clampedY });
  }, [navX, navY, dimensions, onSelectPixel]);

  const handleNavKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleGoToCoords();
    if (e.key === 'Escape') setNavOpen(false);
  }, [handleGoToCoords]);

  // ── Styles partagés ───────────────────────────────────────────────────────
  const glassPanel: React.CSSProperties = {
    background: 'var(--glass-bg)',
    border: '1px solid var(--border-strong)',
    borderRadius: 12,
    backdropFilter: 'blur(12px)',
    boxShadow: '0 4px 24px var(--shadow-default)',
  };

  const inputStyle: React.CSSProperties = {
    width: 90,
    padding: '6px 10px',
    background: 'var(--bg-app)',
    border: '1px solid var(--border-strong)',
    borderRadius: 6,
    color: 'var(--color-primary)',
    fontFamily: "'Space Mono', monospace",
    fontSize: 13,
    outline: 'none',
  };

  const zoomBtnBase = (disabled?: boolean): React.CSSProperties => ({
    flex: 1, padding: '9px 0',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-default)',
    borderRadius: 8,
    color: disabled ? 'var(--text-muted)' : 'var(--text-secondary)',
    fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer',
  });

  const isFreezeBatchDisabled = freezingBatch || !zoneSelection || zoneSelection.pixels.length === 0 || zoneSelection.pixels.length > MAX_BATCH_FREEZE;

  return (
    <>
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        style={{
          width: '100%', height: '100%',
          overflow: 'hidden', position: 'relative',
          cursor: zoneMode ? 'crosshair' : cursorStyle,
          userSelect: 'none',
        }}
      >
        {/* Canvas */}
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
          <canvas
            ref={canvasRef}
            width={dimensions.width}
            height={dimensions.height}
            style={{ width: '100%', height: '100%', display: 'block' }}
          />
        </div>

        {/* Navigation bas-gauche */}
        <div
          style={{ position: 'absolute', bottom: 20, left: 20, zIndex: 50 }}
          onMouseDown={e => e.stopPropagation()}
          onMouseUp={e => e.stopPropagation()}
        >
          {navOpen ? (
            <div style={{ ...glassPanel, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>
                ALLER AUX COORDONNÉES
              </span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {(['X', 'Y'] as const).map((axis) => (
                  <div key={axis} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ color: 'var(--text-muted)', fontSize: 10 }}>{axis}</label>
                    <input
                      type="number"
                      value={axis === 'X' ? navX : navY}
                      onChange={e => axis === 'X' ? setNavX(e.target.value) : setNavY(e.target.value)}
                      onKeyDown={handleNavKeyDown}
                      placeholder="0"
                      min={0}
                      max={axis === 'X' ? CANVAS_W - 1 : CANVAS_H - 1}
                      style={inputStyle}
                      autoFocus={axis === 'X'}
                    />
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleGoToCoords}
                  style={{
                    flex: 1, padding: '7px 0',
                    background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-border))',
                    border: 'none', borderRadius: 7,
                    color: '#000', fontWeight: 700, fontSize: 12, cursor: 'pointer',
                  }}
                >
                  ↗ Y aller
                </button>
                <button
                  onClick={() => setNavOpen(false)}
                  style={{
                    padding: '7px 12px',
                    background: 'var(--bg-hover)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 7, color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer',
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setNavOpen(true)}
              style={{
                ...glassPanel,
                padding: '9px 16px',
                color: 'var(--color-primary)',
                fontFamily: "'Space Mono', monospace",
                fontSize: 13, fontWeight: 700,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <span style={{ fontSize: 16 }}>⌖</span> Aller à…
            </button>
          )}
        </div>

        {/* Contrôles zoom bas-droite */}
        <div
          style={{ position: 'absolute', bottom: 20, right: 20, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 50 }}
          onMouseDown={e => e.stopPropagation()}
          onMouseUp={e => e.stopPropagation()}
        >
          {ZOOM_BUTTONS.map(({ label, delta, title }) => (
            <button
              key={label}
              className="btn-control"
              title={title}
              onClick={() => {
                const currentZoom = zoomRef.current;
                const z = snapZoom(currentZoom + delta);
                if (z === currentZoom) return;
                const cx = dimensionsRef.current.width  / 2;
                const cy = dimensionsRef.current.height / 2;
                const ratio = z / currentZoom;
                const currentPan = panRef.current;
                const newPanRaw = { x: cx - (cx - currentPan.x) * ratio, y: cy - (cy - currentPan.y) * ratio };
                const clampedPan = getClampedPan(newPanRaw.x, newPanRaw.y, z, dimensionsRef.current);
                zoomRef.current = z; panRef.current = clampedPan;
                setZoom(z); setPan(clampedPan);
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Pixel inspecté */}
        {selectedPixel && !zoneMode && (
          <div
            onMouseDown={e => e.stopPropagation()}
            onMouseUp={e => e.stopPropagation()}
            style={{
              position: 'absolute', top: 16, left: 16, ...glassPanel,
              borderRadius: 16, padding: '10px 16px',
              display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, zIndex: 50,
            }}
          >
            <span style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 700 }}>INSPECT</span>
            <span style={{ color: 'var(--color-primary)', fontFamily: "'Space Mono', monospace", fontWeight: 700 }}>
              ({selectedPixel.x}, {selectedPixel.y})
            </span>
          </div>
        )}

        {/* Panneau confirmation freeze zone */}
        {zoneSelection && (
          <div
            onMouseDown={e => e.stopPropagation()}
            onMouseUp={e => e.stopPropagation()}
            style={{
              position: 'absolute', top: 70, left: '50%', transform: 'translateX(-50%)',
              ...glassPanel,
              border: '1px solid var(--color-purple-border)',
              borderRadius: 16, padding: '18px 22px',
              display: 'flex', flexDirection: 'column', gap: 14,
              fontSize: 13, zIndex: 60, minWidth: 320,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--color-purple)', fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>❄️ FREEZE DE ZONE</span>
              <span style={{ color: 'var(--color-primary)', fontFamily: "'Space Mono', monospace", fontWeight: 700 }}>
                {zoneSelection.pixels.length} pixel(s)
              </span>
            </div>

            {zoneSelection.pixels.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', margin: 0 }}>Aucun pixel peint à freezer dans cette zone.</p>
            ) : zoneSelection.pixels.length > MAX_BATCH_FREEZE ? (
              <p style={{ color: 'var(--color-red)', margin: 0 }}>
                Trop de pixels ({zoneSelection.pixels.length}). Maximum {MAX_BATCH_FREEZE} — réduis la zone.
              </p>
            ) : (
              <div style={{
                background: 'var(--color-red-dim)',
                border: '1px solid var(--color-red-border)',
                borderRadius: 10, padding: '10px 12px',
                color: 'var(--color-red-text)', lineHeight: 1.5,
              }}>
                ⚠️ <strong>Attention :</strong> cette action est irréversible. Ces {zoneSelection.pixels.length} pixel(s) seront gravés sur la blockchain pour l&rsquo;éternité.
                {` Coût : `}<strong>{zoneSelection.pixels.length} PAINT</strong>{` (brûlés définitivement).`}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleCancelZoneSelection}
                disabled={freezingBatch}
                style={{ ...zoomBtnBase(freezingBatch), flex: 1 }}
              >
                Annuler
              </button>
              <button
                onClick={handleConfirmFreezeBatch}
                disabled={isFreezeBatchDisabled}
                style={{
                  flex: 2, padding: '9px 0', border: 'none', borderRadius: 8,
                  color: '#fff', fontWeight: 700,
                  background: isFreezeBatchDisabled
                    ? 'var(--color-purple-dim)'
                    : 'linear-gradient(135deg, var(--color-purple), var(--color-purple-dark))',
                  cursor: isFreezeBatchDisabled ? 'not-allowed' : 'pointer',
                }}
              >
                {freezingBatch ? 'Freeze en cours...' : '❄️ Confirmer le freeze'}
              </button>
            </div>
          </div>
        )}

        {/* Indicateur zoom */}
        <div style={{
          position: 'absolute', top: 16, right: 16,
          padding: '4px 10px',
          background: 'var(--bg-surface)',
          borderRadius: 8, fontSize: 11,
          color: 'var(--color-green)',
          fontFamily: "'Space Mono', monospace",
          pointerEvents: 'none',
        }}>
          Zoom: {zoom}x
        </div>
      </div>

      {/* Banner zone mode */}
      {zoneMode && (
        <div style={{
          position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--color-primary)', color: '#000',
          padding: '8px 16px', borderRadius: 20,
          fontWeight: 'bold', zIndex: 1000, pointerEvents: 'none',
        }}>
          SÉLECTIONNE TA ZONE...
        </div>
      )}
    </>
  );
}
export default React.memo(PixelCanvas);