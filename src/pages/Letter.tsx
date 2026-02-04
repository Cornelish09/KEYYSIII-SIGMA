import React, { useRef, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { AppState, ContentConfig } from "../lib/types";
import { saveState } from "../lib/storage";
import { logEvent } from "../lib/activity";

export function Letter({
  cfg,
  state,
  setState
}: {
  cfg: ContentConfig;
  state: AppState;
  setState: (s: AppState) => void;
}) {
  const navigate = useNavigate();
  // Kita gak butuh audioRef lokal, kita tembak audio pusat
  const containerRef = useRef<HTMLDivElement>(null);
  const textContainerRef = useRef<HTMLDivElement>(null);
  
  // --- TEKS SURAT (PERSIS KODE LO) ---
  const fullText = cfg.letter?.text || `Jadi... gimana ya mulainya(?). There's something about u that just stays with me. Bukan dalam cara yang aneh, lebih ke arah ur different, dan somehow that difference matters more than i expected. U have this presence that feels both calming. Being around u makes everything feel lighter, but at the same time, u make me want to be better, try harder, step into spaces i usually avoid.

I don't think u realize the weight u carry in people's lives. The way u make everyone feel seen without even trying. Cara kamu dengerin dengan tulus, bukan cuma menunggu giliran bicara. Or just how ur existence alone somehow makes difficult moments more bearable.

So here's the thing. If u're free one night, i'd really love to spend some time with u keyy.. Maybe we could head to tunjungan plaza, dinner, walk around, see where the night takes us. Nothing complicated, just... us, good energy, and whatever feels right in the moment. I'm not trying to impress u or prove anything here. I just think u deserve to feel appreciated, dan aku pengen jadi orang yang nunjukin itu. No expectations, no pressure.. just genuine intention to make u feel as special as u actually are.

Semua ini? Ini cuma caraku untuk bilang aku melihat kamu, aku menghargai kamu, dan aku pengen kamu tau itu. So kalau kamu mau, let me know. And if u need time to think about it, that's completely okay too.

Take ur time with this. And whenever u're ready, I'll be here ready to show u what happens when someone actually pays attention to who you are, not just what they see.

Thank u so much keyy.. happy healthy for uu ♡`;
  
  const [displayedText, setDisplayedText] = useState("");
  const [isTypingComplete, setIsTypingComplete] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);

  // State Mouse Position
  const [mousePos, setMousePos] = useState({ x: '50%', y: '50%' });

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    setMousePos({ x: `${e.clientX}px`, y: `${e.clientY}px` });
  };

  // --- 1. TYPEWRITER EFFECT (PERSIS KODE LO) ---
  useEffect(() => {
    if (showOverlay) return;

    const startDelay = setTimeout(() => {
      let index = 0;
      const typingSpeed = 75; 

      const intervalId = setInterval(() => {
        setDisplayedText((prev) => fullText.slice(0, index + 1));
        index++;

        if (textContainerRef.current) {
           textContainerRef.current.scrollTo({
             top: textContainerRef.current.scrollHeight,
             behavior: 'smooth'
           });
        }

        if (index >= fullText.length) {
          clearInterval(intervalId);
          setIsTypingComplete(true);
        }
      }, typingSpeed);

      return () => clearInterval(intervalId);
    }, 2000); 

    return () => clearTimeout(startDelay);
  }, [fullText, showOverlay]);

  // --- 2. START EXPERIENCE (LOGIC GANTI LAGU DISINI) ---
  const startCinematic = () => {
    setShowOverlay(false);
    
    // AMBIL PLAYER GLOBAL (Layout.tsx)
    const globalAudio = document.getElementById("bg-music") as HTMLAudioElement;
    
    if (globalAudio) {
      // 1. GANTI SRC KE LAGU LETTER ('song.mp3')
      // Ini otomatis stop lagu Intro (lany.mp3) dan siapin lagu baru
      globalAudio.src = "/audio/song.mp3"; 
      
      // 2. SETTING: GAK BOLEH LOOPING
      globalAudio.loop = false;
      
      // 3. PLAY
      globalAudio.volume = 0.6;
      globalAudio.play()
        .then(() => setIsPlaying(true))
        .catch(e => console.log("Audio block:", e));
    }
  };

  // --- 3. NAVIGASI ---
  const goNext = () => {
    // Lagu song.mp3 JANGAN dimatikan, biar lanjut ke Places
    const next: AppState = { ...state, step: 3 }; 
    saveState(next);
    setState(next);
    logEvent("letter_read_finish");
    navigate("/places");
  };

  const toggleAudio = () => {
    const globalAudio = document.getElementById("bg-music") as HTMLAudioElement;
    if (!globalAudio) return;

    if (isPlaying) {
      globalAudio.pause();
    } else {
      globalAudio.play();
    }
    setIsPlaying(!isPlaying);
  };

  return (
    <div 
      ref={containerRef}
      onMouseMove={handleMouseMove}
      style={{
        position: 'fixed', inset: 0,
        background: 'radial-gradient(circle at center, #4c1d95 0%, #1e1b4b 50%, #020617 100%)',
        color: '#e5e5e5',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden',
        fontFamily: "'Playfair Display', serif"
    }}>

      {/* LAYER 1: INTERACTIVE LIGHT */}
      <div className="interactive-light" style={{
        '--x': mousePos.x,
        '--y': mousePos.y,
      } as React.CSSProperties} />

      {/* LAYER 2: NOISE TEXTURE */}
      <div className="noise-overlay" />

      {/* STYLE DESIGN 100% ORIGINAL */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=Inter:wght@300;400;700&display=swap');

        /* ANIMASI MASUK DRAMATIS (Blur to Focus) */
        @keyframes cinematicIn {
          0% { opacity: 0; filter: blur(20px); transform: scale(1.05); }
          100% { opacity: 1; filter: blur(0px); transform: scale(1); }
        }

        .interactive-light {
          position: fixed; inset: 0; z-index: 0;
          pointer-events: none;
          background: radial-gradient(
            circle 600px at var(--x) var(--y),
            rgba(139, 92, 246, 0.15),
            transparent 50%
          );
          mix-blend-mode: overlay;
          transition: background 0.2s ease;
        }

        .noise-overlay {
            position: fixed; inset: 0; z-index: 1;
            pointer-events: none; opacity: 0.07;
            background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
        }

        .cursor-blink {
          display: inline-block; width: 2px; height: 1.1em;
          background: rgba(255,255,255,0.8); margin-left: 4px; vertical-align: baseline;
          animation: blink 1s infinite;
        }
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

        /* SCROLL CONTAINER */
        .scroll-container {
          width: 85%; max-width: 700px;
          height: 60vh; 
          overflow-y: auto; 
          position: relative; z-index: 10;
          padding-right: 10px; 
          
          /* MASKING ATAS BAWAH HALUS */
          mask-image: linear-gradient(to bottom, transparent, black 15%, black 85%, transparent);
          -webkit-mask-image: linear-gradient(to bottom, transparent, black 15%, black 85%, transparent);
          
          scrollbar-width: none; 
          -ms-overflow-style: none;
          
          /* ANIMASI MASUK DRAMATIS DI CONTAINER */
          opacity: 0; /* Default invisible */
          animation: cinematicIn 4s ease-out forwards; /* 4 Detik durasi masuk */
          animation-delay: 0.5s; /* Delay dikit biar smooth pas overlay ilang */
        }
        .scroll-container::-webkit-scrollbar { display: none; }

        .text-content {
          text-align: left;
          line-height: 2.2; /* Spasi baris makin lega */
          font-size: clamp(18px, 3vw, 22px); 
          font-weight: 400;
          letter-spacing: 0.5px;
          text-shadow: 0 4px 20px rgba(0,0,0,0.5);
          white-space: pre-wrap;
          padding: 60px 0; /* Padding lebih gede biar teks bener2 di tengah pas mulai */
        }

        /* TOMBOL NEXT */
        .btn-next-minimal {
          position: fixed; bottom: 40px; right: 40px; z-index: 20;
          background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
          border-radius: 30px;
          color: rgba(255,255,255,0.8); font-family: 'Inter', sans-serif;
          font-size: 12px; letter-spacing: 2px; text-transform: uppercase; font-weight: 700;
          cursor: pointer; transition: all 0.5s ease;
          opacity: 0; transform: translateY(20px);
          animation: fadeUp 2s forwards 0.5s;
          display: flex; align-items: center; gap: 10px;
          padding: 12px 24px;
          backdrop-filter: blur(5px);
        }
        .btn-next-minimal:hover { 
          background: rgba(255,255,255,0.15); color: #fff; transform: translateY(0) scale(1.05);
          box-shadow: 0 0 20px rgba(139, 92, 246, 0.4);
        }
        @keyframes fadeUp { to { opacity: 1; transform: translateY(0); } }

        /* START OVERLAY TRANSITION */
        .start-overlay {
          position: fixed; inset: 0; z-index: 9999;
          background: rgba(2, 6, 23, 1); /* Hitam pekat */
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          width: 100vw; height: 100vh; cursor: pointer;
          transition: opacity 2s ease-in-out, visibility 2s; /* Fade out super slow (2s) */
        }
        .start-overlay.hidden {
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
        }

        .tap-text {
          font-family: 'Inter', sans-serif; font-size: 14px; letter-spacing: 6px; font-weight: 600;
          color: rgba(255,255,255,0.9); text-transform: uppercase; animation: pulse 2.5s infinite;
          text-align: center; width: 100%;
        }
        @keyframes pulse { 0%, 100% { opacity: 0.4; transform: scale(0.95); } 50% { opacity: 1; transform: scale(1); } }

        /* AUDIO PLAYER */
        .audio-control {
          position: fixed; bottom: 40px; left: 40px; z-index: 20;
          display: flex; align-items: center; gap: 15px; opacity: 0.4; transition: opacity 0.3s;
        }
        .audio-control:hover { opacity: 1; }
        .bar-anim { display: flex; gap: 4px; height: 16px; align-items: flex-end; }
        .bar { width: 3px; background: white; animation: equalizer 1s infinite; border-radius: 2px; }
        .bar:nth-child(2) { animation-delay: 0.15s; }
        .bar:nth-child(3) { animation-delay: 0.3s; }
        @keyframes equalizer { 0%, 100% { height: 4px; opacity: 0.5; } 50% { height: 16px; opacity: 1; } }
      `}</style>

      {/* AUDIO LOKAL DIHAPUS. 
         Sekarang kita ganti lagu via JavaScript (startCinematic) 
         ke elemen <audio id="bg-music"> di Layout.tsx 
      */}

      {/* OVERLAY TAP TO START */}
      <div 
        className={`start-overlay ${!showOverlay ? 'hidden' : ''}`} 
        onClick={startCinematic}
      >
        <div className="tap-text">[ TAP TO OPEN LETTER ]</div>
        <div style={{ marginTop: '10px', fontSize: '10px', color: '#64748b', fontFamily: 'Inter', letterSpacing: '1px' }}>
          (Audio Experience)
        </div>
      </div>

      {/* CONTENT UTAMA */}
      
      {/* Header Kecil */}
      <div style={{ 
        position: 'absolute', top: '50px', left: '50%', transform: 'translateX(-50%)',
        fontFamily: 'Inter, sans-serif', fontSize: '11px', letterSpacing: '4px', fontWeight: 600,
        color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', zIndex: 10,
        opacity: showOverlay ? 0 : 1, transition: 'opacity 3s ease 2s' 
      }}>
        A Message For You
      </div>

      {/* AREA SCROLL KHUSUS */}
      <div className="scroll-container" ref={textContainerRef}>
        <div className="text-content">
          <span>{displayedText}</span>
          {!isTypingComplete && <span className="cursor-blink"></span>}
        </div>
      </div>

      {isTypingComplete && (
        <button className="btn-next-minimal" onClick={goNext}>
          Lanjut Pilih Tempat <span>→</span>
        </button>
      )}

      <div className="audio-control" onClick={toggleAudio} style={{ cursor: 'pointer', opacity: showOverlay ? 0 : 0.4, transition: 'opacity 1s' }}>
        {isPlaying ? (
          <div className="bar-anim">
            <div className="bar"></div><div className="bar"></div><div className="bar"></div>
          </div>
        ) : (
          <span style={{ fontSize: '11px', fontFamily: 'Inter', letterSpacing: '2px' }}>MUTED</span>
        )}
      </div>

    </div>
  );
}