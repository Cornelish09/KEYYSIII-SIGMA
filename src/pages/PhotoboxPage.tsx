import React, { useRef, useState, useEffect } from 'react';
import Webcam from 'react-webcam';
import { db } from '../firebase';
import { collection, query, orderBy, onSnapshot, addDoc } from 'firebase/firestore';

// ========================================
// 🎯 TYPES
// ========================================
type PhotoSlot = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PhotoTemplate = {
  id: string;
  name: string;
  imageUrl: string;
  photoCount: number;
  slots: PhotoSlot[];
  canvasWidth: number;
  canvasHeight: number;
  createdAt: string;
};

type CapturedPhoto = {
  slotIndex: number;
  dataUrl: string;
};

type Stage = 'template-selection' | 'camera-capture' | 'preview' | 'result';

// ========================================
// 🎨 MAIN COMPONENT
// ========================================
export function PhotoboxPage() {
  // --- STATE MANAGEMENT ---
  const [stage, setStage] = useState<Stage>('template-selection');
  const [templates, setTemplates] = useState<PhotoTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<PhotoTemplate | null>(null);
  const [capturedPhotos, setCapturedPhotos] = useState<CapturedPhoto[]>([]);
  const [currentSlotIndex, setCurrentSlotIndex] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [countdownDuration, setCountdownDuration] = useState(3);
  const [isFlashing, setIsFlashing] = useState(false);
  const [finalImage, setFinalImage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // --- REFS ---
  const webcamRef = useRef<Webcam>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const compositeCanvasRef = useRef<HTMLCanvasElement>(null);

  // --- LOAD TEMPLATES FROM FIREBASE ---
  useEffect(() => {
    const q = query(collection(db, 'photobox_templates'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const temps = snapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() 
      })) as PhotoTemplate[];
      setTemplates(temps);
      console.log('📸 Loaded templates:', temps.length);
    });
    return () => unsubscribe();
  }, []);

  // --- COUNTDOWN LOGIC ---
  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      capturePhoto();
      setCountdown(null);
      return;
    }
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  // --- HANDLERS ---
  const selectTemplate = (template: PhotoTemplate) => {
    setSelectedTemplate(template);
    setCapturedPhotos([]);
    setCurrentSlotIndex(0);
    setStage('camera-capture');
  };

  const startCountdown = () => {
    setCountdown(countdownDuration);
  };

  const capturePhoto = () => {
    if (!webcamRef.current) return;
    
    const imageSrc = webcamRef.current.getScreenshot();
    if (!imageSrc) return;

    // Flash effect
    setIsFlashing(true);
    setTimeout(() => setIsFlashing(false), 200);

    const newPhoto: CapturedPhoto = {
      slotIndex: currentSlotIndex,
      dataUrl: imageSrc
    };

    const updatedPhotos = [...capturedPhotos, newPhoto];
    setCapturedPhotos(updatedPhotos);

    // Check if all slots are filled
    if (selectedTemplate && updatedPhotos.length >= selectedTemplate.photoCount) {
      setStage('preview');
      generateComposite(updatedPhotos);
    } else {
      setCurrentSlotIndex(currentSlotIndex + 1);
    }
  };

  const retakePhoto = (slotIndex: number) => {
    const filtered = capturedPhotos.filter(p => p.slotIndex !== slotIndex);
    setCapturedPhotos(filtered);
    setCurrentSlotIndex(slotIndex);
    setStage('camera-capture');
  };

  const generateComposite = async (photos: CapturedPhoto[]) => {
    if (!selectedTemplate || !compositeCanvasRef.current) return;

    const canvas = compositeCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = selectedTemplate.canvasWidth;
    canvas.height = selectedTemplate.canvasHeight;

    // 1. Draw white background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. Draw photos in slots
    for (const photo of photos) {
      const slot = selectedTemplate.slots[photo.slotIndex];
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      await new Promise<void>((resolve) => {
        img.onload = () => {
          ctx.drawImage(img, slot.x, slot.y, slot.width, slot.height);
          resolve();
        };
        img.src = photo.dataUrl;
      });
    }

    // 3. Draw template overlay (PNG transparent)
    const templateImg = new Image();
    templateImg.crossOrigin = 'anonymous';
    
    await new Promise<void>((resolve) => {
      templateImg.onload = () => {
        ctx.drawImage(templateImg, 0, 0, canvas.width, canvas.height);
        resolve();
      };
      templateImg.src = selectedTemplate.imageUrl;
    });

    // 4. Export final image
    const finalDataUrl = canvas.toDataURL('image/png');
    setFinalImage(finalDataUrl);
    setStage('result');
  };

  const downloadImage = () => {
    if (!finalImage) return;
    const link = document.createElement('a');
    link.href = finalImage;
    link.download = `photobox-${Date.now()}.png`;
    link.click();
  };

  const saveToDatabase = async () => {
    if (!finalImage) return;
    setIsSaving(true);
    
    try {
      await addDoc(collection(db, 'secret_photos'), {
        url: finalImage,
        templateId: selectedTemplate?.id,
        createdAt: new Date().toISOString()
      });
      alert('✅ Foto berhasil disimpan!');
    } catch (err) {
      console.error(err);
      alert('❌ Gagal menyimpan foto');
    }
    
    setIsSaving(false);
  };

  const resetSession = () => {
    setStage('template-selection');
    setSelectedTemplate(null);
    setCapturedPhotos([]);
    setCurrentSlotIndex(0);
    setFinalImage(null);
  };

  // --- RENDER STAGES ---
  return (
    <div className="photobox-container">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&display=swap');

        .photobox-container {
          position: fixed;
          inset: 0;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          font-family: 'Poppins', sans-serif;
          overflow: hidden;
        }

        /* Animated Background */
        .photobox-container::before {
          content: '';
          position: absolute;
          inset: 0;
          background: 
            radial-gradient(circle at 20% 50%, rgba(255,255,255,0.1) 0%, transparent 50%),
            radial-gradient(circle at 80% 80%, rgba(255,255,255,0.05) 0%, transparent 50%);
          animation: pulse 4s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        /* Header */
        .photobox-header {
          position: relative;
          z-index: 10;
          padding: 24px 40px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: rgba(0,0,0,0.2);
          backdrop-filter: blur(10px);
        }

        .header-title {
          font-size: 28px;
          font-weight: 800;
          color: white;
          text-shadow: 0 2px 10px rgba(0,0,0,0.3);
        }

        .btn-back {
          padding: 10px 24px;
          background: rgba(255,255,255,0.2);
          border: 2px solid white;
          color: white;
          border-radius: 50px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
        }

        .btn-back:hover {
          background: white;
          color: #667eea;
          transform: translateY(-2px);
        }

        /* Content Area */
        .photobox-content {
          position: relative;
          z-index: 5;
          height: calc(100vh - 90px);
          overflow-y: auto;
          padding: 40px;
        }

        /* ===== TEMPLATE SELECTION ===== */
        .template-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 24px;
          max-width: 1200px;
          margin: 0 auto;
        }

        .template-card {
          background: white;
          border-radius: 20px;
          overflow: hidden;
          cursor: pointer;
          transition: all 0.3s;
          box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        }

        .template-card:hover {
          transform: translateY(-8px);
          box-shadow: 0 20px 50px rgba(0,0,0,0.3);
        }

        .template-preview {
          width: 100%;
          height: 350px;
          background: repeating-conic-gradient(#f0f0f0 0% 25%, #e0e0e0 0% 50%) 50% / 20px 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          overflow: hidden;
        }

        .template-preview img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }

        .template-info {
          padding: 20px;
          text-align: center;
        }

        .template-name {
          font-size: 18px;
          font-weight: 700;
          color: #333;
          margin-bottom: 8px;
        }

        .template-meta {
          font-size: 13px;
          color: #666;
        }

        /* ===== CAMERA CAPTURE ===== */
        .camera-stage {
          max-width: 900px;
          margin: 0 auto;
          background: white;
          border-radius: 24px;
          padding: 30px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }

        .progress-bar {
          display: flex;
          gap: 8px;
          margin-bottom: 24px;
        }

        .progress-dot {
          flex: 1;
          height: 8px;
          background: #e0e0e0;
          border-radius: 10px;
          transition: all 0.3s;
        }

        .progress-dot.active {
          background: linear-gradient(90deg, #667eea, #764ba2);
        }

        .progress-dot.completed {
          background: #10b981;
        }

        .camera-view {
          position: relative;
          border-radius: 16px;
          overflow: hidden;
          background: #000;
          margin-bottom: 24px;
        }

        .webcam-feed {
          width: 100%;
          height: auto;
          display: block;
        }

        .countdown-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0,0,0,0.7);
          z-index: 10;
        }

        .countdown-number {
          font-size: 120px;
          font-weight: 800;
          color: white;
          animation: countdownPulse 1s ease-in-out;
        }

        @keyframes countdownPulse {
          0% { transform: scale(0.5); opacity: 0; }
          50% { transform: scale(1.2); }
          100% { transform: scale(1); opacity: 1; }
        }

        .flash-overlay {
          position: absolute;
          inset: 0;
          background: white;
          z-index: 20;
          animation: flash 0.2s ease-out;
        }

        @keyframes flash {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }

        .camera-controls {
          display: flex;
          gap: 16px;
          align-items: center;
          justify-content: center;
        }

        .countdown-selector {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .countdown-btn {
          padding: 8px 16px;
          border: 2px solid #e0e0e0;
          background: white;
          border-radius: 12px;
          cursor: pointer;
          font-weight: 600;
          transition: all 0.2s;
        }

        .countdown-btn.active {
          background: #667eea;
          color: white;
          border-color: #667eea;
        }

        .btn-capture {
          width: 80px;
          height: 80px;
          border-radius: 50%;
          background: linear-gradient(135deg, #667eea, #764ba2);
          border: 4px solid white;
          cursor: pointer;
          transition: all 0.3s;
          box-shadow: 0 8px 20px rgba(102, 126, 234, 0.4);
        }

        .btn-capture:hover {
          transform: scale(1.1);
          box-shadow: 0 12px 30px rgba(102, 126, 234, 0.6);
        }

        .btn-capture:active {
          transform: scale(0.95);
        }

        /* ===== PREVIEW STAGE ===== */
        .preview-stage {
          max-width: 900px;
          margin: 0 auto;
          background: white;
          border-radius: 24px;
          padding: 30px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }

        .preview-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 16px;
          margin-bottom: 24px;
        }

        .preview-item {
          position: relative;
          aspect-ratio: 1;
          border-radius: 12px;
          overflow: hidden;
          border: 3px solid #e0e0e0;
        }

        .preview-item img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .btn-retake {
          position: absolute;
          top: 8px;
          right: 8px;
          padding: 6px 12px;
          background: rgba(239, 68, 68, 0.9);
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-retake:hover {
          background: rgba(220, 38, 38, 1);
        }

        .preview-actions {
          display: flex;
          gap: 16px;
          justify-content: center;
        }

        .btn-primary, .btn-secondary {
          padding: 14px 32px;
          border-radius: 12px;
          font-weight: 700;
          font-size: 16px;
          cursor: pointer;
          transition: all 0.3s;
          border: none;
        }

        .btn-primary {
          background: linear-gradient(135deg, #667eea, #764ba2);
          color: white;
          box-shadow: 0 8px 20px rgba(102, 126, 234, 0.4);
        }

        .btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 12px 30px rgba(102, 126, 234, 0.6);
        }

        .btn-secondary {
          background: white;
          color: #667eea;
          border: 2px solid #667eea;
        }

        .btn-secondary:hover {
          background: #f3f4f6;
        }

        /* ===== RESULT STAGE ===== */
        .result-stage {
          max-width: 700px;
          margin: 0 auto;
          text-align: center;
        }

        .result-image-container {
          background: white;
          border-radius: 20px;
          padding: 24px;
          margin-bottom: 24px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }

        .result-image {
          width: 100%;
          border-radius: 12px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        }

        .result-actions {
          display: flex;
          gap: 16px;
          justify-content: center;
        }

        /* Hidden Canvas */
        .hidden-canvas {
          display: none;
        }

        /* Responsive */
        @media (max-width: 768px) {
          .photobox-header {
            padding: 16px 20px;
          }

          .header-title {
            font-size: 20px;
          }

          .photobox-content {
            padding: 20px;
          }

          .template-grid {
            grid-template-columns: 1fr;
            gap: 16px;
          }

          .camera-stage, .preview-stage {
            padding: 20px;
          }

          .btn-capture {
            width: 70px;
            height: 70px;
          }

          .countdown-number {
            font-size: 80px;
          }
        }
      `}</style>

      {/* Header */}
      <div className="photobox-header">
        <div className="header-title">📸 Photobox Studio</div>
        <button className="btn-back" onClick={() => window.history.back()}>
          ← Kembali
        </button>
      </div>

      {/* Content */}
      <div className="photobox-content">
        {/* ===== STAGE 1: TEMPLATE SELECTION ===== */}
        {stage === 'template-selection' && (
          <div>
            <div style={{ textAlign: 'center', marginBottom: 40 }}>
              <h1 style={{ fontSize: 48, fontWeight: 800, color: 'white', margin: 0, textShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
                Pilih Template Favorit
              </h1>
              <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.9)', marginTop: 12 }}>
                Pilih frame yang kamu suka, lalu ambil foto!
              </p>
            </div>

            {templates.length === 0 ? (
              <div style={{ 
                background: 'white', 
                borderRadius: 20, 
                padding: 60, 
                textAlign: 'center',
                maxWidth: 600,
                margin: '0 auto'
              }}>
                <div style={{ fontSize: 60, marginBottom: 20 }}>📦</div>
                <div style={{ fontSize: 20, fontWeight: 600, color: '#666', marginBottom: 8 }}>
                  Belum ada template
                </div>
                <div style={{ fontSize: 14, color: '#999' }}>
                  Admin belum upload template. Hubungi admin untuk menambahkan template!
                </div>
              </div>
            ) : (
              <div className="template-grid">
                {templates.map(template => (
                  <div 
                    key={template.id} 
                    className="template-card"
                    onClick={() => selectTemplate(template)}
                  >
                    <div className="template-preview">
                      <img src={template.imageUrl} alt={template.name} />
                    </div>
                    <div className="template-info">
                      <div className="template-name">{template.name}</div>
                      <div className="template-meta">
                        📸 {template.photoCount} foto • {template.canvasWidth}x{template.canvasHeight}px
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ===== STAGE 2: CAMERA CAPTURE ===== */}
        {stage === 'camera-capture' && selectedTemplate && (
          <div className="camera-stage">
            <div style={{ marginBottom: 24, textAlign: 'center' }}>
              <h2 style={{ fontSize: 28, fontWeight: 700, color: '#333', margin: 0 }}>
                Foto {currentSlotIndex + 1} dari {selectedTemplate.photoCount}
              </h2>
              <p style={{ fontSize: 14, color: '#666', marginTop: 8 }}>
                Atur pose dan tekan tombol capture!
              </p>
            </div>

            {/* Progress Bar */}
            <div className="progress-bar">
              {Array.from({ length: selectedTemplate.photoCount }).map((_, idx) => (
                <div 
                  key={idx}
                  className={`progress-dot ${
                    idx < currentSlotIndex ? 'completed' : idx === currentSlotIndex ? 'active' : ''
                  }`}
                />
              ))}
            </div>

            {/* Camera View */}
            <div className="camera-view">
              <Webcam
                ref={webcamRef}
                audio={false}
                screenshotFormat="image/jpeg"
                className="webcam-feed"
                videoConstraints={{
                  facingMode: 'user',
                  width: 1280,
                  height: 720
                }}
              />

              {/* Countdown Overlay */}
              {countdown !== null && (
                <div className="countdown-overlay">
                  <div className="countdown-number">
                    {countdown === 0 ? '📸' : countdown}
                  </div>
                </div>
              )}

              {/* Flash Effect */}
              {isFlashing && <div className="flash-overlay" />}
            </div>

            {/* Controls */}
            <div className="camera-controls">
              <div className="countdown-selector">
                <span style={{ fontSize: 14, fontWeight: 600, color: '#666', marginRight: 8 }}>
                  Countdown:
                </span>
                {[3, 5, 10].map(sec => (
                  <button
                    key={sec}
                    className={`countdown-btn ${countdownDuration === sec ? 'active' : ''}`}
                    onClick={() => setCountdownDuration(sec)}
                  >
                    {sec}s
                  </button>
                ))}
              </div>

              <button 
                className="btn-capture" 
                onClick={startCountdown}
                disabled={countdown !== null}
              />

              <button 
                className="btn-secondary"
                onClick={resetSession}
                style={{ marginLeft: 16 }}
              >
                Batal
              </button>
            </div>
          </div>
        )}

        {/* ===== STAGE 3: PREVIEW ===== */}
        {stage === 'preview' && (
          <div className="preview-stage">
            <div style={{ marginBottom: 24, textAlign: 'center' }}>
              <h2 style={{ fontSize: 28, fontWeight: 700, color: '#333', margin: 0 }}>
                Preview Foto
              </h2>
              <p style={{ fontSize: 14, color: '#666', marginTop: 8 }}>
                Cek dulu hasilnya. Kalau ada yang salah, retake aja!
              </p>
            </div>

            <div className="preview-grid">
              {capturedPhotos.map((photo, idx) => (
                <div key={idx} className="preview-item">
                  <img src={photo.dataUrl} alt={`Photo ${idx + 1}`} />
                  <button 
                    className="btn-retake"
                    onClick={() => retakePhoto(photo.slotIndex)}
                  >
                    Retake
                  </button>
                </div>
              ))}
            </div>

            <div className="preview-actions">
              <button className="btn-secondary" onClick={resetSession}>
                Ulang Semua
              </button>
              <button 
                className="btn-primary" 
                onClick={() => generateComposite(capturedPhotos)}
              >
                Lanjut Proses 🎨
              </button>
            </div>
          </div>
        )}

        {/* ===== STAGE 4: RESULT ===== */}
        {stage === 'result' && finalImage && (
          <div className="result-stage">
            <div style={{ marginBottom: 24, textAlign: 'center' }}>
              <h2 style={{ fontSize: 48, fontWeight: 800, color: 'white', margin: 0, textShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
                🎉 Foto Jadi!
              </h2>
              <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.9)', marginTop: 12 }}>
                Simpan atau bagikan ke temen-temen!
              </p>
            </div>

            <div className="result-image-container">
              <img src={finalImage} alt="Final Result" className="result-image" />
            </div>

            <div className="result-actions">
              <button className="btn-secondary" onClick={resetSession}>
                Bikin Lagi
              </button>
              <button className="btn-primary" onClick={downloadImage}>
                📥 Download
              </button>
              <button 
                className="btn-primary" 
                onClick={saveToDatabase}
                disabled={isSaving}
              >
                {isSaving ? '⏳ Menyimpan...' : '☁️ Simpan ke Gallery'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Hidden Canvas for Composite */}
      <canvas ref={compositeCanvasRef} className="hidden-canvas" />
    </div>
  );
}