import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { AppState, ContentConfig, Outfit } from "../lib/types";
import { saveState } from "../lib/storage";
import { logEvent } from "../lib/activity";

// Helper: Pisahin Deskripsi jadi [Cewek | Cowok]
const parseOutfitDesc = (desc?: string) => {
  if (!desc) return { her: "Surprise Outfit", him: "Matching Outfit" };
  if (desc.includes("|")) {
    const [her, him] = desc.split("|").map(s => s.trim());
    return { her, him };
  }
  return { her: desc, him: "Matching Vibe" };
};

export function Outfits({ cfg, state, setState }: { cfg: ContentConfig; state: AppState; setState: (s: AppState) => void; }) {
  const navigate = useNavigate();
  const items = cfg.outfits?.items || [];
  const [selectedId, setSelectedId] = useState<string | null>(state.chosenOutfitId || null);

  useEffect(() => {
    if (state.chosenOutfitId) setSelectedId(state.chosenOutfitId);
  }, [state.chosenOutfitId]);

  const pick = (o: Outfit) => {
    setSelectedId(o.id);
    const next: AppState = { ...state, chosenOutfitId: o.id };
    saveState(next);
    setState(next);
    logEvent("outfit_choose", { id: o.id, name: o.name });
  };

  const goFinish = () => {
    if (!selectedId) return;
    const next: AppState = { ...state, step: 5 }; 
    saveState(next);
    setState(next);
    logEvent("flow_finish_outfit");
    navigate("/final"); 
  };

  return (
    <div className="main-container">
      <div className="nebula-bg" />
      <div className="noise-overlay" />

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,800;1,400&family=Inter:wght@300;400;500;600&display=swap');

        /* UTILS */
        ::-webkit-scrollbar { display: none; }
        * { -ms-overflow-style: none; scrollbar-width: none; box-sizing: border-box; }

        /* CONTAINER */
        .main-container {
          position: fixed; inset: 0; background: #050505; 
          overflow-y: auto; overflow-x: hidden; font-family: 'Inter', sans-serif;
          color: #e5e5e5;
          padding-bottom: 100px; /* Space buat footer */
        }

        /* BACKGROUND */
        .nebula-bg { position: fixed; inset: 0; z-index: -2; background: radial-gradient(circle at top center, #1e1b4b 0%, #0f172a 40%, #000000 90%); background-size: 100% 100%; }
        .noise-overlay { position: fixed; inset: 0; z-index: -1; pointer-events: none; opacity: 0.07; background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E"); }

        /* --- HEADER SECTION --- */
        .header-section {
          padding-top: 100px; 
          padding-bottom: 40px;
          padding-left: 20px;
          padding-right: 20px;
          text-align: center;
          position: relative;
          z-index: 10;
        }
        .header-title { 
          font-family: 'Playfair Display', serif; font-size: 36px; font-weight: 700; font-style: italic;
          margin-bottom: 8px; text-align: center; letter-spacing: 0.5px;
          color: white;
        }
        .header-subtitle { text-align: center; color: #888; font-size: 14px; max-width: 450px; margin: 0 auto; letter-spacing: 0.5px; line-height: 1.5; }

        /* CONTENT */
        .page-content { 
          max-width: 1100px; margin: 0 auto; 
          padding: 0 20px 40px 20px; 
          position: relative; z-index: 10; 
        }

        /* GRID SYSTEM */
        .outfit-grid { 
          display: grid; 
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); 
          gap: 40px; 
          animation: fadeUp 0.8s cubic-bezier(0.2, 0.8, 0.2, 1); 
        }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(40px); } to { opacity: 1; transform: translateY(0); } }

        /* --- LUXURY CARD STYLE --- */
        .outfit-card {
          position: relative;
          background: transparent; 
          cursor: pointer; transition: transform 0.4s ease;
        }
        .outfit-card:hover { transform: translateY(-10px); }
        
        /* Image Container */
        .card-visual {
          position: relative;
          border-radius: 4px; 
          overflow: hidden;
          box-shadow: 0 10px 30px -10px rgba(0,0,0,0.5);
          transition: all 0.4s ease;
          border: 1px solid rgba(255,255,255,0.1);
        }
        
        /* Selected State */
        .outfit-card.selected .card-visual {
          border-color: #c4b5fd;
          box-shadow: 0 0 0 1px #c4b5fd, 0 20px 50px -10px rgba(124, 58, 237, 0.3);
        }

        .img-wrap { 
          aspect-ratio: 3/4; width: 100%; position: relative; 
          background: #111;
        }
        .outfit-img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.8s ease; opacity: 0.9; }
        .outfit-card:hover .outfit-img { transform: scale(1.08); opacity: 1; }
        
        .img-placeholder { width: 100%; height: 100%; background: linear-gradient(to bottom, #1e1b4b, #000); display: flex; align-items: center; justify-content: center; font-size: 50px; color: #333; }

        /* Floating Palette */
        .palette-float {
          position: absolute; bottom: 15px; left: 15px;
          display: flex; gap: -5px; 
          background: rgba(0,0,0,0.4); backdrop-filter: blur(8px);
          padding: 6px 10px; border-radius: 30px;
          border: 1px solid rgba(255,255,255,0.1);
        }
        .palette-dot { 
          width: 20px; height: 20px; border-radius: 50%; 
          border: 1px solid rgba(255,255,255,0.3); 
          margin-right: -6px; 
          box-shadow: 0 2px 5px rgba(0,0,0,0.5);
        }
        .palette-dot:last-child { margin-right: 0; }

        /* Card Content */
        .card-details { padding: 20px 5px 0 5px; text-align: center; display: flex; flex-direction: column; height: 100%; }
        
        .outfit-vibe { 
          font-family: 'Inter', sans-serif; font-size: 10px; text-transform: uppercase; 
          letter-spacing: 3px; color: #94a3b8; margin-bottom: 8px; font-weight: 600;
        }
        .outfit-title { 
          font-family: 'Playfair Display', serif; font-size: 26px; font-weight: 500; 
          color: white; margin-bottom: 20px; letter-spacing: -0.5px;
        }

        /* Couple Grid Info */
        .couple-info {
          display: flex; border-top: 1px solid rgba(255,255,255,0.1);
          padding-top: 15px; text-align: left;
        }
        .info-col { flex: 1; display: flex; flex-direction: column; gap: 4px; padding: 0 10px; }
        .info-col:first-child { border-right: 1px solid rgba(255,255,255,0.1); }
        
        .label { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #64748b; font-weight: 700; margin-bottom: 2px; }
        .value { font-family: 'Playfair Display', serif; font-size: 14px; color: #e2e8f0; font-style: italic; line-height: 1.4; }

        /* --- TOMBOL STATUS YANG LEBIH JELAS --- */
        .select-status-btn {
          margin-top: 20px;
          width: 100%;
          padding: 14px 10px;
          border-radius: 6px;
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 1.5px;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
          display: flex; align-items: center; justify-content: center; gap: 8px;
        }
        
        /* State 1: Belum Dipilih (Background Putih Tipis - Biar Kelihatan Tombol) */
        .select-status-btn.normal {
          background: rgba(255, 255, 255, 0.08); /* Background Glassy */
          border: 1px solid rgba(255,255,255,0.2);
          color: #e2e8f0;
        }
        .outfit-card:hover .select-status-btn.normal {
          background: rgba(255, 255, 255, 0.15); /* Lebih terang pas hover */
          border-color: rgba(255,255,255,0.6);
          color: #fff;
        }

        /* State 2: Terpilih */
        .select-status-btn.active {
          background: #7c3aed; 
          border: 1px solid #7c3aed;
          color: #fff;
          box-shadow: 0 4px 20px rgba(124, 58, 237, 0.4);
        }

        /* FOOTER */
        .summary-bar { 
          position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%); 
          background: rgba(10, 10, 10, 0.9); backdrop-filter: blur(20px); 
          border: 1px solid rgba(255,255,255,0.1); 
          padding: 12px 30px; border-radius: 50px; 
          display: flex; align-items: center; justify-content: space-between; 
          width: 90%; max-width: 450px; box-shadow: 0 20px 50px rgba(0,0,0,0.8); z-index: 50; 
        }
        .status-text { font-family: 'Inter', sans-serif; color: #888; font-size: 12px; font-weight: 500; letter-spacing: 0.5px; }
        .btn-finish { 
          background: #e2e8f0; color: #000; border: none; 
          padding: 12px 30px; border-radius: 30px; 
          font-family: 'Inter', sans-serif; font-weight: 600; font-size: 12px; letter-spacing: 1px;
          cursor: pointer; opacity: 0.3; pointer-events: none; transition: 0.3s; 
          text-transform: uppercase;
        }
        .btn-finish.ready { opacity: 1; pointer-events: auto; box-shadow: 0 0 20px rgba(255,255,255,0.2); }
        .btn-finish.ready:hover { background: #fff; transform: scale(1.05); }

      `}</style>

      {/* HEADER SECTION */}
      <div className="header-section">
        <div className="header-title">Keyysi Outfit Colour Match</div>
        <div className="header-subtitle">Pilih kombinasi outfit yang paling cocok untuk cerita kita.</div>
      </div>

      {/* CONTENT */}
      <div className="page-content">
        <div className="outfit-grid">
          {items.length === 0 ? (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '80px', color: '#444', fontFamily: 'Playfair Display', fontStyle: 'italic', fontSize: 20 }}>
              "Fashion is art and you are the canvas."<br/>
              <span style={{fontSize:'12px', fontFamily:'Inter', fontStyle:'normal', marginTop:10, display:'block', color:'#333'}}>Belum ada data di Admin Panel.</span>
            </div>
          ) : (
            items.map((o) => {
              const isSelected = selectedId === o.id;
              const { her, him } = parseOutfitDesc(o.description);

              return (
                <div 
                  key={o.id} 
                  className={`outfit-card ${isSelected ? 'selected' : ''}`}
                  onClick={() => pick(o)}
                >
                  <div className="card-visual">
                    <div className="img-wrap">
                      {o.image ? (
                        <img src={o.image} alt={o.name} className="outfit-img" />
                      ) : (
                        <div className="img-placeholder">✨</div>
                      )}
                      
                      {/* FLOATING PALETTE */}
                      {o.palette && o.palette.length > 0 && (
                        <div className="palette-float">
                          {o.palette.map((color, idx) => (
                            <div key={idx} className="palette-dot" style={{ background: color }} />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="card-details">
                    <div className="outfit-vibe">{o.style || "Concept"}</div>
                    <div className="outfit-title">{o.name}</div>
                    
                    <div className="couple-info">
                      <div className="info-col">
                        <span className="label">Warna 1</span>
                        <span className="value">{her}</span>
                      </div>
                      <div className="info-col">
                        <span className="label">Warna 2</span>
                        <span className="value">{him}</span>
                      </div>
                    </div>

                    {/* FITUR TOMBOL BARU DISINI 👇 */}
                    <button className={`select-status-btn ${isSelected ? 'active' : 'normal'}`}>
                      {isSelected ? (
                        <>
                          <span>◉</span> TERPILIH
                        </>
                      ) : (
                        <>
                          <span>○</span> PILIH OUTFIT INI
                        </>
                      )}
                    </button>

                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* FOOTER */}
      <div className="summary-bar">
        <div className="status-text">
          {selectedId ? <span style={{color:'#fff'}}>1 Look Selected</span> : "Select a look"} 
        </div>
        <button className={`btn-finish ${selectedId ? 'ready' : ''}`} onClick={goFinish}>
          Confirm Style
        </button>
      </div>

    </div>
  );
}