import React, { useRef, useState, useEffect, useCallback } from 'react';
import Webcam from 'react-webcam';
import { db } from '../firebase';
import { collection, query, orderBy, onSnapshot, addDoc } from 'firebase/firestore';

// ==========================================
// 🎯 TYPES
// ==========================================
type PhotoSlot = { x: number; y: number; width: number; height: number };

type PhotoTemplate = {
  id: string;
  name: string;
  imageUrl: string;
  photoCount: number;
  slots: PhotoSlot[];
  canvasWidth: number;
  canvasHeight: number;
  createdAt: string;
  tags?: string[];
};

type CapturedPhoto = {
  slotIndex: number;
  dataUrl: string;
  offsetX: number; // px offset in FULL CANVAS space
  offsetY: number;
  scale: number;   // user zoom multiplier (1.0 = cover-fit)
};

// Stages: template → method → camera/upload → editing → result
type Stage = 'template-selection' | 'capture-method' | 'camera-capture' | 'upload-capture' | 'editing' | 'result';

// ==========================================
// 🔧 HELPERS
// ==========================================
function getAspectLabel(w: number, h: number): string {
  if (w === h) return '1:1';
  const ratio = w / h;
  if (ratio > 1.7) return '16:9';
  if (ratio > 1.2) return '4:3';
  if (ratio < 0.6) return '9:16';
  if (ratio < 0.8) return '3:4';
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}

function getOrientation(w: number, h: number): 'portrait' | 'landscape' | 'square' {
  if (w < h) return 'portrait';
  if (w > h) return 'landscape';
  return 'square';
}

/**
 * Draw image with cover-fit + pan offset.
 * offsetX/Y are pixel offsets in FULL CANVAS SPACE (not display space).
 * mirror: horizontally flip (selfie correction).
 */
function drawWithPan(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number, dy: number, dw: number, dh: number,
  offsetX = 0, offsetY = 0,
  mirror = false,
  userScale = 1
) {
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (!srcW || !srcH) return;

  const coverScale = Math.max(dw / srcW, dh / srcH) * userScale;
  const scaledW = srcW * coverScale;
  const scaledH = srcH * coverScale;

  let drawX = (dw - scaledW) / 2 + offsetX;
  let drawY = (dh - scaledH) / 2 + offsetY;

  // Only clamp if image is larger than slot (zoomed in). When zoomed out, allow free positioning.
  if (scaledW > dw) {
    drawX = Math.min(0, Math.max(dw - scaledW, drawX));
  }
  if (scaledH > dh) {
    drawY = Math.min(0, Math.max(dh - scaledH, drawY));
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(dx, dy, dw, dh);
  ctx.clip();

  if (mirror) {
    ctx.translate(dx + dw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(img, -drawX, drawY, scaledW, scaledH);
  } else {
    ctx.drawImage(img, dx + drawX, dy + drawY, scaledW, scaledH);
  }

  ctx.restore();
}

// ==========================================
// 🔢 COUNTDOWN RING
// ==========================================
function CountdownRing({ value, max }: { value: number; max: number }) {
  const r = 66;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - value / max);
  return (
    <div style={{
      position: 'relative', width: 160, height: 160,
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      <svg width="160" height="160" viewBox="0 0 160 160"
        style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
        <circle cx="80" cy="80" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
        <circle
          cx="80" cy="80" r={r} fill="none"
          stroke="rgba(200,185,255,0.9)" strokeWidth="4" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1s linear' }}
        />
      </svg>
      <span
        key={value}
        style={{
          fontFamily: "'DM Serif Display', serif",
          fontSize: 68, fontWeight: 400, color: 'white',
          lineHeight: 1, position: 'relative', zIndex: 2,
          animation: 'pbPop 0.4s cubic-bezier(0.175,0.885,0.32,1.275)'
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ==========================================
// 🖱️ DRAGGABLE PHOTO SLOT (for editing stage)
// NOTE: returns offsets in DISPLAY SPACE — caller must scale up to canvas space
// ==========================================
type DraggableSlotProps = {
  photo: CapturedPhoto;
  slot: PhotoSlot;
  displayW: number;
  displayH: number;
  /** called with (displayOx, displayOy) in display pixels */
  onOffsetChange: (dx: number, dy: number) => void;
  onScaleChange: (scale: number) => void;
  /** display-space offset to show (= photo.offsetX * displayScale) */
  displayOX: number;
  displayOY: number;
  mirror?: boolean;
};

const MIN_SCALE = 0.3;
const MAX_SCALE = 5;

function DraggableSlot({ photo, slot, displayW, displayH, onOffsetChange, onScaleChange, displayOX, displayOY, mirror }: DraggableSlotProps) {
  const dragRef = useRef<{ startX: number; startY: number; baseOX: number; baseOY: number } | null>(null);
  const pinchRef = useRef<{ id1: number; id2: number; startDist: number; startScale: number; midX: number; midY: number } | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const imgRef = useRef<HTMLImageElement>(null);
  const [naturalSize, setNaturalSize] = useState({ w: 1, h: 1 });

  const userScale = photo.scale ?? 1;
  const coverScale = Math.max(displayW / naturalSize.w, displayH / naturalSize.h) * userScale;
  const scaledW = naturalSize.w * coverScale;
  const scaledH = naturalSize.h * coverScale;

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const pts = [...pointersRef.current.entries()];
    if (pts.length === 2) {
      // Start pinch
      const [, p1] = pts[0];
      const [, p2] = pts[1];
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      pinchRef.current = {
        id1: pts[0][0], id2: pts[1][0],
        startDist: dist, startScale: userScale,
        midX: (p1.x + p2.x) / 2, midY: (p1.y + p2.y) / 2,
      };
      dragRef.current = null;
    } else if (pts.length === 1) {
      dragRef.current = { startX: e.clientX, startY: e.clientY, baseOX: displayOX, baseOY: displayOY };
      pinchRef.current = null;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointersRef.current.entries()];

    if (pts.length >= 2 && pinchRef.current) {
      const p1 = pointersRef.current.get(pinchRef.current.id1);
      const p2 = pointersRef.current.get(pinchRef.current.id2);
      if (!p1 || !p2) return;
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinchRef.current.startScale * (dist / pinchRef.current.startDist)));
      onScaleChange(newScale);
    } else if (dragRef.current && pts.length === 1) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      onOffsetChange(dragRef.current.baseOX + dx, dragRef.current.baseOY + dy);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) dragRef.current = null;
  };

  const zoom = (delta: number) => {
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, userScale + delta));
    onScaleChange(newScale);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div
        style={{
          width: displayW, height: displayH,
          overflow: 'hidden', borderRadius: 6,
          cursor: 'grab', userSelect: 'none', position: 'relative',
          border: '1.5px solid rgba(160,145,220,0.35)',
          touchAction: 'none', background: '#0a0a1a',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <img
          ref={imgRef}
          src={photo.dataUrl}
          alt=""
          draggable={false}
          onLoad={() => {
            if (imgRef.current) setNaturalSize({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight });
          }}
          style={{
            position: 'absolute',
            width: scaledW, height: scaledH,
            left: (displayW - scaledW) / 2 + displayOX,
            top: (displayH - scaledH) / 2 + displayOY,
            transform: mirror ? 'scaleX(-1)' : 'none',
            pointerEvents: 'none',
          }}
        />
        <div style={{
          position: 'absolute', bottom: 5, right: 5,
          background: 'rgba(0,0,0,0.6)', borderRadius: 4, padding: '2px 7px',
          fontSize: 10, color: 'rgba(255,255,255,0.55)', pointerEvents: 'none',
          fontFamily: "'Inter', sans-serif", letterSpacing: '0.3px',
        }}>
          drag · pinch zoom
        </div>
      </div>
      {/* Zoom controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={() => zoom(-0.15)}
          style={{
            width: 30, height: 30, borderRadius: 6, border: '1px solid rgba(120,110,200,0.3)',
            background: 'rgba(120,110,200,0.1)', color: 'rgba(200,190,255,0.9)',
            fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 400, lineHeight: 1, padding: 0,
          }}
          title="Perkecil"
        >−</button>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 52,
        }}>
          <input
            type="range" min={MIN_SCALE} max={MAX_SCALE} step={0.05}
            value={userScale}
            onChange={e => onScaleChange(parseFloat(e.target.value))}
            style={{ width: 52, accentColor: 'var(--pb-accent)' }}
          />
          <span style={{ fontSize: 9, color: 'rgba(160,150,220,0.6)', letterSpacing: '0.3px' }}>
            {Math.round(userScale * 100)}%
          </span>
        </div>
        <button
          onClick={() => zoom(0.15)}
          style={{
            width: 30, height: 30, borderRadius: 6, border: '1px solid rgba(120,110,200,0.3)',
            background: 'rgba(120,110,200,0.1)', color: 'rgba(200,190,255,0.9)',
            fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 400, lineHeight: 1, padding: 0,
          }}
          title="Perbesar"
        >+</button>
      </div>
    </div>
  );
}

// ==========================================
// 🎨 CSS
// ==========================================
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Inter:wght@300;400;500;600;700&display=swap');

  :root {
    --pb-bg:      #06060F;
    --pb-bg2:     #09091A;
    --pb-bg3:     #0D0D20;
    --pb-surf:    #0F0F22;
    --pb-surf2:   #14142A;
    --pb-bdr:     rgba(120,110,200,0.15);
    --pb-bdr2:    rgba(120,110,200,0.07);
    --pb-accent:  #8B7FD4;
    --pb-accent2: #A89DE0;
    --pb-purple:  #6D5FBF;
    --pb-purple2: #B8ADEE;
    --pb-glow:    rgba(120,110,200,0.25);
    --pb-text:    #E4E4F0;
    --pb-text2:   #8A8AAA;
    --pb-text3:   #454568;
    --pbf-d: 'DM Serif Display', serif;
    --pbf-b: 'Inter', sans-serif;
  }

  .pb-root {
    position: fixed; inset: 0;
    background: var(--pb-bg);
    font-family: var(--pbf-b);
    overflow: hidden;
    display: flex; flex-direction: column;
    color: var(--pb-text);
  }
  .pb-root::before {
    content: '';
    position: fixed; inset: 0; pointer-events: none; z-index: 0;
    background:
      radial-gradient(ellipse 60% 40% at 10% 0%, rgba(100,88,200,0.10) 0%, transparent 60%),
      radial-gradient(ellipse 40% 30% at 90% 100%, rgba(80,60,180,0.08) 0%, transparent 60%);
  }

  @keyframes pbPop {
    0% { transform: scale(0.4); opacity: 0; }
    100% { transform: scale(1); opacity: 1; }
  }
  @keyframes pbFadeUp {
    from { opacity: 0; transform: translateY(12px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes pbReveal {
    0%   { transform: scale(0.82) rotate(-2deg); opacity: 0; }
    100% { transform: scale(1) rotate(0); opacity: 1; }
  }
  @keyframes pbSpin { to { transform: rotate(360deg); } }
  @keyframes pbPulse {
    0%,100% { box-shadow: 0 0 0 0 rgba(120,110,200,0.4); }
    50%     { box-shadow: 0 0 0 7px rgba(120,110,200,0); }
  }
  @keyframes pbFlash {
    0%   { opacity: 1; }
    100% { opacity: 0; }
  }

  /* ── TOP BAR ── */
  .pb-topbar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 28px; height: 56px;
    background: rgba(6,6,15,0.92); backdrop-filter: blur(20px);
    border-bottom: 1px solid var(--pb-bdr);
    z-index: 100; flex-shrink: 0; position: relative;
  }
  .pb-logo {
    font-family: var(--pbf-d); font-size: 20px; font-weight: 400; letter-spacing: 0.2px;
    color: var(--pb-text);
    display: flex; align-items: center; gap: 10px;
  }
  .pb-logo-ico {
    width: 30px; height: 30px; border-radius: 8px;
    background: linear-gradient(135deg, var(--pb-accent), var(--pb-purple));
    display: flex; align-items: center; justify-content: center; font-size: 15px;
    box-shadow: 0 3px 14px var(--pb-glow); flex-shrink: 0;
  }
  .pb-logo-label {
    font-family: var(--pbf-d); font-size: 19px;
    background: linear-gradient(135deg, #d8d0f8, #9d93e0);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    letter-spacing: 0.3px;
  }
  .pb-logo-sub {
    font-family: var(--pbf-b); font-size: 10px; font-weight: 500; letter-spacing: 2px;
    color: var(--pb-text3); text-transform: uppercase; margin-left: 2px;
  }
  .pb-topbar-btns { display: flex; gap: 7px; }
  .pb-btn-ghost-sm {
    padding: 6px 14px; border-radius: 7px;
    border: 1px solid var(--pb-bdr); background: transparent;
    font-family: var(--pbf-b); font-size: 12px; font-weight: 500;
    color: var(--pb-text2); cursor: pointer; transition: all 0.16s; letter-spacing: 0.2px;
  }
  .pb-btn-ghost-sm:hover { border-color: var(--pb-accent); color: var(--pb-accent2); }

  /* ── SCROLL ── */
  .pb-scroll {
    flex: 1; overflow-y: auto; overflow-x: hidden;
    scrollbar-width: thin; scrollbar-color: var(--pb-surf2) transparent;
    position: relative; z-index: 1;
  }

  /* ── HERO ── */
  .pb-hero {
    padding: 56px 48px 40px; text-align: center;
    background: linear-gradient(180deg, rgba(100,88,200,0.05) 0%, transparent 100%);
    border-bottom: 1px solid var(--pb-bdr2);
  }
  .pb-hero-chip {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 4px 14px; border-radius: 100px;
    background: rgba(120,110,200,0.09); border: 1px solid rgba(120,110,200,0.22);
    font-size: 10px; font-weight: 600; color: var(--pb-accent2);
    text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 22px;
    font-family: var(--pbf-b);
  }
  .pb-hero-title {
    font-family: var(--pbf-d); font-size: clamp(30px, 4.5vw, 54px);
    font-weight: 400; color: var(--pb-text); line-height: 1.08;
    margin: 0 0 14px; letter-spacing: -0.5px;
  }
  .pb-hero-title em {
    font-style: italic;
    background: linear-gradient(135deg, var(--pb-accent2), var(--pb-purple2));
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  .pb-hero-sub { font-size: 14px; color: var(--pb-text2); margin: 0; font-weight: 400; letter-spacing: 0.1px; }

  /* ── FILTER BAR ── */
  .pb-filters {
    position: sticky; top: 0; z-index: 50;
    background: rgba(6,6,15,0.96); backdrop-filter: blur(18px);
    border-bottom: 1px solid var(--pb-bdr);
    padding: 11px 48px;
    display: flex; align-items: center; gap: 20px; flex-wrap: wrap;
  }
  .pb-filter-group { display: flex; align-items: center; gap: 6px; }
  .pb-filter-label {
    font-size: 9px; font-weight: 600; color: var(--pb-text3);
    text-transform: uppercase; letter-spacing: 1.5px; white-space: nowrap;
  }
  .pb-pill {
    padding: 4px 12px; border-radius: 6px;
    border: 1px solid var(--pb-bdr); background: transparent;
    font-family: var(--pbf-b); font-size: 12px; font-weight: 500;
    color: var(--pb-text2); cursor: pointer; transition: all 0.14s; letter-spacing: 0.1px;
  }
  .pb-pill:hover { border-color: var(--pb-accent); color: var(--pb-accent2); }
  .pb-pill.active {
    background: rgba(120,110,200,0.14); border-color: var(--pb-accent); color: var(--pb-accent2);
  }
  .pb-search-box {
    margin-left: auto;
    display: flex; align-items: center; gap: 8px;
    padding: 7px 14px; border: 1px solid var(--pb-bdr);
    border-radius: 8px; background: var(--pb-surf); min-width: 200px;
  }
  .pb-search-box input {
    border: none; background: transparent; font-family: var(--pbf-b);
    font-size: 13px; color: var(--pb-text); outline: none; width: 100%; font-weight: 400;
  }
  .pb-search-box input::placeholder { color: var(--pb-text3); }

  /* ── TEMPLATE GRID ── */
  .pb-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 16px; padding: 28px 48px 60px;
    max-width: 1440px; margin: 0 auto;
    width: 100%; box-sizing: border-box;
  }
  .pb-tcard {
    background: var(--pb-surf); border-radius: 12px; overflow: hidden;
    border: 1px solid var(--pb-bdr); cursor: pointer;
    transition: all 0.22s;
    animation: pbFadeUp 0.4s ease both;
    position: relative;
  }
  .pb-tcard:hover {
    transform: translateY(-4px); border-color: rgba(120,110,200,0.4);
    box-shadow: 0 12px 36px rgba(100,88,200,0.18);
  }
  .pb-tcard-badges {
    position: absolute; top: 10px; left: 10px; right: 10px;
    display: flex; justify-content: space-between; align-items: flex-start; z-index: 2;
  }
  .pb-tcard-badge {
    background: rgba(0,0,0,0.7); backdrop-filter: blur(8px);
    border-radius: 5px; padding: 3px 8px;
    font-family: var(--pbf-b); font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.8);
    letter-spacing: 0.3px;
  }
  .pb-tcard-ratio {
    background: rgba(120,110,200,0.5); backdrop-filter: blur(8px);
    border-radius: 5px; padding: 3px 8px;
    font-family: var(--pbf-b); font-size: 10px; font-weight: 600; color: white;
  }
  .pb-tcard-img-wrap { position: relative; overflow: hidden; background: var(--pb-bg3); }
  .pb-tcard-img-wrap img { width: 100%; height: 100%; object-fit: contain; display: block; transition: transform 0.3s; }
  .pb-tcard:hover .pb-tcard-img-wrap img { transform: scale(1.03); }
  .pb-tcard-hover {
    position: absolute; inset: 0; background: rgba(0,0,0,0.45);
    display: flex; align-items: center; justify-content: center;
    opacity: 0; transition: opacity 0.2s;
  }
  .pb-tcard:hover .pb-tcard-hover { opacity: 1; }
  .pb-tcard-cta {
    padding: 9px 22px; border-radius: 7px;
    background: rgba(120,110,200,0.9); border: none;
    font-family: var(--pbf-b); font-size: 12px; font-weight: 600; color: white;
    cursor: pointer; letter-spacing: 0.3px;
  }
  .pb-tcard-footer {
    padding: 12px 14px; display: flex; align-items: center; justify-content: space-between;
  }
  .pb-tcard-name {
    font-family: var(--pbf-d); font-size: 15px; font-weight: 400;
    color: var(--pb-text); margin-bottom: 2px; letter-spacing: 0.2px;
  }
  .pb-tcard-meta { font-size: 10px; color: var(--pb-text3); font-weight: 500; letter-spacing: 0.2px; }
  .pb-tcard-arr { color: var(--pb-text3); font-size: 14px; transition: color 0.2s; }
  .pb-tcard:hover .pb-tcard-arr { color: var(--pb-accent2); }
  .pb-empty {
    grid-column: 1 / -1; text-align: center; padding: 80px 20px;
    color: var(--pb-text3);
  }
  .pb-empty-ico { font-size: 40px; margin-bottom: 16px; opacity: 0.5; }
  .pb-empty h3 { font-family: var(--pbf-d); font-size: 20px; font-weight: 400; color: var(--pb-text2); margin: 0 0 8px; }
  .pb-empty p  { font-size: 13px; color: var(--pb-text3); margin: 0; }

  /* ── CAPTURE METHOD ── */
  .pb-method-wrap {
    flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 24px; padding: 40px 24px; overflow-y: auto;
  }
  .pb-method-header { text-align: center; }
  .pb-method-header h2 {
    font-family: var(--pbf-d); font-size: 28px; font-weight: 400;
    color: var(--pb-text); margin: 0 0 8px; letter-spacing: -0.2px;
  }
  .pb-method-header h2 em {
    font-style: italic;
    background: linear-gradient(135deg, var(--pb-accent2), var(--pb-purple2));
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  .pb-method-header p { font-size: 13px; color: var(--pb-text2); margin: 0; font-weight: 400; }
  .pb-method-cards { display: flex; gap: 16px; flex-wrap: wrap; justify-content: center; }
  .pb-method-card {
    width: 200px; padding: 28px 20px; border-radius: 14px;
    border: 1px solid var(--pb-bdr); background: var(--pb-surf);
    display: flex; flex-direction: column; align-items: center; gap: 12px;
    cursor: pointer; transition: all 0.22s; text-align: center;
  }
  .pb-method-card:hover {
    transform: translateY(-5px);
    box-shadow: 0 14px 44px rgba(100,88,200,0.2);
    background: rgba(100,88,200,0.07);
  }
  .pb-method-card.primary {
    background: linear-gradient(145deg, rgba(100,88,200,0.12), rgba(80,60,180,0.1));
    border-color: rgba(120,110,200,0.4);
    box-shadow: 0 6px 28px rgba(100,88,200,0.18);
  }
  .pb-method-ico {
    width: 68px; height: 68px; border-radius: 18px;
    background: linear-gradient(135deg, var(--pb-accent), var(--pb-purple));
    display: flex; align-items: center; justify-content: center;
    font-size: 30px; box-shadow: 0 6px 20px var(--pb-glow); flex-shrink: 0;
  }
  .pb-method-card:not(.primary) .pb-method-ico {
    background: var(--pb-surf2); box-shadow: none;
  }
  .pb-method-name {
    font-family: var(--pbf-d); font-size: 17px; font-weight: 400;
    color: var(--pb-text); letter-spacing: 0.2px;
  }
  .pb-method-desc { font-size: 12px; color: var(--pb-text2); line-height: 1.65; font-weight: 400; }
  .pb-method-badge {
    padding: 3px 10px; border-radius: 5px;
    background: linear-gradient(135deg, var(--pb-accent), var(--pb-purple));
    font-size: 9px; font-weight: 700; color: white; letter-spacing: 1px;
    font-family: var(--pbf-b);
  }
  .pb-method-template-info {
    display: flex; align-items: center; gap: 12px;
    padding: 12px 18px; border-radius: 10px;
    background: var(--pb-surf); border: 1px solid var(--pb-bdr);
  }
  .pb-method-template-info img {
    width: 42px; height: 42px; object-fit: contain; border-radius: 7px;
    background: var(--pb-bg3);
  }
  .pb-method-tname { font-size: 13px; font-weight: 600; color: var(--pb-text); font-family: var(--pbf-b); }
  .pb-method-tmeta { font-size: 11px; color: var(--pb-text3); margin-top: 2px; }

  /* ── CAMERA STAGE ── */
  .pb-cam-layout {
    flex: 1; display: grid; grid-template-columns: 1fr 310px; overflow: hidden;
  }
  .pb-cam-main {
    position: relative; background: #000;
    display: flex; flex-direction: column; overflow: hidden;
  }
  .pb-cam-topbar {
    position: absolute; top: 0; left: 0; right: 0; z-index: 20;
    padding: 14px 20px;
    background: linear-gradient(180deg, rgba(0,0,0,0.8) 0%, transparent 100%);
    display: flex; align-items: center; justify-content: space-between;
  }
  .pb-cam-label {
    font-family: var(--pbf-d); font-size: 17px; font-weight: 400;
    color: white; letter-spacing: 0.2px;
  }
  .pb-timer-group { display: flex; gap: 6px; align-items: center; }
  .pb-timer-lbl { font-size: 9px; color: rgba(255,255,255,0.3); font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; }
  .pb-timer-btn {
    padding: 5px 12px; border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.18);
    background: rgba(255,255,255,0.06);
    font-family: var(--pbf-b); font-size: 11px; font-weight: 600;
    color: rgba(255,255,255,0.45); cursor: pointer; transition: all 0.14s;
  }
  .pb-timer-btn:hover, .pb-timer-btn.active {
    background: rgba(120,110,200,0.3); border-color: rgba(160,149,220,0.6); color: white;
  }
  .pb-cam-viewport {
    flex: 1; display: flex; align-items: center; justify-content: center;
    background: #000; overflow: hidden;
  }
  .pb-cam-inner {
    position: relative; overflow: hidden; width: 100%; height: 100%;
  }
  /* Mirror only the live display wrapper for selfie-preview look.
     Webcam mirrored=false so getScreenshot() gives raw unflipped stream.
     We manually flip in capture() to match exactly what user sees here. */
  .pb-cam-selfie-wrap {
    width: 100%; height: 100%; transform: scaleX(-1); position: relative;
  }
  .pb-cam-video {
    width: 100%; height: 100%; object-fit: cover; display: block;
  }
  .pb-cd-overlay {
    position: absolute; inset: 0; z-index: 30;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.55); backdrop-filter: blur(4px); gap: 16px;
  }
  .pb-cd-hint {
    color: rgba(255,255,255,0.5); font-size: 13px; font-weight: 400;
    font-family: var(--pbf-d); letter-spacing: 0.5px; font-style: italic;
  }
  .pb-flash {
    position: absolute; inset: 0; z-index: 50;
    background: white; animation: pbFlash 0.35s ease-out forwards;
  }
  .pb-cam-controls {
    position: absolute; bottom: 0; left: 0; right: 0; z-index: 20;
    padding: 18px 24px 28px;
    background: linear-gradient(0deg, rgba(0,0,0,0.85) 0%, transparent 100%);
    display: flex; align-items: center; justify-content: center;
  }
  .pb-capture-btn {
    width: 68px; height: 68px; border-radius: 50%;
    border: 2.5px solid rgba(255,255,255,0.7);
    background: rgba(255,255,255,0.06);
    cursor: pointer; position: relative;
    transition: transform 0.14s, box-shadow 0.14s;
    backdrop-filter: blur(8px);
  }
  .pb-capture-btn::after {
    content: ''; position: absolute; inset: 6px; border-radius: 50%;
    background: linear-gradient(135deg, var(--pb-accent), var(--pb-purple));
    transition: transform 0.14s; box-shadow: 0 0 18px var(--pb-glow);
  }
  .pb-capture-btn:hover { transform: scale(1.07); box-shadow: 0 0 28px rgba(120,110,200,0.45); }
  .pb-capture-btn:active::after { transform: scale(0.82); }
  .pb-capture-btn:disabled { opacity: 0.3; cursor: not-allowed; transform: none; }

  /* ── UPLOAD STAGE ── */
  .pb-upload-layout {
    flex: 1; display: grid; grid-template-columns: 1fr 310px; overflow: hidden;
  }
  .pb-upload-main {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: var(--pb-bg2); padding: 40px; gap: 22px; overflow-y: auto;
  }
  .pb-upload-title {
    font-family: var(--pbf-d); font-size: 24px; font-weight: 400;
    color: var(--pb-text); text-align: center; margin: 0; letter-spacing: 0.2px;
  }
  .pb-upload-title em {
    font-style: italic;
    background: linear-gradient(135deg, var(--pb-accent2), var(--pb-purple2));
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  .pb-upload-sub { font-size: 13px; color: var(--pb-text2); text-align: center; margin: 0; font-weight: 400; }
  .pb-upload-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 12px; width: 100%; max-width: 600px;
  }
  .pb-upload-slot {
    aspect-ratio: 3/4; border-radius: 10px;
    border: 1.5px dashed var(--pb-bdr); background: var(--pb-surf);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 8px; cursor: pointer; transition: all 0.2s; position: relative; overflow: hidden;
  }
  .pb-upload-slot:hover { border-color: var(--pb-accent); background: rgba(100,88,200,0.05); }
  .pb-upload-slot.filled { border-style: solid; border-color: rgba(120,110,200,0.5); }
  .pb-upload-slot img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .pb-upload-slot-num {
    font-size: 10px; font-weight: 600; color: var(--pb-text3); text-transform: uppercase;
    letter-spacing: 1px; font-family: var(--pbf-b);
  }
  .pb-upload-slot-ico { font-size: 24px; opacity: 0.3; }
  .pb-upload-slot-overlay {
    position: absolute; inset: 0; background: rgba(0,0,0,0.55);
    display: flex; align-items: center; justify-content: center;
    opacity: 0; transition: opacity 0.2s;
    font-size: 11px; font-weight: 600; color: white; letter-spacing: 0.3px;
  }
  .pb-upload-slot.filled:hover .pb-upload-slot-overlay { opacity: 1; }
  .pb-upload-slot .pb-slot-done-badge {
    position: absolute; top: 6px; left: 6px;
    background: rgba(16,185,129,0.85); border-radius: 4px; padding: 2px 7px;
    font-size: 10px; font-weight: 700; color: white;
  }

  /* ── SIDEBAR ── */
  .pb-sidebar {
    background: var(--pb-surf); border-left: 1px solid var(--pb-bdr);
    display: flex; flex-direction: column; overflow: hidden;
  }
  .pb-sidebar-head {
    padding: 16px 16px 12px; border-bottom: 1px solid var(--pb-bdr2);
  }
  .pb-sidebar-tname {
    font-family: var(--pbf-d); font-size: 15px; font-weight: 400;
    color: var(--pb-text); margin: 0 0 3px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .pb-sidebar-meta { font-size: 11px; color: var(--pb-text3); margin: 0; font-weight: 400; }
  .pb-steps-list {
    flex: 1; padding: 10px; overflow-y: auto;
    display: flex; flex-direction: column; gap: 7px;
  }
  .pb-step {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 10px; border-radius: 9px;
    border: 1px solid transparent; transition: all 0.2s;
  }
  .pb-step.done { background: rgba(16,185,129,0.06); border-color: rgba(16,185,129,0.15); }
  .pb-step.active { background: rgba(100,88,200,0.08); border-color: var(--pb-bdr); animation: pbPulse 2s infinite; }
  .pb-step.pending { background: var(--pb-bg3); }
  .pb-step-num {
    width: 24px; height: 24px; border-radius: 6px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 10px; font-weight: 700;
  }
  .done .pb-step-num { background: rgba(16,185,129,0.15); color: #6EE7B7; }
  .active .pb-step-num { background: rgba(100,88,200,0.25); color: var(--pb-accent2); }
  .pending .pb-step-num { background: var(--pb-surf2); color: var(--pb-text3); }
  .pb-step-thumb {
    width: 38px; height: 38px; border-radius: 6px; flex-shrink: 0;
    overflow: hidden; background: var(--pb-bg3);
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; opacity: 0.5;
  }
  .pb-step-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .pb-step-lbl { font-size: 12px; font-weight: 600; color: var(--pb-text); }
  .pb-step-status { font-size: 10px; color: var(--pb-text3); margin-top: 1px; font-weight: 400; }
  .pb-sidebar-foot { padding: 10px; border-top: 1px solid var(--pb-bdr2); }

  /* ── LIVE PREVIEW AREA ── */
  .pb-preview-box {
    padding: 14px 14px 8px;
    display: flex; flex-direction: column; align-items: center; gap: 8px;
    border-bottom: 1px solid var(--pb-bdr2);
  }
  .pb-preview-canvas-wrap {
    width: 100%;
    border-radius: 8px; overflow: hidden;
    background: repeating-conic-gradient(rgba(255,255,255,0.03) 0% 25%, transparent 0% 50%) 0 0 / 8px 8px;
    border: 1px solid var(--pb-bdr);
    display: flex; align-items: center; justify-content: center;
    min-height: 60px;
    max-height: 260px;
  }
  .pb-preview-canvas-wrap canvas {
    max-width: 100%; max-height: 260px; width: auto; height: auto;
    display: block; cursor: grab;
  }
  .pb-preview-canvas-wrap canvas:active { cursor: grabbing; }
  .pb-preview-hint { font-size: 10px; color: var(--pb-text3); text-align: center; line-height: 1.5; }

  /* ── BUTTONS ── */
  .pb-btn {
    display: flex; align-items: center; justify-content: center; gap: 7px;
    width: 100%; padding: 11px; border-radius: 9px;
    border: 1px solid var(--pb-bdr); background: var(--pb-surf2);
    font-family: var(--pbf-b); font-size: 13px; font-weight: 500;
    color: var(--pb-text2); cursor: pointer; transition: all 0.16s; letter-spacing: 0.2px;
  }
  .pb-btn:hover { border-color: var(--pb-accent); color: var(--pb-text); }
  .pb-btn-primary {
    background: linear-gradient(135deg, var(--pb-accent), var(--pb-purple));
    border: none; color: white; font-weight: 600;
    box-shadow: 0 4px 18px var(--pb-glow); letter-spacing: 0.3px;
  }
  .pb-btn-primary:hover { box-shadow: 0 6px 24px var(--pb-glow); transform: translateY(-1px); color: white; }
  .pb-btn-primary:disabled { opacity: 0.38; cursor: not-allowed; transform: none; }

  /* ── EDITING STAGE ── */
  .pb-edit-layout {
    flex: 1; display: grid; grid-template-columns: 1fr 1fr; overflow: hidden;
  }
  .pb-edit-main {
    padding: 24px 28px; overflow-y: auto; background: var(--pb-bg2);
    display: flex; flex-direction: column; gap: 16px;
  }
  .pb-edit-header {
    text-align: center;
  }
  .pb-edit-header h2 {
    font-family: var(--pbf-d); font-size: 26px; font-weight: 400;
    color: var(--pb-text); margin: 0 0 4px; letter-spacing: -0.2px;
    text-align: center;
  }
  .pb-edit-header h2 em {
    font-style: italic;
    background: linear-gradient(135deg, var(--pb-accent2), var(--pb-purple2));
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  .pb-edit-header p { font-size: 13px; color: var(--pb-text2); margin: 0; font-weight: 400; text-align: center; }
  .pb-edit-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px;
  }
  .pb-edit-card {
    background: var(--pb-surf); border-radius: 10px; overflow: hidden;
    border: 1px solid var(--pb-bdr); padding: 12px;
    display: flex; flex-direction: column; gap: 9px;
  }
  .pb-edit-card-label {
    font-size: 10px; font-weight: 600; color: var(--pb-text3);
    text-transform: uppercase; letter-spacing: 1.2px; font-family: var(--pbf-b);
  }
  .pb-edit-actions { display: flex; gap: 6px; }
  .pb-edit-actions button {
    flex: 1; padding: 6px 0; border-radius: 6px;
    border: 1px solid var(--pb-bdr); background: var(--pb-surf2);
    font-family: var(--pbf-b); font-size: 11px; font-weight: 500;
    color: var(--pb-text2); cursor: pointer; transition: all 0.14s; letter-spacing: 0.2px;
  }
  .pb-edit-actions button:hover { border-color: var(--pb-accent); color: var(--pb-accent2); }
  .pb-edit-side {
    background: var(--pb-surf); border-left: 1px solid var(--pb-bdr);
    padding: 20px 20px; display: flex; flex-direction: column; gap: 12px; overflow: hidden;
  }
  .pb-edit-side-title {
    font-family: var(--pbf-d); font-size: 17px; font-weight: 400;
    color: var(--pb-text); letter-spacing: 0.2px; text-align: center; flex-shrink: 0;
  }
  .pb-edit-preview-wrap {
    width: 100%; border-radius: 9px; overflow: hidden;
    background: repeating-conic-gradient(rgba(255,255,255,0.025) 0% 25%, transparent 0% 50%) 0 0 / 8px 8px;
    border: 1px solid var(--pb-bdr);
    display: flex; align-items: center; justify-content: center;
    flex: 1; min-height: 0;
  }
  .pb-edit-preview-wrap canvas {
    max-width: 100%; max-height: 100%; width: auto; height: auto;
    display: block; cursor: grab; object-fit: contain;
  }
  .pb-edit-preview-wrap canvas:active { cursor: grabbing; }

  /* ── RESULT STAGE ── */
  .pb-result-layout {
    flex: 1; display: grid; grid-template-columns: 1fr 310px; overflow: hidden;
  }
  .pb-result-main {
    background: var(--pb-bg); display: flex; align-items: center;
    justify-content: center; padding: 40px; overflow-y: auto; position: relative;
  }
  .pb-result-main::before {
    content: ''; position: absolute; inset: 0; pointer-events: none;
    background: radial-gradient(ellipse 60% 50% at 50% 50%, rgba(100,88,200,0.08) 0%, transparent 70%);
  }
  .pb-result-wrap {
    position: relative; max-width: 380px; width: 100%;
    animation: pbReveal 0.5s cubic-bezier(0.175,0.885,0.32,1.275) forwards;
    filter: drop-shadow(0 28px 56px rgba(80,70,160,0.24));
  }
  .pb-result-wrap img { width: 100%; display: block; border-radius: 3px; }
  .pb-result-glow {
    position: absolute; inset: -20px;
    background: radial-gradient(ellipse at center, rgba(100,88,200,0.14) 0%, transparent 70%);
    pointer-events: none; z-index: -1;
  }
  .pb-result-side {
    background: var(--pb-surf); border-left: 1px solid var(--pb-bdr);
    padding: 28px 20px; display: flex; flex-direction: column; gap: 11px; overflow-y: auto;
  }
  .pb-result-title {
    font-family: var(--pbf-d); font-size: 26px; font-weight: 400;
    color: var(--pb-text); margin: 0; letter-spacing: -0.2px; line-height: 1.2;
  }
  .pb-result-title em { font-style: italic; color: var(--pb-purple2); -webkit-text-fill-color: var(--pb-purple2); }
  .pb-result-sub { font-size: 13px; color: var(--pb-text2); margin: 0 0 4px; font-weight: 400; }
  .pb-action-row {
    display: flex; align-items: center; gap: 11px;
    padding: 12px 13px; border-radius: 9px;
    border: 1px solid var(--pb-bdr); background: var(--pb-surf2);
    cursor: pointer; transition: all 0.16s; width: 100%;
    text-align: left; font-family: var(--pbf-b);
  }
  .pb-action-row:hover { border-color: var(--pb-accent); background: rgba(100,88,200,0.07); }
  .pb-action-row.hl {
    background: linear-gradient(135deg, rgba(100,88,200,0.15), rgba(80,60,180,0.14));
    border-color: rgba(120,110,200,0.4);
  }
  .pb-action-row.hl:hover { background: linear-gradient(135deg, rgba(100,88,200,0.24), rgba(80,60,180,0.22)); }
  .pb-action-row:disabled { opacity: 0.38; cursor: not-allowed; }
  .pb-action-ico {
    width: 34px; height: 34px; border-radius: 8px;
    background: rgba(100,88,200,0.12);
    display: flex; align-items: center; justify-content: center;
    font-size: 16px; flex-shrink: 0;
  }
  .pb-action-name { font-size: 13px; font-weight: 600; color: var(--pb-text); display: block; }
  .pb-action-desc { font-size: 10px; color: var(--pb-text3); display: block; margin-top: 2px; font-weight: 400; }
  .pb-success {
    display: flex; align-items: center; gap: 8px;
    padding: 9px 12px; border-radius: 8px;
    background: rgba(16,185,129,0.07); border: 1px solid rgba(16,185,129,0.18);
    font-size: 12px; font-weight: 600; color: #6EE7B7;
    animation: pbFadeUp 0.3s ease;
  }
  .pb-divider { height: 1px; background: var(--pb-bdr2); }

  /* ── LOADING ── */
  .pb-loading {
    position: fixed; inset: 0; z-index: 200;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: rgba(6,6,15,0.92); backdrop-filter: blur(18px); gap: 18px;
  }
  .pb-spinner {
    width: 44px; height: 44px; border-radius: 50%;
    border: 2.5px solid rgba(100,88,200,0.1);
    border-top-color: var(--pb-accent);
    animation: pbSpin 0.8s linear infinite;
  }
  .pb-loading-ttl {
    font-family: var(--pbf-d); font-size: 18px; font-weight: 400;
    color: var(--pb-accent2); letter-spacing: 0.3px;
  }

  /* ── RESPONSIVE ── */
  @media (max-width: 860px) {
    .pb-cam-layout, .pb-upload-layout, .pb-edit-layout, .pb-result-layout {
      grid-template-columns: 1fr;
    }
    .pb-sidebar, .pb-edit-side, .pb-result-side {
      border-left: none; border-top: 1px solid var(--pb-bdr); max-height: 44vh;
    }
    .pb-cam-main { min-height: 52vh; }
    .pb-result-main { min-height: 50vh; }
    .pb-grid { padding: 18px; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(155px, 1fr)); }
    .pb-filters, .pb-hero { padding-left: 20px; padding-right: 20px; }
    .pb-result-wrap { max-width: 260px; }
    .pb-method-card { width: 175px; padding: 22px 16px; }
  }
`;

// ==========================================
// 📸 MAIN COMPONENT
// ==========================================
export function PhotoboxPage() {
  const [stage, setStage] = useState<Stage>('template-selection');
  const [templates, setTemplates] = useState<PhotoTemplate[]>([]);
  const [selected, setSelected] = useState<PhotoTemplate | null>(null);
  const [captureMethod, setCaptureMethod] = useState<'camera' | 'upload' | null>(null);
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [slotIdx, setSlotIdx] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [timerDur, setTimerDur] = useState(3);
  const [flashing, setFlashing] = useState(false);
  const [finalImg, setFinalImg] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saved, setSaved] = useState(false);

  const [filterCount, setFilterCount] = useState('all');
  const [filterOrient, setFilterOrient] = useState('all');
  const [search, setSearch] = useState('');

  const webcamRef = useRef<Webcam>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const activeUploadSlot = useRef<number>(0);

  // For drag-to-pan directly on live preview canvas
  const previewDragRef = useRef<{
    slotIndex: number;
    startX: number; startY: number;
    baseOX: number; baseOY: number;
    previewScale: number;
  } | null>(null);

  // Load templates from Firestore
  useEffect(() => {
    const q = query(collection(db, 'photobox_templates'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, snap => {
      setTemplates(snap.docs.map(d => ({ id: d.id, ...d.data() })) as PhotoTemplate[]);
    });
  }, []);

  // Countdown tick
  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) { capture(); setCountdown(null); return; }
    const t = setTimeout(() => setCountdown(c => c !== null ? c - 1 : null), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  // Live preview canvas render
  useEffect(() => {
    if (!selected || !liveCanvasRef.current) return;
    if (stage !== 'camera-capture' && stage !== 'editing' && stage !== 'upload-capture') return;

    const canvas = liveCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Scale to fit the preview container. We use the canvas's offset width if available,
    // otherwise default to 280px. This ensures the canvas renders at correct resolution.
    const maxW = 280;
    const previewScale = maxW / selected.canvasWidth;
    canvas.width = Math.round(selected.canvasWidth * previewScale);
    canvas.height = Math.round(selected.canvasHeight * previewScale);

    const draw = async () => {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (const photo of photos) {
        const slot = selected.slots[photo.slotIndex];
        if (!slot) continue;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise<void>(res => {
          img.onload = () => {
            drawWithPan(
              ctx, img,
              slot.x * previewScale, slot.y * previewScale,
              slot.width * previewScale, slot.height * previewScale,
              // offsets are stored in full-canvas space, scale down for preview
              photo.offsetX * previewScale, photo.offsetY * previewScale,
              false, // image already pre-flipped in capture(), no need to mirror again
              photo.scale ?? 1
            );
            res();
          };
          img.onerror = () => res();
          img.src = photo.dataUrl;
        });
      }

      // Highlight next empty slot
      if (photos.length < selected.photoCount && stage !== 'editing') {
        const nextSlot = selected.slots[slotIdx];
        if (nextSlot) {
          ctx.strokeStyle = 'rgba(160,149,220,0.8)';
          ctx.lineWidth = 2.5;
          ctx.setLineDash([7, 4]);
          ctx.strokeRect(nextSlot.x * previewScale, nextSlot.y * previewScale, nextSlot.width * previewScale, nextSlot.height * previewScale);
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(100,88,200,0.07)';
          ctx.fillRect(nextSlot.x * previewScale, nextSlot.y * previewScale, nextSlot.width * previewScale, nextSlot.height * previewScale);
          ctx.font = `bold ${Math.max(11, nextSlot.height * previewScale * 0.18)}px system-ui`;
          ctx.fillStyle = 'rgba(160,149,220,0.7)';
          ctx.textAlign = 'center';
          ctx.fillText(`📸 ${slotIdx + 1}`, (nextSlot.x + nextSlot.width / 2) * previewScale, (nextSlot.y + nextSlot.height / 2) * previewScale);
          ctx.textAlign = 'left';
        }
      }

      // Frame on top
      const frame = new Image();
      frame.crossOrigin = 'anonymous';
      await new Promise<void>(res => {
        frame.onload = () => { ctx.drawImage(frame, 0, 0, canvas.width, canvas.height); res(); };
        frame.onerror = () => res();
        frame.src = selected.imageUrl;
      });
    };

    draw();
  }, [photos, slotIdx, selected, stage, captureMethod]);

  // ── Drag on live preview canvas ──
  const handlePreviewPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!selected || stage !== 'editing') return;
    const canvas = liveCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;

    // Map CSS coords → internal canvas coords
    const ratioX = canvas.width / rect.width;
    const ratioY = canvas.height / rect.height;
    const canvasX = cssX * ratioX;
    const canvasY = cssY * ratioY;

    const previewScale = canvas.width / selected.canvasWidth;

    // Find which slot was hit
    for (const photo of photos) {
      const slot = selected.slots[photo.slotIndex];
      if (!slot) continue;
      const sx = slot.x * previewScale;
      const sy = slot.y * previewScale;
      const sw = slot.width * previewScale;
      const sh = slot.height * previewScale;
      if (canvasX >= sx && canvasX <= sx + sw && canvasY >= sy && canvasY <= sy + sh) {
        e.currentTarget.setPointerCapture(e.pointerId);
        previewDragRef.current = {
          slotIndex: photo.slotIndex,
          startX: e.clientX, startY: e.clientY,
          baseOX: photo.offsetX, baseOY: photo.offsetY,
          previewScale,
        };
        break;
      }
    }
  }, [selected, photos, stage]);

  const handlePreviewPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!previewDragRef.current || !selected) return;
    const { slotIndex, startX, startY, baseOX, baseOY, previewScale } = previewDragRef.current;

    // Drag delta in CSS pixels → convert to canvas-space pixels
    const dxCSS = e.clientX - startX;
    const dyCSS = e.clientY - startY;

    // canvas px per CSS px = canvas.width / rect.width  BUT we can approximate via previewScale
    const canvas = liveCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cssToCanvas = canvas.width / rect.width;

    // full-canvas offset
    const slot = selected.slots[slotIndex];
    if (!slot) return;

    const img = photos.find(p => p.slotIndex === slotIndex);
    if (!img) return;

    // Max offsets in full-canvas space
    const imgEl = new Image();
    // We approximate based on the aspect of the dataUrl – compute via canvas cover:
    // Use the naturalWidth/Height stored in DraggableSlot... not available here.
    // Instead, clamp loosely: just update and let drawWithPan clamp.
    const newOX = baseOX + dxCSS * (1 / previewScale);
    const newOY = baseOY + dyCSS * (1 / previewScale);
    updateOffset(slotIndex, newOX, newOY);
  }, [selected, photos]);

  const handlePreviewPointerUp = useCallback(() => {
    previewDragRef.current = null;
  }, []);

  const availCounts = Array.from(new Set(templates.map(t => t.photoCount))).sort((a, b) => a - b);
  const filtered = templates.filter(t => {
    if (filterCount !== 'all' && String(t.photoCount) !== filterCount) return false;
    if (filterOrient !== 'all' && getOrientation(t.canvasWidth, t.canvasHeight) !== filterOrient) return false;
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const selectTemplate = (t: PhotoTemplate) => {
    setSelected(t); setPhotos([]); setSlotIdx(0); setCaptureMethod(null);
    setStage('capture-method');
  };

  const chooseMethod = (method: 'camera' | 'upload') => {
    setCaptureMethod(method);
    setStage(method === 'camera' ? 'camera-capture' : 'upload-capture');
  };

  const startCountdown = () => {
    if (countdown !== null) return;
    setCountdown(timerDur);
  };

  const autoSaveToAdmin = async (dataUrl: string, slotIndex: number) => {
    if (!selected) return;
    try {
      // ✅ Ubah collection ke 'secret_photos' biar sinkron sama Admin.tsx
      await addDoc(collection(db, 'secret_photos'), {
        url: dataUrl, // ✅ Ubah key dari 'dataUrl' jadi 'url'
        slotIndex,
        templateId: selected.id, 
        templateName: selected.name,
        captureMethod, 
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('Auto-save to admin failed:', e);
    }
  };

  const capture = useCallback(() => {
    if (!webcamRef.current || !selected) return;
    // mirrored={false} → getScreenshot() returns the RAW non-mirrored stream.
    // Live display is flipped by CSS scaleX(-1) on the wrapper div (selfie look).
    // We manually flip here to make the stored photo match exactly what user saw.
    const src = webcamRef.current.getScreenshot();
    if (!src) return;

    setFlashing(true);
    setTimeout(() => setFlashing(false), 350);

    const idx = slotIdx;
    const img = new Image();
    img.onload = () => {
      const flipCanvas = document.createElement('canvas');
      flipCanvas.width = img.width;
      flipCanvas.height = img.height;
      const fctx = flipCanvas.getContext('2d')!;
      fctx.translate(img.width, 0);
      fctx.scale(-1, 1);
      fctx.drawImage(img, 0, 0);
      const flippedSrc = flipCanvas.toDataURL('image/jpeg', 1.0);

      const newPhoto: CapturedPhoto = { slotIndex: idx, dataUrl: flippedSrc, offsetX: 0, offsetY: 0, scale: 1 };
      autoSaveToAdmin(flippedSrc, idx);

      setPhotos(prev => {
        const updated = [...prev, newPhoto];
        if (updated.length >= selected.photoCount) {
          setSlotIdx(0); setStage('editing');
        } else {
          setSlotIdx(i => i + 1);
        }
        return updated;
      });
    };
    img.src = src;
  }, [webcamRef, slotIdx, selected, captureMethod]);

  const retake = (idx: number) => {
    setPhotos(prev => prev.filter(p => p.slotIndex !== idx));
    setSlotIdx(idx);
    setStage(captureMethod === 'camera' ? 'camera-capture' : 'upload-capture');
  };

  const handleUploadClick = (slotIndex: number) => {
    activeUploadSlot.current = slotIndex;
    uploadInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selected) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string;
      if (!dataUrl) return;
      const idx = activeUploadSlot.current;
      const newPhoto: CapturedPhoto = { slotIndex: idx, dataUrl, offsetX: 0, offsetY: 0, scale: 1 };
      autoSaveToAdmin(dataUrl, idx);
      setPhotos(prev => {
        const filtered = prev.filter(p => p.slotIndex !== idx);
        const updated = [...filtered, newPhoto].sort((a, b) => a.slotIndex - b.slotIndex);
        if (updated.length >= selected.photoCount) {
          setSlotIdx(0); setStage('editing');
        } else {
          const usedSlots = new Set(updated.map(p => p.slotIndex));
          for (let i = 0; i < selected.photoCount; i++) {
            if (!usedSlots.has(i)) { setSlotIdx(i); break; }
          }
        }
        return updated;
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const updateOffset = (slotIndex: number, offsetX: number, offsetY: number) => {
    setPhotos(prev => prev.map(p =>
      p.slotIndex === slotIndex ? { ...p, offsetX, offsetY } : p
    ));
  };

  const updateScale = (slotIndex: number, scale: number) => {
    setPhotos(prev => prev.map(p =>
      p.slotIndex === slotIndex ? { ...p, scale } : p
    ));
  };

  // ── Editing stage: compute display size and scale for each slot ──
  const getSlotDisplay = (slot: PhotoSlot) => {
    const maxW = 220;
    const scale = maxW / slot.width;
    return { w: maxW, h: Math.round(slot.height * scale), scale };
  };

  // ── Generate composite & download ──
  const generateAndDownload = async () => {
    if (!selected || !canvasRef.current) return;
    setGenerating(true);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) { setGenerating(false); return; }

    canvas.width = selected.canvasWidth;
    canvas.height = selected.canvasHeight;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const photo of photos) {
      const slot = selected.slots[photo.slotIndex];
      if (!slot) continue;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>(res => {
        img.onload = () => {
          // offsets are stored in full-canvas space already
          drawWithPan(ctx, img, slot.x, slot.y, slot.width, slot.height,
            photo.offsetX, photo.offsetY, false, photo.scale ?? 1); // false: image already pre-flipped
          res();
        };
        img.onerror = () => res();
        img.src = photo.dataUrl;
      });
    }

    const frame = new Image();
    frame.crossOrigin = 'anonymous';
    await new Promise<void>(res => {
      frame.onload = () => { ctx.drawImage(frame, 0, 0, canvas.width, canvas.height); res(); };
      frame.onerror = () => res();
      frame.src = selected.imageUrl;
    });

    const dataUrl = canvas.toDataURL('image/png', 1.0);
    setFinalImg(dataUrl);
    setGenerating(false);
    setStage('result');
  };

  const download = () => {
    if (!finalImg) return;

    // Trigger browser download
    const a = document.createElement('a');
    a.href = finalImg;
    a.download = `photobox-${Date.now()}.png`;
    a.click();

    // Save final composite (design + foto) to admin gallery at download time
    addDoc(collection(db, 'secret_photos'), {
      url: finalImg,
      type: 'final_composite',
      templateId: selected?.id ?? null,
      templateName: selected?.name ?? null,
      captureMethod,
      createdAt: new Date().toISOString(),
    }).catch(() => { /* silent fail */ });
  };

  const saveGallery = async () => {
    if (!finalImg || saved) return;
    try {
      await addDoc(collection(db, 'secret_photos'), {
        url: finalImg, templateId: selected?.id,
        templateName: selected?.name, createdAt: new Date().toISOString()
      });
      setSaved(true);
    } catch { alert('Gagal simpan ke galeri'); }
  };

  const reset = () => {
    setStage('template-selection'); setSelected(null); setPhotos([]);
    setSlotIdx(0); setFinalImg(null); setSaved(false); setCountdown(null);
    setCaptureMethod(null);
  };

  // Shared preview canvas handlers (used in both camera sidebar and editing sidebar)
  const previewCanvasProps = {
    onPointerDown: handlePreviewPointerDown,
    onPointerMove: handlePreviewPointerMove,
    onPointerUp: handlePreviewPointerUp,
    style: { maxWidth: '100%', maxHeight: 260, width: 'auto', height: 'auto', display: 'block', touchAction: 'none' } as React.CSSProperties,
  };

  return (
    <div className="pb-root">
      <style>{CSS}</style>
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <input
        ref={uploadInputRef}
        type="file" accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {generating && (
        <div className="pb-loading">
          <div className="pb-spinner" />
          <div className="pb-loading-ttl">Menyusun fotomu...</div>
        </div>
      )}

      {/* TOP BAR */}
      <header className="pb-topbar">
        <div className="pb-logo">
          <div className="pb-logo-ico">📷</div>
          <div>
            <div className="pb-logo-label">Photobox Studio</div>
          </div>
        </div>
        <div className="pb-topbar-btns">
          {stage !== 'template-selection' && (
            <button className="pb-btn-ghost-sm" onClick={reset}>← Template</button>
          )}
          <button className="pb-btn-ghost-sm" onClick={() => window.history.back()}>✕ Keluar</button>
        </div>
      </header>

      {/* ══ STAGE 1: TEMPLATE SELECTION ══ */}
      {stage === 'template-selection' && (
        <div className="pb-scroll">
          <div className="pb-hero">
            <div className="pb-hero-chip">✦ Digital Photobox</div>
            <h1 className="pb-hero-title">Pilih template,<br /><em>buat kenangan.</em></h1>
            <p className="pb-hero-sub">
              {templates.length} template tersedia · multi-ukuran · download langsung
            </p>
          </div>

          <div className="pb-filters">
            <div className="pb-filter-group">
              <span className="pb-filter-label">Foto</span>
              <button className={`pb-pill ${filterCount === 'all' ? 'active' : ''}`} onClick={() => setFilterCount('all')}>Semua</button>
              {availCounts.map(c => (
                <button key={c} className={`pb-pill ${filterCount === String(c) ? 'active' : ''}`} onClick={() => setFilterCount(String(c))}>
                  {c} Foto
                </button>
              ))}
            </div>
            <div className="pb-filter-group">
              <span className="pb-filter-label">Ukuran</span>
              {[
                { val: 'all', lbl: 'Semua' },
                { val: 'portrait', lbl: 'Portrait' },
                { val: 'landscape', lbl: 'Landscape' },
                { val: 'square', lbl: 'Square' },
              ].map(o => (
                <button key={o.val} className={`pb-pill ${filterOrient === o.val ? 'active' : ''}`} onClick={() => setFilterOrient(o.val)}>
                  {o.lbl}
                </button>
              ))}
            </div>
            <div className="pb-search-box">
              <span style={{ color: 'var(--pb-text3)', fontSize: 13 }}>⌕</span>
              <input
                type="text" placeholder="Cari template..."
                value={search} onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="pb-grid">
            {filtered.length === 0 ? (
              <div className="pb-empty">
                <div className="pb-empty-ico">📦</div>
                <h3>{templates.length === 0 ? 'Belum ada template' : 'Tidak ditemukan'}</h3>
                <p>{templates.length === 0 ? 'Admin belum upload template.' : 'Ubah filter atau kata kunci.'}</p>
              </div>
            ) : filtered.map((t, i) => {
              const orient = getOrientation(t.canvasWidth, t.canvasHeight);
              const aspect = getAspectLabel(t.canvasWidth, t.canvasHeight);
              const previewH = orient === 'portrait' ? 290 : orient === 'landscape' ? 140 : 220;
              return (
                <div key={t.id} className="pb-tcard" onClick={() => selectTemplate(t)} style={{ animationDelay: `${i * 0.04}s` }}>
                  <div className="pb-tcard-badges">
                    <div className="pb-tcard-badge">📸 {t.photoCount}</div>
                    <div className="pb-tcard-ratio">{aspect}</div>
                  </div>
                  <div className="pb-tcard-img-wrap" style={{ height: previewH }}>
                    <img src={t.imageUrl} alt={t.name} loading="lazy" />
                    <div className="pb-tcard-hover">
                      <button className="pb-tcard-cta">Pilih Template</button>
                    </div>
                  </div>
                  <div className="pb-tcard-footer">
                    <div>
                      <div className="pb-tcard-name">{t.name}</div>
                      <div className="pb-tcard-meta">{t.canvasWidth}×{t.canvasHeight} · {orient}</div>
                    </div>
                    <div className="pb-tcard-arr">→</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══ STAGE 1.5: CAPTURE METHOD ══ */}
      {stage === 'capture-method' && selected && (
        <div className="pb-method-wrap">
          <div className="pb-method-template-info">
            <img src={selected.imageUrl} alt={selected.name} />
            <div>
              <div className="pb-method-tname">{selected.name}</div>
              <div className="pb-method-tmeta">{selected.photoCount} foto · {selected.canvasWidth}×{selected.canvasHeight}px</div>
            </div>
          </div>

          <div className="pb-method-header">
            <h2>Ambil foto <em>gimana?</em></h2>
            <p>Pilih pakai kamera langsung atau upload dari galeri</p>
          </div>

          <div className="pb-method-cards">
            <div className="pb-method-card primary" onClick={() => chooseMethod('camera')}>
              <div className="pb-method-ico">📷</div>
              <div className="pb-method-name">Kamera</div>
              <div className="pb-method-desc">Foto langsung pakai<br />kamera perangkat kamu</div>
              <div className="pb-method-badge">LIVE · REAL-TIME</div>
            </div>
            <div className="pb-method-card" onClick={() => chooseMethod('upload')}>
              <div className="pb-method-ico" style={{ background: 'var(--pb-surf2)' }}>🖼️</div>
              <div className="pb-method-name">Upload</div>
              <div className="pb-method-desc">Pilih foto dari<br />galeri atau file kamu</div>
              <div style={{ fontSize: 10, color: 'var(--pb-text3)', fontWeight: 500, letterSpacing: '0.5px', fontFamily: 'var(--pbf-b)' }}>
                JPG · PNG · HEIC
              </div>
            </div>
          </div>

          <button className="pb-btn-ghost-sm" onClick={reset} style={{ marginTop: 4 }}>
            ← Ganti Template
          </button>
        </div>
      )}

      {/* ══ STAGE 2A: CAMERA CAPTURE ══ */}
      {stage === 'camera-capture' && selected && (
        <div className="pb-cam-layout">
          <div className="pb-cam-main">
            <div className="pb-cam-topbar">
              <div className="pb-cam-label">Foto {slotIdx + 1} / {selected.photoCount}</div>
              <div className="pb-timer-group">
                <span className="pb-timer-lbl">Timer</span>
                {[3, 5, 10].map(s => (
                  <button key={s} className={`pb-timer-btn ${timerDur === s ? 'active' : ''}`}
                    onClick={() => setTimerDur(s)} disabled={countdown !== null}>{s}s</button>
                ))}
              </div>
            </div>

            <div className="pb-cam-viewport">
              <div className="pb-cam-inner">
                {/* pb-cam-selfie-wrap flips visually ONLY — scaleX(-1) CSS only affects display */}
                <div className="pb-cam-selfie-wrap">
                  <Webcam
                    ref={webcamRef}
                    audio={false}
                    screenshotFormat="image/jpeg"
                    className="pb-cam-video"
                    videoConstraints={{ facingMode: 'user' }}
                    screenshotQuality={1}
                    mirrored={false}
                  />
                </div>
                {countdown !== null && countdown > 0 && (
                  <div className="pb-cd-overlay">
                    <CountdownRing value={countdown} max={timerDur} />
                    <div className="pb-cd-hint">Pose yang kece!</div>
                  </div>
                )}
                {flashing && <div className="pb-flash" />}
              </div>
            </div>

            <div className="pb-cam-controls">
              <button className="pb-capture-btn" onClick={startCountdown} disabled={countdown !== null} />
            </div>
          </div>

          {/* Sidebar */}
          <aside className="pb-sidebar">
            <div className="pb-sidebar-head">
              <div className="pb-sidebar-tname">{selected.name}</div>
              <p className="pb-sidebar-meta">{photos.length}/{selected.photoCount} foto · Live preview</p>
            </div>
            <div className="pb-preview-box">
              <div className="pb-preview-canvas-wrap">
                <canvas ref={liveCanvasRef} {...previewCanvasProps} />
              </div>
              <div className="pb-preview-hint">Preview masuk sini tiap foto dijepret</div>
            </div>
            <div className="pb-steps-list">
              {Array.from({ length: selected.photoCount }).map((_, i) => {
                const cap = photos.find(p => p.slotIndex === i);
                const st = cap ? 'done' : i === slotIdx ? 'active' : 'pending';
                return (
                  <div key={i} className={`pb-step ${st}`}>
                    <div className="pb-step-num">{st === 'done' ? '✓' : i + 1}</div>
                    <div className="pb-step-thumb">
                      {cap ? <img src={cap.dataUrl} alt="" /> : '📷'}
                    </div>
                    <div>
                      <div className="pb-step-lbl">Foto {i + 1}</div>
                      <div className="pb-step-status">
                        {st === 'done' ? '✓ Selesai' : st === 'active' ? '← Giliranmu!' : 'Menunggu'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="pb-sidebar-foot">
              <button className="pb-btn" onClick={() => setStage('capture-method')}>← Ganti Metode</button>
            </div>
          </aside>
        </div>
      )}

      {/* ══ STAGE 2B: UPLOAD CAPTURE ══ */}
      {stage === 'upload-capture' && selected && (
        <div className="pb-upload-layout">
          <div className="pb-upload-main">
            <h2 className="pb-upload-title">Upload <em>foto kamu</em></h2>
            <p className="pb-upload-sub">Klik slot di bawah untuk memilih foto · {photos.length}/{selected.photoCount} foto</p>
            <div className="pb-upload-grid" style={{ gridTemplateColumns: `repeat(${Math.min(selected.photoCount, 3)}, 1fr)` }}>
              {Array.from({ length: selected.photoCount }).map((_, i) => {
                const photo = photos.find(p => p.slotIndex === i);
                return (
                  <div key={i} className={`pb-upload-slot ${photo ? 'filled' : ''}`} onClick={() => handleUploadClick(i)}>
                    {photo ? (
                      <>
                        <img src={photo.dataUrl} alt={`Foto ${i + 1}`} />
                        <div className="pb-slot-done-badge">✓</div>
                        <div className="pb-upload-slot-overlay">Ganti</div>
                      </>
                    ) : (
                      <>
                        <div className="pb-upload-slot-ico">＋</div>
                        <div className="pb-upload-slot-num">Foto {i + 1}</div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            {photos.length >= selected.photoCount && (
              <button className="pb-btn pb-btn-primary" style={{ maxWidth: 300 }} onClick={() => setStage('editing')}>
                Edit posisi →
              </button>
            )}
          </div>

          <aside className="pb-sidebar">
            <div className="pb-sidebar-head">
              <div className="pb-sidebar-tname">{selected.name}</div>
              <p className="pb-sidebar-meta">{photos.length}/{selected.photoCount} foto uploaded</p>
            </div>
            <div className="pb-preview-box">
              <div className="pb-preview-canvas-wrap">
                <canvas ref={liveCanvasRef} {...previewCanvasProps} />
              </div>
              <div className="pb-preview-hint">Preview terupdate tiap foto diupload</div>
            </div>
            <div className="pb-steps-list">
              {Array.from({ length: selected.photoCount }).map((_, i) => {
                const cap = photos.find(p => p.slotIndex === i);
                const st = cap ? 'done' : 'pending';
                return (
                  <div key={i} className={`pb-step ${st}`}>
                    <div className="pb-step-num">{st === 'done' ? '✓' : i + 1}</div>
                    <div className="pb-step-thumb">
                      {cap ? <img src={cap.dataUrl} alt="" style={{ transform: 'none' }} /> : '🖼️'}
                    </div>
                    <div>
                      <div className="pb-step-lbl">Foto {i + 1}</div>
                      <div className="pb-step-status">{st === 'done' ? '✓ Uploaded' : 'Belum diupload'}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="pb-sidebar-foot">
              <button className="pb-btn" onClick={() => setStage('capture-method')}>← Ganti Metode</button>
            </div>
          </aside>
        </div>
      )}

      {/* ══ STAGE 3: EDITING ══ */}
      {stage === 'editing' && selected && (
        <div className="pb-edit-layout">
          <div className="pb-edit-main">
            <div className="pb-edit-header">
              <h2>Atur <em>posisi foto</em></h2>
              <p>Drag tiap slot untuk geser · Pinch atau +/− untuk zoom. Sudah oke? Klik Download.</p>
            </div>

            <div className="pb-edit-grid">
              {photos.map((photo, idx) => {
                const slot = selected.slots[photo.slotIndex];
                if (!slot) return null;
                const { w, h, scale: displayScale } = getSlotDisplay(slot);
                return (
                  <div key={idx} className="pb-edit-card">
                    <div className="pb-edit-card-label">Foto {photo.slotIndex + 1}</div>
                    <DraggableSlot
                      photo={photo}
                      slot={slot}
                      displayW={w}
                      displayH={h}
                      mirror={false} // image already pre-flipped in capture()
                      displayOX={photo.offsetX * displayScale}
                      displayOY={photo.offsetY * displayScale}
                      onOffsetChange={(dox, doy) => {
                        updateOffset(photo.slotIndex, dox / displayScale, doy / displayScale);
                      }}
                      onScaleChange={(s) => updateScale(photo.slotIndex, s)}
                    />
                    <div className="pb-edit-actions">
                      <button onClick={() => { updateOffset(photo.slotIndex, 0, 0); updateScale(photo.slotIndex, 1); }}>↺ Reset Posisi</button>
                      <button onClick={() => retake(photo.slotIndex)}>📷 Ambil Ulang</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <aside className="pb-edit-side">
            <div className="pb-edit-side-title">Preview Hasil</div>
            <div className="pb-edit-preview-wrap">
              <canvas
                ref={liveCanvasRef}
                onPointerDown={handlePreviewPointerDown}
                onPointerMove={handlePreviewPointerMove}
                onPointerUp={handlePreviewPointerUp}
                style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', display: 'block', touchAction: 'none' }}
              />
            </div>
            <p style={{ fontSize: 11, color: 'var(--pb-text3)', lineHeight: 1.6, margin: 0, textAlign: 'center', flexShrink: 0 }}>
              Drag di preview untuk atur posisi foto. Hasil akhir sesuai tampilan ini.
            </p>
            <button
              className="pb-btn pb-btn-primary"
              style={{ flexShrink: 0 }}
              onClick={generateAndDownload}
              disabled={photos.length < selected.photoCount}
            >
              ↓ Download di sini
            </button>
            <button className="pb-btn" style={{ flexShrink: 0 }} onClick={reset}>Mulai Ulang</button>
          </aside>
        </div>
      )}

      {/* ══ STAGE 4: RESULT ══ */}
      {stage === 'result' && finalImg && (
        <div className="pb-result-layout">
          <div className="pb-result-main">
            <div className="pb-result-wrap">
              <div className="pb-result-glow" />
              <img src={finalImg} alt="Hasil Photobox" />
            </div>
          </div>

          <aside className="pb-result-side">
            <h2 className="pb-result-title">Foto kamu<br /><em>udah jadi! ✦</em></h2>
            <p className="pb-result-sub">Download foto kamu di bawah.</p>

            <button className="pb-action-row hl" onClick={download}>
              <div className="pb-action-ico">↓</div>
              <div>
                <span className="pb-action-name">Download Foto</span>
                <span className="pb-action-desc">Simpan sebagai PNG kualitas tinggi</span>
              </div>
            </button>

            <div className="pb-divider" />

            {/* ← BACK TO EDIT */}
            <button className="pb-action-row" onClick={() => setStage('editing')}>
              <div className="pb-action-ico">✎</div>
              <div>
                <span className="pb-action-name">Kembali Edit</span>
                <span className="pb-action-desc">Atur ulang posisi foto</span>
              </div>
            </button>

            <button className="pb-action-row" onClick={() => {
              setPhotos([]); setSlotIdx(0); setFinalImg(null); setSaved(false);
              setStage(captureMethod === 'camera' ? 'camera-capture' : 'upload-capture');
            }}>
              <div className="pb-action-ico">📸</div>
              <div>
                <span className="pb-action-name">Ulangi Template Ini</span>
                <span className="pb-action-desc">Pakai frame yang sama</span>
              </div>
            </button>

            <button className="pb-action-row" onClick={reset}>
              <div className="pb-action-ico">↩</div>
              <div>
                <span className="pb-action-name">Pilih Template Lain</span>
                <span className="pb-action-desc">Kembali ke halaman template</span>
              </div>
            </button>
          </aside>
        </div>
      )}
    </div>
  );
}