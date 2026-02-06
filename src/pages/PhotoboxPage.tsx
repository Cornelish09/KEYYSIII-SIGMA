import React, { useRef, useState, useEffect } from "react";
import Webcam from "react-webcam";
import { useNavigate } from "react-router-dom";
import { db, storage } from "../firebase"; // Gunakan Storage firebase
import { collection, addDoc, onSnapshot, query, orderBy } from "firebase/firestore";
import { ref, uploadString, getDownloadURL } from "firebase/storage";

// --- TYPES & CONFIG ---
type LayoutType = 'STRIP' | 'GRID';
type Sticker = { id: string; url: string; };
type PlacedSticker = { id: string; url: string; x: number; y: number; scale: number; };

const LAYOUTS = {
  STRIP: { w: 600, h: 1800, count: 3, photos: [
    { x: 50, y: 50, w: 500, h: 500 },
    { x: 50, y: 600, w: 500, h: 500 },
    { x: 50, y: 1150, w: 500, h: 500 }
  ]},
  GRID: { w: 1200, h: 1800, count: 4, photos: [
    { x: 50, y: 50, w: 525, h: 700 },
    { x: 625, y: 50, w: 525, h: 700 },
    { x: 50, y: 800, w: 525, h: 700 },
    { x: 625, y: 800, w: 525, h: 700 }
  ]}
};

const COLORS = ['#ffffff', '#000000', '#ffc0cb', '#87ceeb', '#fffdd0', '#e6e6fa', '#ffdab9'];

export function PhotoboxPage() {
  const navigate = useNavigate();
  const webcamRef = useRef<Webcam>(null);
  
  // STATE: SETUP
  const [step, setStep] = useState<'SETUP' | 'CAPTURE' | 'EDIT' | 'RESULT'>('SETUP');
  const [layout, setLayout] = useState<LayoutType>('STRIP');
  const [timerDelay, setTimerDelay] = useState(3); // 0, 3, 5, 10
  
  // STATE: CAPTURE
  const [captures, setCaptures] = useState<string[]>([]);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);

  // STATE: EDIT
  const [frameColor, setFrameColor] = useState('#ffffff');
  const [availableStickers, setAvailableStickers] = useState<Sticker[]>([]);
  const [placedStickers, setPlacedStickers] = useState<PlacedSticker[]>([]);
  const [selectedStickerIdx, setSelectedStickerIdx] = useState<number | null>(null);
  
  // STATE: RESULT
  const [finalImage, setFinalImage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // LOAD STICKERS FROM ADMIN
  useEffect(() => {
    const q = query(collection(db, "stickers"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => setAvailableStickers(snap.docs.map(d => ({ id: d.id, ...d.data() } as Sticker))));
  }, []);

  // --- LOGIC: CAPTURE ---
  const startSession = () => {
    setCaptures([]);
    setStep('CAPTURE');
    triggerCaptureLoop(0);
  };

  const triggerCaptureLoop = (index: number) => {
    const max = LAYOUTS[layout].count;
    if (index >= max) {
      setTimeout(() => setStep('EDIT'), 1000);
      return;
    }

    let count = timerDelay;
    if (count === 0) {
      takePhoto(index);
    } else {
      setCountdown(count);
      const timer = setInterval(() => {
        count--;
        setCountdown(count);
        if (count === 0) {
          clearInterval(timer);
          setCountdown(null);
          takePhoto(index);
        }
      }, 1000);
    }
  };

  const takePhoto = async (index: number) => {
    if (!webcamRef.current) return;
    const imageSrc = webcamRef.current.getScreenshot();
    if (!imageSrc) return;

    setFlash(true);
    setTimeout(() => setFlash(false), 150);

    // FLIP LOGIC: Webcam preview is mirrored, but we want result UN-MIRRORED (True Self)
    // We create a canvas to flip it back horizontally
    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Balik horizontal (Un-mirror) karena webcam defaultnya mirror
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0);
        
        const truePhoto = canvas.toDataURL('image/jpeg', 0.9);
        setCaptures(prev => [...prev, truePhoto]);
        
        // 🔥 AUTO UPLOAD RAW CAPTURE TO ADMIN
        uploadToAdmin(truePhoto, 'raw');

        // Next photo
        setTimeout(() => triggerCaptureLoop(index + 1), 1000);
      }
    };
  };

  // --- LOGIC: STICKER EDITOR ---
  const addSticker = (sticker: Sticker) => {
    setPlacedStickers([...placedStickers, {
      id: Date.now().toString(),
      url: sticker.url,
      x: LAYOUTS[layout].w / 2 - 100, // Center
      y: LAYOUTS[layout].h / 2 - 100,
      scale: 1
    }]);
  };

  const updateSticker = (idx: number, updates: Partial<PlacedSticker>) => {
    const newStickers = [...placedStickers];
    newStickers[idx] = { ...newStickers[idx], ...updates };
    setPlacedStickers(newStickers);
  };

  // --- LOGIC: RENDER FINAL IMAGE (CANVAS) ---
  const generateFinalImage = async () => {
    setSaving(true);
    const canvas = document.createElement('canvas');
    const cfg = LAYOUTS[layout];
    canvas.width = cfg.w;
    canvas.height = cfg.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 1. Draw Background
    ctx.fillStyle = frameColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. Draw Photos
    const photoProms = captures.map((src, i) => {
      return new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const slot = cfg.photos[i];
          // Crop Center Logic (Object-fit: cover)
          const ratio = img.width / img.height;
          const slotRatio = slot.w / slot.h;
          let sw, sh, sx, sy;
          
          if (ratio > slotRatio) {
            sh = img.height; sw = img.height * slotRatio;
            sy = 0; sx = (img.width - sw) / 2;
          } else {
            sw = img.width; sh = img.width / slotRatio;
            sx = 0; sy = (img.height - sh) / 2;
          }

          ctx.drawImage(img, sx, sy, sw, sh, slot.x, slot.y, slot.w, slot.h);
          resolve();
        };
        img.src = src;
      });
    });

    await Promise.all(photoProms);

    // 3. Draw Stickers
    const stickerProms = placedStickers.map((s) => {
      return new Promise<void>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const size = 200 * s.scale; // Base size 200px
          ctx.drawImage(img, s.x, s.y, size, size);
          resolve();
        };
        img.src = s.url;
      });
    });

    await Promise.all(stickerProms);

    // 4. Branding (Optional)
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.font = 'bold 20px Arial';
    ctx.fillText("📸 PHOTOBOOTH", 20, canvas.height - 20);

    const result = canvas.toDataURL('image/jpeg', 0.95);
    setFinalImage(result);
    
    // 🔥 AUTO UPLOAD FINAL RESULT TO ADMIN
    await uploadToAdmin(result, 'final');
    
    setStep('RESULT');
    setSaving(false);
  };

  const uploadToAdmin = async (base64: string, type: 'raw' | 'final') => {
    try {
      // 1. Upload Base64 to Firebase Storage
      const fileName = `photobooth/${type}_${Date.now()}.jpg`;
      const storageRef = ref(storage, fileName);
      await uploadString(storageRef, base64, 'data_url');
      const url = await getDownloadURL(storageRef);

      // 2. Add Record to Firestore
      await addDoc(collection(db, "photobooth_gallery"), {
        url,
        type,
        createdAt: new Date().toISOString()
      });
      console.log(`✅ Uploaded ${type} to admin`);
    } catch (e) {
      console.error("Upload failed", e);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#1a1a1a', color: 'white', fontFamily: 'sans-serif', overflow: 'hidden' }}>
      
      {/* HEADER NAV */}
      <div style={{ padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#000' }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>📸 PHOTOBOOTH</h1>
        <button onClick={() => navigate('/final')} style={{ background: 'transparent', border: '1px solid white', color: 'white', padding: '5px 15px', borderRadius: 20 }}>Exit</button>
      </div>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: 20, textAlign: 'center' }}>
        
        {/* STEP 1: SETUP */}
        {step === 'SETUP' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 30, marginTop: 40 }}>
            <div>
              <h3>1. Pilih Layout</h3>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button onClick={() => setLayout('STRIP')} style={selStyle(layout === 'STRIP')}>🎞️ Strip (3 Foto)</button>
                <button onClick={() => setLayout('GRID')} style={selStyle(layout === 'GRID')}>田 Grid (4 Foto)</button>
              </div>
            </div>

            <div>
              <h3>2. Timer Pose</h3>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                {[0, 3, 5, 10].map(t => (
                  <button key={t} onClick={() => setTimerDelay(t)} style={selStyle(timerDelay === t)}>{t}s</button>
                ))}
              </div>
            </div>

            <button onClick={startSession} style={{ padding: 20, fontSize: 20, background: '#3b82f6', color: 'white', border: 'none', borderRadius: 10, fontWeight: 'bold', marginTop: 20, cursor: 'pointer' }}>
              MULAI FOTO! 📸
            </button>
          </div>
        )}

        {/* STEP 2: CAPTURE */}
        {step === 'CAPTURE' && (
          <div style={{ position: 'relative', borderRadius: 20, overflow: 'hidden', border: '4px solid #333' }}>
            <Webcam 
              ref={webcamRef} 
              mirrored={true} // PREVIEW MIRRORED (Buat ngaca)
              screenshotFormat="image/jpeg"
              style={{ width: '100%', display: 'block' }} 
            />
            
            {/* Countdown Overlay */}
            {countdown !== null && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', background: 'rgba(0,0,0,0.3)' }}>
                <span style={{ fontSize: 150, fontWeight: 900, color: 'white', textShadow: '0 4px 20px black' }}>{countdown}</span>
              </div>
            )}

            {/* Flash Effect */}
            <div style={{ position: 'absolute', inset: 0, background: 'white', opacity: flash ? 1 : 0, transition: 'opacity 0.2s', pointerEvents: 'none' }} />
            
            {/* Progress */}
            <div style={{ position: 'absolute', bottom: 20, left: 0, right: 0, textAlign: 'center' }}>
               <span style={{ background: 'rgba(0,0,0,0.6)', padding: '5px 15px', borderRadius: 20, fontSize: 14 }}>
                 Foto {captures.length + 1} / {LAYOUTS[layout].count}
               </span>
            </div>
          </div>
        )}

        {/* STEP 3: EDITOR */}
        {step === 'EDIT' && (
          <div style={{ display: 'flex', gap: 20, flexDirection: 'column' }}>
            {/* CANVAS PREVIEW (DOM BASED FOR INTERACTION) */}
            <div style={{ 
                width: 350, height: layout === 'STRIP' ? 1050 : 525, // Aspect ratio scaled down
                margin: '0 auto',
                background: frameColor,
                position: 'relative',
                overflow: 'hidden',
                boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
                transition: 'background 0.3s'
              }}
              onPointerUp={() => setSelectedStickerIdx(null)} // Deselect
            >
              {/* PHOTOS */}
              {captures.map((src, i) => {
                 const cfg = LAYOUTS[layout].photos[i];
                 // Calculate scale factor for DOM preview (350px width base)
                 const scale = 350 / LAYOUTS[layout].w;
                 return (
                   <img key={i} src={src} style={{
                     position: 'absolute',
                     left: cfg.x * scale, top: cfg.y * scale,
                     width: cfg.w * scale, height: cfg.h * scale,
                     objectFit: 'cover'
                   }} />
                 )
              })}

              {/* STICKERS */}
              {placedStickers.map((s, i) => {
                 const scale = 350 / LAYOUTS[layout].w;
                 const isSelected = selectedStickerIdx === i;
                 return (
                   <img 
                    key={s.id}
                    src={s.url}
                    style={{
                      position: 'absolute',
                      left: s.x * scale, top: s.y * scale,
                      width: (200 * s.scale) * scale,
                      border: isSelected ? '2px dashed blue' : 'none',
                      cursor: 'grab'
                    }}
                    // Simple Drag Logic (Mouse Only for brevity, add Touch if needed)
                    onPointerDown={(e) => {
                      setSelectedStickerIdx(i);
                      // Add drag logic here or separate handlers
                    }}
                   />
                 )
              })}
            </div>

            {/* CONTROLS */}
            <div style={{ background: '#222', padding: 20, borderRadius: 15 }}>
              <h4>1. Pilih Frame</h4>
              <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 10 }}>
                {COLORS.map(c => (
                  <div key={c} onClick={() => setFrameColor(c)} style={{ minWidth: 40, height: 40, background: c, borderRadius: '50%', border: frameColor===c ? '3px solid white' : '1px solid gray', cursor: 'pointer' }} />
                ))}
              </div>

              <h4>2. Tambah Sticker (Drag to move)</h4>
              <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 10 }}>
                {availableStickers.map(s => (
                  <img key={s.id} src={s.url} onClick={() => addSticker(s)} style={{ width: 60, height: 60, objectFit: 'contain', cursor: 'pointer', background: '#333', padding: 5, borderRadius: 8 }} />
                ))}
              </div>

              {selectedStickerIdx !== null && (
                <div style={{ marginTop: 20 }}>
                  <button onClick={() => {
                     const news = [...placedStickers]; news[selectedStickerIdx].scale += 0.1; setPlacedStickers(news);
                  }} style={btnCtrl}>Besarin (+)</button>
                   <button onClick={() => {
                     const news = [...placedStickers]; news[selectedStickerIdx].scale -= 0.1; setPlacedStickers(news);
                  }} style={btnCtrl}>Kecilin (-)</button>
                  
                  {/* D-Pad Move for precision */}
                  <div style={{marginTop: 10, display:'flex', gap:5, justifyContent:'center'}}>
                    <button onClick={() => updateSticker(selectedStickerIdx, { x: placedStickers[selectedStickerIdx].x - 20 })}>⬅️</button>
                    <button onClick={() => updateSticker(selectedStickerIdx, { y: placedStickers[selectedStickerIdx].y + 20 })}>⬇️</button>
                    <button onClick={() => updateSticker(selectedStickerIdx, { y: placedStickers[selectedStickerIdx].y - 20 })}>⬆️</button>
                    <button onClick={() => updateSticker(selectedStickerIdx, { x: placedStickers[selectedStickerIdx].x + 20 })}>➡️</button>
                  </div>

                  <button onClick={() => {
                    setPlacedStickers(placedStickers.filter((_, i) => i !== selectedStickerIdx));
                    setSelectedStickerIdx(null);
                  }} style={{...btnCtrl, background: 'red', marginTop: 10}}>Hapus Sticker</button>
                </div>
              )}

              <button onClick={generateFinalImage} disabled={saving} style={{ width: '100%', padding: 15, background: '#10b981', color: 'white', border: 'none', borderRadius: 10, fontSize: 18, fontWeight: 'bold', marginTop: 20, cursor: 'pointer' }}>
                {saving ? "SAVING..." : "✅ SIMPAN & SELESAI"}
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: RESULT */}
        {step === 'RESULT' && finalImage && (
          <div style={{ textAlign: 'center' }}>
            <h2>✨ HASIL FOTO ✨</h2>
            <img src={finalImage} style={{ maxWidth: '100%', borderRadius: 10, boxShadow: '0 5px 30px black' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
              <a href={finalImage} download="photobooth.jpg" style={{ padding: 15, background: 'white', color: 'black', textDecoration: 'none', borderRadius: 30, fontWeight: 'bold' }}>DOWNLOAD IMAGE ⬇️</a>
              <button onClick={() => window.location.reload()} style={{ padding: 15, background: '#333', color: 'white', border: '1px solid white', borderRadius: 30, cursor: 'pointer' }}>MAIN LAGI 🔄</button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// STYLES HELPER
const selStyle = (active: boolean) => ({
  flex: 1, padding: 15, borderRadius: 10, border: active ? '2px solid #3b82f6' : '1px solid #444',
  background: active ? 'rgba(59, 130, 246, 0.2)' : '#222', color: 'white', cursor: 'pointer', fontWeight: 'bold'
});

const btnCtrl = {
  padding: '5px 10px', margin: '0 5px', borderRadius: 5, border: 'none', cursor: 'pointer'
};