import React, { useRef, useState, useCallback, useEffect } from "react";
import Webcam from "react-webcam";
import { useNavigate } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import { db } from "../firebase"; 
import { doc, setDoc, collection, onSnapshot } from "firebase/firestore";

const CLOUDINARY_CLOUD_NAME = "dkfhlusok";
const CLOUDINARY_UPLOAD_PRESET = "keyysi_sigma";

interface PhotoSlot {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Template {
  id: string;
  name: string;
  imageUrl: string;
  photoCount: number;
  slots?: PhotoSlot[];
  canvasWidth?: number;   // ✅ TAMBAHAN
  canvasHeight?: number;  // ✅ TAMBAHAN
}

// ✅ FUNGSI BARU: AUTO DETECT PINK SLOTS
const detectPinkSlots = async (imageUrl: string): Promise<PhotoSlot[]> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve([]);

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;

      const pinkRegions: { minX: number; minY: number; maxX: number; maxY: number }[] = [];
      const visited = new Set<string>();

      // Scan pixel cari pink (#FF00FF atau deket pink)
      for (let y = 0; y < canvas.height; y += 5) { // Skip 5px biar cepet
        for (let x = 0; x < canvas.width; x += 5) {
          const idx = (y * canvas.width + x) * 4;
          const r = pixels[idx];
          const g = pixels[idx + 1];
          const b = pixels[idx + 2];

          // Detect pink (R tinggi, G rendah, B tinggi)
          const isPink = r > 200 && g < 100 && b > 200;
          
          if (isPink && !visited.has(`${x},${y}`)) {
            // Flood fill untuk dapetin region
            const region = floodFill(pixels, canvas.width, canvas.height, x, y, visited);
            if (region.maxX - region.minX > 50 && region.maxY - region.minY > 50) {
              pinkRegions.push(region);
            }
          }
        }
      }

      // Convert regions ke slots
      const slots: PhotoSlot[] = pinkRegions
        .sort((a, b) => a.minY - b.minY) // Sort dari atas ke bawah
        .map(region => ({
          x: region.minX,
          y: region.minY,
          width: region.maxX - region.minX,
          height: region.maxY - region.minY
        }));

      console.log("🎨 Detected slots:", slots);
      resolve(slots);
    };

    img.onerror = () => resolve([]);
    img.src = imageUrl;
  });
};

const floodFill = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  visited: Set<string>
) => {
  let minX = startX, maxX = startX, minY = startY, maxY = startY;
  const stack = [[startX, startY]];

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    const key = `${x},${y}`;
    
    if (visited.has(key)) continue;
    if (x < 0 || x >= width || y < 0 || y >= height) continue;

    const idx = (y * width + x) * 4;
    const r = pixels[idx];
    const g = pixels[idx + 1];
    const b = pixels[idx + 2];
    
    const isPink = r > 200 && g < 100 && b > 200;
    if (!isPink) continue;

    visited.add(key);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);

    // Check neighbors (only cardinal directions biar ga lambat)
    stack.push([x + 5, y], [x - 5, y], [x, y + 5], [x, y - 5]);
  }

  return { minX, minY, maxX, maxY };
};

export function PhotoboxPage() {
  const navigate = useNavigate();
  const webcamRef = useRef<Webcam>(null);
  
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [detectedSlots, setDetectedSlots] = useState<PhotoSlot[]>([]);
  const [capturedPhotos, setCapturedPhotos] = useState<string[]>([]);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  
  const [finalResult, setFinalResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [detectingSlots, setDetectingSlots] = useState(false);
  const [flash, setFlash] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");

  // Load templates dari Firestore
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "photobox_templates"), (snapshot) => {
      const loadedTemplates = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Template));
      setTemplates(loadedTemplates);
    });
    return () => unsubscribe();
  }, []);

  // Auto-detect slots ketika template dipilih
  useEffect(() => {
    if (!selectedTemplate) return;

    const detectSlots = async () => {
      // Kalau slots udah di-set manual di admin, skip auto-detect
      if (selectedTemplate.slots && selectedTemplate.slots.length > 0) {
        setDetectedSlots(selectedTemplate.slots);
        return;
      }

      // Auto-detect dari pink markers
      setDetectingSlots(true);
      console.log("🔍 Auto-detecting pink slots...");
      const slots = await detectPinkSlots(selectedTemplate.imageUrl);
      console.log("✅ Detected", slots.length, "slots");
      setDetectedSlots(slots);
      setDetectingSlots(false);
    };

    detectSlots();
  }, [selectedTemplate]);

  // Reset saat ganti template
  useEffect(() => {
    setCapturedPhotos([]);
    setCurrentPhotoIndex(0);
    setFinalResult(null);
  }, [selectedTemplate]);

  // ✅ FIXED: Merge dengan canvas size yang bener (707 x 2000)
  const mergePhotosWithTemplate = async (photos: string[]): Promise<string> => {
    return new Promise((resolve) => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      
      // ✅ PAKE CANVAS SIZE DARI TEMPLATE (707 x 2000)
      canvas.width = selectedTemplate?.canvasWidth || 707;
      canvas.height = selectedTemplate?.canvasHeight || 2000;
      
      if (!ctx) return resolve("");

      // Background putih
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      let loadedCount = 0;
      const slots = detectedSlots.length > 0 ? detectedSlots : (selectedTemplate?.slots || []);
      const totalImages = photos.length + 1; // Photos + template

      const checkAllLoaded = () => {
        loadedCount++;
        if (loadedCount === totalImages) {
          resolve(canvas.toDataURL("image/jpeg", 0.9));
        }
      };

      // 1. Draw foto user ke slot
      photos.forEach((photoBase64, index) => {
        if (!slots[index]) return;

        const slot = slots[index];
        const img = new Image();
        img.src = photoBase64;
        
        img.onload = () => {
          const scale = Math.max(slot.width / img.width, slot.height / img.height);
          const scaledWidth = img.width * scale;
          const scaledHeight = img.height * scale;
          
          const offsetX = (scaledWidth - slot.width) / 2;
          const offsetY = (scaledHeight - slot.height) / 2;
          
          ctx.save();
          ctx.beginPath();
          ctx.rect(slot.x, slot.y, slot.width, slot.height);
          ctx.clip();
          ctx.drawImage(
            img, 
            slot.x - offsetX, 
            slot.y - offsetY, 
            scaledWidth, 
            scaledHeight
          );
          ctx.restore();
          
          checkAllLoaded();
        };
      });

      // 2. Overlay template
      const template = new Image();
      template.crossOrigin = "anonymous";
      template.src = selectedTemplate!.imageUrl;
      
      template.onload = () => {
        ctx.drawImage(template, 0, 0, canvas.width, canvas.height);
        checkAllLoaded();
      };
    });
  };

  const capturePhoto = useCallback(async () => {
    if (!webcamRef.current) return;

    setFlash(true);
    setTimeout(() => setFlash(false), 200);

    const imageSrc = webcamRef.current.getScreenshot();
    if (!imageSrc) return;

    const newPhotos = [...capturedPhotos, imageSrc];
    setCapturedPhotos(newPhotos);

    const requiredCount = detectedSlots.length || selectedTemplate?.photoCount || 4;
    
    if (newPhotos.length >= requiredCount) {
      setLoading(true);
      
      // Merge semua foto
      const result = await mergePhotosWithTemplate(newPhotos);
      
      // Upload ke Cloudinary
      try {
        const formData = new FormData();
        const blob = await (await fetch(result)).blob();
        formData.append("file", blob);
        formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

        const res = await fetch(
          `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
          { method: "POST", body: formData }
        );

        const data = await res.json();
        
        // Save to Firestore
        const sessionId = uuidv4();
        await setDoc(doc(db, "photobox_sessions", sessionId), {
          imageUrl: data.secure_url,
          templateId: selectedTemplate?.id,
          timestamp: new Date().toISOString(),
          photoCount: newPhotos.length
        });

        setFinalResult(result);
      } catch (err) {
        console.error("Upload failed:", err);
        setFinalResult(result); // Still show result even if upload fails
      }
      
      setLoading(false);
    } else {
      setCurrentPhotoIndex(newPhotos.length);
    }
  }, [webcamRef, capturedPhotos, detectedSlots, selectedTemplate]);

  const startCountdown = useCallback(() => {
    setCountdown(3);
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          setTimeout(() => {
            capturePhoto();
            setCountdown(null);
          }, 100);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  }, [capturePhoto]);

  const resetPhotos = useCallback(() => {
    setCapturedPhotos([]);
    setCurrentPhotoIndex(0);
    setFinalResult(null);
  }, []);

  const requiredCount = detectedSlots.length || selectedTemplate?.photoCount || 4;

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: 20,
      fontFamily: 'system-ui, sans-serif'
    }}>
      <div style={{ maxWidth: 500, margin: '0 auto' }}>
        <div style={{
          textAlign: 'center',
          marginBottom: 30,
          paddingTop: 20
        }}>
          <h1 style={{
            color: 'white',
            fontSize: 32,
            fontWeight: 900,
            marginBottom: 8,
            letterSpacing: 2
          }}>
            📸 PHOTOBOX
          </h1>
          <p style={{
            color: 'rgba(255,255,255,0.8)',
            fontSize: 14,
            fontWeight: 500
          }}>
            Ambil {requiredCount} foto bareng buat kenangan!
          </p>
        </div>

        <div style={{
          position: 'relative',
          borderRadius: 30,
          overflow: 'hidden',
          boxShadow: '0 25px 60px rgba(0,0,0,0.3)',
          marginBottom: 20
        }}>
          {!finalResult ? (
            <div style={{ position: 'relative', aspectRatio: '3/4', background: '#000' }}>
              <Webcam
                ref={webcamRef}
                screenshotFormat="image/jpeg"
                videoConstraints={{
                  facingMode,
                  width: 1080,
                  height: 1920
                }}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover'
                }}
              />

              <button
                onClick={() => setFacingMode(prev => prev === "user" ? "environment" : "user")}
                style={{
                  position: 'absolute',
                  top: 20,
                  right: 20,
                  background: 'rgba(0,0,0,0.6)',
                  backdropFilter: 'blur(10px)',
                  border: '2px solid white',
                  borderRadius: '50%',
                  width: 50,
                  height: 50,
                  color: 'white',
                  fontSize: 20,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 10
                }}
              >
                🔄
              </button>

              {countdown !== null && (
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(0,0,0,0.7)',
                  zIndex: 40
                }}>
                  <span style={{
                    fontSize: 120,
                    fontWeight: 900,
                    color: 'white',
                    animation: 'pulse 1s ease-in-out'
                  }}>
                    {countdown}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <img
              src={finalResult}
              style={{
                width: '100%',
                display: 'block',
                borderRadius: 0
              }}
              alt="Final photostrip"
            />
          )}

          {loading && (
            <div style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.9)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 50
            }}>
              <div style={{
                border: '4px solid rgba(255,255,255,0.1)',
                borderTop: '4px solid white',
                borderRadius: '50%',
                width: 60,
                height: 60,
                animation: 'spin 1s linear infinite'
              }}/>
              <p style={{ color: 'white', marginTop: 20, letterSpacing: 3, fontSize: 12 }}>
                GENERATING PHOTOSTRIP...
              </p>
            </div>
          )}

          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'white',
            opacity: flash ? 1 : 0,
            pointerEvents: 'none',
            transition: 'opacity 0.2s'
          }}/>
        </div>

        {capturedPhotos.length > 0 && !finalResult && (
          <div style={{ marginBottom: 20 }}>
            <p style={{ color: 'white', fontSize: 12, marginBottom: 8, fontWeight: 600 }}>
              FOTO YANG SUDAH DIAMBIL:
            </p>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
              {capturedPhotos.map((photo, idx) => (
                <div
                  key={idx}
                  style={{
                    minWidth: 80,
                    height: 100,
                    borderRadius: 10,
                    overflow: 'hidden',
                    border: '2px solid white',
                    boxShadow: '0 4px 15px rgba(0,0,0,0.2)'
                  }}
                >
                  <img src={photo} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt={`Photo ${idx+1}`} />
                </div>
              ))}
            </div>
          </div>
        )}

        {!finalResult && capturedPhotos.length === 0 && templates.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <p style={{ color: 'white', fontSize: 13, marginBottom: 10, fontWeight: 600 }}>
              PILIH TEMPLATE:
            </p>
            <div style={{
              display: 'flex',
              gap: 12,
              overflowX: 'auto',
              paddingBottom: 10
            }}>
              {templates.map(template => (
                <div
                  key={template.id}
                  onClick={() => setSelectedTemplate(template)}
                  style={{
                    minWidth: 100,
                    cursor: 'pointer',
                    border: selectedTemplate?.id === template.id
                      ? '3px solid #fff'
                      : '3px solid transparent',
                    borderRadius: 15,
                    overflow: 'hidden',
                    boxShadow: selectedTemplate?.id === template.id
                      ? '0 8px 25px rgba(255,255,255,0.4)'
                      : '0 4px 15px rgba(0,0,0,0.2)',
                    transition: 'all 0.3s',
                    position: 'relative'
                  }}
                >
                  <img
                    src={template.imageUrl}
                    style={{ width: '100%', height: 130, objectFit: 'cover' }}
                    alt={template.name}
                  />
                  <div style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
                    padding: '20px 8px 8px',
                    fontSize: 9,
                    color: 'white',
                    fontWeight: 600,
                    textAlign: 'center'
                  }}>
                    {template.name}
                    <br />
                    <span style={{ fontSize: 8, opacity: 0.8 }}>({template.photoCount} foto)</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!finalResult && !loading && !detectingSlots && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {capturedPhotos.length > 0 && capturedPhotos.length < requiredCount && (
              <button
                onClick={resetPhotos}
                style={{
                  width: '100%',
                  padding: 15,
                  borderRadius: 50,
                  background: 'rgba(255,255,255,0.2)',
                  backdropFilter: 'blur(10px)',
                  border: '2px solid white',
                  color: 'white',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                🔄 Ulangi dari Awal
              </button>
            )}

            <button
              onClick={startCountdown}
              disabled={countdown !== null || !selectedTemplate}
              style={{
                width: '100%',
                padding: 20,
                borderRadius: 50,
                background: countdown !== null || !selectedTemplate
                  ? 'rgba(255,255,255,0.3)'
                  : 'linear-gradient(45deg, #f093fb 0%, #f5576c 100%)',
                border: 'none',
                color: 'white',
                fontSize: 18,
                fontWeight: 900,
                cursor: countdown !== null || !selectedTemplate ? 'not-allowed' : 'pointer',
                boxShadow: '0 10px 30px rgba(245, 87, 108, 0.4)',
                transition: 'all 0.3s',
                letterSpacing: 2
              }}
            >
              {!selectedTemplate
                ? '⚠️ PILIH TEMPLATE DULU'
                : capturedPhotos.length === 0
                ? `📸 MULAI (${requiredCount} FOTO)`
                : `📸 FOTO ${capturedPhotos.length + 1} / ${requiredCount}`
              }
            </button>
          </div>
        )}

        {detectingSlots && (
          <div style={{
            textAlign: 'center',
            color: 'white',
            padding: 20,
            background: 'rgba(255,255,255,0.1)',
            borderRadius: 15,
            backdropFilter: 'blur(10px)'
          }}>
            <div style={{
              border: '3px solid rgba(255,255,255,0.3)',
              borderTop: '3px solid white',
              borderRadius: '50%',
              width: 40,
              height: 40,
              animation: 'spin 1s linear infinite',
              margin: '0 auto 10px'
            }}/>
            Detecting photo slots...
          </div>
        )}

        {finalResult && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <a
              href={finalResult}
              download={`photostrip-${Date.now()}.jpg`}
              style={{
                width: '100%',
                padding: 18,
                background: 'white',
                color: '#667eea',
                borderRadius: 50,
                textDecoration: 'none',
                fontWeight: 900,
                textAlign: 'center',
                boxShadow: '0 8px 25px rgba(0,0,0,0.2)'
              }}
            >
              💾 SIMPAN FOTO
            </a>
            <button
              onClick={resetPhotos}
              style={{
                width: '100%',
                padding: 18,
                background: 'rgba(255,255,255,0.2)',
                backdropFilter: 'blur(10px)',
                border: '2px solid white',
                color: 'white',
                borderRadius: 50,
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              🔄 FOTO LAGI
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.2); opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}