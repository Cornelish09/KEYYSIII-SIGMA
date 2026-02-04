import React, { useRef, useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { AppState, ContentConfig } from "../lib/types";
import { saveState } from "../lib/storage";
import { logEvent } from "../lib/activity";

export function Intro3D({
  cfg,
  state,
  setState
}: {
  cfg: ContentConfig;
  state: AppState;
  setState: (s: AppState) => void;
}) {
  const navigate = useNavigate();
  
  // --- STATE ---
  const [hasEntered, setHasEntered] = useState(false);

  // --- LOGIC AUDIO GLOBAL (ANTI-LOOP FIX) ---
  const handleEnter = () => {
    // Ambil elemen audio dari Layout.tsx
    const globalAudio = document.getElementById("bg-music") as HTMLAudioElement;
    
    if (globalAudio) {
      globalAudio.src = "/audio/lany.mp3"; 
      globalAudio.volume = 0.5;
      
      // 🔥 FIX UTAMA: MATIKAN LOOP SECARA PAKSA 🔥
      globalAudio.loop = false; 
      
      globalAudio.play().catch(e => console.error("Audio error:", e));
    }
    setHasEntered(true);
  };

  // --- LOGIC GAMBAR (ASLI) ---
  const [imgSrc, setImgSrc] = useState("/key1.jpg");
  const handleImgError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    if (imgSrc === "/key1.jpg") setImgSrc("/key1.png");
    else if (imgSrc === "/key1.png") setImgSrc("/key1.jpeg");
    else {
      e.currentTarget.style.display = 'none';
      e.currentTarget.parentElement!.style.background = 'linear-gradient(135deg, #1e1b4b, #312e81)';
    }
  };

  // --- LOGIC TYPEWRITER (ASLI) ---
  const chatText = `Halo semuanya! kenalin nama dia ${cfg.couple.herName}.. wanita yang ceria, baik, dan lucu (like a strawberry 🍓), i'm such a big fan of her >_<`;
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!hasEntered) return;
    let i = 0;
    const timer = setInterval(() => {
      setTyped(chatText.slice(0, i + 1));
      i++;
      if (i >= chatText.length) clearInterval(timer);
    }, 40);
    return () => clearInterval(timer);
  }, [chatText, hasEntered]);

  const goNext = () => {
    const next: AppState = { ...state, step: 1, stats: { ...state.stats, lastPlayedAt: new Date().toISOString() } };
    saveState(next);
    setState(next);
    logEvent("flow_next", { from: 0, to: 1 });
    navigate("/game");
  };

  // --- STARS & METEOR (ASLI) ---
  const stars = useMemo(() => 
    Array.from({ length: 40 }).map((_, i) => ({
      left: Math.random() * 100 + "%",
      top: Math.random() * 100 + "%",
      size: Math.random() * 3 + 1 + "px",
      delay: Math.random() * 5 + "s",
      duration: Math.random() * 3 + 2 + "s"
    })), 
  []);

  return (
    <>
      <style>{`
        /* --- TOMBOL GACOR V2 (HYPER NEON) --- */
        .btn-gacor-ultimate {
          position: relative;
          padding: 20px 50px;
          font-family: 'Inter', sans-serif;
          font-size: 16px;
          font-weight: 800;
          color: white;
          text-transform: uppercase;
          letter-spacing: 2px;
          background: rgba(124, 58, 237, 0.2); /* Base Ungu Transparan */
          border: 1px solid rgba(167, 139, 250, 0.5);
          border-radius: 100px;
          cursor: pointer;
          overflow: hidden;
          transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
          backdrop-filter: blur(15px);
          box-shadow: 
            0 0 20px rgba(124, 58, 237, 0.3),
            inset 0 0 20px rgba(124, 58, 237, 0.1);
          z-index: 10;
          display: inline-flex; align-items: center; gap: 12px;
        }

        /* Efek Kilat Miring */
        .btn-gacor-ultimate::before {
          content: '';
          position: absolute;
          top: 0; left: -100%;
          width: 100%; height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.6), transparent);
          transform: skewX(-25deg);
          transition: 0.5s;
        }

        /* Hover State */
        .btn-gacor-ultimate:hover {
          transform: scale(1.05) translateY(-3px);
          background: rgba(124, 58, 237, 0.4);
          border-color: #fff;
          box-shadow: 
            0 0 40px rgba(124, 58, 237, 0.6),
            0 0 10px #fff,
            inset 0 0 30px rgba(124, 58, 237, 0.4);
          text-shadow: 0 0 8px rgba(255,255,255,0.8);
        }

        .btn-gacor-ultimate:hover::before {
          left: 150%;
          transition: 0.7s ease-in-out;
        }

        .btn-gacor-ultimate:active {
          transform: scale(0.95);
        }

        /* Icon Lock di dalam tombol */
        .lock-icon-glow {
          font-size: 18px;
          filter: drop-shadow(0 0 5px #fff);
        }

        /* --- CSS ASLI LAINNYA (JANGAN DIUBAH) --- */
        .heroSection { display: flex; align-items: center; gap: 40px; width: 100%; }
        @media (max-width: 768px) { .heroSection { flex-direction: column-reverse; text-align: center; } }
        
        .gentle-badge { background: rgba(255,255,255,0.1); padding: 8px 16px; border-radius: 20px; color: #a78bfa; font-weight: 600; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; width: fit-content; margin-bottom: 20px; }
        @media (max-width: 768px) { .gentle-badge { margin: 0 auto 20px; } }

        .title-shimmer { background: linear-gradient(90deg, #fff, #c4b5fd, #fff); background-size: 200%; -webkit-background-clip: text; -webkit-text-fill-color: transparent; animation: shimmer 3s infinite linear; font-weight: 800; line-height: 1.1; }
        @keyframes shimmer { 0% { background-position: -200%; } 100% { background-position: 200%; } }
        
        .gentle-desc { color: #94a3b8; line-height: 1.6; }
        .gentle-title { font-weight: 800; line-height: 1.1; margin: 0 0 20px 0; background: linear-gradient(to right, #fff, #c4b5fd); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }

        .glass-stage { display: flex; perspective: 1000px; }
        .glass-panel { background: rgba(255,255,255,0.03); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.1); border-radius: 24px; overflow: hidden; position: relative; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); }
        .glass-img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.5s; }
        
        .chat-elegant { background: rgba(15, 23, 42, 0.95); border: 1px solid rgba(139, 92, 246, 0.3); color: white; padding: 16px 24px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); font-size: 14px; }
        .typing-cursor::after { content: '|'; animation: blink 1s infinite; color: #a78bfa; }
        @keyframes blink { 50% { opacity: 0; } }
        
        .animate-up { animation: fadeUp 0.8s ease-out forwards; opacity: 0; transform: translateY(20px); }
        @keyframes fadeUp { to { opacity: 1; transform: translateY(0); } }
        .delay-1 { animation-delay: 0.1s; }
        .delay-2 { animation-delay: 0.2s; }
        .delay-3 { animation-delay: 0.3s; }
        .delay-4 { animation-delay: 0.4s; }

        .star-twinkle { position: absolute; background: white; border-radius: 50%; opacity: 0; animation: twinkle ease-in-out infinite; box-shadow: 0 0 10px rgba(255,255,255,0.8); }
        @keyframes twinkle { 0%, 100% { opacity: 0; transform: scale(0.5); } 50% { opacity: 0.8; transform: scale(1); } }
        
        .meteor { position: absolute; top: 0; left: 50%; width: 300px; height: 1px; background: linear-gradient(90deg, #fff, transparent); opacity: 0; transform: rotate(-45deg); animation: meteor-fall 4s linear infinite; filter: drop-shadow(0 0 10px #fff); }
        .meteor::before { content: ''; position: absolute; width: 4px; height: 4px; background: #fff; border-radius: 50%; box-shadow: 0 0 15px 2px #fff; margin-top: -2px; }
        @keyframes meteor-fall { 0% { opacity: 0; transform: rotate(-45deg) translateX(0); } 10% { opacity: 1; } 20% { opacity: 0; transform: rotate(-45deg) translateX(-1000px); } 100% { opacity: 0; } }

        .enter-overlay { position: fixed; inset: 0; z-index: 9999; background: #020617; display: flex; align-items: center; justify-content: center; cursor: pointer; }
        .enter-text { color: white; font-size: 14px; letter-spacing: 4px; text-transform: uppercase; animation: pulse 2s infinite; }
        @keyframes pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
      `}</style>

      {/* --- 1. ENTER SCREEN --- */}
      {!hasEntered && (
        <div className="enter-overlay" onClick={handleEnter}>
          <div className="enter-text">[ CLICK TO ENTER ]</div>
        </div>
      )}

      {/* --- 2. MAIN CONTENT --- */}
      {hasEntered && (
        <div style={{
          position: "fixed", inset: 0, width: "100%", height: "100%", zIndex: 10,
          background: "radial-gradient(circle at 20% 20%, #1e1b4b 0%, #0f172a 40%, #020617 100%)", 
          display: "flex", alignItems: "center", justifyContent: "center", overflowY: "auto", paddingTop: "60px"
        }}>
          
          <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}>
            {stars.map((s, i) => (
              <div key={i} className="star-twinkle" style={{
                left: s.left, top: s.top, width: s.size, height: s.size,
                animationDelay: s.delay, animationDuration: s.duration
              }} />
            ))}
            <div className="meteor" style={{ top: "10%", right: "20%", animationDelay: "0s" }}></div>
            <div className="meteor" style={{ top: "30%", right: "10%", animationDelay: "2.5s" }}></div>
            <div className="meteor" style={{ top: "5%", right: "40%", animationDelay: "5s" }}></div>
          </div>

          <div style={{ width: "100%", maxWidth: "1200px", padding: "0 5%", position: "relative", zIndex: 20 }}>
            <div className="heroSection">
              <div style={{ flex: 1 }}>
                <div className="gentle-badge animate-up delay-1">✨ Invitation</div>
                <div className="animate-up delay-2">
                  <div className="gentle-title" style={{ fontSize: "clamp(36px, 5vw, 64px)", color: "rgba(255,255,255,0.6)", marginBottom: "0" }}>
                    Ready for
                  </div>
                  <div className="title-shimmer" style={{ fontSize: "clamp(42px, 6vw, 72px)" }}>
                    The Next Adventure?
                  </div>
                </div>
                <p className="gentle-desc animate-up delay-3" style={{ marginTop: "24px", fontSize: "18px", maxWidth: "540px" }}>
                  Aku udah plan satu hari yang hopefully bakal worth it buat kita berdua. Semua udah aku siapin dengan hopefully ga berlebihan wkwk.
                  <br/><br/>
                  Tapi sebelum aku spill semuanya, ada satu challenge kecil yang harus kamu selesain dulu. Consider it as the 'entry ticket' buat lihat full plan-nya.
                  <br/><br/>
                  Sounds good? Let's go then ✨
                </p>
                <div className="animate-up delay-4" style={{ marginTop: "50px" }}>
                  
                  {/* --- TOMBOL BARU GACOR --- */}
                  <button className="btn-gacor-ultimate" onClick={goNext}>
                    <span className="lock-icon-glow">🔓</span>
                    <span>AYO MULAI KEYY!!</span>
                  </button>

                </div>
              </div>

              <div className="glass-stage animate-up delay-2" style={{ position: "relative", transform: "translateX(-40px) translateY(20px)" }}>
                <div className="glass-panel" style={{ width: "340px", height: "460px" }}>
                  <img src={imgSrc} alt="My Special Person" className="glass-img" onError={handleImgError} />
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(124, 58, 237, 0.4), transparent 60%)', zIndex: 2, pointerEvents: 'none' }}></div>
                </div>
                <div className="chat-elegant" style={{ position: "absolute", margin: 0, left: "50%", top: "50%", transform: "translate(180px, -240px)", width: "max-content", maxWidth: "240px", zIndex: 50 }}>
                  {typed}<span className="typing-cursor" />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}