import React, { useRef, useState, useEffect } from 'react';
import Webcam from 'react-webcam';
import html2canvas from 'html2canvas';
import Draggable from 'react-draggable';
import Confetti from 'react-confetti';
import { QRCodeSVG } from 'qrcode.react';
import { db, storage } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

// ========================================
// 🎯 TYPES
// ========================================
type PhotoLayout = '2-vertical' | '3-vertical' | '4-vertical' | '2x2-grid' | '3x3-grid' | '4-custom';
type CanvasSize = '4:5' | '9:16' | '1:1' | '707x2000' | 'custom';
type FilterType = 'normal' | 'bw' | 'vintage' | 'vibrant' | 'soft' | 'warm';

type Frame = {
  id: string;
  name: string;
  imageUrl?: string;
  color?: string;
  type: 'color' | 'image';
};

type Sticker = {
  id: string;
  name: string;
  imageUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
};

type PhotoCapture = {
  id: string;
  dataUrl: string;
  filter: FilterType;
  timestamp: number;
};

type TextOverlay = {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontFamily: string;
  rotation: number;
};

// ========================================
// 🎨 CONSTANTS
// ========================================
const CANVAS_SIZES = {
  '4:5': { width: 1080, height: 1350 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '707x2000': { width: 707, height: 2000 },
};

const LAYOUTS = {
  '2-vertical': { photoCount: 2, gridCols: 1, gridRows: 2 },
  '3-vertical': { photoCount: 3, gridCols: 1, gridRows: 3 },
  '4-vertical': { photoCount: 4, gridCols: 1, gridRows: 4 },
  '2x2-grid': { photoCount: 4, gridCols: 2, gridRows: 2 },
  '3x3-grid': { photoCount: 9, gridCols: 3, gridRows: 3 },
  '4-custom': { photoCount: 4, gridCols: 2, gridRows: 2 },
};

const FILTERS: FilterType[] = ['normal', 'bw', 'vintage', 'vibrant', 'soft', 'warm'];

const COUNTDOWN_SOUNDS = {
  3: new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'),
  2: new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'),
  1: new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'),
  0: new Audio('https://assets.mixkit.co/active_storage/sfx/2018/2018-preview.mp3'), // Camera shutter
};

// Mock data - nanti di-fetch dari Firebase
const MOCK_FRAMES: Frame[] = [
  { id: 'f1', name: 'Pink Pastel', color: '#FFB6C1', type: 'color' },
  { id: 'f2', name: 'Baby Blue', color: '#89CFF0', type: 'color' },
  { id: 'f3', name: 'Mint Green', color: '#98FF98', type: 'color' },
  { id: 'f4', name: 'Lavender', color: '#E6E6FA', type: 'color' },
];

const MOCK_STICKERS: Omit<Sticker, 'x' | 'y' | 'rotation' | 'flipX' | 'flipY' | 'width' | 'height'>[] = [
  { id: 's1', name: 'Heart', imageUrl: 'https://em-content.zobj.net/thumbs/240/apple/354/sparkling-heart_1f496.png' },
  { id: 's2', name: 'Star', imageUrl: 'https://em-content.zobj.net/thumbs/240/apple/354/star_2b50.png' },
  { id: 's3', name: 'Rainbow', imageUrl: 'https://em-content.zobj.net/thumbs/240/apple/354/rainbow_1f308.png' },
  { id: 's4', name: 'Butterfly', imageUrl: 'https://em-content.zobj.net/thumbs/240/apple/354/butterfly_1f98b.png' },
];

// ========================================
// 🚀 MAIN COMPONENT
// ========================================
export function PhotoboxPage() {
  const webcamRef = useRef<Webcam>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // ========== STEP CONTROL ==========
  const [step, setStep] = useState<'setup' | 'capture' | 'preview' | 'edit' | 'final'>('setup');

  // ========== SETUP CONFIG ==========
  const [photoCount, setPhotoCount] = useState(4);
  const [layout, setLayout] = useState<PhotoLayout>('4-vertical');
  const [canvasSize, setCanvasSize] = useState<CanvasSize>('4:5');
  const [customSize, setCustomSize] = useState({ width: 1080, height: 1350 });
  const [timerDuration, setTimerDuration] = useState(3);
  const [enableMusic, setEnableMusic] = useState(false);

  // ========== CAPTURE STATE ==========
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [capturedPhotos, setCapturedPhotos] = useState<PhotoCapture[]>([]);
  const [currentFilter, setCurrentFilter] = useState<FilterType>('normal');

  // ========== EDIT STATE ==========
  const [selectedFrame, setSelectedFrame] = useState<Frame>(MOCK_FRAMES[0]);
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [textOverlays, setTextOverlays] = useState<TextOverlay[]>([]);
  const [selectedStickerId, setSelectedStickerId] = useState<string | null>(null);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);

  // ========== UI STATE ==========
  const [showConfetti, setShowConfetti] = useState(false);
  const [finalImageUrl, setFinalImageUrl] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  // ========== HISTORY (UNDO/REDO) ==========
  const [history, setHistory] = useState<any[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // ========================================
  // 📸 PHOTO CAPTURE LOGIC
  // ========================================
  const startCapture = () => {
    setStep('capture');
    setCurrentPhotoIndex(0);
    setCapturedPhotos([]);
    captureNextPhoto();
  };

  const captureNextPhoto = () => {
    if (timerDuration > 0) {
      setCountdown(timerDuration);
    } else {
      takePhoto();
    }
  };

  useEffect(() => {
    if (countdown === null) return;
    
    if (countdown > 0) {
      // Play countdown sound
      if (COUNTDOWN_SOUNDS[countdown as 3 | 2 | 1]) {
        COUNTDOWN_SOUNDS[countdown as 3 | 2 | 1].play();
      }
      
      const timer = setTimeout(() => {
        setCountdown(countdown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      // Take photo when countdown reaches 0
      COUNTDOWN_SOUNDS[0].play();
      takePhoto();
      setCountdown(null);
    }
  }, [countdown]);

  const takePhoto = async () => {
    const imageSrc = webcamRef.current?.getScreenshot();
    if (!imageSrc) return;

    const newPhoto: PhotoCapture = {
      id: `photo-${Date.now()}`,
      dataUrl: imageSrc,
      filter: currentFilter,
      timestamp: Date.now(),
    };

    setCapturedPhotos(prev => [...prev, newPhoto]);

    // Upload ke Firebase Storage IMMEDIATELY
    await uploadPhotoToFirebase(imageSrc);

    // Check if we need more photos
    if (currentPhotoIndex + 1 < photoCount) {
      setCurrentPhotoIndex(prev => prev + 1);
      setTimeout(() => captureNextPhoto(), 1000); // 1s delay between shots
    } else {
      // All photos captured!
      setStep('preview');
    }
  };

  const retakePhoto = (index: number) => {
    setCapturedPhotos(prev => prev.filter((_, i) => i !== index));
    setCurrentPhotoIndex(index);
    setStep('capture');
    captureNextPhoto();
  };

  // ========================================
  // 🔥 FIREBASE UPLOAD
  // ========================================
  const uploadPhotoToFirebase = async (dataUrl: string) => {
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const timestamp = Date.now();
      const storageRef = ref(storage, `photobox/raw/${timestamp}.jpg`);
      
      await uploadBytes(storageRef, blob);
      const downloadUrl = await getDownloadURL(storageRef);

      // Save metadata to Firestore
      await addDoc(collection(db, 'photobox_raw'), {
        url: downloadUrl,
        createdAt: serverTimestamp(),
        type: 'raw_capture',
      });

      console.log('✅ Photo uploaded to Firebase:', downloadUrl);
    } catch (error) {
      console.error('❌ Upload error:', error);
    }
  };

  const uploadFinalDesign = async (dataUrl: string) => {
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const timestamp = Date.now();
      const storageRef = ref(storage, `photobox/final/${timestamp}.jpg`);
      
      await uploadBytes(storageRef, blob);
      const downloadUrl = await getDownloadURL(storageRef);

      // Save to Firestore
      await addDoc(collection(db, 'photobox_final'), {
        url: downloadUrl,
        createdAt: serverTimestamp(),
        layout,
        photoCount,
        frameId: selectedFrame.id,
        stickerCount: stickers.length,
        textCount: textOverlays.length,
      });

      setFinalImageUrl(downloadUrl);
      console.log('✅ Final design uploaded:', downloadUrl);
    } catch (error) {
      console.error('❌ Final upload error:', error);
    }
  };

  // ========================================
  // 🎨 EDITING FUNCTIONS
  // ========================================
  const addSticker = (sticker: typeof MOCK_STICKERS[0]) => {
    const newSticker: Sticker = {
      ...sticker,
      x: 200,
      y: 200,
      width: 100,
      height: 100,
      rotation: 0,
      flipX: false,
      flipY: false,
    };
    setStickers(prev => [...prev, newSticker]);
    saveHistory();
  };

  const updateSticker = (id: string, updates: Partial<Sticker>) => {
    setStickers(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
    saveHistory();
  };

  const deleteSticker = (id: string) => {
    setStickers(prev => prev.filter(s => s.id !== id));
    setSelectedStickerId(null);
    saveHistory();
  };

  const addText = () => {
    const newText: TextOverlay = {
      id: `text-${Date.now()}`,
      text: 'Your Text Here',
      x: 200,
      y: 200,
      fontSize: 32,
      color: '#FFFFFF',
      fontFamily: 'Arial',
      rotation: 0,
    };
    setTextOverlays(prev => [...prev, newText]);
    saveHistory();
  };

  const updateText = (id: string, updates: Partial<TextOverlay>) => {
    setTextOverlays(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    saveHistory();
  };

  const deleteText = (id: string) => {
    setTextOverlays(prev => prev.filter(t => t.id !== id));
    setSelectedTextId(null);
    saveHistory();
  };

  // ========================================
  // 🔄 UNDO/REDO
  // ========================================
  const saveHistory = () => {
    const state = { stickers: [...stickers], textOverlays: [...textOverlays] };
    setHistory(prev => [...prev.slice(0, historyIndex + 1), state]);
    setHistoryIndex(prev => prev + 1);
  };

  const undo = () => {
    if (historyIndex > 0) {
      const prevState = history[historyIndex - 1];
      setStickers(prevState.stickers);
      setTextOverlays(prevState.textOverlays);
      setHistoryIndex(prev => prev - 1);
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const nextState = history[historyIndex + 1];
      setStickers(nextState.stickers);
      setTextOverlays(nextState.textOverlays);
      setHistoryIndex(prev => prev + 1);
    }
  };

  // ========================================
  // 💾 EXPORT TO IMAGE
  // ========================================
  const exportImage = async () => {
    if (!canvasRef.current) return;

    setIsProcessing(true);
    setUploadProgress(20);

    try {
      const canvas = await html2canvas(canvasRef.current, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: null,
      });

      setUploadProgress(60);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
      
      setUploadProgress(80);

      // Upload to Firebase
      await uploadFinalDesign(dataUrl);

      setUploadProgress(100);
      setShowConfetti(true);
      setStep('final');

      setTimeout(() => setShowConfetti(false), 5000);
    } catch (error) {
      console.error('Export error:', error);
      alert('Gagal export image. Coba lagi!');
    } finally {
      setIsProcessing(false);
      setUploadProgress(0);
    }
  };

  // ========================================
  // 🎨 FILTER CSS
  // ========================================
  const getFilterStyle = (filter: FilterType): React.CSSProperties => {
    const filters = {
      normal: 'none',
      bw: 'grayscale(100%)',
      vintage: 'sepia(50%) contrast(1.2) brightness(0.9)',
      vibrant: 'saturate(1.5) contrast(1.1)',
      soft: 'brightness(1.1) contrast(0.9)',
      warm: 'sepia(30%) saturate(1.2)',
    };
    return { filter: filters[filter] };
  };

  // ========================================
  // 📐 CANVAS SIZE CALCULATOR
  // ========================================
  const getCanvasDimensions = () => {
    if (canvasSize === 'custom') return customSize;
    return CANVAS_SIZES[canvasSize];
  };

  const dimensions = getCanvasDimensions();

  // ========================================
  // 🎬 RENDER
  // ========================================
  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', padding: '40px 20px' }}>
      {showConfetti && <Confetti recycle={false} numberOfPieces={500} />}

      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        
        {/* ========== HEADER ========== */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <h1 style={{ fontSize: '48px', color: 'white', margin: '0 0 10px 0', fontWeight: '800', textShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
            📸 Photo Booth Pro Max
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.9)', fontSize: '18px', margin: 0 }}>
            Snap, Edit, Share - Ultra GACOR! ✨
          </p>
        </div>

        {/* ========== STEP 1: SETUP ========== */}
        {step === 'setup' && (
          <div style={{ background: 'white', borderRadius: '24px', padding: '40px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h2 style={{ fontSize: '28px', marginTop: 0, marginBottom: '30px', color: '#1e293b' }}>⚙️ Konfigurasi Booth</h2>

            {/* Photo Count */}
            <div style={{ marginBottom: '30px' }}>
              <label style={{ display: 'block', fontWeight: '600', marginBottom: '12px', color: '#475569', fontSize: '16px' }}>
                📸 Jumlah Foto
              </label>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                {[2, 3, 4, 6, 9].map(count => (
                  <button
                    key={count}
                    onClick={() => setPhotoCount(count)}
                    style={{
                      padding: '12px 24px',
                      border: photoCount === count ? '3px solid #667eea' : '2px solid #e2e8f0',
                      background: photoCount === count ? '#667eea' : 'white',
                      color: photoCount === count ? 'white' : '#1e293b',
                      borderRadius: '12px',
                      fontSize: '16px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    {count} Foto
                  </button>
                ))}
              </div>
            </div>

            {/* Layout */}
            <div style={{ marginBottom: '30px' }}>
              <label style={{ display: 'block', fontWeight: '600', marginBottom: '12px', color: '#475569', fontSize: '16px' }}>
                📐 Layout Foto
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
                {Object.keys(LAYOUTS).map(layoutKey => (
                  <button
                    key={layoutKey}
                    onClick={() => {
                      setLayout(layoutKey as PhotoLayout);
                      setPhotoCount(LAYOUTS[layoutKey as PhotoLayout].photoCount);
                    }}
                    style={{
                      padding: '16px',
                      border: layout === layoutKey ? '3px solid #667eea' : '2px solid #e2e8f0',
                      background: layout === layoutKey ? '#f1f5f9' : 'white',
                      borderRadius: '12px',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: '14px', fontWeight: '600', color: '#1e293b' }}>
                      {layoutKey.replace('-', ' ').toUpperCase()}
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                      {LAYOUTS[layoutKey as PhotoLayout].photoCount} foto
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Canvas Size */}
            <div style={{ marginBottom: '30px' }}>
              <label style={{ display: 'block', fontWeight: '600', marginBottom: '12px', color: '#475569', fontSize: '16px' }}>
                📏 Ukuran Canvas
              </label>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                {Object.keys(CANVAS_SIZES).map(size => (
                  <button
                    key={size}
                    onClick={() => setCanvasSize(size as CanvasSize)}
                    style={{
                      padding: '12px 20px',
                      border: canvasSize === size ? '3px solid #667eea' : '2px solid #e2e8f0',
                      background: canvasSize === size ? '#667eea' : 'white',
                      color: canvasSize === size ? 'white' : '#1e293b',
                      borderRadius: '12px',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: 'pointer',
                    }}
                  >
                    {size}
                  </button>
                ))}
                <button
                  onClick={() => setCanvasSize('custom')}
                  style={{
                    padding: '12px 20px',
                    border: canvasSize === 'custom' ? '3px solid #667eea' : '2px solid #e2e8f0',
                    background: canvasSize === 'custom' ? '#667eea' : 'white',
                    color: canvasSize === 'custom' ? 'white' : '#1e293b',
                    borderRadius: '12px',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: 'pointer',
                  }}
                >
                  Custom
                </button>
              </div>

              {canvasSize === 'custom' && (
                <div style={{ marginTop: '16px', display: 'flex', gap: '12px' }}>
                  <input
                    type="number"
                    placeholder="Width"
                    value={customSize.width}
                    onChange={e => setCustomSize(prev => ({ ...prev, width: parseInt(e.target.value) || 1080 }))}
                    style={{ flex: 1, padding: '12px', border: '2px solid #e2e8f0', borderRadius: '8px', fontSize: '14px' }}
                  />
                  <input
                    type="number"
                    placeholder="Height"
                    value={customSize.height}
                    onChange={e => setCustomSize(prev => ({ ...prev, height: parseInt(e.target.value) || 1350 }))}
                    style={{ flex: 1, padding: '12px', border: '2px solid #e2e8f0', borderRadius: '8px', fontSize: '14px' }}
                  />
                </div>
              )}
            </div>

            {/* Timer */}
            <div style={{ marginBottom: '30px' }}>
              <label style={{ display: 'block', fontWeight: '600', marginBottom: '12px', color: '#475569', fontSize: '16px' }}>
                ⏱️ Timer Countdown
              </label>
              <div style={{ display: 'flex', gap: '12px' }}>
                {[0, 3, 5, 10].map(seconds => (
                  <button
                    key={seconds}
                    onClick={() => setTimerDuration(seconds)}
                    style={{
                      padding: '12px 24px',
                      border: timerDuration === seconds ? '3px solid #667eea' : '2px solid #e2e8f0',
                      background: timerDuration === seconds ? '#667eea' : 'white',
                      color: timerDuration === seconds ? 'white' : '#1e293b',
                      borderRadius: '12px',
                      fontSize: '16px',
                      fontWeight: '600',
                      cursor: 'pointer',
                    }}
                  >
                    {seconds === 0 ? 'Instant' : `${seconds}s`}
                  </button>
                ))}
              </div>
            </div>

            {/* Music Toggle */}
            <div style={{ marginBottom: '30px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={enableMusic}
                  onChange={e => setEnableMusic(e.target.checked)}
                  style={{ width: '20px', height: '20px', cursor: 'pointer' }}
                />
                <span style={{ fontSize: '16px', fontWeight: '600', color: '#475569' }}>
                  🎵 Background Music
                </span>
              </label>
            </div>

            {/* Start Button */}
            <button
              onClick={startCapture}
              style={{
                width: '100%',
                padding: '18px',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '16px',
                fontSize: '20px',
                fontWeight: '700',
                cursor: 'pointer',
                boxShadow: '0 10px 30px rgba(102, 126, 234, 0.4)',
                transition: 'transform 0.2s',
              }}
              onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.02)')}
              onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
            >
              🚀 Mulai Photo Booth!
            </button>
          </div>
        )}

        {/* ========== STEP 2: CAPTURE ========== */}
        {step === 'capture' && (
          <div style={{ background: 'white', borderRadius: '24px', padding: '40px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', textAlign: 'center' }}>
            <h2 style={{ fontSize: '28px', marginTop: 0, marginBottom: '20px', color: '#1e293b' }}>
              📸 Foto {currentPhotoIndex + 1} dari {photoCount}
            </h2>

            {/* Countdown Display */}
            {countdown !== null && (
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                fontSize: '200px',
                fontWeight: '900',
                color: '#667eea',
                textShadow: '0 10px 40px rgba(0,0,0,0.3)',
                zIndex: 1000,
                animation: 'pulse 1s infinite',
              }}>
                {countdown}
              </div>
            )}

            {/* Webcam */}
            <div style={{ position: 'relative', margin: '0 auto', maxWidth: '640px', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
              <Webcam
                ref={webcamRef}
                audio={false}
                screenshotFormat="image/jpeg"
                videoConstraints={{
                  width: 1280,
                  height: 720,
                  facingMode: 'user',
                }}
                mirrored={false} // NON-MIRROR!
                style={{
                  width: '100%',
                  height: 'auto',
                  ...getFilterStyle(currentFilter),
                }}
              />
            </div>

            {/* Filter Selector */}
            <div style={{ marginTop: '24px', display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
              {FILTERS.map(filter => (
                <button
                  key={filter}
                  onClick={() => setCurrentFilter(filter)}
                  style={{
                    padding: '8px 16px',
                    border: currentFilter === filter ? '2px solid #667eea' : '1px solid #e2e8f0',
                    background: currentFilter === filter ? '#667eea' : 'white',
                    color: currentFilter === filter ? 'white' : '#1e293b',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                  }}
                >
                  {filter}
                </button>
              ))}
            </div>

            {/* Progress */}
            <div style={{ marginTop: '24px', background: '#f1f5f9', borderRadius: '12px', padding: '16px' }}>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                {Array.from({ length: photoCount }).map((_, i) => (
                  <div
                    key={i}
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '8px',
                      background: i < capturedPhotos.length ? '#10b981' : i === currentPhotoIndex ? '#667eea' : '#e2e8f0',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'white',
                      fontWeight: '700',
                      fontSize: '14px',
                    }}
                  >
                    {i < capturedPhotos.length ? '✓' : i + 1}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ========== STEP 3: PREVIEW ========== */}
        {step === 'preview' && (
          <div style={{ background: 'white', borderRadius: '24px', padding: '40px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h2 style={{ fontSize: '28px', marginTop: 0, marginBottom: '30px', color: '#1e293b', textAlign: 'center' }}>
              👀 Preview Hasil Foto
            </h2>

            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${LAYOUTS[layout].gridCols}, 1fr)`, gap: '16px', marginBottom: '30px' }}>
              {capturedPhotos.map((photo, index) => (
                <div key={photo.id} style={{ position: 'relative', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                  <img
                    src={photo.dataUrl}
                    alt={`Photo ${index + 1}`}
                    style={{ width: '100%', height: 'auto', ...getFilterStyle(photo.filter) }}
                  />
                  <button
                    onClick={() => retakePhoto(index)}
                    style={{
                      position: 'absolute',
                      top: '8px',
                      right: '8px',
                      padding: '8px 12px',
                      background: 'rgba(239, 68, 68, 0.9)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontWeight: '600',
                      cursor: 'pointer',
                    }}
                  >
                    🔄 Retake
                  </button>
                  <div style={{
                    position: 'absolute',
                    bottom: '8px',
                    left: '8px',
                    padding: '4px 12px',
                    background: 'rgba(0,0,0,0.7)',
                    color: 'white',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: '600',
                  }}>
                    #{index + 1}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '16px' }}>
              <button
                onClick={() => setStep('setup')}
                style={{
                  flex: 1,
                  padding: '16px',
                  background: '#64748b',
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                ← Ulang dari Awal
              </button>
              <button
                onClick={() => setStep('edit')}
                style={{
                  flex: 2,
                  padding: '16px',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  fontSize: '16px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  boxShadow: '0 4px 16px rgba(102, 126, 234, 0.4)',
                }}
              >
                ✨ Lanjut Edit & Frame
              </button>
            </div>
          </div>
        )}

        {/* ========== STEP 4: EDIT ========== */}
        {step === 'edit' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: '24px' }}>
            
            {/* LEFT: Canvas Editor */}
            <div style={{ background: 'white', borderRadius: '24px', padding: '40px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
              <h2 style={{ fontSize: '24px', marginTop: 0, marginBottom: '24px', color: '#1e293b' }}>🎨 Canvas Editor</h2>

              {/* Canvas Preview */}
              <div
                ref={canvasRef}
                style={{
                  width: dimensions.width / 2,
                  height: dimensions.height / 2,
                  position: 'relative',
                  margin: '0 auto',
                  background: selectedFrame.type === 'color' ? selectedFrame.color : 'white',
                  backgroundImage: selectedFrame.type === 'image' ? `url(${selectedFrame.imageUrl})` : 'none',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  borderRadius: '16px',
                  overflow: 'hidden',
                  boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
                }}
              >
                {/* Photo Grid */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${LAYOUTS[layout].gridCols}, 1fr)`,
                  gridTemplateRows: `repeat(${LAYOUTS[layout].gridRows}, 1fr)`,
                  gap: '8px',
                  padding: '20px',
                  height: '100%',
                }}>
                  {capturedPhotos.map((photo, index) => (
                    <div key={photo.id} style={{ position: 'relative', borderRadius: '8px', overflow: 'hidden', border: '2px solid white' }}>
                      <img
                        src={photo.dataUrl}
                        alt={`Photo ${index + 1}`}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', ...getFilterStyle(photo.filter) }}
                      />
                    </div>
                  ))}
                </div>

                {/* Stickers */}
                {stickers.map(sticker => (
                  <Draggable
                    key={sticker.id}
                    defaultPosition={{ x: sticker.x, y: sticker.y }}
                    onStop={(e, data) => updateSticker(sticker.id, { x: data.x, y: data.y })}
                  >
                    <div
                      onClick={() => setSelectedStickerId(sticker.id)}
                      style={{
                        position: 'absolute',
                        cursor: 'move',
                        border: selectedStickerId === sticker.id ? '3px dashed #667eea' : 'none',
                        padding: selectedStickerId === sticker.id ? '4px' : '0',
                      }}
                    >
                      <img
                        src={sticker.imageUrl}
                        alt={sticker.name}
                        style={{
                          width: sticker.width,
                          height: sticker.height,
                          transform: `rotate(${sticker.rotation}deg) scaleX(${sticker.flipX ? -1 : 1}) scaleY(${sticker.flipY ? -1 : 1})`,
                          userSelect: 'none',
                        }}
                      />
                    </div>
                  </Draggable>
                ))}

                {/* Text Overlays */}
                {textOverlays.map(text => (
                  <Draggable
                    key={text.id}
                    defaultPosition={{ x: text.x, y: text.y }}
                    onStop={(e, data) => updateText(text.id, { x: data.x, y: data.y })}
                  >
                    <div
                      onClick={() => setSelectedTextId(text.id)}
                      style={{
                        position: 'absolute',
                        cursor: 'move',
                        border: selectedTextId === text.id ? '2px dashed #667eea' : 'none',
                        padding: '4px',
                      }}
                    >
                      <span
                        style={{
                          fontSize: text.fontSize,
                          color: text.color,
                          fontFamily: text.fontFamily,
                          fontWeight: '700',
                          textShadow: '0 2px 8px rgba(0,0,0,0.3)',
                          transform: `rotate(${text.rotation}deg)`,
                          display: 'inline-block',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {text.text}
                      </span>
                    </div>
                  </Draggable>
                ))}
              </div>

              {/* Undo/Redo */}
              <div style={{ marginTop: '24px', display: 'flex', gap: '12px', justifyContent: 'center' }}>
                <button
                  onClick={undo}
                  disabled={historyIndex <= 0}
                  style={{
                    padding: '12px 24px',
                    background: historyIndex <= 0 ? '#e2e8f0' : '#667eea',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: historyIndex <= 0 ? 'not-allowed' : 'pointer',
                  }}
                >
                  ↶ Undo
                </button>
                <button
                  onClick={redo}
                  disabled={historyIndex >= history.length - 1}
                  style={{
                    padding: '12px 24px',
                    background: historyIndex >= history.length - 1 ? '#e2e8f0' : '#667eea',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: historyIndex >= history.length - 1 ? 'not-allowed' : 'pointer',
                  }}
                >
                  ↷ Redo
                </button>
              </div>

              {/* Export Button */}
              <button
                onClick={exportImage}
                disabled={isProcessing}
                style={{
                  width: '100%',
                  marginTop: '24px',
                  padding: '18px',
                  background: isProcessing ? '#94a3b8' : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '16px',
                  fontSize: '18px',
                  fontWeight: '700',
                  cursor: isProcessing ? 'not-allowed' : 'pointer',
                  boxShadow: '0 8px 24px rgba(16, 185, 129, 0.4)',
                }}
              >
                {isProcessing ? `⏳ Processing... ${uploadProgress}%` : '💾 Save & Upload'}
              </button>
            </div>

            {/* RIGHT: Toolbox */}
            <div style={{ background: 'white', borderRadius: '24px', padding: '30px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', maxHeight: '90vh', overflowY: 'auto' }}>
              <h3 style={{ fontSize: '20px', marginTop: 0, marginBottom: '20px', color: '#1e293b' }}>🧰 Toolbox</h3>

              {/* Frame Selector */}
              <div style={{ marginBottom: '24px' }}>
                <h4 style={{ fontSize: '14px', fontWeight: '700', color: '#475569', marginBottom: '12px', textTransform: 'uppercase' }}>
                  🖼️ Frame
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                  {MOCK_FRAMES.map(frame => (
                    <button
                      key={frame.id}
                      onClick={() => setSelectedFrame(frame)}
                      style={{
                        padding: '12px',
                        border: selectedFrame.id === frame.id ? '3px solid #667eea' : '2px solid #e2e8f0',
                        background: frame.type === 'color' ? frame.color : 'white',
                        borderRadius: '8px',
                        fontSize: '12px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        color: frame.type === 'color' ? '#1e293b' : '#64748b',
                      }}
                    >
                      {frame.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sticker Picker */}
              <div style={{ marginBottom: '24px' }}>
                <h4 style={{ fontSize: '14px', fontWeight: '700', color: '#475569', marginBottom: '12px', textTransform: 'uppercase' }}>
                  ✨ Stickers
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                  {MOCK_STICKERS.map(sticker => (
                    <button
                      key={sticker.id}
                      onClick={() => addSticker(sticker)}
                      style={{
                        padding: '8px',
                        border: '2px solid #e2e8f0',
                        background: 'white',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.1)')}
                      onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
                    >
                      <img src={sticker.imageUrl} alt={sticker.name} style={{ width: '100%', height: 'auto' }} />
                    </button>
                  ))}
                </div>
              </div>

              {/* Selected Sticker Controls */}
              {selectedStickerId && (
                <div style={{ marginBottom: '24px', padding: '16px', background: '#f1f5f9', borderRadius: '12px' }}>
                  <h4 style={{ fontSize: '14px', fontWeight: '700', color: '#475569', marginBottom: '12px' }}>
                    🎯 Sticker Controls
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <button
                      onClick={() => {
                        const sticker = stickers.find(s => s.id === selectedStickerId);
                        if (sticker) updateSticker(selectedStickerId, { rotation: sticker.rotation + 15 });
                      }}
                      style={{ padding: '8px', background: '#667eea', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}
                    >
                      🔄 Rotate +15°
                    </button>
                    <button
                      onClick={() => {
                        const sticker = stickers.find(s => s.id === selectedStickerId);
                        if (sticker) updateSticker(selectedStickerId, { flipX: !sticker.flipX });
                      }}
                      style={{ padding: '8px', background: '#667eea', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}
                    >
                      ↔️ Flip Horizontal
                    </button>
                    <button
                      onClick={() => {
                        const sticker = stickers.find(s => s.id === selectedStickerId);
                        if (sticker) updateSticker(selectedStickerId, { flipY: !sticker.flipY });
                      }}
                      style={{ padding: '8px', background: '#667eea', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}
                    >
                      ↕️ Flip Vertical
                    </button>
                    <button
                      onClick={() => deleteSticker(selectedStickerId)}
                      style={{ padding: '8px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}
                    >
                      🗑️ Delete Sticker
                    </button>
                  </div>
                </div>
              )}

              {/* Add Text */}
              <div style={{ marginBottom: '24px' }}>
                <button
                  onClick={addText}
                  style={{
                    width: '100%',
                    padding: '14px',
                    background: '#764ba2',
                    color: 'white',
                    border: 'none',
                    borderRadius: '12px',
                    fontSize: '14px',
                    fontWeight: '700',
                    cursor: 'pointer',
                  }}
                >
                  ➕ Add Text
                </button>
              </div>

              {/* Selected Text Controls */}
              {selectedTextId && (() => {
                const text = textOverlays.find(t => t.id === selectedTextId);
                if (!text) return null;
                return (
                  <div style={{ marginBottom: '24px', padding: '16px', background: '#f1f5f9', borderRadius: '12px' }}>
                    <h4 style={{ fontSize: '14px', fontWeight: '700', color: '#475569', marginBottom: '12px' }}>
                      📝 Text Controls
                    </h4>
                    <input
                      type="text"
                      value={text.text}
                      onChange={e => updateText(selectedTextId, { text: e.target.value })}
                      style={{ width: '100%', padding: '8px', marginBottom: '8px', border: '2px solid #e2e8f0', borderRadius: '6px', fontSize: '14px' }}
                      placeholder="Your text here..."
                    />
                    <input
                      type="number"
                      value={text.fontSize}
                      onChange={e => updateText(selectedTextId, { fontSize: parseInt(e.target.value) || 32 })}
                      style={{ width: '100%', padding: '8px', marginBottom: '8px', border: '2px solid #e2e8f0', borderRadius: '6px', fontSize: '14px' }}
                      placeholder="Font size"
                    />
                    <input
                      type="color"
                      value={text.color}
                      onChange={e => updateText(selectedTextId, { color: e.target.value })}
                      style={{ width: '100%', padding: '8px', marginBottom: '8px', border: '2px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer' }}
                    />
                    <button
                      onClick={() => deleteText(selectedTextId)}
                      style={{ width: '100%', padding: '8px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}
                    >
                      🗑️ Delete Text
                    </button>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* ========== STEP 5: FINAL ========== */}
        {step === 'final' && finalImageUrl && (
          <div style={{ background: 'white', borderRadius: '24px', padding: '40px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', textAlign: 'center' }}>
            <h2 style={{ fontSize: '32px', marginTop: 0, marginBottom: '20px', color: '#1e293b' }}>
              🎉 Sukses! Foto Kamu Keren Banget!
            </h2>
            
            <img
              src={finalImageUrl}
              alt="Final Result"
              style={{ maxWidth: '400px', width: '100%', height: 'auto', borderRadius: '16px', marginBottom: '30px', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}
            />

            <div style={{ background: '#f1f5f9', padding: '24px', borderRadius: '16px', marginBottom: '30px' }}>
              <h3 style={{ fontSize: '18px', marginTop: 0, marginBottom: '16px', color: '#1e293b' }}>
                📱 Scan QR untuk Download
              </h3>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
                <QRCodeSVG value={finalImageUrl} size={200} />
              </div>
              <a
                href={finalImageUrl}
                download="photo-booth-result.jpg"
                style={{
                  display: 'inline-block',
                  padding: '12px 32px',
                  background: '#667eea',
                  color: 'white',
                  textDecoration: 'none',
                  borderRadius: '12px',
                  fontSize: '16px',
                  fontWeight: '700',
                  marginRight: '12px',
                }}
              >
                ⬇️ Download
              </a>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(finalImageUrl);
                  alert('Link copied!');
                }}
                style={{
                  padding: '12px 32px',
                  background: '#10b981',
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  fontSize: '16px',
                  fontWeight: '700',
                  cursor: 'pointer',
                }}
              >
                📋 Copy Link
              </button>
            </div>

            <button
              onClick={() => {
                setStep('setup');
                setCapturedPhotos([]);
                setStickers([]);
                setTextOverlays([]);
                setFinalImageUrl(null);
              }}
              style={{
                width: '100%',
                padding: '18px',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '16px',
                fontSize: '18px',
                fontWeight: '700',
                cursor: 'pointer',
                boxShadow: '0 8px 24px rgba(102, 126, 234, 0.4)',
              }}
            >
              🔄 Foto Lagi!
            </button>
          </div>
        )}
      </div>

      {/* Inline Keyframes for Animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
          50% { transform: translate(-50%, -50%) scale(1.1); opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}