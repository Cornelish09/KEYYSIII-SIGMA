import React from "react";
import type { AppState, ContentConfig } from "../lib/types";
import { saveState } from "../lib/storage";
import { logEvent } from "../lib/activity";
import { shuffle } from "../lib/utils";
import { useNavigate } from "react-router-dom";

// --- TYPE DEFINITIONS ---
type Tile = {
  id: string;
  value: string;
  revealed: boolean;
  matched: boolean;
};

const EMOJIS = ["🍓", "🐱", "🌸", "🍦", "🌙", "🧸", "🍯", "🎧"];

// --- HELPER AUDIO (CUMA NAMBAH INI DOANG) ---
const playSfx = (filename: string) => {
  try {
    const audio = new Audio(`/${filename}.mp3`);
    audio.volume = 0.5; 
    audio.play().catch((e) => console.log("SFX error:", e));
  } catch (e) {
    console.log("Audio logic error", e);
  }
};

// --- BUILDER ---
function buildTiles(): Tile[] {
  const values = [...EMOJIS, ...EMOJIS];
  const shuffled = shuffle(values);
  return shuffled.map((v, idx) => ({
    id: `tile-${idx}-${Math.random().toString(36).substr(2, 9)}`, 
    value: v,
    revealed: false,
    matched: false
  }));
}

export function GameUnlock({
  cfg,
  state,
  setState
}: {
  cfg: ContentConfig;
  state: AppState;
  setState: (s: AppState) => void;
}) {
  const navigate = useNavigate();
  const [tiles, setTiles] = React.useState<Tile[]>(() => buildTiles());
  const [busy, setBusy] = React.useState(false);
  const [moves, setMoves] = React.useState(0);
  const [kuromiChat, setKuromiChat] = React.useState("Wah, kita di luar angkasa! 🌌 Ayo main!");
  
  // State untuk Pop-up Victory
  const [showVictory, setShowVictory] = React.useState(false);
  
  const allMatched = tiles.every((t) => t.matched);
  const matchedCount = tiles.filter(t => t.matched).length / 2;

  // --- LOGIC MENANG ---
  React.useEffect(() => {
    if (!allMatched) return;
    
    // Play sound WIN
    playSfx("win");

    setKuromiChat("MISSION ACCOMPLISHED! 🎉");
    logEvent("game_complete", { moves });

    const timer = setTimeout(() => {
      setShowVictory(true);
    }, 800); 

    return () => clearTimeout(timer);
  }, [allMatched, moves]);

  // --- NAVIGASI KE SURAT ---
  const handleNextLevel = () => {
    const next: AppState = { ...state, unlocked: true, step: 2 };
    saveState(next);
    setState(next);
    navigate("/letter");
  };

  // --- LOGIC KLIK ---
  const onTile = async (idx: number) => {
    if (busy) return;
    if (tiles[idx].revealed || tiles[idx].matched) return;

    // Play sound FLIP
    playSfx("flip");

    setTiles((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], revealed: true };
      return copy;
    });

    const currentTiles = tiles.map((t, i) => ({ ...t, idx }));
    currentTiles[idx].revealed = true;
    const revealedList = currentTiles.filter(t => t.revealed && !t.matched);

    if (revealedList.length === 2) {
      setBusy(true);
      setMoves((m) => m + 1);
      const [cardA, cardB] = revealedList;
      
      await new Promise((r) => setTimeout(r, 600));

      if (cardA.value === cardB.value) {
        // Play sound MATCH
        playSfx("match");
        
        setTiles(prev => prev.map(t => (t.value === cardA.value) ? { ...t, matched: true } : t));
        setKuromiChat("KERJA BAGUS!! PROUD OF U KEYYY✨");
      } else {
        setTiles(prev => prev.map(t => (t.id === cardA.id || t.id === cardB.id) ? { ...t, revealed: false } : t));
        setKuromiChat("YAH SALAH.. AYO CARI LAGI KEYY!!🛸");
      }
      setBusy(false);
    }
  };

  const restart = () => {
    setTiles(buildTiles());
    setMoves(0);
    setKuromiChat("PUZZLE SUDAH DI RESET🎲");
    setShowVictory(false);
  };

  // --- SPACE STARS GENERATOR ---
  const generateSpace = (count: number) => {
    let shadow = "";
    for (let i = 0; i < count; i++) {
      shadow += `${Math.random() * 2000}px ${Math.random() * 2000}px #FFF, `;
    }
    return shadow.slice(0, -2);
  };
  
  const starsSmall = React.useMemo(() => generateSpace(700), []);
  const starsMedium = React.useMemo(() => generateSpace(200), []);
  const starsBig = React.useMemo(() => generateSpace(100), []);

  return (
    <div className="game-container" style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden', background: '#020617'
    }}>

      <style>{`
        /* --- SPACE ANIMATION --- */
        @keyframes nebulaShift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .nebula-bg {
          position: absolute; inset: 0; z-index: -4;
          background: linear-gradient(to right, #0f0c29, #302b63, #24243e);
          background-size: 400% 400%;
          opacity: 0.8;
          animation: nebulaShift 60s ease infinite;
        }
        @keyframes flyBy {
          from { transform: translateY(0px); }
          to { transform: translateY(-2000px); }
        }
        .stars-1 { position: absolute; inset:0; z-index: -3; width: 1px; height: 1px; box-shadow: ${starsSmall}; animation: flyBy 150s linear infinite; }
        .stars-2 { position: absolute; inset:0; z-index: -2; width: 2px; height: 2px; box-shadow: ${starsMedium}; animation: flyBy 100s linear infinite; }
        .stars-3 { position: absolute; inset:0; z-index: -1; width: 3px; height: 3px; box-shadow: ${starsBig}; animation: flyBy 50s linear infinite; }

        /* --- CARD STYLE (ABSOLUTE CENTER) --- */
        .card-wrap { position: relative; width: 75px; height: 75px; cursor: pointer; perspective: 800px; }
        @media (min-width: 768px) { .card-wrap { width: 90px; height: 90px; } }

        .card-inner {
          position: absolute; width: 100%; height: 100%;
          transition: transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
          transform-style: preserve-3d; border-radius: 16px;
        }
        .card-wrap.flipped .card-inner { transform: rotateY(180deg); }
        .card-wrap:hover .card-inner { box-shadow: 0 0 25px rgba(139, 92, 246, 0.8); transform: scale(1.05); }
        .card-wrap.flipped:hover .card-inner { transform: rotateY(180deg) scale(1.05); }

        .card-face {
          position: absolute; inset: 0; backface-visibility: hidden; border-radius: 16px;
          
          /* FIX CENTERING MURNI */
          display: flex !important; 
          align-items: center !important; 
          justify-content: center !important;
          
          padding: 0; margin: 0;
          border: 1px solid rgba(255,255,255,0.1);
        }
        
        .card-face span { 
           display: block; 
           font-size: 40px; 
           line-height: 0; /* INI KUNCINYA: Mencegah offset vertikal */
           padding: 0;
           margin: 0;
           transform: none; /* Hapus semua pergeseran manual */
        }

        .card-back { background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(10px); }
        .card-front { background: rgba(255, 255, 255, 0.9); transform: rotateY(180deg); box-shadow: inset 0 0 20px rgba(139, 92, 246, 0.5); }
        
        .card-wrap.matched .card-inner { animation: pulseSuccess 1s infinite; box-shadow: 0 0 30px #34d399; }
        @keyframes pulseSuccess { 0% { transform: rotateY(180deg) scale(1); } 50% { transform: rotateY(180deg) scale(1.1); } 100% { transform: rotateY(180deg) scale(1); } }

        @keyframes floatKuromi { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-15px); } }

        /* --- VICTORY MODAL STYLE --- */
        .victory-overlay {
          position: fixed; inset: 0; z-index: 10000;
          background: rgba(0,0,0,0.85); backdrop-filter: blur(12px);
          display: flex; align-items: center; justify-content: center;
          animation: fadeIn 0.4s ease;
          padding: 20px;
        }
        .victory-card-new {
          display: flex;
          flex-direction: row;
          align-items: center;
          background: rgba(15, 23, 42, 0.9);
          border: 1px solid rgba(139, 92, 246, 0.3);
          box-shadow: 0 0 60px rgba(124, 58, 237, 0.4);
          border-radius: 30px;
          padding: 40px;
          max-width: 700px;
          width: 100%;
          position: relative;
          overflow: hidden;
          animation: slideUp 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .victory-card-new::before {
          content: ''; position: absolute; top: -50%; left: -50%; width: 200%; height: 200%;
          background: radial-gradient(circle, rgba(139, 92, 246, 0.15) 0%, transparent 70%);
          pointer-events: none;
        }
        .victory-visual { flex: 0 0 220px; display: flex; justify-content: center; align-items: center; position: relative; }
        .victory-kuromi-img { width: 200px; height: auto; filter: drop-shadow(0 10px 30px rgba(167, 139, 250, 0.6)); animation: floatKuromi 4s ease-in-out infinite; z-index: 2; }
        .victory-glow-circle { position: absolute; width: 160px; height: 160px; background: radial-gradient(circle, rgba(139, 92, 246, 0.6), transparent 70%); border-radius: 50%; z-index: 1; animation: pulseGlow 3s infinite; }
        .victory-content { flex: 1; padding-left: 30px; text-align: left; z-index: 2; }
        .victory-title { font-size: 36px; font-weight: 900; margin: 0 0 10px 0; background: linear-gradient(90deg, #fff, #c4b5fd); -webkit-background-clip: text; -webkit-text-fill-color: transparent; letter-spacing: -1px; }
        .victory-desc { color: #cbd5e1; font-size: 16px; margin-bottom: 25px; line-height: 1.6; }
        .victory-stats-row { display: flex; gap: 15px; margin-bottom: 30px; }
        .stat-badge { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); padding: 8px 16px; border-radius: 12px; color: #94a3b8; font-size: 14px; }
        .stat-badge strong { color: white; display: block; font-size: 18px; margin-top: 4px; }
        .victory-btn-primary { background: linear-gradient(135deg, #7c3aed, #4f46e5); color: white; border: none; padding: 16px 40px; border-radius: 16px; font-size: 18px; font-weight: 700; cursor: pointer; width: 100%; box-shadow: 0 10px 25px rgba(124, 58, 237, 0.4); transition: all 0.3s ease; display: flex; align-items: center; justify-content: center; gap: 10px; }
        .victory-btn-primary:hover { transform: translateY(-4px); box-shadow: 0 20px 40px rgba(124, 58, 237, 0.6); background: linear-gradient(135deg, #8b5cf6, #6366f1); }
        @keyframes slideUp { from { transform: translateY(50px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes pulseGlow { 0%, 100% { opacity: 0.5; transform: scale(1); } 50% { opacity: 0.8; transform: scale(1.1); } }
        @media (max-width: 768px) {
          .victory-card-new { flex-direction: column; text-align: center; padding: 30px 20px; }
          .victory-visual { margin-bottom: 20px; }
          .victory-content { padding-left: 0; text-align: center; }
          .victory-stats-row { justify-content: center; }
          .victory-title { font-size: 28px; }
        }
      `}</style>

      <div className="nebula-bg" />
      <div className="stars-1" />
      <div className="stars-2" />
      <div className="stars-3" />

      <div style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
        
        <div style={{ textAlign: 'center', marginBottom: '25px' }}>
          <h1 style={{ fontSize: 'clamp(28px, 5vw, 42px)', fontWeight: 900, margin: 0, background: 'linear-gradient(to right, #fff, #a78bfa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', filter: 'drop-shadow(0 0 20px rgba(139,92,246,0.8))', letterSpacing: '2px' }}>WELCOME TO KEYYSI PUZZLE</h1>
          <div style={{ display: 'flex', gap: '15px', justifyContent: 'center', marginTop: '10px' }}>
             <div style={{ background:'rgba(255,255,255,0.1)', padding:'5px 15px', borderRadius:'20px', color:'white', border:'1px solid rgba(255,255,255,0.2)', backdropFilter:'blur(5px)' }}>Moves: <strong>{moves}</strong></div>
             <div style={{ background:'rgba(52, 211, 153, 0.2)', padding:'5px 15px', borderRadius:'20px', color:'#34d399', border:'1px solid rgba(52, 211, 153, 0.4)', backdropFilter:'blur(5px)' }}>Pairs: <strong>{matchedCount}/8</strong></div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '40px', flexWrap: 'wrap', width: '100%', maxWidth: '1000px' }}>
          
          <div style={{ background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(20px)', padding: '25px', borderRadius: '24px', border: '1px solid rgba(255, 255, 255, 0.1)', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
              {tiles.map((t, i) => (
                <div key={t.id} className={`card-wrap ${t.revealed || t.matched ? 'flipped' : ''} ${t.matched ? 'matched' : ''}`} onClick={() => onTile(i)}>
                  <div className="card-inner">
                    <div className="card-face card-front">
                      <span>{t.value}</span>
                    </div>
                    <div className="card-face card-back"></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', animation: 'floatKuromi 4s ease-in-out infinite' }}>
            <div style={{ background: 'linear-gradient(135deg, #fff, #e0e7ff)', color: '#1e1b4b', padding: '12px 20px', borderRadius: '16px', fontWeight: 'bold', fontSize: '14px', marginBottom: '15px', position: 'relative', boxShadow: '0 5px 25px rgba(139, 92, 246, 0.4)', border: '2px solid rgba(255,255,255,0.5)' }}>
              {kuromiChat}
              <div style={{ position:'absolute', bottom:'-10px', left:'50%', marginLeft:'-6px', width:0, height:0, borderLeft:'8px solid transparent', borderRight:'8px solid transparent', borderTop:'10px solid #fff' }}/>
            </div>
            <img src="/kuromi.png" alt="Kuromi" style={{ width: '160px', filter: 'drop-shadow(0 10px 30px rgba(139, 92, 246, 0.6))' }} onError={(e) => { e.currentTarget.src = "https://i.pinimg.com/originals/1d/1d/9b/1d1d9b3d0c9f1d0f5e3b5e4f4d4d5e2e.png"; }} />
            <button onClick={restart} className="btn small" style={{ marginTop: '20px', background: 'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.2)', color:'white', backdropFilter:'blur(5px)' }}>↺ Restart Mission</button>
          </div>

        </div>
      </div>

      {showVictory && (
        <div className="victory-overlay">
          <div className="victory-card-new">
            <div className="victory-visual">
              <div className="victory-glow-circle"></div>
              <img src="/kuromi.png" alt="Kuromi Win" className="victory-kuromi-img" onError={(e) => { e.currentTarget.src = "https://i.pinimg.com/originals/1d/1d/9b/1d1d9b3d0c9f1d0f5e3b5e4f4d4d5e2e.png"; }} />
            </div>
            <div className="victory-content">
              <div style={{ color: '#a78bfa', fontWeight: 'bold', fontSize: '14px', marginBottom: '5px', letterSpacing: '1px' }}>LEVEL COMPLETE</div>
              <h2 className="victory-title">MISSION ACCOMPLISHED!</h2>
              <p className="victory-desc">
                KAMU SANGAT KEREN KEYYY!! PROUD OF U ♡ <br/>
                Sekarang kamu bisa lanjut ke inti game ini keyy..
              </p>
              <div className="victory-stats-row">
                <div className="stat-badge">Moves <strong>{moves}</strong></div>
                <div className="stat-badge">Pairs <strong>8/8</strong></div>
                <div className="stat-badge">Rating <strong>⭐⭐⭐⭐⭐</strong></div>
              </div>
              <button className="victory-btn-primary" onClick={handleNextLevel}><span>Buka Surat 📩</span></button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}