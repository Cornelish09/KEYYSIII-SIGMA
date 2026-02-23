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
  offsetX: number; // px offset from center (for pan)
  offsetY: number;
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
 * offsetX/Y are pixel offsets from center at cover scale.
 * mirror: horizontally flip (selfie correction).
 */
function drawWithPan(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number, dy: number, dw: number, dh: number,
  offsetX = 0, offsetY = 0,
  mirror = false
) {
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (!srcW || !srcH) return;

  // Scale to cover the slot
  const coverScale = Math.max(dw / srcW, dh / srcH);
  const scaledW = srcW * coverScale;
  const scaledH = srcH * coverScale;

  // Centered position
  let drawX = (dw - scaledW) / 2 + offsetX;
  let drawY = (dh - scaledH) / 2 + offsetY;

  // Clamp so image never leaves slot
  drawX = Math.min(0, Math.max(dw - scaledW, drawX));
  drawY = Math.min(0, Math.max(dh - scaledH, drawY));

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
        <circle cx="80" cy="80" r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="6" />
        <circle
          cx="80" cy="80" r={r} fill="none"
          stroke="#818CF8" strokeWidth="6" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1s linear' }}
        />
      </svg>
      <span
        key={value}
        style={{
          fontFamily: "'Syne', sans-serif",
          fontSize: 72, fontWeight: 900, color: 'white',
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
// ==========================================
type DraggableSlotProps = {
  photo: CapturedPhoto;
  slot: PhotoSlot;
  displayW: number;  // display width of slot
  displayH: number;  // display height of slot
  onOffsetChange: (dx: number, dy: number) => void;
  mirror?: boolean;
};

function DraggableSlot({ photo, slot, displayW, displayH, onOffsetChange, mirror }: DraggableSlotProps) {
  const dragRef = useRef<{ startX: number; startY: number; baseOX: number; baseOY: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Compute natural image size at cover scale for clamping
  const [naturalSize, setNaturalSize] = useState({ w: 1, h: 1 });
  const coverScale = Math.max(displayW / naturalSize.w, displayH / naturalSize.h);
  const scaledW = naturalSize.w * coverScale;
  const scaledH = naturalSize.h * coverScale;
  const maxX = (scaledW - displayW) / 2;
  const maxY = (scaledH - displayH) / 2;

  const clamp = (val: number, min: number, max: number) => Math.min(max, Math.max(min, val));

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      baseOX: photo.offsetX, baseOY: photo.offsetY
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const newX = clamp(dragRef.current.baseOX + dx, -maxX, maxX);
    const newY = clamp(dragRef.current.baseOY + dy, -maxY, maxY);
    onOffsetChange(newX, newY);
  };

  const onPointerUp = () => { dragRef.current = null; };

  return (
    <div
      style={{
        width: displayW, height: displayH,
        overflow: 'hidden', borderRadius: 8,
        cursor: 'grab', userSelect: 'none', position: 'relative',
        border: '2px solid rgba(99,102,241,0.5)',
        touchAction: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
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
          left: (displayW - scaledW) / 2 + photo.offsetX,
          top: (displayH - scaledH) / 2 + photo.offsetY,
          transform: mirror ? 'scaleX(-1)' : 'none',
          pointerEvents: 'none',
        }}
      />
      <div style={{
        position: 'absolute', bottom: 6, right: 6,
        background: 'rgba(0,0,0,0.65)', borderRadius: 5, padding: '3px 7px',
        fontSize: 10, color: 'rgba(255,255,255,0.7)', pointerEvents: 'none'
      }}>
        ↔ Geser foto
      </div>
    </div>
  );
}


// ==========================================
// 🎨 CSS
// ==========================================
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Syne:wght@700;800&display=swap');

  :root {
    --pb-bg:      #04040E;
    --pb-bg2:     #08081A;
    --pb-bg3:     #0E0E22;
    --pb-surf:    #101024;
    --pb-surf2:   #161630;
    --pb-bdr:     rgba(99,102,241,0.18);
    --pb-bdr2:    rgba(99,102,241,0.08);
    --pb-blue:    #6366F1;
    --pb-blue2:   #818CF8;
    --pb-purple:  #7C3AED;
    --pb-purple2: #A78BFA;
    --pb-glow:    rgba(99,102,241,0.3);
    --pb-text:    #E8E8F8;
    --pb-text2:   #9090BB;
    --pb-text3:   #4A4A88;
    --pbf-d: 'Syne', sans-serif;
    --pbf-b: 'Space Grotesk', sans-serif;
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
      radial-gradient(ellipse 70% 50% at 15% 0%, rgba(99,102,241,0.13) 0%, transparent 65%),
      radial-gradient(ellipse 50% 40% at 85% 100%, rgba(124,58,237,0.1) 0%, transparent 65%);
  }

  @keyframes pbPop {
    0% { transform: scale(0.3); opacity: 0; }
    100% { transform: scale(1); opacity: 1; }
  }
  @keyframes pbFadeUp {
    from { opacity: 0; transform: translateY(14px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes pbReveal {
    0%   { transform: scale(0.75) rotate(-4deg); opacity: 0; }
    100% { transform: scale(1) rotate(0); opacity: 1; }
  }
  @keyframes pbSpin { to { transform: rotate(360deg); } }
  @keyframes pbPulse {
    0%,100% { box-shadow: 0 0 0 0 rgba(99,102,241,0.45); }
    50%     { box-shadow: 0 0 0 8px rgba(99,102,241,0); }
  }
  @keyframes pbFlash {
    0%   { opacity: 1; }
    100% { opacity: 0; }
  }

  /* ── TOP BAR ── */
  .pb-topbar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 28px; height: 58px;
    background: rgba(4,4,14,0.9); backdrop-filter: blur(18px);
    border-bottom: 1px solid var(--pb-bdr);
    z-index: 100; flex-shrink: 0; position: relative;
  }
  .pb-logo {
    font-family: var(--pbf-d); font-size: 21px; font-weight: 800;
    background: linear-gradient(135deg, var(--pb-blue2), var(--pb-purple2));
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    display: flex; align-items: center; gap: 10px; letter-spacing: -0.5px;
  }
  .pb-logo-ico {
    width: 32px; height: 32px; border-radius: 10px;
    background: linear-gradient(135deg, var(--pb-blue), var(--pb-purple));
    display: flex; align-items: center; justify-content: center; font-size: 16px;
    box-shadow: 0 4px 16px var(--pb-glow); flex-shrink: 0;
  }
  .pb-topbar-btns { display: flex; gap: 8px; }
  .pb-btn-ghost-sm {
    padding: 7px 15px; border-radius: 8px;
    border: 1px solid var(--pb-bdr); background: var(--pb-surf);
    font-family: var(--pbf-b); font-size: 13px; font-weight: 600;
    color: var(--pb-text2); cursor: pointer; transition: all 0.16s;
  }
  .pb-btn-ghost-sm:hover { border-color: var(--pb-blue); color: var(--pb-blue2); }

  /* ── SCROLL ── */
  .pb-scroll {
    flex: 1; overflow-y: auto; overflow-x: hidden;
    scrollbar-width: thin; scrollbar-color: var(--pb-surf2) transparent;
    position: relative; z-index: 1;
  }

  /* ── HERO ── */
  .pb-hero {
    padding: 52px 44px 36px; text-align: center;
    background: linear-gradient(180deg, rgba(99,102,241,0.06) 0%, transparent 100%);
    border-bottom: 1px solid var(--pb-bdr2);
  }
  .pb-hero-chip {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 5px 14px; border-radius: 100px;
    background: rgba(99,102,241,0.12); border: 1px solid rgba(99,102,241,0.3);
    font-size: 11px; font-weight: 700; color: var(--pb-blue2);
    text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 20px;
  }
  .pb-hero-title {
    font-family: var(--pbf-d); font-size: clamp(28px, 4.5vw, 52px);
    font-weight: 800; color: var(--pb-text); line-height: 1.1;
    margin: 0 0 14px; letter-spacing: -1px;
  }
  .pb-hero-title span {
    background: linear-gradient(135deg, var(--pb-blue2), var(--pb-purple2));
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  .pb-hero-sub { font-size: 15px; color: var(--pb-text2); margin: 0; font-weight: 500; }

  /* ── FILTER BAR ── */
  .pb-filters {
    position: sticky; top: 0; z-index: 50;
    background: rgba(4,4,14,0.95); backdrop-filter: blur(18px);
    border-bottom: 1px solid var(--pb-bdr);
    padding: 13px 44px;
    display: flex; align-items: center; gap: 20px; flex-wrap: wrap;
  }
  .pb-filter-group { display: flex; align-items: center; gap: 7px; }
  .pb-filter-label {
    font-size: 10px; font-weight: 700; color: var(--pb-text3);
    text-transform: uppercase; letter-spacing: 1px; white-space: nowrap;
  }
  .pb-pill {
    padding: 5px 13px; border-radius: 7px;
    border: 1px solid var(--pb-bdr); background: transparent;
    font-family: var(--pbf-b); font-size: 12px; font-weight: 600;
    color: var(--pb-text2); cursor: pointer; transition: all 0.14s;
  }
  .pb-pill:hover { border-color: var(--pb-blue); color: var(--pb-blue2); }
  .pb-pill.active {
    background: rgba(99,102,241,0.18); border-color: var(--pb-blue); color: var(--pb-blue2);
  }
  .pb-search-box {
    margin-left: auto;
    display: flex; align-items: center; gap: 8px;
    padding: 7px 14px; border: 1px solid var(--pb-bdr);
    border-radius: 9px; background: var(--pb-surf); min-width: 200px;
  }
  .pb-search-box input {
    border: none; background: transparent; font-family: var(--pbf-b);
    font-size: 13px; color: var(--pb-text); outline: none; width: 100%;
  }
  .pb-search-box input::placeholder { color: var(--pb-text3); }

  /* ── TEMPLATE GRID ── */
  .pb-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(215px, 1fr));
    gap: 18px; padding: 26px 44px 56px;
    max-width: 1440px; margin: 0 auto;
    width: 100%; box-sizing: border-box;
  }
  .pb-tcard {
    background: var(--pb-surf); border-radius: 14px; overflow: hidden;
    border: 1px solid var(--pb-bdr); cursor: pointer;
    transition: all 0.22s;
    animation: pbFadeUp 0.4s ease both;
    position: relative;
  }
  .pb-tcard:hover {
    transform: translateY(-5px); border-color: var(--pb-blue);
    box-shadow: 0 12px 40px rgba(99,102,241,0.22), 0 0 0 1px rgba(99,102,241,0.35);
  }
  .pb-tcard-badges {
    position: absolute; top: 10px; left: 10px; right: 10px; z-index: 5;
    display: flex; justify-content: space-between; gap: 6px;
  }
  .pb-tcard-badge {
    padding: 4px 10px; border-radius: 6px;
    background: rgba(4,4,14,0.82); backdrop-filter: blur(8px);
    font-size: 11px; font-weight: 700; color: var(--pb-blue2);
    border: 1px solid rgba(99,102,241,0.3);
  }
  .pb-tcard-ratio {
    padding: 4px 10px; border-radius: 6px;
    background: rgba(124,58,237,0.18); backdrop-filter: blur(8px);
    font-size: 11px; font-weight: 700; color: var(--pb-purple2);
    border: 1px solid rgba(124,58,237,0.3);
  }
  .pb-tcard-img-wrap {
    width: 100%;
    background: repeating-conic-gradient(rgba(255,255,255,0.03) 0% 25%, transparent 0% 50%) 0 0 / 12px 12px;
    display: flex; align-items: center; justify-content: center;
    position: relative; overflow: hidden;
  }
  .pb-tcard-img-wrap img {
    width: 100%; height: 100%;
    object-fit: contain; display: block; transition: transform 0.3s;
  }
  .pb-tcard:hover .pb-tcard-img-wrap img { transform: scale(1.04); }
  .pb-tcard-hover {
    position: absolute; inset: 0;
    background: rgba(4,4,14,0.68); backdrop-filter: blur(6px);
    display: flex; align-items: center; justify-content: center;
    opacity: 0; transition: opacity 0.22s;
  }
  .pb-tcard:hover .pb-tcard-hover { opacity: 1; }
  .pb-tcard-cta {
    padding: 10px 22px; border-radius: 10px;
    background: linear-gradient(135deg, var(--pb-blue), var(--pb-purple));
    border: none; font-family: var(--pbf-b); font-size: 13px; font-weight: 700;
    color: white; cursor: pointer;
    transform: translateY(8px); transition: transform 0.22s;
    box-shadow: 0 4px 20px var(--pb-glow);
  }
  .pb-tcard:hover .pb-tcard-cta { transform: translateY(0); }
  .pb-tcard-footer {
    padding: 12px 14px;
    border-top: 1px solid var(--pb-bdr2);
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
  }
  .pb-tcard-name {
    font-size: 13px; font-weight: 700; color: var(--pb-text);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px;
  }
  .pb-tcard-meta { font-size: 11px; color: var(--pb-text3); margin-top: 3px; }
  .pb-tcard-arr {
    width: 30px; height: 30px; border-radius: 7px; flex-shrink: 0;
    background: rgba(99,102,241,0.12); color: var(--pb-blue2);
    display: flex; align-items: center; justify-content: center; font-size: 15px;
    transition: all 0.2s;
  }
  .pb-tcard:hover .pb-tcard-arr { background: var(--pb-blue); color: white; transform: rotate(45deg); }

  .pb-empty {
    grid-column: 1/-1; padding: 80px 40px;
    text-align: center; color: var(--pb-text2);
    animation: pbFadeUp 0.4s ease;
  }
  .pb-empty-ico { font-size: 52px; opacity: 0.25; margin-bottom: 16px; }
  .pb-empty h3 { font-family: var(--pbf-d); color: var(--pb-text); margin: 0 0 8px; font-size: 20px; }
  .pb-empty p { margin: 0; font-size: 13px; }

  /* ── CAPTURE METHOD STAGE ── */
  .pb-method-wrap {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 36px; padding: 40px 20px; position: relative; z-index: 1;
    animation: pbFadeUp 0.4s ease;
  }
  .pb-method-header { text-align: center; }
  .pb-method-header h2 {
    font-family: var(--pbf-d); font-size: clamp(22px, 3vw, 36px);
    font-weight: 800; color: var(--pb-text); margin: 0 0 8px; letter-spacing: -0.5px;
  }
  .pb-method-header h2 span {
    background: linear-gradient(135deg, var(--pb-blue2), var(--pb-purple2));
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  .pb-method-header p { font-size: 14px; color: var(--pb-text2); margin: 0; }
  .pb-method-cards {
    display: flex; gap: 20px; flex-wrap: wrap; justify-content: center;
  }
  .pb-method-card {
    width: 240px; border-radius: 20px;
    background: var(--pb-surf); border: 2px solid var(--pb-bdr);
    padding: 36px 28px; text-align: center; cursor: pointer;
    transition: all 0.22s; display: flex; flex-direction: column;
    align-items: center; gap: 14px;
  }
  .pb-method-card:hover {
    border-color: var(--pb-blue);
    transform: translateY(-6px);
    box-shadow: 0 16px 48px rgba(99,102,241,0.24);
    background: rgba(99,102,241,0.07);
  }
  .pb-method-card.primary {
    background: linear-gradient(145deg, rgba(99,102,241,0.15), rgba(124,58,237,0.12));
    border-color: var(--pb-blue);
    box-shadow: 0 8px 32px rgba(99,102,241,0.2);
  }
  .pb-method-card.primary:hover {
    background: linear-gradient(145deg, rgba(99,102,241,0.25), rgba(124,58,237,0.2));
    box-shadow: 0 16px 48px rgba(99,102,241,0.35);
  }
  .pb-method-ico {
    width: 72px; height: 72px; border-radius: 20px;
    background: linear-gradient(135deg, var(--pb-blue), var(--pb-purple));
    display: flex; align-items: center; justify-content: center;
    font-size: 32px; box-shadow: 0 8px 24px var(--pb-glow);
    flex-shrink: 0;
  }
  .pb-method-card:not(.primary) .pb-method-ico {
    background: var(--pb-surf2); box-shadow: none;
  }
  .pb-method-name {
    font-family: var(--pbf-d); font-size: 18px; font-weight: 800;
    color: var(--pb-text); letter-spacing: -0.3px;
  }
  .pb-method-desc { font-size: 12px; color: var(--pb-text2); line-height: 1.6; }
  .pb-method-badge {
    padding: 4px 10px; border-radius: 6px;
    background: linear-gradient(135deg, var(--pb-blue), var(--pb-purple));
    font-size: 10px; font-weight: 700; color: white; letter-spacing: 0.5px;
  }
  .pb-method-template-info {
    display: flex; align-items: center; gap: 12px;
    padding: 12px 18px; border-radius: 12px;
    background: var(--pb-surf); border: 1px solid var(--pb-bdr);
  }
  .pb-method-template-info img {
    width: 44px; height: 44px; object-fit: contain; border-radius: 8px;
    background: var(--pb-bg3);
  }
  .pb-method-tname { font-size: 13px; font-weight: 700; color: var(--pb-text); }
  .pb-method-tmeta { font-size: 11px; color: var(--pb-text3); margin-top: 2px; }

  /* ── CAMERA STAGE ── */
  .pb-cam-layout {
    flex: 1; display: grid; grid-template-columns: 1fr 320px; overflow: hidden;
  }
  .pb-cam-main {
    position: relative; background: #000;
    display: flex; flex-direction: column; overflow: hidden;
  }
  .pb-cam-topbar {
    position: absolute; top: 0; left: 0; right: 0; z-index: 20;
    padding: 14px 20px;
    background: linear-gradient(180deg, rgba(0,0,0,0.82) 0%, transparent 100%);
    display: flex; align-items: center; justify-content: space-between;
  }
  .pb-cam-label {
    font-family: var(--pbf-d); font-size: 17px; font-weight: 800;
    color: white; letter-spacing: -0.3px;
  }
  .pb-timer-group { display: flex; gap: 6px; align-items: center; }
  .pb-timer-lbl { font-size: 10px; color: rgba(255,255,255,0.35); font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
  .pb-timer-btn {
    padding: 5px 12px; border-radius: 7px;
    border: 1px solid rgba(255,255,255,0.22);
    background: rgba(255,255,255,0.07);
    font-family: var(--pbf-b); font-size: 12px; font-weight: 700;
    color: rgba(255,255,255,0.5); cursor: pointer; transition: all 0.14s;
  }
  .pb-timer-btn:hover,
  .pb-timer-btn.active {
    background: rgba(99,102,241,0.35); border-color: var(--pb-blue);
    color: white;
  }
  .pb-cam-viewport {
    flex: 1; display: flex; align-items: center; justify-content: center;
    background: #000; overflow: hidden;
  }
  .pb-cam-inner {
    position: relative; overflow: hidden;
    width: 100%; height: 100%;
  }
  .pb-cam-video {
    width: 100%; height: 100%; object-fit: cover; display: block;
    transform: scaleX(-1);
  }
  .pb-cd-overlay {
    position: absolute; inset: 0; z-index: 30;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.58); backdrop-filter: blur(4px); gap: 16px;
  }
  .pb-cd-hint { color: rgba(255,255,255,0.55); font-size: 13px; font-weight: 600; letter-spacing: 0.5px; }
  .pb-flash {
    position: absolute; inset: 0; z-index: 50;
    background: white; animation: pbFlash 0.35s ease-out forwards;
  }
  .pb-cam-controls {
    position: absolute; bottom: 0; left: 0; right: 0; z-index: 20;
    padding: 18px 24px 26px;
    background: linear-gradient(0deg, rgba(0,0,0,0.88) 0%, transparent 100%);
    display: flex; align-items: center; justify-content: center;
  }
  .pb-capture-btn {
    width: 70px; height: 70px; border-radius: 50%;
    border: 3px solid rgba(255,255,255,0.85);
    background: rgba(255,255,255,0.08);
    cursor: pointer; position: relative;
    transition: transform 0.14s, box-shadow 0.14s;
    backdrop-filter: blur(8px);
  }
  .pb-capture-btn::after {
    content: ''; position: absolute; inset: 6px; border-radius: 50%;
    background: linear-gradient(135deg, var(--pb-blue), var(--pb-purple));
    transition: transform 0.14s;
    box-shadow: 0 0 20px var(--pb-glow);
  }
  .pb-capture-btn:hover { transform: scale(1.07); box-shadow: 0 0 30px rgba(99,102,241,0.5); }
  .pb-capture-btn:active::after { transform: scale(0.84); }
  .pb-capture-btn:disabled { opacity: 0.3; cursor: not-allowed; transform: none; }

  /* ── UPLOAD STAGE ── */
  .pb-upload-layout {
    flex: 1; display: grid; grid-template-columns: 1fr 320px; overflow: hidden;
  }
  .pb-upload-main {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: var(--pb-bg2); padding: 40px; gap: 24px; overflow-y: auto;
  }
  .pb-upload-title {
    font-family: var(--pbf-d); font-size: 22px; font-weight: 800;
    color: var(--pb-text); text-align: center; margin: 0;
  }
  .pb-upload-sub { font-size: 13px; color: var(--pb-text2); text-align: center; margin: 0; }
  .pb-upload-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 14px; width: 100%; max-width: 600px;
  }
  .pb-upload-slot {
    aspect-ratio: 3/4; border-radius: 12px;
    border: 2px dashed var(--pb-bdr); background: var(--pb-surf);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 8px; cursor: pointer; transition: all 0.2s; position: relative; overflow: hidden;
  }
  .pb-upload-slot:hover { border-color: var(--pb-blue); background: rgba(99,102,241,0.06); }
  .pb-upload-slot.filled { border-style: solid; border-color: var(--pb-blue); }
  .pb-upload-slot img {
    position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
  }
  .pb-upload-slot-num {
    font-size: 11px; font-weight: 800; color: var(--pb-text3); text-transform: uppercase;
  }
  .pb-upload-slot-ico { font-size: 28px; opacity: 0.4; }
  .pb-upload-slot-overlay {
    position: absolute; inset: 0; background: rgba(0,0,0,0.55);
    display: flex; align-items: center; justify-content: center;
    opacity: 0; transition: opacity 0.2s;
    font-size: 11px; font-weight: 700; color: white;
  }
  .pb-upload-slot.filled:hover .pb-upload-slot-overlay { opacity: 1; }
  .pb-upload-slot .pb-slot-done-badge {
    position: absolute; top: 6px; left: 6px;
    background: rgba(16,185,129,0.9); border-radius: 5px; padding: 2px 7px;
    font-size: 10px; font-weight: 800; color: white;
  }

  /* ── SIDEBAR ── */
  .pb-sidebar {
    background: var(--pb-surf); border-left: 1px solid var(--pb-bdr);
    display: flex; flex-direction: column; overflow: hidden;
  }
  .pb-sidebar-head {
    padding: 18px 16px 12px; border-bottom: 1px solid var(--pb-bdr2);
  }
  .pb-sidebar-tname {
    font-family: var(--pbf-d); font-size: 15px; font-weight: 800;
    color: var(--pb-text); margin: 0 0 4px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .pb-sidebar-meta { font-size: 11px; color: var(--pb-text3); margin: 0; }
  .pb-steps-list {
    flex: 1; padding: 12px; overflow-y: auto;
    display: flex; flex-direction: column; gap: 8px;
  }
  .pb-step {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 11px; border-radius: 11px;
    border: 1px solid transparent; transition: all 0.2s;
  }
  .pb-step.done { background: rgba(16,185,129,0.07); border-color: rgba(16,185,129,0.18); }
  .pb-step.active { background: rgba(99,102,241,0.09); border-color: var(--pb-bdr); animation: pbPulse 2s infinite; }
  .pb-step.pending { background: var(--pb-bg3); }
  .pb-step-num {
    width: 26px; height: 26px; border-radius: 7px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 800;
  }
  .done .pb-step-num { background: rgba(16,185,129,0.18); color: #6EE7B7; }
  .active .pb-step-num { background: rgba(99,102,241,0.28); color: var(--pb-blue2); }
  .pending .pb-step-num { background: var(--pb-surf2); color: var(--pb-text3); }
  .pb-step-thumb {
    width: 42px; height: 42px; border-radius: 7px; flex-shrink: 0;
    overflow: hidden; background: var(--pb-bg3);
    display: flex; align-items: center; justify-content: center;
    font-size: 15px; opacity: 0.5;
  }
  .pb-step-thumb img { width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); display: block; }
  .pb-step-lbl { font-size: 12px; font-weight: 700; color: var(--pb-text); }
  .pb-step-status { font-size: 10px; color: var(--pb-text3); margin-top: 2px; }
  .pb-sidebar-foot { padding: 12px; border-top: 1px solid var(--pb-bdr2); }

  /* ── BUTTONS ── */
  .pb-btn {
    display: flex; align-items: center; justify-content: center; gap: 7px;
    width: 100%; padding: 11px; border-radius: 10px;
    border: 1px solid var(--pb-bdr); background: var(--pb-surf2);
    font-family: var(--pbf-b); font-size: 13px; font-weight: 700;
    color: var(--pb-text2); cursor: pointer; transition: all 0.16s;
  }
  .pb-btn:hover { border-color: var(--pb-blue); color: var(--pb-text); }
  .pb-btn-primary {
    background: linear-gradient(135deg, var(--pb-blue), var(--pb-purple));
    border: none; color: white;
    box-shadow: 0 4px 20px var(--pb-glow);
  }
  .pb-btn-primary:hover { box-shadow: 0 6px 28px var(--pb-glow); transform: translateY(-1px); color: white; }
  .pb-btn-primary:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

  /* ── EDITING STAGE ── */
  .pb-edit-layout {
    flex: 1; display: grid; grid-template-columns: 1fr 320px; overflow: hidden;
  }
  .pb-edit-main {
    padding: 28px 32px; overflow-y: auto; background: var(--pb-bg2);
    display: flex; flex-direction: column; gap: 20px;
  }
  .pb-edit-header h2 {
    font-family: var(--pbf-d); font-size: 26px; font-weight: 800;
    color: var(--pb-text); margin: 0 0 4px; letter-spacing: -0.5px;
  }
  .pb-edit-header h2 span { color: var(--pb-blue2); }
  .pb-edit-header p { font-size: 13px; color: var(--pb-text2); margin: 0; }
  .pb-edit-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 18px;
  }
  .pb-edit-card {
    background: var(--pb-surf); border-radius: 12px; overflow: hidden;
    border: 1px solid var(--pb-bdr); padding: 12px;
    display: flex; flex-direction: column; gap: 10px;
  }
  .pb-edit-card-label {
    font-size: 11px; font-weight: 700; color: var(--pb-text2);
    text-transform: uppercase; letter-spacing: 0.8px;
  }
  .pb-edit-actions {
    display: flex; gap: 6px;
  }
  .pb-edit-actions button {
    flex: 1; padding: 6px 0; border-radius: 7px;
    border: 1px solid var(--pb-bdr); background: var(--pb-surf2);
    font-family: var(--pbf-b); font-size: 11px; font-weight: 700;
    color: var(--pb-text2); cursor: pointer; transition: all 0.14s;
  }
  .pb-edit-actions button:hover { border-color: var(--pb-blue); color: var(--pb-blue2); }
  .pb-edit-side {
    background: var(--pb-surf); border-left: 1px solid var(--pb-bdr);
    padding: 22px 18px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto;
  }
  .pb-edit-preview-wrap {
    width: 100%; border-radius: 11px; overflow: hidden;
    background: repeating-conic-gradient(rgba(255,255,255,0.03) 0% 25%, transparent 0% 50%) 0 0 / 10px 10px;
    border: 1px solid var(--pb-bdr); min-height: 80px;
    display: flex; align-items: center; justify-content: center;
  }
  .pb-edit-preview-wrap canvas { width: 100%; height: auto; display: block; }

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
    background: radial-gradient(ellipse 70% 60% at 50% 50%, rgba(99,102,241,0.1) 0%, transparent 70%);
  }
  .pb-result-wrap {
    position: relative; max-width: 370px; width: 100%;
    animation: pbReveal 0.6s cubic-bezier(0.175,0.885,0.32,1.275) forwards;
    filter: drop-shadow(0 30px 60px rgba(99,102,241,0.28));
  }
  .pb-result-wrap img { width: 100%; display: block; border-radius: 4px; }
  .pb-result-glow {
    position: absolute; inset: -20px;
    background: radial-gradient(ellipse at center, rgba(99,102,241,0.18) 0%, transparent 70%);
    pointer-events: none; z-index: -1;
  }
  .pb-result-side {
    background: var(--pb-surf); border-left: 1px solid var(--pb-bdr);
    padding: 32px 22px; display: flex; flex-direction: column; gap: 12px; overflow-y: auto;
  }
  .pb-result-title {
    font-family: var(--pbf-d); font-size: 26px; font-weight: 800;
    color: var(--pb-text); margin: 0; letter-spacing: -0.5px; line-height: 1.2;
  }
  .pb-result-title span { color: var(--pb-purple2); }
  .pb-result-sub { font-size: 13px; color: var(--pb-text2); margin: 0 0 6px; }
  .pb-action-row {
    display: flex; align-items: center; gap: 12px;
    padding: 13px 14px; border-radius: 11px;
    border: 1px solid var(--pb-bdr); background: var(--pb-surf2);
    cursor: pointer; transition: all 0.16s; width: 100%;
    text-align: left; font-family: var(--pbf-b);
  }
  .pb-action-row:hover { border-color: var(--pb-blue); background: rgba(99,102,241,0.07); }
  .pb-action-row.hl { background: linear-gradient(135deg, rgba(99,102,241,0.18), rgba(124,58,237,0.18)); border-color: var(--pb-blue); }
  .pb-action-row.hl:hover { background: linear-gradient(135deg, rgba(99,102,241,0.28), rgba(124,58,237,0.28)); }
  .pb-action-row:disabled { opacity: 0.4; cursor: not-allowed; }
  .pb-action-ico {
    width: 36px; height: 36px; border-radius: 9px;
    background: rgba(99,102,241,0.14);
    display: flex; align-items: center; justify-content: center;
    font-size: 17px; flex-shrink: 0;
  }
  .pb-action-name { font-size: 13px; font-weight: 700; color: var(--pb-text); display: block; }
  .pb-action-desc { font-size: 11px; color: var(--pb-text3); display: block; margin-top: 2px; }
  .pb-success {
    display: flex; align-items: center; gap: 8px;
    padding: 9px 12px; border-radius: 9px;
    background: rgba(16,185,129,0.09); border: 1px solid rgba(16,185,129,0.22);
    font-size: 12px; font-weight: 700; color: #6EE7B7;
    animation: pbFadeUp 0.3s ease;
  }
  .pb-divider { height: 1px; background: var(--pb-bdr2); }

  /* ── LOADING ── */
  .pb-loading {
    position: fixed; inset: 0; z-index: 200;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: rgba(4,4,14,0.9); backdrop-filter: blur(18px); gap: 20px;
  }
  .pb-spinner {
    width: 50px; height: 50px; border-radius: 50%;
    border: 3px solid rgba(99,102,241,0.12);
    border-top-color: var(--pb-blue);
    animation: pbSpin 0.8s linear infinite;
  }
  .pb-loading-ttl {
    font-family: var(--pbf-d); font-size: 19px; font-weight: 800;
    background: linear-gradient(135deg, var(--pb-blue2), var(--pb-purple2));
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
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
    .pb-result-wrap { max-width: 230px; }
    .pb-method-card { width: 190px; padding: 24px 18px; }
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

  // Live preview canvas (camera & editing)
  useEffect(() => {
    if (!selected || !liveCanvasRef.current) return;
    if (stage !== 'camera-capture' && stage !== 'editing' && stage !== 'upload-capture') return;

    const canvas = liveCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const maxW = 280;
    const scale = maxW / selected.canvasWidth;
    canvas.width = Math.round(selected.canvasWidth * scale);
    canvas.height = Math.round(selected.canvasHeight * scale);

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
              slot.x * scale, slot.y * scale,
              slot.width * scale, slot.height * scale,
              photo.offsetX * scale, photo.offsetY * scale,
              captureMethod === 'camera' // only mirror for camera
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
          ctx.strokeStyle = 'rgba(129,140,248,0.8)';
          ctx.lineWidth = 3;
          ctx.setLineDash([8, 4]);
          ctx.strokeRect(nextSlot.x * scale, nextSlot.y * scale, nextSlot.width * scale, nextSlot.height * scale);
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(99,102,241,0.08)';
          ctx.fillRect(nextSlot.x * scale, nextSlot.y * scale, nextSlot.width * scale, nextSlot.height * scale);
          ctx.font = `bold ${Math.max(12, nextSlot.height * scale * 0.2)}px system-ui`;
          ctx.fillStyle = 'rgba(129,140,248,0.7)';
          ctx.textAlign = 'center';
          ctx.fillText(`📸 ${slotIdx + 1}`, (nextSlot.x + nextSlot.width / 2) * scale, (nextSlot.y + nextSlot.height / 2) * scale);
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

  // ── Auto-save raw photo to Firestore ──
  const autoSaveToAdmin = async (dataUrl: string, slotIndex: number) => {
    if (!selected) return;
    try {
      await addDoc(collection(db, 'photobox_raw_photos'), {
        dataUrl,
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
    const src = webcamRef.current.getScreenshot();
    if (!src) return;

    setFlashing(true);
    setTimeout(() => setFlashing(false), 350);

    const idx = slotIdx;
    const newPhoto: CapturedPhoto = { slotIndex: idx, dataUrl: src, offsetX: 0, offsetY: 0 };

    autoSaveToAdmin(src, idx);

    setPhotos(prev => {
      const updated = [...prev, newPhoto];
      if (updated.length >= selected.photoCount) {
        setSlotIdx(0); setStage('editing');
      } else {
        setSlotIdx(i => i + 1);
      }
      return updated;
    });
  }, [webcamRef, slotIdx, selected, captureMethod]);

  const retake = (idx: number) => {
    setPhotos(prev => prev.filter(p => p.slotIndex !== idx));
    setSlotIdx(idx);
    setStage(captureMethod === 'camera' ? 'camera-capture' : 'upload-capture');
  };

  // ── Upload handler ──
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
      const newPhoto: CapturedPhoto = { slotIndex: idx, dataUrl, offsetX: 0, offsetY: 0 };

      autoSaveToAdmin(dataUrl, idx);

      setPhotos(prev => {
        const filtered = prev.filter(p => p.slotIndex !== idx);
        const updated = [...filtered, newPhoto].sort((a, b) => a.slotIndex - b.slotIndex);
        if (updated.length >= selected.photoCount) {
          setSlotIdx(0); setStage('editing');
        } else {
          // Move to next empty slot
          const usedSlots = new Set(updated.map(p => p.slotIndex));
          for (let i = 0; i < selected.photoCount; i++) {
            if (!usedSlots.has(i)) { setSlotIdx(i); break; }
          }
        }
        return updated;
      });
    };
    reader.readAsDataURL(file);
    // reset input so same file can be reselected
    e.target.value = '';
  };

  // ── Update photo offset (for drag-to-pan in editing) ──
  const updateOffset = (slotIndex: number, offsetX: number, offsetY: number) => {
    setPhotos(prev => prev.map(p =>
      p.slotIndex === slotIndex ? { ...p, offsetX, offsetY } : p
    ));
  };

  // ── Generate composite ──
  const generateComposite = async () => {
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
          drawWithPan(
            ctx, img,
            slot.x, slot.y, slot.width, slot.height,
            photo.offsetX, photo.offsetY,
            captureMethod === 'camera'
          );
          res();
        };
        img.onerror = () => res();
        img.src = photo.dataUrl;
      });
    }

    // Frame on top
    const frame = new Image();
    frame.crossOrigin = 'anonymous';
    await new Promise<void>(res => {
      frame.onload = () => { ctx.drawImage(frame, 0, 0, canvas.width, canvas.height); res(); };
      frame.onerror = () => res();
      frame.src = selected.imageUrl;
    });

    setFinalImg(canvas.toDataURL('image/png', 1.0));
    setGenerating(false);
    setStage('result');
  };

  const download = () => {
    if (!finalImg) return;
    const a = document.createElement('a');
    a.href = finalImg; a.download = `photobox-${Date.now()}.png`; a.click();
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

  // ── Editing stage: compute display size for each slot ──
  const getSlotDisplay = (slot: PhotoSlot) => {
    const maxW = 220;
    const scale = maxW / slot.width;
    return { w: maxW, h: Math.round(slot.height * scale) };
  };

  return (
    <div className="pb-root">
      <style>{CSS}</style>
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      {/* Hidden upload input */}
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {generating && (
        <div className="pb-loading">
          <div className="pb-spinner" />
          <div className="pb-loading-ttl">Menyusun foto kamu...</div>
        </div>
      )}

      {/* TOP BAR */}
      <header className="pb-topbar">
        <div className="pb-logo">
          <div className="pb-logo-ico">📷</div>
          Photobox Studio
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
            <div className="pb-hero-chip">✨ Digital Photobox</div>
            <h1 className="pb-hero-title">Pilih template,<br /><span>bikin kenangan.</span></h1>
            <p className="pb-hero-sub">
              {templates.length} template tersedia • Multi-ukuran • Download langsung
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
                { val: 'portrait', lbl: '↑ Portrait' },
                { val: 'landscape', lbl: '→ Landscape' },
                { val: 'square', lbl: '□ Square' },
              ].map(o => (
                <button key={o.val} className={`pb-pill ${filterOrient === o.val ? 'active' : ''}`} onClick={() => setFilterOrient(o.val)}>
                  {o.lbl}
                </button>
              ))}
            </div>
            <div className="pb-search-box">
              <span style={{ color: 'var(--pb-text3)', fontSize: 14 }}>🔍</span>
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
              const previewH = orient === 'portrait' ? 300 : orient === 'landscape' ? 150 : 220;
              return (
                <div key={t.id} className="pb-tcard" onClick={() => selectTemplate(t)} style={{ animationDelay: `${i * 0.04}s` }}>
                  <div className="pb-tcard-badges">
                    <div className="pb-tcard-badge">📸 {t.photoCount} foto</div>
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
                      <div className="pb-tcard-meta">{t.canvasWidth}×{t.canvasHeight}px • {orient}</div>
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
          {/* Selected template info */}
          <div className="pb-method-template-info">
            <img src={selected.imageUrl} alt={selected.name} />
            <div>
              <div className="pb-method-tname">{selected.name}</div>
              <div className="pb-method-tmeta">{selected.photoCount} foto • {selected.canvasWidth}×{selected.canvasHeight}px</div>
            </div>
          </div>

          <div className="pb-method-header">
            <h2>Mau <span>ambil foto</span> gimana?</h2>
            <p>Pilih pakai kamera langsung atau upload dari galeri kamu</p>
          </div>

          <div className="pb-method-cards">
            {/* Camera */}
            <div className="pb-method-card primary" onClick={() => chooseMethod('camera')}>
              <div className="pb-method-ico">📷</div>
              <div className="pb-method-name">Kamera</div>
              <div className="pb-method-desc">Foto langsung pakai<br />kamera perangkat kamu</div>
              <div className="pb-method-badge">LIVE • REAL-TIME</div>
            </div>

            {/* Upload */}
            <div className="pb-method-card" onClick={() => chooseMethod('upload')}>
              <div className="pb-method-ico" style={{ background: 'var(--pb-surf2)' }}>🖼️</div>
              <div className="pb-method-name">Upload</div>
              <div className="pb-method-desc">Pilih foto dari<br />galeri atau file kamu</div>
              <div style={{ fontSize: 11, color: 'var(--pb-text3)', fontWeight: 600 }}>
                JPG / PNG / HEIC
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
                <Webcam
                  ref={webcamRef}
                  audio={false}
                  screenshotFormat="image/jpeg"
                  className="pb-cam-video"
                  videoConstraints={{ facingMode: 'user' }}
                  screenshotQuality={1}
                />
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
              <p className="pb-sidebar-meta">{photos.length}/{selected.photoCount} foto • Live preview</p>
            </div>
            <div style={{ padding: '16px 16px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--pb-bdr2)' }}>
              <div style={{ width: '100%', borderRadius: 10, overflow: 'hidden', background: 'repeating-conic-gradient(rgba(255,255,255,0.04) 0% 25%, transparent 0% 50%) 0 0 / 10px 10px', border: '1px solid var(--pb-bdr)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <canvas ref={liveCanvasRef} style={{ width: '100%', height: 'auto', display: 'block', maxHeight: 320 }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--pb-text3)', textAlign: 'center' }}>Preview langsung masuk sini tiap foto dijepret ↑</div>
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
            <h2 className="pb-upload-title">Upload <span style={{ color: 'var(--pb-blue2)' }}>foto kamu</span></h2>
            <p className="pb-upload-sub">Klik slot di bawah untuk memilih foto dari galeri kamu • {photos.length}/{selected.photoCount} foto</p>
            <div className="pb-upload-grid" style={{ gridTemplateColumns: `repeat(${Math.min(selected.photoCount, 3)}, 1fr)` }}>
              {Array.from({ length: selected.photoCount }).map((_, i) => {
                const photo = photos.find(p => p.slotIndex === i);
                return (
                  <div
                    key={i}
                    className={`pb-upload-slot ${photo ? 'filled' : ''}`}
                    onClick={() => handleUploadClick(i)}
                  >
                    {photo ? (
                      <>
                        <img src={photo.dataUrl} alt={`Foto ${i + 1}`} />
                        <div className="pb-slot-done-badge">✓</div>
                        <div className="pb-upload-slot-overlay">🔄 Ganti</div>
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
              <button
                className="pb-btn pb-btn-primary"
                style={{ maxWidth: 300 }}
                onClick={() => setStage('editing')}
              >
                ✏️ Lanjut ke Editing →
              </button>
            )}
          </div>

          {/* Sidebar */}
          <aside className="pb-sidebar">
            <div className="pb-sidebar-head">
              <div className="pb-sidebar-tname">{selected.name}</div>
              <p className="pb-sidebar-meta">{photos.length}/{selected.photoCount} foto uploaded</p>
            </div>
            <div style={{ padding: '16px 16px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--pb-bdr2)' }}>
              <div style={{ width: '100%', borderRadius: 10, overflow: 'hidden', background: 'repeating-conic-gradient(rgba(255,255,255,0.04) 0% 25%, transparent 0% 50%) 0 0 / 10px 10px', border: '1px solid var(--pb-bdr)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <canvas ref={liveCanvasRef} style={{ width: '100%', height: 'auto', display: 'block', maxHeight: 320 }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--pb-text3)', textAlign: 'center' }}>Preview terupdate tiap foto diupload ↑</div>
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

      {/* ══ STAGE 3: EDITING (drag to pan) ══ */}
      {stage === 'editing' && selected && (
        <div className="pb-edit-layout">
          <div className="pb-edit-main">
            <div className="pb-edit-header">
              <h2>Atur <span>posisi foto</span></h2>
              <p>Drag foto di setiap slot untuk mengatur posisi yang kamu mau. Kalau sudah oke, klik Proses!</p>
            </div>

            <div className="pb-edit-grid">
              {photos.map((photo, idx) => {
                const slot = selected.slots[photo.slotIndex];
                if (!slot) return null;
                const { w, h } = getSlotDisplay(slot);
                return (
                  <div key={idx} className="pb-edit-card">
                    <div className="pb-edit-card-label">Foto {photo.slotIndex + 1}</div>
                    <DraggableSlot
                      photo={photo}
                      slot={slot}
                      displayW={w}
                      displayH={h}
                      mirror={captureMethod === 'camera'}
                      onOffsetChange={(ox, oy) => updateOffset(photo.slotIndex, ox, oy)}
                    />
                    <div className="pb-edit-actions">
                      <button onClick={() => updateOffset(photo.slotIndex, 0, 0)}>↺ Reset</button>
                      <button onClick={() => retake(photo.slotIndex)}>🔄 Retake</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <aside className="pb-edit-side">
            <div style={{ fontFamily: 'var(--pbf-d)', fontSize: 15, fontWeight: 800, color: 'var(--pb-text)' }}>
              Preview Hasil
            </div>
            <div className="pb-edit-preview-wrap">
              <canvas ref={liveCanvasRef} style={{ width: '100%', height: 'auto', display: 'block' }} />
            </div>
            <p style={{ fontSize: 12, color: 'var(--pb-text2)', lineHeight: 1.6, margin: 0 }}>
              Preview update otomatis saat kamu geser foto. Hasil akhir sesuai posisi ini.
            </p>
            <button
              className="pb-btn pb-btn-primary"
              onClick={generateComposite}
              disabled={photos.length < selected.photoCount}
            >
              🎨 Proses Foto!
            </button>
            <button className="pb-btn" onClick={reset}>Mulai Ulang</button>
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
            <h2 className="pb-result-title">Foto kamu<br /><span>udah jadi! 🎉</span></h2>
            <p className="pb-result-sub">Download atau simpan ke galeri bersama!</p>

            <button className="pb-action-row hl" onClick={download}>
              <div className="pb-action-ico">📥</div>
              <div>
                <span className="pb-action-name">Download Foto</span>
                <span className="pb-action-desc">Simpan sebagai PNG kualitas tinggi</span>
              </div>
            </button>

            <button className="pb-action-row" onClick={saveGallery} disabled={saved}>
              <div className="pb-action-ico">☁️</div>
              <div>
                <span className="pb-action-name">Simpan ke Galeri</span>
                <span className="pb-action-desc">Admin bisa lihat di dashboard</span>
              </div>
            </button>

            {saved && <div className="pb-success">✅ Berhasil disimpan ke galeri!</div>}

            <div className="pb-divider" />

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
              <div className="pb-action-ico">🔄</div>
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