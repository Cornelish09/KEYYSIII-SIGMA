import React, { useState } from "react";
import { useLocation } from "react-router-dom";

export function Header({ onReset }: { onReset: () => void }) {
  const location = useLocation();
  const [showVideo, setShowVideo] = useState(false);
  const isIntro = location.pathname === "/";

  // --- LOGIC AUDIO "SAPU JAGAT" (Mute All) ---
  const handleOpenVideo = () => {
    // 1. Cari SEMUA elemen audio di seluruh halaman (bukan cuma ID bg-music)
    const allAudios = document.querySelectorAll("audio");

    // 2. Loop setiap audio
    allAudios.forEach((audio) => {
      // Kalau audionya lagi bunyi (tidak dipause)
      if (!audio.paused) {
        audio.pause(); // Matikan
        // Kasih tanda kalau audio ini tadi kita matikan paksa
        audio.setAttribute("data-paused-by-header", "true");
      }
    });

    setShowVideo(true);
  };

  const handleCloseVideo = () => {
    setShowVideo(false);

    // 1. Cari lagi semua audio
    const allAudios = document.querySelectorAll("audio");

    // 2. Loop dan nyalakan hanya yang tadi kita matikan
    allAudios.forEach((audio) => {
      if (audio.getAttribute("data-paused-by-header") === "true") {
        audio.play().catch((e) => console.log("Resume error:", e));
        // Hapus tandanya
        audio.removeAttribute("data-paused-by-header");
      }
    });
  };

  return (
    <>
      <header className="app-header">
        {/* TOMBOL SIGNATURE (Cyber Theme) */}
        <div className="signature-pill-dark" onClick={handleOpenVideo}>
          <span className="icon-glow">👾</span> 
          <span className="text-gradient">yoshyy x keyysi</span>
        </div>

        {/* TOMBOL RESET */}
        {!isIntro && (
          <button className="btn-reset-cyber" onClick={onReset}>
            RST
          </button>
        )}
      </header>

      {/* --- VIDEO MODAL SUPER --- */}
      {showVideo && (
        <div className="video-overlay-cyber">
          {/* EFEK RASI BINTANG */}
          <div className="constellation-bg"></div>

          {/* Hiasan Orbit */}
          <div className="orbit-ring">
            <div className="planet p1">🪐</div>
            <div className="planet p3">💜</div>
          </div>

          {/* Hiasan Ngambang Lucu */}
          <div className="floater f1">✨</div>
          <div className="floater f2">🚀</div>
          <div className="floater f3">🛸</div>
          <div className="floater f4">⭐</div>

          {/* FRAME VIDEO 16:9 */}
          <div className="video-frame-cyber">
            {/* Header Frame */}
            <div className="cyber-header">
              <div className="dot red"></div>
              <div className="dot yellow"></div>
              <div className="dot green"></div>
              <span className="rec-text">REC • PLAYING MEMORIES</span>
              <button className="btn-close-cyber" onClick={handleCloseVideo}>✕</button>
            </div>

            {/* Video Player */}
            <div className="video-wrapper">
              <video 
                className="video-player" 
                src="/us.mp4" 
                autoPlay 
                loop 
                playsInline 
              />
              {/* Scanline Effect */}
              <div className="scanline"></div>
            </div>

            {/* Footer Visualizer */}
            <div className="cyber-footer">
              <div className="visualizer">
                <span></span><span></span><span></span><span></span><span></span>
              </div>
              <div className="cyber-caption">in every moment, there's a story</div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@600;700&family=Inter:wght@400;600&display=swap');

        /* HEADER */
        .app-header { position: fixed; top: 0; left: 0; right: 0; z-index: 100; display: flex; justify-content: space-between; align-items: flex-start; padding: 25px 30px; pointer-events: none; }
        
        /* TOMBOL UTAMA */
        .signature-pill-dark { pointer-events: auto; cursor: pointer; background: rgba(10, 10, 20, 0.6); backdrop-filter: blur(12px); border: 1px solid rgba(124, 58, 237, 0.4); padding: 8px 20px; border-radius: 50px; display: flex; align-items: center; gap: 10px; box-shadow: 0 0 20px rgba(124, 58, 237, 0.15); transition: 0.3s; }
        .signature-pill-dark:hover { background: #000; border-color: #3b82f6; box-shadow: 0 0 30px rgba(59, 130, 246, 0.4); transform: scale(1.05); }
        .text-gradient { font-family: 'Rajdhani', sans-serif; font-weight: 700; font-size: 16px; letter-spacing: 1px; background: linear-gradient(90deg, #fff, #c4b5fd); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .icon-glow { font-size: 16px; animation: bounce 2s infinite; }
        
        /* TOMBOL RESET */
        .btn-reset-cyber { pointer-events: auto; cursor: pointer; background: black; color: #7c3aed; border: 1px solid #7c3aed; font-family: 'Rajdhani', sans-serif; font-weight: 700; padding: 6px 14px; border-radius: 8px; transition: 0.3s; }
        .btn-reset-cyber:hover { background: #7c3aed; color: #fff; box-shadow: 0 0 15px #7c3aed; }

        /* OVERLAY CONTAINER */
        .video-overlay-cyber {
          position: fixed; inset: 0; z-index: 9999;
          background: rgba(2, 6, 23, 0.96);
          backdrop-filter: blur(20px);
          display: flex; align-items: center; justify-content: center;
          animation: fadeIn 0.4s ease;
          overflow: hidden;
        }

        /* EFEK RASI BINTANG */
        .constellation-bg {
            position: absolute; inset: 0; pointer-events: none;
            background-image: 
                radial-gradient(circle at center, rgba(124, 58, 237, 0.1) 0%, transparent 50%),
                radial-gradient(white, rgba(255,255,255,.2) 2px, transparent 5px),
                radial-gradient(white, rgba(255,255,255,.1) 1px, transparent 3px);
            background-size: 100% 100%, 550px 550px, 350px 350px;
            animation: twinkleDrift 120s linear infinite;
            opacity: 0.4; z-index: 1;
        }
        @keyframes twinkleDrift { from { transform: translateY(0) rotate(0deg); } to { transform: translateY(-500px) rotate(5deg); } }

        /* ANIMASI ORBIT */
        .orbit-ring { position: absolute; width: 700px; height: 700px; border: 1px dashed rgba(124, 58, 237, 0.3); border-radius: 50%; animation: spin 30s linear infinite; pointer-events: none; z-index: 2; }
        .planet { position: absolute; font-size: 24px; animation: antiSpin 30s linear infinite; }
        .p1 { top: 50px; left: 50%; } .p3 { top: 200px; right: 50px; }
        @keyframes spin { 100% { transform: rotate(360deg); } } @keyframes antiSpin { 100% { transform: rotate(-360deg); } }

        /* ANIMASI FLOATERS */
        .floater { position: absolute; font-size: 20px; z-index: 3; animation: floatAround 15s infinite ease-in-out alternate; pointer-events: none; filter: drop-shadow(0 0 10px rgba(124,58,237,0.5)); }
        .f1 { top: 15%; left: 10%; animation-delay: 0s; font-size: 28px; }
        .f2 { bottom: 20%; right: 15%; animation-delay: -5s; font-size: 35px; }
        .f3 { top: 65%; left: 8%; animation-delay: -2s; font-size: 26px; }
        .f4 { top: 10%; right: 25%; animation-delay: -8s; font-size: 22px; color: #ffbd2e; }
        @keyframes floatAround {
            0% { transform: translate(0, 0) rotate(0deg); }
            50% { transform: translate(30px, -40px) rotate(15deg); }
            100% { transform: translate(-20px, 20px) rotate(-10deg); }
        }

        /* FRAME VIDEO 16:9 BESAR */
        .video-frame-cyber {
          position: relative; width: 95%; max-width: 1000px;
          background: #000; border-radius: 16px;
          border: 2px solid rgba(124, 58, 237, 0.6);
          box-shadow: 0 0 80px rgba(59, 130, 246, 0.3), 0 0 30px rgba(124, 58, 237, 0.5);
          overflow: hidden; animation: popUp 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); z-index: 10;
        }

        .cyber-header { padding: 12px 15px; background: rgba(15, 23, 42, 0.9); border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; gap: 6px; }
        .dot { width: 8px; height: 8px; border-radius: 50%; } .red { background: #ff5f56; } .yellow { background: #ffbd2e; } .green { background: #27c93f; }
        .rec-text { margin-left: auto; font-family: 'Rajdhani', sans-serif; font-size: 12px; color: #ef4444; font-weight: 700; letter-spacing: 1px; animation: blink 1.5s infinite; }
        .btn-close-cyber { background: none; border: none; color: #fff; font-size: 18px; cursor: pointer; margin-left: 15px; transition: 0.3s; }
        .btn-close-cyber:hover { color: #ff5f56; transform: scale(1.2) rotate(90deg); }
        
        .video-wrapper { position: relative; width: 100%; aspect-ratio: 16/9; background: #000; }
        .video-player { width: 100%; height: 100%; object-fit: cover; }
        .scanline { position: absolute; inset: 0; background: linear-gradient(to bottom, transparent 50%, rgba(0,0,0,0.2) 51%); background-size: 100% 4px; pointer-events: none; opacity: 0.7; }

        .cyber-footer { padding: 15px; background: rgba(15, 23, 42, 0.95); display: flex; align-items: center; justify-content: space-between; border-top: 1px solid rgba(124, 58, 237, 0.3); }
        .cyber-caption { font-family: 'Space Mono', monospace; font-size: 11px; color: #94a3b8; letter-spacing: 1px; }
        
        .visualizer { display: flex; gap: 3px; align-items: flex-end; height: 15px; }
        .visualizer span { width: 3px; background: #7c3aed; animation: sound 0.5s infinite ease-in-out alternate; box-shadow: 0 0 5px #7c3aed; }
        .visualizer span:nth-child(1) { height: 60%; animation-delay: 0.1s; } .visualizer span:nth-child(2) { height: 30%; animation-delay: 0.3s; } .visualizer span:nth-child(3) { height: 100%; animation-delay: 0.0s; background: #3b82f6; box-shadow: 0 0 8px #3b82f6; } .visualizer span:nth-child(4) { height: 50%; animation-delay: 0.4s; } .visualizer span:nth-child(5) { height: 80%; animation-delay: 0.2s; }

        @keyframes sound { 0% { height: 20%; } 100% { height: 100%; } }
        @keyframes blink { 50% { opacity: 0; } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes popUp { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
      `}</style>
    </>
  );
}