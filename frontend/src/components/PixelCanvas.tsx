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

function numToHex(n: number): string {
  return '#' + Number(n).toString(16).padStart(6, '0');
}

function snapZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(z)));
}

interface Dimensions {
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

function getClampedPan(x: number, y: number, zoom: number, dimensions: Dimensions): Point {
  const canvasPixelW = CANVAS_W * zoom;
  const canvasPixelH = CANVAS_H * zoom;
  const halfW = dimensions.width / 2;
  const halfH = dimensions.height / 2;
  const maxX = halfW;
  const maxY = halfH;
  const minX = halfW - canvasPixelW;
  const minY = halfH - canvasPixelH;
  return {
    x: Math.max(minX, Math.min(maxX, x)),
    y: Math.max(minY, Math.min(maxY, y)),
  };
}

interface ZoneRect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface ZoneSelection {
  rect: ZoneRect;
  pixels: DraftPixel[];
}

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
  onDraftPixelsChange: (updater: DraftPixel[] | ((prev: DraftPixel[]) => DraftPixel[])) => void;
}

export default function PixelCanvas({
  canvasData, selectedPixel, selectedColor, account, onSelectPixel, onLoadSlice,
  onFreezeBatch, showFrozenOverlay, zoneMode, onToggleZoneMode,
  draftPixels, onDraftPixelsChange,
}: PixelCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [dimensions, setDimensions] = useState<Dimensions>({ width: window.innerWidth, height: window.innerHeight });
  const [cursorStyle, setCursorStyle] = useState('grab');

  const [navX, setNavX] = useState('');
  const [navY, setNavY] = useState('');
  const [navOpen, setNavOpen] = useState(false);

  const [zoneDragging, setZoneDragging] = useState(false);
  const [zoneStart, setZoneStart] = useState<Point | null>(null);
  const [zoneEnd, setZoneEnd] = useState<Point | null>(null);
  const [zoneSelection, setZoneSelection] = useState<ZoneSelection | null>(null);
  const [freezingBatch, setFreezingBatch] = useState(false);

  const isPanningRef = useRef(false);
  const panStartRef = useRef<Point>({ x: 0, y: 0 });
  const mouseDownPosRef = useRef<Point | null>(null);

  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  const dimensionsRef = useRef(dimensions);
  const selectedPixelRef = useRef(selectedPixel);
  useEffect(() => { selectedPixelRef.current = selectedPixel; }, [selectedPixel]);

  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { dimensionsRef.current = dimensions; }, [dimensions]);

  useEffect(() => {
    if (!account) {
      onDraftPixelsChange([]);
      if (zoneMode && onToggleZoneMode) onToggleZoneMode();
      setZoneSelection(null);
      setZoneStart(null);
      setZoneEnd(null);
    }
  }, [account, zoneMode, onToggleZoneMode]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const resizeObserver = new ResizeObserver(() => {
      setDimensions({ width: container.clientWidth, height: container.clientHeight });
    });
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
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
      const zoomRatio = newZoom / currentZoom;
      const currentPan = panRef.current;
      const newPanRaw = {
        x: mouseX - (mouseX - currentPan.x) * zoomRatio,
        y: mouseY - (mouseY - currentPan.y) * zoomRatio,
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
    const minX = Math.max(0, Math.min(zoneStart.x, zoneEnd.x));
    const maxX = Math.min(CANVAS_W - 1, Math.max(zoneStart.x, zoneEnd.x));
    const minY = Math.max(0, Math.min(zoneStart.y, zoneEnd.y));
    const maxY = Math.min(CANVAS_H - 1, Math.max(zoneStart.y, zoneEnd.y));
    return { minX, maxX, minY, maxY };
  }, [zoneStart, zoneEnd]);

  const finalizeZoneSelection = useCallback(() => {
    const zr = getZoneRect();
    if (!zr || !canvasData || !canvasData.colors) {
      setZoneStart(null);
      setZoneEnd(null);
      return;
    }
    const pixels: DraftPixel[] = [];
    for (let yy = zr.minY; yy <= zr.maxY; yy++) {
      for (let xx = zr.minX; xx <= zr.maxX; xx++) {
        const localX = xx - canvasData.startX;
        const localY = yy - canvasData.startY;
        if (localX < 0 || localX >= canvasData.w || localY < 0 || localY >= canvasData.h) continue;
        const idx = localY * canvasData.w + localX;
        const color = canvasData.colors[idx];
        const isFrozen = !!canvasData.frozen?.[idx];
        if (color && !isFrozen) {
          pixels.push({ id: `${xx}-${yy}`, x: xx, y: yy, color });
        }
      }
    }
    setZoneSelection({ rect: zr, pixels });
  }, [getZoneRect, canvasData]);

  // RENDU CANVAS
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(pan.x, pan.y);

    ctx.strokeStyle = 'rgba(239, 68, 68, 0.3)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, CANVAS_W * zoom, CANVAS_H * zoom);

    if (canvasData && canvasData.colors) {
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
          ctx.strokeStyle = 'rgba(167, 139, 250, 0.9)';
          ctx.lineWidth = Math.max(1.5, zoom * 0.08);
          ctx.strokeRect(px + 1, py + 1, zoom - 2, zoom - 2);
        }
      });
    }

    if (zoom >= 3) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      const startX = Math.max(0, Math.floor(-pan.x / zoom));
      const endX = Math.min(CANVAS_W, startX + Math.ceil(canvas.width / zoom));
      const startY = Math.max(0, Math.floor(-pan.y / zoom));
      const endY = Math.min(CANVAS_H, startY + Math.ceil(canvas.height / zoom));
      ctx.beginPath();
      for (let x = startX; x <= endX; x++) {
        ctx.moveTo(x * zoom, startY * zoom); ctx.lineTo(x * zoom, endY * zoom);
      }
      for (let y = startY; y <= endY; y++) {
        ctx.moveTo(startX * zoom, y * zoom); ctx.lineTo(endX * zoom, y * zoom);
      }
      ctx.stroke();
    }

    if (draftPixels.length > 0) {
      draftPixels.forEach(p => {
        ctx.fillStyle = typeof p.color === 'number' ? numToHex(p.color) : p.color;
        ctx.fillRect(p.x * zoom, p.y * zoom, zoom, zoom);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.lineWidth = 1;
        ctx.strokeRect(p.x * zoom + 0.5, p.y * zoom + 0.5, zoom - 1, zoom - 1);
      });
    }

    const zr = getZoneRect();
    if (zr) {
      const rx = zr.minX * zoom;
      const ry = zr.minY * zoom;
      const rw = (zr.maxX - zr.minX + 1) * zoom;
      const rh = (zr.maxY - zr.minY + 1) * zoom;
      ctx.fillStyle = 'rgba(0, 212, 255, 0.15)';
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = '#00d4ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(rx, ry, rw, rh);
    }

    if (selectedPixel) {
      ctx.strokeStyle = '#00d4ff';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#00d4ff';
      ctx.shadowBlur = 10;
      ctx.strokeRect(selectedPixel.x * zoom - 1, selectedPixel.y * zoom - 1, zoom + 2, zoom + 2);
      ctx.shadowBlur = 0;
    }
  }, [canvasData, zoom, pan, dimensions, selectedPixel, draftPixels, zoneStart, zoneEnd, getZoneRect, showFrozenOverlay]);

  // HANDLERS SOURIS
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
    if (zoneMode) {
      const rect = containerRef.current!.getBoundingClientRect();
      const gridX = Math.floor((e.clientX - rect.left - panRef.current.x) / zoomRef.current);
      const gridY = Math.floor((e.clientY - rect.top - panRef.current.y) / zoomRef.current);
      setZoneDragging(true);
      setZoneStart({ x: gridX, y: gridY });
      setZoneEnd({ x: gridX, y: gridY });
      e.preventDefault();
      return;
    }
    isPanningRef.current = true;
    panStartRef.current = {
      x: e.clientX - panRef.current.x,
      y: e.clientY - panRef.current.y,
    };
    setCursorStyle('grabbing');
    e.preventDefault();
  }, [zoneMode]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (zoneDragging) {
      const rect = containerRef.current!.getBoundingClientRect();
      const gridX = Math.floor((e.clientX - rect.left - panRef.current.x) / zoomRef.current);
      const gridY = Math.floor((e.clientY - rect.top - panRef.current.y) / zoomRef.current);
      setZoneEnd({ x: gridX, y: gridY });
      return;
    }
    if (!isPanningRef.current) return;
    const newX = e.clientX - panStartRef.current.x;
    const newY = e.clientY - panStartRef.current.y;
    const clampedPan = getClampedPan(newX, newY, zoomRef.current, dimensionsRef.current);
    panRef.current = clampedPan;
    setPan(clampedPan);
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
        const currentZoom = zoomRef.current;
        const currentPan = panRef.current;
        const gridX = Math.floor((e.clientX - rect.left - currentPan.x) / currentZoom);
        const gridY = Math.floor((e.clientY - rect.top - currentPan.y) / currentZoom);
        if (gridX >= 0 && gridX < CANVAS_W && gridY >= 0 && gridY < CANVAS_H) {
        // Toggle sélection
          onSelectPixel({ x: gridX, y: gridY });
          let isFrozen = false;
          if (canvasData && canvasData.colors) {
            const localX = gridX - canvasData.startX;
            const localY = gridY - canvasData.startY;
            if (localX >= 0 && localX < canvasData.w && localY >= 0 && localY < canvasData.h) {
              const idx = localY * canvasData.w + localX;
              isFrozen = !!canvasData.frozen?.[idx];
            }
          }
          if (isFrozen) return;
          if (!account) return;
          if (selectedColor) {
            onDraftPixelsChange(prev => {
              const existingIndex = prev.findIndex(p => p.x === gridX && p.y === gridY);
              if (existingIndex >= 0) {
                return prev.filter((_, i) => i !== existingIndex);
          }
      // N'ajoute au panier QUE si le pixel est sélectionné (pas déjà selected)
      if (selectedPixelRef.current && selectedPixelRef.current.x === gridX && selectedPixelRef.current.y === gridY) {
              return prev; // désélection, pas d'ajout
              }
              return [...prev, { id: `${gridX}-${gridY}`, x: gridX, y: gridY, color: selectedColor }];
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
    setCursorStyle('grab');
  }, []);

  const handleLoadVisibleRegion = useCallback(() => {
    const idealW = Math.ceil(dimensions.width / zoom) + 4;
    const idealH = Math.ceil(dimensions.height / zoom) + 4;
    const startX = Math.max(0, Math.floor(-pan.x / zoom) - 2);
    const startY = Math.max(0, Math.floor(-pan.y / zoom) - 2);
    const w = Math.min(idealW, CANVAS_W - startX);
    const h = Math.min(idealH, CANVAS_H - startY);
    onLoadSlice(startX, startY, w, h);
  }, [pan, zoom, dimensions, onLoadSlice]);

  useEffect(() => {
    const delay = zoom < 4 ? 800 : 300;
    const timer = setTimeout(() => { handleLoadVisibleRegion(); }, delay);
    return () => clearTimeout(timer);
  }, [pan, zoom, handleLoadVisibleRegion]);

  const glassPanel: React.CSSProperties = {
    background: 'rgba(10, 10, 20, 0.85)',
    border: '1px solid rgba(0, 212, 255, 0.25)',
    borderRadius: 12,
    backdropFilter: 'blur(12px)',
    boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
  };

  const inputStyle: React.CSSProperties = {
    width: 90,
    padding: '6px 10px',
    background: 'rgba(0,0,0,0.4)',
    border: '1px solid rgba(0, 212, 255, 0.3)',
    borderRadius: 6,
    color: '#00d4ff',
    fontFamily: "'Space Mono', monospace",
    fontSize: 13,
    outline: 'none',
  };

  useEffect(() => {
    if (!selectedPixel) return;
    const currentPan = panRef.current;
    const currentZoom = zoomRef.current;
    const screenX = selectedPixel.x * currentZoom + currentPan.x;
    const screenY = selectedPixel.y * currentZoom + currentPan.y;
    const margin = 60;
    if (
      screenX < margin || screenX > dimensionsRef.current.width - margin ||
      screenY < margin || screenY > dimensionsRef.current.height - margin
    ) {
      const targetX = (dimensionsRef.current.width / 2) - selectedPixel.x * currentZoom;
      const targetY = (dimensionsRef.current.height / 2) - selectedPixel.y * currentZoom;
      const clampedPan = getClampedPan(targetX, targetY, currentZoom, dimensionsRef.current);
      panRef.current = clampedPan;
      setPan(clampedPan);
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
  };

  const handleGoToCoords = useCallback(() => {
    const x = parseInt(navX, 10);
    const y = parseInt(navY, 10);
    if (isNaN(x) || isNaN(y)) return;
    const clampedX = Math.max(0, Math.min(CANVAS_W - 1, x));
    const clampedY = Math.max(0, Math.min(CANVAS_H - 1, y));
    const targetZoom = Math.max(DEFAULT_ZOOM, zoomRef.current);
    const targetX = (dimensions.width / 2) - clampedX * targetZoom;
    const targetY = (dimensions.height / 2) - clampedY * targetZoom;
    const clampedPan = getClampedPan(targetX, targetY, targetZoom, dimensions);
    zoomRef.current = targetZoom;
    panRef.current = clampedPan;
    setZoom(targetZoom);
    setPan(clampedPan);
    setNavOpen(false);
    onSelectPixel({ x: clampedX, y: clampedY });
  }, [navX, navY, dimensions, onSelectPixel]);

  const handleNavKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleGoToCoords();
    if (e.key === 'Escape') setNavOpen(false);
  }, [handleGoToCoords]);

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
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
          <canvas
            ref={canvasRef}
            width={dimensions.width}
            height={dimensions.height}
            style={{ width: '100%', height: '100%', display: 'block' }}
          />
        </div>

        <div style={{ position: 'absolute', bottom: 20, left: 20, zIndex: 50 }} onMouseDown={e => e.stopPropagation()} onMouseUp={e => e.stopPropagation()}>
          {navOpen ? (
            <div style={{ ...glassPanel, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={{ color: '#6b7280', fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>ALLER AUX COORDONNÉES</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ color: '#6b7280', fontSize: 10 }}>X</label>
                  <input type="number" value={navX} onChange={e => setNavX(e.target.value)} onKeyDown={handleNavKeyDown} placeholder="0" min={0} max={CANVAS_W - 1} style={inputStyle} autoFocus />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ color: '#6b7280', fontSize: 10 }}>Y</label>
                  <input type="number" value={navY} onChange={e => setNavY(e.target.value)} onKeyDown={handleNavKeyDown} placeholder="0" min={0} max={CANVAS_H - 1} style={inputStyle} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleGoToCoords} style={{ flex: 1, padding: '7px 0', background: 'linear-gradient(135deg, #00d4ff, #0099cc)', border: 'none', borderRadius: 7, color: '#000', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>↗ Y aller</button>
                <button onClick={() => setNavOpen(false)} style={{ padding: '7px 12px', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, color: '#6b7280', fontSize: 12, cursor: 'pointer' }}>✕</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setNavOpen(true)} style={{ ...glassPanel, padding: '9px 16px', color: '#00d4ff', fontFamily: "'Space Mono', monospace", fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ fontSize: 16 }}>⌖</span> Aller à…</button>
          )}
        </div>

        <div style={{ position: 'absolute', bottom: 20, right: 20, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 50 }} onMouseDown={e => e.stopPropagation()} onMouseUp={e => e.stopPropagation()}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignSelf: 'flex-end' }}>
            <button onClick={() => {
              const currentZoom = zoomRef.current;
              const z = snapZoom(currentZoom + 1);
              if (z === currentZoom) return;
              const centerX = dimensionsRef.current.width / 2;
              const centerY = dimensionsRef.current.height / 2;
              const ratio = z / currentZoom;
              const currentPan = panRef.current;
              const newPanRaw = { x: centerX - (centerX - currentPan.x) * ratio, y: centerY - (centerY - currentPan.y) * ratio };
              const clampedPan = getClampedPan(newPanRaw.x, newPanRaw.y, z, dimensionsRef.current);
              zoomRef.current = z; panRef.current = clampedPan; setZoom(z); setPan(clampedPan);
            }} className="btn-control" title="Zoom In">+</button>
            <button onClick={() => {
              const currentZoom = zoomRef.current;
              const z = snapZoom(currentZoom - 1);
              if (z === currentZoom) return;
              const centerX = dimensionsRef.current.width / 2;
              const centerY = dimensionsRef.current.height / 2;
              const ratio = z / currentZoom;
              const currentPan = panRef.current;
              const newPanRaw = { x: centerX - (centerX - currentPan.x) * ratio, y: centerY - (centerY - currentPan.y) * ratio };
              const clampedPan = getClampedPan(newPanRaw.x, newPanRaw.y, z, dimensionsRef.current);
              zoomRef.current = z; panRef.current = clampedPan; setZoom(z); setPan(clampedPan);
            }} className="btn-control" title="Zoom Out">−</button>
          </div>
        </div>

        {selectedPixel && !zoneMode && (
          <div
            onMouseDown={e => e.stopPropagation()}
            onMouseUp={e => e.stopPropagation()}
            style={{ position: 'absolute', top: 16, left: 16, ...glassPanel, borderRadius: 16, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, zIndex: 50 }}
          >
            <span style={{ color: '#6b7280', fontSize: 10, fontWeight: 700 }}>INSPECT</span>
            <span style={{ color: '#00d4ff', fontFamily: "'Space Mono', monospace", fontWeight: 700 }}>({selectedPixel.x}, {selectedPixel.y})</span>
          </div>
        )}

        {zoneSelection && (
          <div
            onMouseDown={e => e.stopPropagation()}
            onMouseUp={e => e.stopPropagation()}
            style={{ position: 'absolute', top: 70, left: '50%', transform: 'translateX(-50%)', ...glassPanel, borderRadius: 16, padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13, zIndex: 60, minWidth: 320, border: '1px solid rgba(168, 85, 247, 0.4)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#a855f7', fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>❄️ FREEZE DE ZONE</span>
              <span style={{ color: '#00d4ff', fontFamily: "'Space Mono', monospace", fontWeight: 700 }}>{zoneSelection.pixels.length} pixel(s)</span>
            </div>
            {zoneSelection.pixels.length === 0 ? (
              <p style={{ color: '#6b7280', margin: 0 }}>Aucun pixel peint à freezer dans cette zone.</p>
            ) : zoneSelection.pixels.length > MAX_BATCH_FREEZE ? (
              <p style={{ color: '#ef4444', margin: 0 }}>Trop de pixels ({zoneSelection.pixels.length}). Maximum {MAX_BATCH_FREEZE} — réduis la zone.</p>
            ) : (
              <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 10, padding: '10px 12px', color: '#fca5a5', lineHeight: 1.5 }}>
                ⚠️ <strong>Attention :</strong> cette action est irréversible. Ces {zoneSelection.pixels.length} pixel(s) seront gravés sur la blockchain pour l&rsquo;éternité.
                {`Coût : `}<strong>{zoneSelection.pixels.length} PAINT</strong>{` (brûlés définitivement).`}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleCancelZoneSelection} disabled={freezingBatch} style={{ flex: 1, padding: '9px 0', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#9ca3af', fontWeight: 700, cursor: freezingBatch ? 'not-allowed' : 'pointer' }}>Annuler</button>
              <button
                onClick={handleConfirmFreezeBatch}
                disabled={freezingBatch || zoneSelection.pixels.length === 0 || zoneSelection.pixels.length > MAX_BATCH_FREEZE}
                style={{
                  flex: 2, padding: '9px 0',
                  background: (freezingBatch || zoneSelection.pixels.length === 0 || zoneSelection.pixels.length > MAX_BATCH_FREEZE) ? 'rgba(168, 85, 247, 0.3)' : 'linear-gradient(135deg, #a855f7, #9333ea)',
                  border: 'none', borderRadius: 8, color: '#fff', fontWeight: 700,
                  cursor: (freezingBatch || zoneSelection.pixels.length === 0 || zoneSelection.pixels.length > MAX_BATCH_FREEZE) ? 'not-allowed' : 'pointer'
                }}
              >
                {freezingBatch ? 'Freeze en cours...' : '❄️ Confirmer le freeze'}
              </button>
            </div>
          </div>
        )}

        <div style={{ position: 'absolute', top: 16, right: 16, padding: '4px 10px', background: 'rgba(0,0,0,0.5)', borderRadius: 8, fontSize: 11, color: '#22c55e', fontFamily: "'Space Mono', monospace", pointerEvents: 'none' }}>
          Zoom: {zoom}x
        </div>
      </div>

      {zoneMode && (
        <div style={{
          position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)',
          background: '#00d4ff', color: '#000', padding: '8px 16px', borderRadius: 20,
          fontWeight: 'bold', zIndex: 1000, pointerEvents: 'none'
        }}>
          SÉLECTIONNE TA ZONE...
        </div>
      )}
    </>
  );
}