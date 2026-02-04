import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom"; // <--- INI YG KETINGGALAN TADI
import type { AppState, ContentConfig, Place } from "../lib/types";
import { saveState } from "../lib/storage";
import { logEvent } from "../lib/activity";
import { safeOpen } from "../lib/utils";

type Category = 'dinner' | 'snack' | 'dessert';
type Itinerary = { dinner: string | null; snack: string | null; dessert: string | null; };

// --- FIX LOGIC PARSING SWOT ---
const parseSwotList = (raw?: string) => {
  if (!raw) return { pros: [], cons: [] };
  const lines = raw.split('\n');
  
  const pros = lines
    .filter(l => l.trim().startsWith('+')) 
    .map(l => l.replace(/^\+\s*/, '').trim());
    
  const cons = lines
    .filter(l => l.trim().startsWith('-')) 
    .map(l => l.replace(/^\-\s*/, '').trim());
    
  return { pros, cons };
};

export function Places({ cfg, state, setState }: { cfg: ContentConfig; state: AppState; setState: (s: AppState) => void; }) {
  const navigate = useNavigate(); // <--- INISIALISASI NAVIGASI
  const allItems = cfg.places.items;
  
  const [activeTab, setActiveTab] = useState<Category>('dinner');
  const [selections, setSelections] = useState<Itinerary>({ dinner: null, snack: null, dessert: null });
  const [selectedDetail, setSelectedDetail] = useState<Place | null>(null);

  useEffect(() => {
    if (state.chosenPlaceId && state.chosenPlaceId.startsWith('{')) {
      try { setSelections(JSON.parse(state.chosenPlaceId)); } catch (e) { }
    }
  }, []);

  const getItemsByCategory = (cat: Category) => allItems.filter(p => p.tags.some(t => t.toLowerCase().includes(cat)));

  const handleSelect = (place: Place, cat: Category) => {
    const newSelections = { ...selections, [cat]: place.id };
    setSelections(newSelections);
    
    if (selectedDetail) setSelectedDetail(null);

    // Auto next tab delay
    if (cat === 'dinner' && !newSelections.snack) setTimeout(() => setActiveTab('snack'), 500);
    else if (cat === 'snack' && !newSelections.dessert) setTimeout(() => setActiveTab('dessert'), 500);
  };

  const isComplete = selections.dinner && selections.snack && selections.dessert;

  const goNext = () => {
    if (!isComplete) return;
    
    // Simpan data itinerary
    const itineraryString = JSON.stringify(selections);
    const next: AppState = { ...state, chosenPlaceId: itineraryString, step: 4 }; 
    
    saveState(next);
    setState(next);
    logEvent("itinerary_complete", selections);
    
    // --- PINDAH HALAMAN (FIX UTAMA) ---
    navigate("/outfits");
  };

  // Render SWOT di dalam Modal
  const renderSwot = (place: Place) => {
    const { pros, cons } = parseSwotList(place.swot);
    if (pros.length === 0 && cons.length === 0) return null;
    return (
      <div className="modal-swot-container">
        {pros.length > 0 && (
          <div className="swot-column">
            <div className="swot-header plus">✅ HIGHLIGHTS</div>
            <ul className="swot-list">{pros.map((txt, i) => <li key={i}>{txt}</li>)}</ul>
          </div>
        )}
        {cons.length > 0 && (
          <div className="swot-column">
            <div className="swot-header minus">⚠️ NOTE</div>
            <ul className="swot-list">{cons.map((txt, i) => <li key={i}>{txt}</li>)}</ul>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="main-container">
      <div className="nebula-bg" />
      <div className="noise-overlay" />
      
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;800&family=Inter:wght@300;400;500;700&display=swap');
        
        /* HIDE SCROLLBAR */
        ::-webkit-scrollbar { display: none; }
        * { -ms-overflow-style: none; scrollbar-width: none; box-sizing: border-box; }
        
        /* CONTAINER */
        .main-container {
          position: fixed; inset: 0; background: #020617; 
          overflow-y: auto; overflow-x: hidden; font-family: 'Inter', sans-serif;
        }

        /* BACKGROUND */
        .nebula-bg { position: fixed; inset: 0; z-index: -2; background: radial-gradient(circle at top center, #4c1d95 0%, #1e1b4b 40%, #0f172a 80%); background-size: 100% 100%; }
        .noise-overlay { position: fixed; inset: 0; z-index: -1; pointer-events: none; opacity: 0.05; background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E"); }
        
        /* HEADER (SCROLLABLE, NOT FIXED) */
        .header-section { 
          text-align: center; padding-top: 40px; padding-bottom: 20px; 
          margin-bottom: 10px;
        }
        .header-title { 
          font-family: 'Plus Jakarta Sans', sans-serif; font-size: clamp(32px, 5vw, 42px); 
          font-weight: 800; margin-bottom: 8px; line-height: 1.1;
          background: linear-gradient(to right, #fff, #c4b5fd); 
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; 
        }
        .header-subtitle { color: #94a3b8; font-size: 15px; max-width: 500px; margin: 0 auto; line-height: 1.5; }
        
        /* STICKY TABS */
        .sticky-tabs-wrapper {
          position: sticky; top: 0; z-index: 40;
          padding: 15px 0; margin-bottom: 30px;
          background: rgba(2, 6, 23, 0.85); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
          border-bottom: 1px solid rgba(255,255,255,0.05);
          margin-left: -20px; margin-right: -20px; padding-left: 20px; padding-right: 20px;
        }
        .tabs-container { display: flex; justify-content: center; gap: 10px; max-width: 600px; margin: 0 auto; }
        .tab-btn { 
          flex: 1; padding: 12px; border-radius: 14px; 
          background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255,255,255,0.1); 
          color: #94a3b8; font-weight: 600; font-size: 13px; cursor: pointer;
          transition: all 0.2s ease; display: flex; align-items: center; justify-content: center; gap: 8px; 
        }
        .tab-btn.active { background: #7c3aed; color: white; border-color: #7c3aed; box-shadow: 0 0 20px rgba(124, 58, 237, 0.3); transform: scale(1.02); }
        .check-badge { width: 18px; height: 18px; background: white; color: #7c3aed; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: bold; }

        /* CONTENT */
        .page-content { max-width: 1200px; margin: 0 auto; padding: 0 20px 140px 20px; position: relative; z-index: 10; }

        /* GRID (BIGGER CARDS) */
        .places-grid { 
          display: grid; 
          grid-template-columns: 1fr; 
          gap: 25px; 
          animation: fadeUp 0.6s ease; 
        }
        @media (min-width: 640px) { .places-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (min-width: 1024px) { .places-grid { grid-template-columns: repeat(3, 1fr); } }
        
        @keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

        /* CARD STYLE */
        .place-card {
          background: rgba(30, 41, 59, 0.4); backdrop-filter: blur(8px);
          border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 24px;
          overflow: hidden; cursor: pointer; transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
          position: relative; display: flex; flex-direction: column; 
          height: 100%; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        .place-card:hover { transform: translateY(-8px); border-color: rgba(139, 92, 246, 0.5); background: rgba(30, 41, 59, 0.8); box-shadow: 0 20px 40px -10px rgba(0,0,0,0.5); }
        .place-card.selected { border: 2px solid #a78bfa; background: rgba(139, 92, 246, 0.1); box-shadow: 0 0 0 1px #a78bfa; }

        .card-img-wrap { height: 220px; width: 100%; position: relative; overflow: hidden; }
        .card-img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.5s ease; }
        .place-card:hover .card-img { transform: scale(1.05); }
        .img-placeholder { width: 100%; height: 100%; background: linear-gradient(135deg, #312e81, #4c1d95); display: flex; align-items: center; justify-content: center; font-size: 50px; }

        .btn-mini-map {
          position: absolute; top: 15px; right: 15px; width: 40px; height: 40px;
          background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); border-radius: 50%;
          display: flex; align-items: center; justify-content: center; color: white;
          border: 1px solid rgba(255,255,255,0.2); transition: 0.2s; z-index: 5;
        }
        .btn-mini-map:hover { background: #a78bfa; border-color: #a78bfa; transform: scale(1.1); }

        .card-body { padding: 24px; display: flex; flex-direction: column; flex: 1; }
        .card-name { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 20px; font-weight: 700; color: white; margin-bottom: 8px; line-height: 1.3; }
        
        .card-meta { display: flex; gap: 10px; margin-bottom: 16px; font-size: 13px; color: #cbd5e1; }
        .meta-item { display: flex; align-items: center; gap: 5px; background: rgba(255,255,255,0.05); padding: 6px 12px; border-radius: 8px; }

        .btn-view-detail {
          margin-top: auto; padding: 14px; border-radius: 12px; 
          font-size: 14px; font-weight: 600; text-align: center; transition: 0.2s;
          background: rgba(255,255,255,0.05); color: #a78bfa; border: 1px solid rgba(255,255,255,0.1);
        }
        .btn-view-detail:hover { background: rgba(139, 92, 246, 0.1); border-color: #a78bfa; }
        .place-card.selected .btn-view-detail { background: #a78bfa; color: white; border-color: #a78bfa; }

        /* MODAL */
        .modal-overlay { position: fixed; inset: 0; z-index: 100; background: rgba(0,0,0,0.85); backdrop-filter: blur(10px); display: flex; align-items: center; justify-content: center; padding: 20px; animation: fadeIn 0.3s ease; }
        .modal-content { background: #0f172a; border: 1px solid rgba(139, 92, 246, 0.4); width: 100%; max-width: 500px; max-height: 85vh; border-radius: 24px; overflow-y: auto; position: relative; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8); animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
        .modal-header-img { width: 100%; height: 240px; object-fit: cover; }
        .close-btn { position: absolute; top: 15px; right: 15px; width: 40px; height: 40px; background: rgba(0,0,0,0.5); backdrop-filter: blur(4px); color: white; border-radius: 50%; border: none; font-size: 24px; cursor: pointer; z-index: 10; transition: 0.2s; display: flex; align-items: center; justify-content: center; }
        .close-btn:hover { background: #ef4444; transform: rotate(90deg); }

        .modal-body { padding: 30px; }
        .modal-title { font-size: 28px; font-weight: 800; margin-bottom: 10px; color: white; font-family: 'Plus Jakarta Sans', sans-serif; line-height: 1.2; }
        .modal-desc { color: #94a3b8; font-size: 15px; line-height: 1.6; margin-bottom: 25px; }

        .modal-swot-container { background: #1e293b; border-radius: 16px; padding: 20px; margin-bottom: 25px; border: 1px solid #334155; }
        .swot-header { font-size: 12px; font-weight: 800; letter-spacing: 1px; margin-bottom: 10px; }
        .swot-header.plus { color: #34d399; }
        .swot-header.minus { color: #f87171; margin-top: 20px; }
        .swot-list { padding-left: 20px; margin: 0; color: #cbd5e1; font-size: 14px; line-height: 1.6; }

        .btn-maps-large { width: 100%; background: transparent; border: 1px solid rgba(139, 92, 246, 0.3); color: #a78bfa; padding: 16px; border-radius: 14px; font-weight: 600; font-size: 15px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 12px; transition: 0.2s; }
        .btn-maps-large:hover { background: rgba(139, 92, 246, 0.1); border-color: #a78bfa; }
        .btn-select-large { width: 100%; background: linear-gradient(135deg, #7c3aed, #4f46e5); border: none; color: white; padding: 18px; border-radius: 14px; font-weight: 700; font-size: 16px; cursor: pointer; transition: 0.2s; box-shadow: 0 10px 20px -5px rgba(124, 58, 237, 0.4); }
        .btn-select-large:hover { transform: translateY(-3px); box-shadow: 0 15px 30px -5px rgba(124, 58, 237, 0.6); }

        /* FOOTER */
        .summary-bar { position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%); background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,0.15); padding: 12px 24px; border-radius: 50px; display: flex; align-items: center; justify-content: space-between; width: 90%; max-width: 450px; box-shadow: 0 10px 40px rgba(0,0,0,0.6); z-index: 50; }
        .btn-finish { background: linear-gradient(135deg, #7c3aed, #4f46e5); color: white; border: none; padding: 12px 28px; border-radius: 30px; font-weight: 700; cursor: pointer; opacity: 0.5; pointer-events: none; transition: 0.3s; font-size: 13px; }
        .btn-finish.ready { opacity: 1; pointer-events: auto; box-shadow: 0 0 20px rgba(124, 58, 237, 0.5); }
      `}</style>

      {/* --- PAGE CONTENT (SCROLLABLE) --- */}
      <div className="page-content">
        
        {/* Header di dalam flow scroll */}
        <div className="header-section">
          <div className="header-title">WELCOME TO KEYYSI PLACE </div>
          <div className="header-subtitle">Pilih satu destinasi untuk setiap sesi ya!</div>
        </div>

        {/* TABS STICKY */}
        <div className="sticky-tabs-wrapper">
          <div className="tabs-container">
            {['dinner', 'snack', 'dessert'].map((t) => (
              <button 
                key={t}
                className={`tab-btn ${activeTab === t ? 'active' : ''}`} 
                onClick={() => setActiveTab(t as Category)}
              >
                {t === 'dinner' ? '🍽️' : t === 'snack' ? '🧋' : '🍦'} 
                <span style={{textTransform:'capitalize'}}>{t}</span>
                {selections[t as Category] && <div className="check-badge">✓</div>}
              </button>
            ))}
          </div>
        </div>

        {/* GRID KARTU */}
        <div className="places-grid">
          {getItemsByCategory(activeTab).length === 0 ? (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '60px', color: '#64748b' }}>
              <div style={{fontSize:40, marginBottom:10}}>🏜️</div>
              Belum ada tempat kategori <strong>{activeTab}</strong>.<br/>
              <span style={{fontSize:'12px'}}>Tambahkan di Admin Panel dulu bro.</span>
            </div>
          ) : (
            getItemsByCategory(activeTab).map((p) => {
              const isSelected = selections[activeTab] === p.id;
              return (
                <div 
                  key={p.id} 
                  className={`place-card ${isSelected ? 'selected' : ''}`}
                  onClick={() => setSelectedDetail(p)}
                >
                  <div className="card-img-wrap">
                    <button className="btn-mini-map" onClick={(e) => { e.stopPropagation(); safeOpen(p.locationUrl); }}>📍</button>
                    {p.image ? <img src={p.image} alt={p.name} className="card-img" /> : <div className="img-placeholder">{activeTab === 'dinner' ? '🍽️' : activeTab === 'snack' ? '🧋' : '🍦'}</div>}
                  </div>

                  <div className="card-body">
                    <div className="card-name">{p.name}</div>
                    <div className="card-meta">
                       {p.budget && <div className="meta-item">💰 {p.budget}</div>}
                       {p.openHours && <div className="meta-item">🕒 {p.openHours}</div>}
                    </div>
                    
                    <div className="btn-view-detail">
                       {isSelected ? "✓ TERPILIH" : "LIHAT DETAIL"}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* MODAL & FOOTER */}
      {selectedDetail && (
        <div className="modal-overlay" onClick={() => setSelectedDetail(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setSelectedDetail(null)}>×</button>
            <div style={{position:'relative'}}>
               {selectedDetail.image ? <img src={selectedDetail.image} className="modal-header-img" alt={selectedDetail.name} /> : <div className="modal-header-img" style={{background:'linear-gradient(135deg, #312e81, #4c1d95)'}} />}
               <div style={{position:'absolute', inset:0, background:'linear-gradient(to top, #0f172a, transparent)'}}></div>
            </div>
            <div className="modal-body">
              <div className="modal-title">{selectedDetail.name}</div>
              <div style={{display:'flex', gap:10, marginBottom:15, color:'#cbd5e1', fontSize:13}}>
                {selectedDetail.budget && <span style={{background:'rgba(255,255,255,0.1)', padding:'4px 10px', borderRadius:6}}>💰 {selectedDetail.budget}</span>}
                {selectedDetail.openHours && <span style={{background:'rgba(255,255,255,0.1)', padding:'4px 10px', borderRadius:6}}>🕒 {selectedDetail.openHours}</span>}
              </div>
              <div className="modal-desc">{selectedDetail.description}</div>
              {renderSwot(selectedDetail)}
              <div className="modal-actions">
                {selectedDetail.locationUrl && (
                  <button className="btn-maps-large" onClick={() => safeOpen(selectedDetail.locationUrl)}>📍 Buka di Google Maps</button>
                )}
                <button className="btn-select-large" onClick={() => handleSelect(selectedDetail, activeTab)}>
                  {selections[activeTab] === selectedDetail.id ? "Sudah Dipilih ✓" : "Pilih Tempat Ini ✨"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="summary-bar">
        <div style={{ color: '#94a3b8', fontSize: 12, fontWeight: 600 }}>
          {isComplete ? <span style={{color:'#34d399'}}>Plan Ready! ✨</span> : "Lengkapi:"} 
          <span style={{ marginLeft: 8, color: 'white' }}>
            {!selections.dinner && "🍽️ "}
            {!selections.snack && "🧋 "}
            {!selections.dessert && "🍦 "}
          </span>
        </div>
        <button className={`btn-finish ${isComplete ? 'ready' : ''}`} onClick={goNext}>Lanjut Outfit →</button>
      </div>
    </div>
  );
}