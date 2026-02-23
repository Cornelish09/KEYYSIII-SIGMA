import React, { useRef, useState, useEffect, useCallback } from 'react';
import Webcam from 'react-webcam';
import html2canvas from 'html2canvas';
import Draggable from 'react-draggable'; // <--- INI KUNCI BUAT GESER FOTO
import { QRCodeSVG } from 'qrcode.react';
import { useNavigate } from 'react-router-dom';
import { db, storage } from '../firebase';
import { collection, addDoc, query, orderBy, onSnapshot } from 'firebase/firestore';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';

// ========================================
// 🎯 TYPES
// ========================================
type PhotoSlot = { x: number; y: number; width: number; height: number; };
type PhotoTemplate = {
  id: string; name: string; imageUrl: string; photoCount: number;
  slots: PhotoSlot[]; canvasWidth: number; canvasHeight: number;
};
type FilterType = 'normal' | 'bw' | 'vintage' | 'warm' | 'cool';

const FILTERS: { id: FilterType; label: string; css: string }[] = [
  { id: 'normal', label: '✨ Original', css: 'none' },
  { id: 'bw', label: '🎥 Classic B&W', css: 'grayscale(100%) contrast(1.2)' },
  { id: 'vintage', label: '🎞️ 90s Vintage', css: 'sepia(40%) contrast(1.1) brightness(0.9) saturate(1.2)' },
  { id: 'warm', label: '🌅 Warm Sunset', css: 'sepia(30%) saturate(1.4) hue-rotate(-10deg)' },
  { id: 'cool', label: '🧊 Cool Night', css: 'saturate(1.2) hue-rotate(15deg) brightness(1.05)' },
];

export function PhotoboxPage() {
  const navigate = useNavigate();
  const webcamRef = useRef<Webcam>(null);
  const captureAreaRef = useRef<HTMLDivElement>(null);

  // --- STATES ---
  const [step, setStep] = useState<'select' | 'capture' | 'review' | 'final'>('select');
  const [templates, setTemplates] = useState<PhotoTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<PhotoTemplate | null>(null);
  
  const [timerDuration, setTimerDuration] = useState(3);
  const [currentSlotIndex, setCurrentSlotIndex] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [capturedPhotos, setCapturedPhotos] = useState<string[]>([]);
  const [currentFilter, setCurrentFilter] = useState<FilterType>('normal');
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [finalImageUrl, setFinalImageUrl] = useState<string | null>(null);
  const [isFlashing, setIsFlashing] = useState(false);

  // Margin untuk fitur drag (30% ekstra ruang biar foto bisa digeser)
  const DRAG_MARGIN = 0.3; 

  // --- 1. FETCH DATA DARI ADMIN ---
  useEffect(() => {
    const q = query(collection(db, "photobox_templates"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setTemplates(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as PhotoTemplate)));
    });
    return () => unsub();
  }, []);

  // --- 2. CAMERA LOGIC ---
  const startSession = () => {
    setCapturedPhotos([]);
    setCurrentSlotIndex(0);
    setStep('capture');
  };

  const triggerNextPhoto = useCallback(() => {
    setCountdown(timerDuration);
  }, [timerDuration]);

  useEffect(() => {
    if (step === 'capture' && currentSlotIndex < (selectedTemplate?.photoCount || 0)) {
      triggerNextPhoto();
    } else if (step === 'capture' && currentSlotIndex >= (selectedTemplate?.photoCount || 0)) {
      setTimeout(() => setStep('review'), 1000);
    }
  }, [step, currentSlotIndex, selectedTemplate, triggerNextPhoto]);

  useEffect(() => {
    if (countdown === null || step !== 'capture') return;
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      takePhoto();
      setCountdown(null);
    }
  }, [countdown, step]);

  const takePhoto = () => {
    const imageSrc = webcamRef.current?.getScreenshot();
    if (imageSrc) {
      setIsFlashing(true);
      setTimeout(() => setIsFlashing(false), 200);
      setCapturedPhotos(prev => [...prev, imageSrc]);
      setCurrentSlotIndex(prev => prev + 1);
    }
  };

  // --- 3. EXPORT & SECRET UPLOAD ---
  const handleExportAndUpload = async () => {
    if (!captureAreaRef.current || !selectedTemplate) return;
    setIsProcessing(true);

    try {
      await new Promise(r => setTimeout(r, 500)); // Tunggu DOM stabil
      
      const canvas = await html2canvas(captureAreaRef.current, { 
        scale: 2, // Biar pas di-download HD
        useCORS: true, 
        backgroundColor: null 
      });
      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);

      // SILENT UPLOAD KE DATABASE ADMIN
      const timestamp = Date.now();
      const storageRef = ref(storage, `secret_gallery/photobooth-${timestamp}.jpg`);
      await uploadString(storageRef, dataUrl, 'data_url');
      const downloadUrl = await getDownloadURL(storageRef);

      await addDoc(collection(db, 'secret_photos'), {
        url: downloadUrl,
        createdAt: new Date().toISOString(),
        templateName: selectedTemplate.name
      });

      // LANJUT KE USER
      setFinalImageUrl(dataUrl);
      setStep('final');
    } catch (error) {
      console.error('Error:', error);
      alert('Oops, ada yang salah pas mencetak foto. Coba lagi ya!');
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadImage = () => {
    if (!finalImageUrl) return;
    const link = document.createElement('a');
    link.href = finalImageUrl;
    link.download = `Memories-${Date.now()}.jpg`;
    link.click();
  };

  // Kalkulasi ukuran preview biar pas di semua layar HP/Laptop
  const calculateScale = () => {
    if (!selectedTemplate) return 1;
    const maxWidth = Math.min(window.innerWidth - 40, 400); // Max lebar
    return maxWidth / selectedTemplate.canvasWidth;
  };

  // --- RENDER ---
  return (
    <div className="pb-root">
      <div className="pb-ambient"></div>
      
      {/* HEADER */}
      <div className="pb-header">
        <button className="pb-back" onClick={() => navigate(-1)}>← Back</button>
        <div className="pb-logo">NEON <span>STUDIO</span></div>
      </div>

      <div className="pb-container">
        
        {/* ================= STAGE 1: PILIH TEMPLATE ================= */}
        {step === 'select' && (
          <div className="pb-card">
            <h2 className="pb-title">Pilih Frame Favoritmu</h2>
            <p className="pb-subtitle">Banyak ukuran: 9:16, 4:3, Strip. Bebas pilih!</p>

            {templates.length === 0 ? (
              <div className="pb-empty">Belum ada template. Admin belum upload!</div>
            ) : (
              <div className="pb-grid">
                {templates.map(t => (
                  <div key={t.id} className={`pb-grid-item ${selectedTemplate?.id === t.id ? 'active' : ''}`} onClick={() => setSelectedTemplate(t)}>
                    {/* Tampilkan rasio asli dari template admin */}
                    <div className="pb-grid-img" style={{ aspectRatio: `${t.canvasWidth}/${t.canvasHeight}` }}>
                      <img src={t.imageUrl} alt={t.name} />
                    </div>
                    <div className="pb-grid-name">{t.name}</div>
                    <div className="pb-grid-desc">{t.canvasWidth}x{t.canvasHeight} px • {t.photoCount} Slot</div>
                  </div>
                ))}
              </div>
            )}

            {selectedTemplate && (
              <div className="pb-action-box">
                <div style={{color:'#94a3b8', fontSize:14, marginBottom:10}}>Timer Jepret:</div>
                <div style={{display:'flex', gap:10, justifyContent:'center', marginBottom:20}}>
                  {[3, 5, 10].map(time => (
                    <button key={time} className={`pb-timer-btn ${timerDuration === time ? 'active' : ''}`} onClick={() => setTimerDuration(time)}>
                      {time}s
                    </button>
                  ))}
                </div>
                <button className="pb-btn-glow" onClick={startSession}>GAS FOTO! 📸</button>
              </div>
            )}
          </div>
        )}

        {/* ================= STAGE 2: CAMERA CAPTURE ================= */}
        {step === 'capture' && (
          <div className="pb-card" style={{textAlign:'center'}}>
            <h2 className="pb-title" style={{color:'#3b82f6'}}>
              Pose ke-{currentSlotIndex + 1} / {selectedTemplate?.photoCount}
            </h2>
            
            <div className="pb-cam-wrapper">
              {countdown !== null && <div className="pb-countdown">{countdown === 0 ? '✨' : countdown}</div>}
              {isFlashing && <div className="pb-flash"></div>}
              
              <Webcam 
                ref={webcamRef} 
                audio={false} 
                mirrored={true} 
                screenshotFormat="image/jpeg" 
                videoConstraints={{ facingMode: "user" }}
                className="pb-video" 
              />
              {/* Garis bantu grid kamera */}
              <div className="pb-cam-grid"></div> 
            </div>

            <div className="pb-dots">
              {Array.from({length: selectedTemplate?.photoCount || 0}).map((_, i) => (
                <div key={i} className={`pb-dot ${i < capturedPhotos.length ? 'done' : i === currentSlotIndex ? 'active' : ''}`}></div>
              ))}
            </div>
          </div>
        )}

        {/* ================= STAGE 3: DRAG & PREVIEW ================= */}
        {step === 'review' && selectedTemplate && (
          <div className="pb-card">
            <h2 className="pb-title">Geser & Sesuaikan 🎨</h2>
            <p className="pb-subtitle" style={{color:'#f472b6'}}>*Sentuh & geser foto biar pas sama bingkainya!</p>
            
            <div className="pb-review-layout">
              {/* AREA SANDWICH (KIRI) */}
              <div className="pb-sandwich-box">
                <div style={{ 
                  transform: `scale(${calculateScale()})`, 
                  transformOrigin: 'top center', 
                  marginBottom: `-${selectedTemplate.canvasHeight * (1 - calculateScale())}px` 
                }}>
                  
                  {/* INI YANG BAKAL DI-CAPTURE HTML2CANVAS */}
                  <div 
                    ref={captureAreaRef} 
                    className="pb-sandwich-target" 
                    style={{ 
                      width: selectedTemplate.canvasWidth, 
                      height: selectedTemplate.canvasHeight, 
                      filter: FILTERS.find(f => f.id === currentFilter)?.css 
                    }}
                  >
                    <div style={{ position:'absolute', inset:0, background:'#fff' }}></div>

                    {/* FOTO-FOTO USER (BISA DI GESER) */}
                    {selectedTemplate.slots.map((slot, i) => (
                      <div key={i} style={{ position:'absolute', left: slot.x, top: slot.y, width: slot.width, height: slot.height, overflow:'hidden', background:'#e2e8f0' }}>
                        {capturedPhotos[i] && (
                          <Draggable 
                            bounds={{ 
                              left: -(slot.width * DRAG_MARGIN), top: -(slot.height * DRAG_MARGIN), 
                              right: slot.width * DRAG_MARGIN, bottom: slot.height * DRAG_MARGIN 
                            }}
                          >
                            <div style={{
                              position: 'absolute', cursor: 'grab',
                              width: `${100 * (1 + DRAG_MARGIN * 2)}%`, height: `${100 * (1 + DRAG_MARGIN * 2)}%`,
                              left: `-${DRAG_MARGIN * 100}%`, top: `-${DRAG_MARGIN * 100}%`
                            }}>
                              <img src={capturedPhotos[i]} draggable={false} style={{ width:'100%', height:'100%', objectFit:'cover', transform:'scaleX(-1)' }} alt={`Slot ${i}`} />
                            </div>
                          </Draggable>
                        )}
                      </div>
                    ))}

                    {/* FRAME TRANSPARAN DI ATAS FOTO (BIAR RAPI) */}
                    <img src={selectedTemplate.imageUrl} className="pb-sandwich-frame" crossOrigin="anonymous" alt="frame" />
                  </div>

                </div>
              </div>

              {/* KONTROL KANAN */}
              <div className="pb-controls">
                <div className="pb-filter-list">
                  {FILTERS.map(f => (
                    <button key={f.id} className={`pb-filter-btn ${currentFilter === f.id ? 'active' : ''}`} onClick={() => setCurrentFilter(f.id)}>{f.label}</button>
                  ))}
                </div>

                <div style={{display:'flex', flexDirection:'column', gap:10}}>
                  <button className="pb-btn-glow" onClick={handleExportAndUpload} disabled={isProcessing}>
                    {isProcessing ? '⏳ MENCETAK FOTO...' : 'CETAK SEKARANG 🖨️'}
                  </button>
                  <button className="pb-btn-outline" onClick={() => setStep('select')} disabled={isProcessing}>
                    🔄 Retake Semua
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= STAGE 4: HASIL AKHIR ================= */}
        {step === 'final' && finalImageUrl && (
          <div className="pb-card" style={{textAlign:'center', maxWidth:500, margin:'0 auto'}}>
            <h2 className="pb-title" style={{color:'#10b981', fontSize:32}}>Perfect! ✨</h2>
            <p className="pb-subtitle">Foto berhasil dicetak. Scan QR untuk simpan ke HP-mu!</p>

            <img src={finalImageUrl} alt="Final" className="pb-final-img" />

            <div className="pb-qr-box">
              <div style={{background:'#fff', padding:15, borderRadius:12}}><QRCodeSVG value={finalImageUrl} size={140} /></div>
              <p style={{marginTop:10, fontSize:12, color:'#94a3b8'}}>Scan me!</p>
            </div>

            <div style={{display:'flex', gap:15, justifyContent:'center', marginTop:20}}>
              <button className="pb-btn-glow" style={{width:'auto', padding:'15px 30px'}} onClick={downloadImage}>⬇️ DOWNLOAD</button>
              <button className="pb-btn-outline" style={{width:'auto', padding:'15px 30px'}} onClick={() => setStep('select')}>📸 FOTO LAGI</button>
            </div>
          </div>
        )}

      </div>

      {/* --- CSS THEME: BLACK, BLUE, PURPLE --- */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;600&display=swap');

        .pb-root { position: fixed; inset: 0; background: #05050A; color: #fff; font-family: 'Inter', sans-serif; overflow-y: auto; overflow-x: hidden; }
        
        /* Background Ambient Glow */
        .pb-ambient { position: fixed; width: 150vw; height: 150vh; top: -25vh; left: -25vw; background: radial-gradient(circle at 30% 20%, rgba(59, 130, 246, 0.15), transparent 40%), radial-gradient(circle at 70% 80%, rgba(124, 58, 237, 0.15), transparent 40%); z-index: 0; pointer-events: none; }
        
        /* Header */
        .pb-header { position: relative; z-index: 10; padding: 20px 30px; display: flex; align-items: center; justify-content: center; }
        .pb-back { position: absolute; left: 20px; background: rgba(30, 41, 59, 0.5); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 8px 16px; border-radius: 8px; cursor: pointer; transition: 0.3s; backdrop-filter: blur(10px); }
        .pb-back:hover { background: rgba(59, 130, 246, 0.3); border-color: #3b82f6; }
        .pb-logo { font-family: 'Space Grotesk', sans-serif; font-size: 24px; font-weight: 700; letter-spacing: 2px; }
        .pb-logo span { color: #3b82f6; text-shadow: 0 0 15px rgba(59, 130, 246, 0.5); }

        .pb-container { position: relative; z-index: 10; max-width: 1000px; margin: 0 auto; padding: 0 20px 50px; }
        
        /* Glass Card */
        .pb-card { background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(59, 130, 246, 0.2); box-shadow: 0 20px 40px rgba(0,0,0,0.5); border-radius: 24px; backdrop-filter: blur(20px); padding: 40px; animation: slideUp 0.5s ease; }
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

        .pb-title { margin: 0 0 10px 0; font-family: 'Space Grotesk', sans-serif; font-size: 32px; font-weight: 700; background: linear-gradient(to right, #fff, #93c5fd); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .pb-subtitle { color: #94a3b8; font-size: 14px; margin-bottom: 30px; }

        /* Template Grid (Dynamic Sizes) */
        .pb-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 20px; }
        .pb-grid-item { background: rgba(0,0,0,0.3); border: 2px solid #1e293b; border-radius: 16px; padding: 15px; cursor: pointer; transition: 0.3s; text-align: center; display: flex; flex-direction: column; align-items: center; }
        .pb-grid-item:hover { transform: translateY(-5px); border-color: #7c3aed; box-shadow: 0 10px 20px rgba(124, 58, 237, 0.2); }
        .pb-grid-item.active { border-color: #3b82f6; background: rgba(59, 130, 246, 0.1); box-shadow: 0 0 20px rgba(59, 130, 246, 0.3); }
        
        .pb-grid-img { width: 100%; max-height: 250px; background: repeating-conic-gradient(#1e293b 0% 25%, #0f172a 0% 50%) 50% / 15px 15px; border-radius: 8px; margin-bottom: 12px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
        .pb-grid-img img { max-width: 90%; max-height: 90%; object-fit: contain; filter: drop-shadow(0 5px 10px rgba(0,0,0,0.5)); }
        
        .pb-grid-name { font-weight: 600; font-size: 15px; margin-bottom: 4px; }
        .pb-grid-desc { font-size: 11px; color: #64748b; }

        .pb-action-box { margin-top: 40px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 30px; text-align: center; }
        .pb-timer-btn { background: #1e293b; border: 1px solid #334155; color: #cbd5e1; padding: 8px 20px; border-radius: 50px; cursor: pointer; transition: 0.3s; font-weight: 600; }
        .pb-timer-btn.active { background: #3b82f6; border-color: #3b82f6; color: #fff; box-shadow: 0 0 15px rgba(59, 130, 246, 0.4); }

        /* Buttons */
        .pb-btn-glow { background: linear-gradient(135deg, #3b82f6, #7c3aed); color: #fff; border: none; padding: 16px 30px; border-radius: 12px; font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 16px; letter-spacing: 1px; cursor: pointer; transition: 0.3s; width: 100%; box-shadow: 0 10px 20px rgba(59, 130, 246, 0.3); }
        .pb-btn-glow:hover:not(:disabled) { transform: translateY(-3px); box-shadow: 0 15px 30px rgba(124, 58, 237, 0.5); }
        .pb-btn-glow:disabled { opacity: 0.5; cursor: wait; }
        
        .pb-btn-outline { background: transparent; border: 2px solid #334155; color: #fff; padding: 16px 30px; border-radius: 12px; font-family: 'Space Grotesk', sans-serif; font-weight: 600; cursor: pointer; transition: 0.3s; width: 100%; }
        .pb-btn-outline:hover:not(:disabled) { background: #1e293b; border-color: #475569; }

        /* Camera Box */
        .pb-cam-wrapper { position: relative; width: 100%; max-width: 600px; margin: 0 auto; aspect-ratio: 4/3; border-radius: 16px; overflow: hidden; border: 2px solid rgba(59, 130, 246, 0.3); box-shadow: 0 0 30px rgba(59, 130, 246, 0.1); background: #000; }
        .pb-video { width: 100%; height: 100%; object-fit: cover; }
        .pb-cam-grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(255,255,255,0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.2) 1px, transparent 1px); background-size: 33.33% 33.33%; pointer-events: none; }
        .pb-countdown { position: absolute; inset: 0; display: flex; justify-content: center; align-items: center; font-size: 150px; font-weight: 900; font-family: 'Space Grotesk', sans-serif; color: #fff; text-shadow: 0 0 40px #3b82f6; z-index: 10; animation: pop 1s infinite; }
        @keyframes pop { 0% { transform: scale(0.5); opacity: 0; } 50% { transform: scale(1.1); opacity: 1; } 100% { transform: scale(1); opacity: 0; } }
        .pb-flash { position: absolute; inset: 0; background: #fff; z-index: 20; animation: flash 0.2s forwards; }
        @keyframes flash { from { opacity: 1; } to { opacity: 0; } }
        
        .pb-dots { display: flex; justify-content: center; gap: 10px; margin-top: 25px; }
        .pb-dot { width: 12px; height: 12px; border-radius: 50%; background: #1e293b; transition: 0.3s; }
        .pb-dot.done { background: #10b981; box-shadow: 0 0 10px #10b981; }
        .pb-dot.active { background: #3b82f6; box-shadow: 0 0 15px #3b82f6; transform: scale(1.3); }

        /* Sandwich Review Area */
        .pb-review-layout { display: grid; grid-template-columns: 1fr 300px; gap: 40px; align-items: start; }
        @media (max-width: 768px) { .pb-review-layout { grid-template-columns: 1fr; } }
        
        .pb-sandwich-box { background: #020617; border: 1px solid #1e293b; border-radius: 16px; padding: 20px; display: flex; justify-content: center; overflow: hidden; box-shadow: inset 0 0 30px rgba(0,0,0,0.8); }
        .pb-sandwich-target { position: relative; background: #fff; box-shadow: 0 10px 40px rgba(0,0,0,0.5); overflow: hidden; }
        .pb-sandwich-frame { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 10; }

        .pb-controls { display: flex; flex-direction: column; gap: 20px; }
        .pb-filter-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; }
        .pb-filter-btn { padding: 12px 20px; border-radius: 12px; border: 1px solid #334155; background: #0f172a; color: #fff; font-weight: 600; text-align: left; cursor: pointer; transition: 0.3s; }
        .pb-filter-btn:hover { background: #1e293b; }
        .pb-filter-btn.active { border-color: #3b82f6; background: rgba(59, 130, 246, 0.1); color: #93c5fd; box-shadow: 0 0 15px rgba(59, 130, 246, 0.2); }

        /* Final Stage */
        .pb-final-img { max-width: 100%; max-height: 50vh; border-radius: 12px; box-shadow: 0 15px 40px rgba(0,0,0,0.6); margin-bottom: 30px; border: 1px solid rgba(255,255,255,0.1); }
        .pb-qr-box { background: rgba(0,0,0,0.4); padding: 20px; border-radius: 16px; display: inline-block; border: 1px solid #1e293b; }
      `}</style>
    </div>
  );
}