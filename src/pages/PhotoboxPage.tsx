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
  category?: string;
};

type CapturedPhoto = { slotIndex: number; dataUrl: string };
type Stage = 'template-selection' | 'camera-capture' | 'preview' | 'result';
type FilterCount = 'all' | '2' | '3' | '4' | '6';

// ==========================================
// 🎨 STYLES (injected once)
// ==========================================
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,700;0,9..144,900;1,9..144,400&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');

  :root {
    --cream: #FDF6EE;
    --cream2: #F5EDE0;
    --coral: #FF6B6B;
    --coral-dark: #E85555;
    --orange: #FF8C42;
    --gold: #F4A261;
    --dark: #1A1208;
    --dark2: #2D2112;
    --mid: #7A6652;
    --light: #C4A882;
    --white: #FFFCF8;
    --shadow: rgba(90,60,20,0.15);
    --shadow-strong: rgba(90,60,20,0.28);
    --font-display: 'Fraunces', Georgia, serif;
    --font-body: 'Plus Jakarta Sans', system-ui, sans-serif;
  }

  .pb-root {
    position: fixed; inset: 0;
    background: var(--cream);
    font-family: var(--font-body);
    overflow: hidden;
    display: flex; flex-direction: column;
  }

  /* Grain overlay */
  .pb-root::after {
    content: '';
    position: fixed; inset: 0;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E");
    pointer-events: none; z-index: 999;
    opacity: 0.4;
  }

  /* ====== TOPBAR ====== */
  .pb-topbar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 32px;
    background: var(--white);
    border-bottom: 1.5px solid var(--cream2);
    z-index: 100; flex-shrink: 0;
    box-shadow: 0 2px 20px var(--shadow);
  }

  .pb-logo {
    font-family: var(--font-display);
    font-size: 26px; font-weight: 900;
    color: var(--dark);
    letter-spacing: -0.5px;
    display: flex; align-items: center; gap: 10px;
  }

  .pb-logo-dot {
    width: 10px; height: 10px; border-radius: 50%;
    background: var(--coral);
    display: inline-block; margin-bottom: 2px;
  }

  .pb-back-btn {
    display: flex; align-items: center; gap: 8px;
    padding: 9px 20px;
    border: 1.5px solid var(--cream2);
    background: var(--white);
    border-radius: 100px;
    font-family: var(--font-body);
    font-weight: 600; font-size: 14px;
    color: var(--dark2);
    cursor: pointer;
    transition: all 0.2s;
  }
  .pb-back-btn:hover { border-color: var(--coral); color: var(--coral); transform: translateX(-2px); }

  /* ====== SCROLL AREA ====== */
  .pb-scroll {
    flex: 1; overflow-y: auto; overflow-x: hidden;
    padding: 0;
    scrollbar-width: thin;
    scrollbar-color: var(--cream2) transparent;
  }

  /* ====== SECTION HEADERS ====== */
  .pb-hero {
    padding: 48px 40px 32px;
    background: linear-gradient(180deg, #FDF6EE 0%, #F5EDE0 100%);
    border-bottom: 1px solid var(--cream2);
    text-align: center;
  }

  .pb-hero-tag {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 6px 16px;
    background: var(--coral); color: white;
    border-radius: 100px; font-size: 12px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 1px;
    margin-bottom: 20px;
  }

  .pb-hero-title {
    font-family: var(--font-display);
    font-size: clamp(32px, 5vw, 54px);
    font-weight: 900; color: var(--dark);
    line-height: 1.1; margin: 0 0 16px;
  }

  .pb-hero-title em {
    font-style: italic; color: var(--coral);
  }

  .pb-hero-sub {
    font-size: 16px; color: var(--mid);
    font-weight: 500; margin: 0;
  }

  /* ====== FILTER BAR ====== */
  .pb-filterbar {
    display: flex; align-items: center; gap: 12px;
    padding: 20px 40px;
    background: var(--white);
    border-bottom: 1px solid var(--cream2);
    flex-wrap: wrap;
    position: sticky; top: 0; z-index: 50;
    box-shadow: 0 2px 12px var(--shadow);
  }

  .pb-filter-label {
    font-size: 13px; font-weight: 700; color: var(--mid);
    text-transform: uppercase; letter-spacing: 0.5px;
    white-space: nowrap;
  }

  .pb-filter-pills {
    display: flex; gap: 8px; flex-wrap: wrap;
  }

  .pb-pill {
    padding: 7px 18px;
    border-radius: 100px;
    border: 1.5px solid var(--cream2);
    background: var(--white);
    font-size: 13px; font-weight: 600;
    color: var(--mid); cursor: pointer;
    transition: all 0.2s;
  }
  .pb-pill:hover { border-color: var(--coral); color: var(--coral); }
  .pb-pill.active {
    background: var(--dark); color: white;
    border-color: var(--dark);
  }

  .pb-search {
    margin-left: auto;
    display: flex; align-items: center; gap: 8px;
    padding: 8px 16px;
    border: 1.5px solid var(--cream2);
    border-radius: 100px;
    background: var(--cream);
    min-width: 220px;
  }

  .pb-search input {
    border: none; background: transparent;
    font-family: var(--font-body);
    font-size: 14px; color: var(--dark2);
    outline: none; width: 100%;
  }
  .pb-search input::placeholder { color: var(--light); }

  /* ====== TEMPLATE GRID ====== */
  .pb-template-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 24px;
    padding: 32px 40px 60px;
    max-width: 1400px;
    margin: 0 auto;
    width: 100%;
    box-sizing: border-box;
  }

  .pb-template-card {
    background: var(--white);
    border-radius: 20px;
    overflow: hidden;
    cursor: pointer;
    border: 2px solid transparent;
    transition: all 0.25s;
    box-shadow: 0 4px 20px var(--shadow);
    position: relative;
  }
  .pb-template-card:hover {
    transform: translateY(-6px);
    border-color: var(--coral);
    box-shadow: 0 16px 40px var(--shadow-strong);
  }

  .pb-card-badge {
    position: absolute; top: 14px; left: 14px; z-index: 5;
    display: flex; align-items: center; gap: 5px;
    padding: 5px 12px;
    background: rgba(255,255,255,0.95);
    backdrop-filter: blur(8px);
    border-radius: 100px;
    font-size: 12px; font-weight: 700; color: var(--dark2);
    box-shadow: 0 2px 12px rgba(0,0,0,0.12);
  }

  .pb-card-preview {
    width: 100%; height: 300px;
    background: repeating-conic-gradient(#EFE5D8 0% 25%, #F5EDE0 0% 50%) 0 0 / 16px 16px;
    display: flex; align-items: center; justify-content: center;
    position: relative; overflow: hidden;
  }
  .pb-card-preview img {
    width: 100%; height: 100%;
    object-fit: contain;
    transition: transform 0.3s;
  }
  .pb-template-card:hover .pb-card-preview img { transform: scale(1.03); }

  .pb-card-hover-btn {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    background: rgba(26,18,8,0.6);
    opacity: 0; transition: opacity 0.25s;
    backdrop-filter: blur(4px);
  }
  .pb-template-card:hover .pb-card-hover-btn { opacity: 1; }

  .pb-select-btn {
    padding: 12px 28px;
    background: var(--coral); color: white;
    border: none; border-radius: 100px;
    font-family: var(--font-body);
    font-size: 15px; font-weight: 700;
    cursor: pointer;
    transform: translateY(8px);
    transition: transform 0.25s;
  }
  .pb-template-card:hover .pb-select-btn { transform: translateY(0); }

  .pb-card-info {
    padding: 16px 20px 20px;
    display: flex; align-items: center; justify-content: space-between;
  }

  .pb-card-name {
    font-size: 16px; font-weight: 700; color: var(--dark);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  .pb-card-tags {
    display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px;
  }
  .pb-tag {
    padding: 3px 10px; border-radius: 100px;
    background: var(--cream2); color: var(--mid);
    font-size: 11px; font-weight: 600;
  }

  .pb-card-arrow {
    width: 36px; height: 36px; border-radius: 50%;
    background: var(--coral); color: white;
    display: flex; align-items: center; justify-content: center;
    font-size: 18px; flex-shrink: 0;
    transition: transform 0.2s;
  }
  .pb-template-card:hover .pb-card-arrow { transform: scale(1.1) rotate(45deg); }

  /* ====== EMPTY STATE ====== */
  .pb-empty {
    grid-column: 1/-1;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 80px 40px; text-align: center; color: var(--mid);
  }
  .pb-empty-icon { font-size: 64px; margin-bottom: 20px; opacity: 0.5; }
  .pb-empty h3 { font-family: var(--font-display); font-size: 24px; color: var(--dark2); margin: 0 0 8px; }
  .pb-empty p { margin: 0; font-size: 14px; }

  /* ====== CAMERA STAGE ====== */
  .pb-camera-layout {
    display: grid;
    grid-template-columns: 1fr 320px;
    gap: 0;
    height: calc(100vh - 65px);
    overflow: hidden;
  }

  .pb-camera-main {
    position: relative;
    background: #0D0D0D;
    display: flex; flex-direction: column;
    overflow: hidden;
  }

  .pb-camera-topbar {
    position: absolute; top: 0; left: 0; right: 0; z-index: 20;
    padding: 20px 24px;
    display: flex; align-items: center; justify-content: space-between;
    background: linear-gradient(180deg, rgba(0,0,0,0.7) 0%, transparent 100%);
  }

  .pb-camera-title {
    font-family: var(--font-display); font-size: 20px; font-weight: 700;
    color: white; italic; font-style: italic;
  }

  .pb-camera-frame-wrapper {
    flex: 1; position: relative;
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
  }

  .pb-webcam {
    width: 100%; height: 100%;
    object-fit: cover;
    transform: scaleX(-1);
  }

  .pb-frame-overlay {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    pointer-events: none; z-index: 10;
  }
  .pb-frame-overlay img {
    width: 100%; height: 100%;
    object-fit: contain;
  }

  /* Countdown ring overlay */
  .pb-countdown-overlay {
    position: absolute; inset: 0; z-index: 30;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    background: rgba(0,0,0,0.55);
    backdrop-filter: blur(2px);
  }

  .pb-countdown-ring {
    position: relative; width: 160px; height: 160px;
    display: flex; align-items: center; justify-content: center;
  }

  .pb-countdown-ring svg {
    position: absolute; inset: 0;
    transform: rotate(-90deg);
  }

  .pb-countdown-ring-bg { fill: none; stroke: rgba(255,255,255,0.15); stroke-width: 6; }
  .pb-countdown-ring-fill {
    fill: none; stroke: var(--coral);
    stroke-width: 6;
    stroke-linecap: round;
    transition: stroke-dashoffset 1s linear;
  }

  .pb-countdown-num {
    font-family: var(--font-display);
    font-size: 72px; font-weight: 900;
    color: white; line-height: 1;
    animation: cntPop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }

  @keyframes cntPop {
    0% { transform: scale(0.4); opacity: 0; }
    100% { transform: scale(1); opacity: 1; }
  }

  .pb-countdown-hint {
    margin-top: 20px; color: rgba(255,255,255,0.7);
    font-size: 15px; font-weight: 600; letter-spacing: 0.5px;
  }

  .pb-flash { position: absolute; inset: 0; z-index: 50; background: white; animation: flashOut 0.35s ease-out forwards; }
  @keyframes flashOut { 0% { opacity: 1; } 100% { opacity: 0; } }

  /* Camera bottom controls */
  .pb-camera-controls {
    position: absolute; bottom: 0; left: 0; right: 0; z-index: 20;
    padding: 24px 32px 32px;
    background: linear-gradient(0deg, rgba(0,0,0,0.8) 0%, transparent 100%);
    display: flex; align-items: center; justify-content: center; gap: 24px;
  }

  .pb-timer-group {
    display: flex; gap: 8px;
  }

  .pb-timer-btn {
    padding: 8px 14px; border-radius: 100px;
    border: 1.5px solid rgba(255,255,255,0.3);
    background: rgba(255,255,255,0.1);
    color: white; font-family: var(--font-body);
    font-size: 13px; font-weight: 700; cursor: pointer;
    transition: all 0.2s;
    backdrop-filter: blur(8px);
  }
  .pb-timer-btn:hover { border-color: white; background: rgba(255,255,255,0.2); }
  .pb-timer-btn.active { background: var(--coral); border-color: var(--coral); }

  .pb-capture-btn {
    width: 76px; height: 76px; border-radius: 50%;
    border: 4px solid white;
    background: white;
    cursor: pointer; position: relative;
    transition: transform 0.15s, box-shadow 0.15s;
    box-shadow: 0 0 0 0 rgba(255,107,107,0.5);
  }
  .pb-capture-btn::after {
    content: '';
    position: absolute; inset: 6px;
    border-radius: 50%;
    background: var(--coral);
    transition: transform 0.15s;
  }
  .pb-capture-btn:hover { transform: scale(1.08); box-shadow: 0 0 0 8px rgba(255,107,107,0.25); }
  .pb-capture-btn:active::after { transform: scale(0.88); }
  .pb-capture-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

  /* ====== CAMERA SIDEBAR ====== */
  .pb-sidebar {
    background: var(--white);
    border-left: 1.5px solid var(--cream2);
    display: flex; flex-direction: column;
    overflow-y: auto;
  }

  .pb-sidebar-header {
    padding: 24px 20px 16px;
    border-bottom: 1px solid var(--cream2);
  }

  .pb-sidebar-title {
    font-family: var(--font-display); font-size: 18px; font-weight: 700;
    color: var(--dark); margin: 0 0 4px;
  }

  .pb-sidebar-sub { font-size: 13px; color: var(--mid); margin: 0; }

  /* Progress steps */
  .pb-progress-steps {
    padding: 20px;
    display: flex; flex-direction: column; gap: 12px;
    flex: 1;
  }

  .pb-step {
    display: flex; align-items: center; gap: 12px;
    padding: 12px 14px;
    border-radius: 14px;
    border: 2px solid transparent;
    transition: all 0.25s;
  }
  .pb-step.done { background: #F0FDF4; border-color: #86EFAC; }
  .pb-step.active { background: #FFF5F5; border-color: var(--coral); }
  .pb-step.pending { background: var(--cream); }

  .pb-step-num {
    width: 32px; height: 32px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; font-weight: 800; flex-shrink: 0;
  }
  .pb-step.done .pb-step-num { background: #22C55E; color: white; }
  .pb-step.active .pb-step-num { background: var(--coral); color: white; animation: pulseSoft 1.5s infinite; }
  .pb-step.pending .pb-step-num { background: var(--cream2); color: var(--light); }

  @keyframes pulseSoft {
    0%, 100% { box-shadow: 0 0 0 0 rgba(255,107,107,0.4); }
    50% { box-shadow: 0 0 0 6px rgba(255,107,107,0); }
  }

  .pb-step-thumb {
    width: 48px; height: 48px; border-radius: 10px;
    overflow: hidden; flex-shrink: 0;
    background: var(--cream2);
    display: flex; align-items: center; justify-content: center;
  }
  .pb-step-thumb img { width: 100%; height: 100%; object-fit: cover; }
  .pb-step-thumb-empty { font-size: 18px; opacity: 0.4; }

  .pb-step-label { font-size: 13px; font-weight: 600; color: var(--dark2); }
  .pb-step-status { font-size: 11px; color: var(--mid); margin-top: 2px; }

  /* Sidebar footer */
  .pb-sidebar-footer {
    padding: 20px;
    border-top: 1px solid var(--cream2);
    display: flex; flex-direction: column; gap: 10px;
  }

  .pb-btn-full {
    width: 100%; padding: 12px;
    border-radius: 14px; border: none;
    font-family: var(--font-body);
    font-size: 14px; font-weight: 700;
    cursor: pointer; transition: all 0.2s;
  }
  .pb-btn-primary { background: var(--coral); color: white; }
  .pb-btn-primary:hover { background: var(--coral-dark); transform: translateY(-1px); }
  .pb-btn-ghost { background: transparent; color: var(--mid); border: 1.5px solid var(--cream2); }
  .pb-btn-ghost:hover { border-color: var(--mid); color: var(--dark2); }

  /* ====== PREVIEW STAGE ====== */
  .pb-preview-layout {
    display: grid;
    grid-template-columns: 1fr 360px;
    gap: 0;
    height: calc(100vh - 65px);
    overflow: hidden;
  }

  .pb-preview-main {
    padding: 40px;
    overflow-y: auto;
    background: var(--cream);
  }

  .pb-preview-title {
    font-family: var(--font-display); font-size: 36px; font-weight: 900;
    color: var(--dark); margin: 0 0 8px;
  }
  .pb-preview-title em { color: var(--coral); font-style: italic; }
  .pb-preview-sub { color: var(--mid); font-size: 15px; margin: 0 0 32px; }

  .pb-preview-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 20px;
  }

  .pb-preview-card {
    background: white; border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 4px 20px var(--shadow);
    position: relative;
  }

  .pb-preview-card-img {
    width: 100%; aspect-ratio: 3/4;
    object-fit: cover;
    display: block;
    transform: scaleX(-1);
  }

  .pb-preview-card-overlay {
    position: absolute; inset: 0;
    background: rgba(0,0,0,0.5);
    display: flex; align-items: center; justify-content: center;
    opacity: 0; transition: opacity 0.2s;
    backdrop-filter: blur(4px);
  }
  .pb-preview-card:hover .pb-preview-card-overlay { opacity: 1; }

  .pb-retake-btn {
    padding: 10px 20px; border-radius: 100px;
    background: white; color: var(--coral);
    border: none; font-family: var(--font-body);
    font-size: 13px; font-weight: 700; cursor: pointer;
    transition: all 0.2s;
  }
  .pb-retake-btn:hover { background: var(--coral); color: white; }

  .pb-preview-card-num {
    position: absolute; top: 10px; left: 10px;
    width: 28px; height: 28px; border-radius: 50%;
    background: white; color: var(--dark2);
    display: flex; align-items: center; justify-content: center;
    font-size: 13px; font-weight: 800;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  }

  /* Preview side panel */
  .pb-preview-side {
    background: var(--white);
    border-left: 1.5px solid var(--cream2);
    padding: 32px 24px;
    display: flex; flex-direction: column; gap: 20px;
    overflow-y: auto;
  }

  .pb-composite-preview {
    width: 100%;
    border-radius: 16px; overflow: hidden;
    background: repeating-conic-gradient(#EFE5D8 0% 25%, #F5EDE0 0% 50%) 0 0 / 12px 12px;
    aspect-ratio: 2/3;
    display: flex; align-items: center; justify-content: center;
    font-size: 40px; color: var(--light);
  }

  .pb-composite-preview img {
    width: 100%; height: 100%; object-fit: contain;
  }

  /* ====== RESULT STAGE ====== */
  .pb-result-layout {
    display: grid;
    grid-template-columns: 1fr 360px;
    gap: 0;
    height: calc(100vh - 65px);
    overflow: hidden;
  }

  .pb-result-main {
    background: var(--dark);
    display: flex; align-items: center; justify-content: center;
    padding: 40px; overflow-y: auto;
    position: relative;
  }

  .pb-result-main::before {
    content: '';
    position: absolute; inset: 0;
    background: radial-gradient(ellipse at center, rgba(255,107,107,0.15) 0%, transparent 70%);
    pointer-events: none;
  }

  .pb-result-img-wrapper {
    position: relative; max-width: 400px; width: 100%;
    filter: drop-shadow(0 30px 60px rgba(0,0,0,0.8));
    animation: resultReveal 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
  }

  @keyframes resultReveal {
    0% { transform: scale(0.7) rotate(-3deg); opacity: 0; }
    100% { transform: scale(1) rotate(0deg); opacity: 1; }
  }

  .pb-result-img-wrapper img {
    width: 100%; border-radius: 4px; display: block;
  }

  /* Polaroid tape */
  .pb-tape {
    position: absolute; top: -14px; left: 50%;
    transform: translateX(-50%) rotate(-1.5deg);
    width: 80px; height: 28px;
    background: rgba(255,249,196,0.75);
    backdrop-filter: blur(4px);
    border-radius: 3px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  }

  .pb-result-side {
    background: var(--white);
    border-left: 1.5px solid var(--cream2);
    padding: 40px 28px;
    display: flex; flex-direction: column; gap: 16px;
    overflow-y: auto;
  }

  .pb-result-congrats {
    font-family: var(--font-display);
    font-size: 32px; font-weight: 900; color: var(--dark);
    line-height: 1.2; margin: 0 0 4px;
  }
  .pb-result-congrats em { color: var(--coral); font-style: italic; }

  .pb-result-hint { font-size: 14px; color: var(--mid); margin: 0 0 24px; }

  .pb-action-btn {
    display: flex; align-items: center; gap: 12px;
    padding: 16px 20px;
    border-radius: 16px; border: 2px solid transparent;
    background: var(--cream);
    font-family: var(--font-body);
    font-size: 15px; font-weight: 700;
    color: var(--dark2); cursor: pointer;
    transition: all 0.2s; width: 100%;
    text-align: left;
  }
  .pb-action-btn:hover { border-color: var(--coral); background: #FFF5F5; }
  .pb-action-btn.primary { background: var(--coral); color: white; border-color: var(--coral); }
  .pb-action-btn.primary:hover { background: var(--coral-dark); }

  .pb-action-icon {
    width: 40px; height: 40px; border-radius: 12px;
    background: rgba(255,255,255,0.25);
    display: flex; align-items: center; justify-content: center;
    font-size: 20px; flex-shrink: 0;
  }
  .pb-action-btn:not(.primary) .pb-action-icon {
    background: var(--cream2);
  }

  .pb-action-text-wrap { flex: 1; }
  .pb-action-title { display: block; }
  .pb-action-desc { font-size: 12px; font-weight: 400; opacity: 0.7; display: block; margin-top: 2px; }

  .pb-divider { height: 1px; background: var(--cream2); margin: 4px 0; }

  /* Saving indicator */
  .pb-saving-badge {
    display: flex; align-items: center; gap: 8px;
    padding: 12px 16px; border-radius: 12px;
    background: #F0FDF4; border: 1.5px solid #86EFAC;
    font-size: 13px; font-weight: 600; color: #16A34A;
    animation: fadeIn 0.3s;
  }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

  /* ====== LOADING ====== */
  .pb-generating {
    position: fixed; inset: 0; z-index: 200;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    background: rgba(26,18,8,0.85);
    backdrop-filter: blur(8px);
  }

  .pb-spinner {
    width: 56px; height: 56px; border-radius: 50%;
    border: 4px solid rgba(255,255,255,0.1);
    border-top-color: var(--coral);
    animation: spin 0.8s linear infinite;
    margin-bottom: 20px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .pb-gen-text {
    color: white; font-family: var(--font-display);
    font-size: 22px; font-weight: 700; font-style: italic;
  }

  /* ====== RESPONSIVE ====== */
  @media (max-width: 900px) {
    .pb-camera-layout,
    .pb-preview-layout,
    .pb-result-layout {
      grid-template-columns: 1fr;
    }

    .pb-sidebar,
    .pb-preview-side,
    .pb-result-side {
      height: auto; max-height: 50vh;
      border-left: none; border-top: 1.5px solid var(--cream2);
    }

    .pb-camera-layout {
      grid-template-rows: 1fr auto;
    }
    .pb-camera-main { height: 55vh; }

    .pb-template-grid { padding: 20px; gap: 16px; }
    .pb-filterbar { padding: 12px 20px; }
    .pb-hero { padding: 32px 20px 20px; }
    .pb-result-main { min-height: 55vh; }
    .pb-result-img-wrapper { max-width: 260px; }

    .pb-topbar { padding: 12px 20px; }
    .pb-hero-title { font-size: 28px; }
  }
`;

// ==========================================
// 🔢 SVG COUNTDOWN RING
// ==========================================
function CountdownRing({ value, max }: { value: number; max: number }) {
  const r = 66;
  const circ = 2 * Math.PI * r;
  const progress = value / max;
  const offset = circ * (1 - progress);

  return (
    <div className="pb-countdown-ring">
      <svg width="160" height="160" viewBox="0 0 160 160">
        <circle className="pb-countdown-ring-bg" cx="80" cy="80" r={r} />
        <circle
          className="pb-countdown-ring-fill"
          cx="80" cy="80" r={r}
          strokeDasharray={circ}
          strokeDashoffset={offset}
        />
      </svg>
      <span key={value} className="pb-countdown-num">{value}</span>
    </div>
  );
}

// ==========================================
// 📸 MAIN COMPONENT
// ==========================================
export function PhotoboxPage() {
  const [stage, setStage] = useState<Stage>('template-selection');
  const [templates, setTemplates] = useState<PhotoTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<PhotoTemplate | null>(null);
  const [capturedPhotos, setCapturedPhotos] = useState<CapturedPhoto[]>([]);
  const [currentSlotIndex, setCurrentSlotIndex] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [countdownDuration, setCountdownDuration] = useState(3);
  const [isFlashing, setIsFlashing] = useState(false);
  const [finalImage, setFinalImage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [filterCount, setFilterCount] = useState<FilterCount>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const webcamRef = useRef<Webcam>(null);
  const compositeCanvasRef = useRef<HTMLCanvasElement>(null);

  // Load templates
  useEffect(() => {
    const q = query(collection(db, 'photobox_templates'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snap) => {
      setTemplates(snap.docs.map(d => ({ id: d.id, ...d.data() })) as PhotoTemplate[]);
    });
  }, []);

  // Countdown logic
  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      doCapture();
      setCountdown(null);
      return;
    }
    const t = setTimeout(() => setCountdown(c => c !== null ? c - 1 : null), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  // ---- HANDLERS ----
  const selectTemplate = (t: PhotoTemplate) => {
    setSelectedTemplate(t);
    setCapturedPhotos([]);
    setCurrentSlotIndex(0);
    setStage('camera-capture');
  };

  const startCountdown = () => {
    if (countdown !== null) return;
    setCountdown(countdownDuration);
  };

  const doCapture = useCallback(() => {
    if (!webcamRef.current) return;
    const src = webcamRef.current.getScreenshot();
    if (!src) return;

    setIsFlashing(true);
    setTimeout(() => setIsFlashing(false), 350);

    setCapturedPhotos(prev => {
      const updated = [...prev, { slotIndex: currentSlotIndex, dataUrl: src }];
      if (selectedTemplate && updated.length >= selectedTemplate.photoCount) {
        // Go to preview
        setCurrentSlotIndex(0);
        setStage('preview');
      } else {
        setCurrentSlotIndex(idx => idx + 1);
      }
      return updated;
    });
  }, [webcamRef, currentSlotIndex, selectedTemplate]);

  const retakePhoto = (slotIndex: number) => {
    setCapturedPhotos(prev => prev.filter(p => p.slotIndex !== slotIndex));
    setCurrentSlotIndex(slotIndex);
    setStage('camera-capture');
  };

  const generateComposite = async (photos: CapturedPhoto[]) => {
    if (!selectedTemplate || !compositeCanvasRef.current) return;
    setIsGenerating(true);

    const canvas = compositeCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) { setIsGenerating(false); return; }

    canvas.width = selectedTemplate.canvasWidth;
    canvas.height = selectedTemplate.canvasHeight;

    // White bg
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw photos into slots (mirror horizontally to match webcam preview)
    for (const photo of photos) {
      const slot = selectedTemplate.slots[photo.slotIndex];
      if (!slot) continue;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>(res => {
        img.onload = () => {
          ctx.save();
          // Mirror to match how user sees themselves
          ctx.translate(slot.x + slot.width, slot.y);
          ctx.scale(-1, 1);
          ctx.drawImage(img, 0, 0, slot.width, slot.height);
          ctx.restore();
          res();
        };
        img.src = photo.dataUrl;
      });
    }

    // Draw template frame on top (sandwich technique)
    const frameImg = new Image();
    frameImg.crossOrigin = 'anonymous';
    await new Promise<void>(res => {
      frameImg.onload = () => {
        ctx.drawImage(frameImg, 0, 0, canvas.width, canvas.height);
        res();
      };
      frameImg.src = selectedTemplate.imageUrl;
    });

    setFinalImage(canvas.toDataURL('image/png'));
    setIsGenerating(false);
    setStage('result');
  };

  const downloadImage = () => {
    if (!finalImage) return;
    const a = document.createElement('a');
    a.href = finalImage;
    a.download = `photobox-${Date.now()}.png`;
    a.click();
  };

  const saveToGallery = async () => {
    if (!finalImage) return;
    try {
      await addDoc(collection(db, 'secret_photos'), {
        url: finalImage,
        templateId: selectedTemplate?.id,
        createdAt: new Date().toISOString()
      });
      setSavedOk(true);
    } catch (e) {
      console.error(e);
      alert('Gagal simpan ke galeri');
    }
  };

  const resetSession = () => {
    setStage('template-selection');
    setSelectedTemplate(null);
    setCapturedPhotos([]);
    setCurrentSlotIndex(0);
    setFinalImage(null);
    setSavedOk(false);
    setCountdown(null);
  };

  // ---- FILTERED TEMPLATES ----
  const filteredTemplates = templates.filter(t => {
    const countOk = filterCount === 'all' || String(t.photoCount) === filterCount;
    const searchOk = !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase());
    return countOk && searchOk;
  });

  // Count distinct photo counts for filter pills
  const availableCounts = Array.from(new Set(templates.map(t => t.photoCount))).sort();

  // ==========================================
  // RENDER
  // ==========================================
  return (
    <div className="pb-root">
      <style>{CSS}</style>

      {/* Hidden composite canvas */}
      <canvas ref={compositeCanvasRef} style={{ display: 'none' }} />

      {/* Generating overlay */}
      {isGenerating && (
        <div className="pb-generating">
          <div className="pb-spinner" />
          <div className="pb-gen-text">Menyusun foto kamu...</div>
        </div>
      )}

      {/* ======= TOP BAR ======= */}
      <header className="pb-topbar">
        <div className="pb-logo">
          <span className="pb-logo-dot" />
          Photobox
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {stage !== 'template-selection' && (
            <button className="pb-back-btn" onClick={resetSession}>
              ← Ganti Template
            </button>
          )}
          <button className="pb-back-btn" onClick={() => window.history.back()}>
            ✕ Keluar
          </button>
        </div>
      </header>

      {/* ======= STAGE: TEMPLATE SELECTION ======= */}
      {stage === 'template-selection' && (
        <div className="pb-scroll">
          {/* Hero */}
          <div className="pb-hero">
            <div className="pb-hero-tag">✨ Digital Photobox</div>
            <h1 className="pb-hero-title">
              Pilih <em>template</em> kamu,<br />lalu kita mulai!
            </h1>
            <p className="pb-hero-sub">
              {templates.length} template tersedia — gratis, instant, dan bisa didownload
            </p>
          </div>

          {/* Filter bar */}
          <div className="pb-filterbar">
            <span className="pb-filter-label">Foto:</span>
            <div className="pb-filter-pills">
              <button
                className={`pb-pill ${filterCount === 'all' ? 'active' : ''}`}
                onClick={() => setFilterCount('all')}
              >
                Semua
              </button>
              {availableCounts.map(c => (
                <button
                  key={c}
                  className={`pb-pill ${filterCount === String(c) ? 'active' : ''}`}
                  onClick={() => setFilterCount(String(c) as FilterCount)}
                >
                  {c} Foto
                </button>
              ))}
            </div>

            <div className="pb-search">
              <span style={{ fontSize: 16, color: 'var(--light)' }}>🔍</span>
              <input
                type="text"
                placeholder="Cari template..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* Template grid */}
          <div className="pb-template-grid">
            {filteredTemplates.length === 0 ? (
              <div className="pb-empty">
                <div className="pb-empty-icon">📦</div>
                <h3>{templates.length === 0 ? 'Belum ada template' : 'Tidak ditemukan'}</h3>
                <p>
                  {templates.length === 0
                    ? 'Admin belum upload template. Hubungi admin dulu ya!'
                    : 'Coba ubah filter atau kata kunci pencarian.'}
                </p>
              </div>
            ) : (
              filteredTemplates.map(t => (
                <div key={t.id} className="pb-template-card" onClick={() => selectTemplate(t)}>
                  <div className="pb-card-badge">
                    📸 {t.photoCount} foto
                  </div>

                  <div className="pb-card-preview">
                    <img src={t.imageUrl} alt={t.name} loading="lazy" />
                    <div className="pb-card-hover-btn">
                      <button className="pb-select-btn">Pilih Template →</button>
                    </div>
                  </div>

                  <div className="pb-card-info">
                    <div>
                      <div className="pb-card-name">{t.name}</div>
                      {t.tags && t.tags.length > 0 && (
                        <div className="pb-card-tags">
                          {t.tags.slice(0, 3).map(tag => (
                            <span key={tag} className="pb-tag">{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="pb-card-arrow">→</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ======= STAGE: CAMERA CAPTURE ======= */}
      {stage === 'camera-capture' && selectedTemplate && (
        <div className="pb-camera-layout">
          {/* Main camera area */}
          <div className="pb-camera-main">
            <div className="pb-camera-topbar">
              <div className="pb-camera-title">
                Foto {currentSlotIndex + 1} dari {selectedTemplate.photoCount}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {[3, 5, 10].map(s => (
                  <button
                    key={s}
                    className={`pb-timer-btn ${countdownDuration === s ? 'active' : ''}`}
                    onClick={() => setCountdownDuration(s)}
                    disabled={countdown !== null}
                  >
                    {s}s
                  </button>
                ))}
              </div>
            </div>

            <div className="pb-camera-frame-wrapper">
              <Webcam
                ref={webcamRef}
                audio={false}
                screenshotFormat="image/jpeg"
                className="pb-webcam"
                videoConstraints={{ facingMode: 'user', width: 1280, height: 720 }}
                style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
              />

              {/* Live frame overlay (sandwich technique in preview) */}
              <div className="pb-frame-overlay">
                <img src={selectedTemplate.imageUrl} alt="frame" />
              </div>

              {/* Countdown */}
              {countdown !== null && countdown > 0 && (
                <div className="pb-countdown-overlay">
                  <CountdownRing value={countdown} max={countdownDuration} />
                  <div className="pb-countdown-hint">Berpose dulu!</div>
                </div>
              )}

              {/* Flash */}
              {isFlashing && <div className="pb-flash" />}
            </div>

            <div className="pb-camera-controls">
              <button
                className="pb-capture-btn"
                onClick={startCountdown}
                disabled={countdown !== null}
                title="Ambil foto"
              />
            </div>
          </div>

          {/* Sidebar */}
          <aside className="pb-sidebar">
            <div className="pb-sidebar-header">
              <div className="pb-sidebar-title">{selectedTemplate.name}</div>
              <p className="pb-sidebar-sub">
                {selectedTemplate.photoCount} foto • {selectedTemplate.canvasWidth}×{selectedTemplate.canvasHeight}px
              </p>
            </div>

            <div className="pb-progress-steps">
              {Array.from({ length: selectedTemplate.photoCount }).map((_, i) => {
                const captured = capturedPhotos.find(p => p.slotIndex === i);
                const status = captured ? 'done' : i === currentSlotIndex ? 'active' : 'pending';
                return (
                  <div key={i} className={`pb-step ${status}`}>
                    <div className="pb-step-num">
                      {status === 'done' ? '✓' : i + 1}
                    </div>
                    <div className="pb-step-thumb">
                      {captured
                        ? <img src={captured.dataUrl} alt="" style={{ transform: 'scaleX(-1)' }} />
                        : <span className="pb-step-thumb-empty">📷</span>
                      }
                    </div>
                    <div>
                      <div className="pb-step-label">Foto {i + 1}</div>
                      <div className="pb-step-status">
                        {status === 'done' ? '✓ Sudah diambil' : status === 'active' ? '← Sekarang' : 'Menunggu...'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pb-sidebar-footer">
              <button className="pb-btn-full pb-btn-ghost" onClick={resetSession}>
                ← Ganti Template
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* ======= STAGE: PREVIEW ======= */}
      {stage === 'preview' && selectedTemplate && (
        <div className="pb-preview-layout">
          <div className="pb-preview-main">
            <h2 className="pb-preview-title">Cek dulu <em>hasilnya!</em></h2>
            <p className="pb-preview-sub">
              Hover foto untuk retake. Kalau sudah oke, klik "Proses Foto"!
            </p>

            <div className="pb-preview-grid">
              {capturedPhotos.map((photo, idx) => (
                <div key={idx} className="pb-preview-card">
                  <img
                    className="pb-preview-card-img"
                    src={photo.dataUrl}
                    alt={`Foto ${idx + 1}`}
                  />
                  <div className="pb-preview-card-num">{idx + 1}</div>
                  <div className="pb-preview-card-overlay">
                    <button
                      className="pb-retake-btn"
                      onClick={() => retakePhoto(photo.slotIndex)}
                    >
                      🔄 Retake
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <aside className="pb-preview-side">
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--dark)' }}>
              Template: {selectedTemplate.name}
            </div>

            {/* Mini composite preview placeholder */}
            <div className="pb-composite-preview">
              <img src={selectedTemplate.imageUrl} alt="preview frame" />
            </div>

            <div style={{ fontSize: 13, color: 'var(--mid)', lineHeight: 1.6 }}>
              {capturedPhotos.length} dari {selectedTemplate.photoCount} foto siap.
              Hover tiap foto untuk retake, atau lanjut proses sekarang!
            </div>

            <button
              className="pb-btn-full pb-btn-primary"
              onClick={() => generateComposite(capturedPhotos)}
              disabled={capturedPhotos.length < selectedTemplate.photoCount}
              style={{ padding: '14px', fontSize: 15 }}
            >
              🎨 Proses Foto!
            </button>

            <button className="pb-btn-full pb-btn-ghost" onClick={resetSession}>
              Mulai Ulang
            </button>
          </aside>
        </div>
      )}

      {/* ======= STAGE: RESULT ======= */}
      {stage === 'result' && finalImage && (
        <div className="pb-result-layout">
          {/* Dark display area */}
          <div className="pb-result-main">
            <div className="pb-result-img-wrapper">
              <div className="pb-tape" />
              <img src={finalImage} alt="Hasil Photobox" />
            </div>
          </div>

          {/* Actions panel */}
          <aside className="pb-result-side">
            <h2 className="pb-result-congrats">
              Foto kamu<br /><em>udah jadi!</em> 🎉
            </h2>
            <p className="pb-result-hint">
              Simpan, download, atau bagikan ke temen-temen kamu!
            </p>

            <button className="pb-action-btn primary" onClick={downloadImage}>
              <div className="pb-action-icon">📥</div>
              <div className="pb-action-text-wrap">
                <span className="pb-action-title">Download Foto</span>
                <span className="pb-action-desc">Simpan sebagai file PNG</span>
              </div>
            </button>

            <button className="pb-action-btn" onClick={saveToGallery} disabled={savedOk}>
              <div className="pb-action-icon">☁️</div>
              <div className="pb-action-text-wrap">
                <span className="pb-action-title">Simpan ke Galeri</span>
                <span className="pb-action-desc">Admin bisa lihat di dashboard</span>
              </div>
            </button>

            {savedOk && (
              <div className="pb-saving-badge">
                ✅ Berhasil disimpan ke galeri!
              </div>
            )}

            <div className="pb-divider" />

            <button className="pb-action-btn" onClick={resetSession}>
              <div className="pb-action-icon">🔄</div>
              <div className="pb-action-text-wrap">
                <span className="pb-action-title">Foto Lagi</span>
                <span className="pb-action-desc">Pilih template baru</span>
              </div>
            </button>

            <button
              className="pb-action-btn"
              onClick={() => {
                setCapturedPhotos([]);
                setCurrentSlotIndex(0);
                setFinalImage(null);
                setStage('camera-capture');
              }}
            >
              <div className="pb-action-icon">📸</div>
              <div className="pb-action-text-wrap">
                <span className="pb-action-title">Ulangi dengan Template Ini</span>
                <span className="pb-action-desc">Pakai frame yang sama</span>
              </div>
            </button>
          </aside>
        </div>
      )}
    </div>
  );
}