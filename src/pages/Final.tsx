import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import html2canvas from "html2canvas"; 
import { db } from "../firebase";
import { doc, onSnapshot } from "firebase/firestore";
import type { AppState, ContentConfig, Outfit } from "../lib/types";
import { saveState } from "../lib/storage"; 

// Tipe data itinerary
type Itinerary = { dinner: string | null; snack: string | null; dessert: string | null; };

// Tipe data rundown
type RundownItem = {
  time: string;
  label: string;
  desc: string;
  type: string;
};

export function Final({ cfg, state }: { cfg: ContentConfig; state: AppState }) {
  const navigate = useNavigate();
  const [plan, setPlan] = useState<Itinerary | null>(null);
  const [outfit, setOutfit] = useState<Outfit | null>(null);
  const [loading, setLoading] = useState(true);
  
  // State Fitur
  const [showReceipt, setShowReceipt] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false); 
  const receiptRef = useRef<HTMLDivElement>(null); 
  const [showResetModal, setShowResetModal] = useState(false);

  // State untuk rundown (realtime dari Firebase)
  const [rundownData, setRundownData] = useState<RundownItem[]>([]);

  // Default tanggal reservasi
  const [reservationDate, setReservationDate] = useState(new Date().toISOString().split('T')[0]);

  // --- REALTIME SYNC RUNDOWN DARI FIREBASE ---
  useEffect(() => {
    const docRef = doc(db, "configs", "main_config");
    
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.rundown && Array.isArray(data.rundown)) {
          setRundownData(data.rundown);
          console.log("📅 Rundown berhasil di-sync dari Firebase:", data.rundown);
        } else {
          // Fallback ke default rundown jika belum ada di Firebase
          setRundownData([
            { time: "16:30-17:30", label: "PICK UP", desc: "yoshyy jemput keysii", type: "static" },
            { time: "17:00-18:15", label: "DINNER", desc: "", type: "dinner" },
            { time: "18:15-18:30", label: "PRAYER", desc: "sholat maghrib", type: "static" },
            { time: "18:30-19:00", label: "SNACK", desc: "", type: "snack" },
            { time: "19:45-20:15", label: "DESSERT", desc: "", type: "dessert" },
            { time: "22:00-22:30", label: "DROP OFF", desc: "anterin keyy pulang", type: "static" }
          ]);
        }
      }
    }, (error) => {
      console.error("Firebase Rundown Sync Error:", error);
    });

    return () => unsubscribe();
  }, []);

  // --- 1. LOAD DATA ---
  useEffect(() => {
    if (state.chosenPlaceId && state.chosenPlaceId.startsWith('{')) {
      try { setPlan(JSON.parse(state.chosenPlaceId)); } catch (e) {}
    }
    if (state.chosenOutfitId && cfg.outfits?.items) {
      const found = cfg.outfits.items.find(o => o.id === state.chosenOutfitId);
      setOutfit(found || null);
    }
    setTimeout(() => setLoading(false), 500);
  }, [state.chosenPlaceId, state.chosenOutfitId, cfg]);

  // --- 2. LOGIC RESET ---
  const executeReset = () => {
    const nextState: AppState = {
      ...state,
      step: 3, 
      chosenPlaceId: undefined, 
      chosenOutfitId: undefined 
    };
    saveState(nextState);
    window.location.href = "/places";
  };

  // --- 3. HELPER ---
  const getPlaceName = (id: string | null, fallback: string) => {
    if (!id || !cfg.places?.items) return fallback;
    const p = cfg.places.items.find(item => item.id === id);
    return p ? p.name : fallback;
  };

  // Helper Format Tanggal Cantik (Indonesia)
  const formatDateIndo = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
  };

  // --- 4. CAPTURE ---
  const handleDownloadImage = async () => {
    if (!receiptRef.current) return;
    setIsCapturing(true);
    try {
      await new Promise(r => setTimeout(r, 300));
      const canvas = await html2canvas(receiptRef.current, { scale: 3, backgroundColor: null, useCORS: true, logging: false });
      const image = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.href = image;
      link.download = `DATE-TICKET-${reservationDate}.png`;
      link.click();
    } catch (err) { alert("Gagal menyimpan gambar."); }
    setIsCapturing(false);
  };

  // --- PROSES RUNDOWN: Ganti dynamic content dengan pilihan user ---
  const rundown = rundownData.map((item: RundownItem) => {
    if (item.type === 'dinner') {
      return { 
        ...item, 
        desc: getPlaceName(plan?.dinner || null, item.desc || "Belum pilih tempat"), 
        type: 'dynamic' 
      };
    }
    if (item.type === 'snack') {
      return { 
        ...item, 
        desc: getPlaceName(plan?.snack || null, item.desc || "Belum pilih snack"), 
        type: 'dynamic' 
      };
    }
    if (item.type === 'dessert') {
      return { 
        ...item, 
        desc: getPlaceName(plan?.dessert || null, item.desc || "Belum pilih dessert"), 
        type: 'dynamic' 
      };
    }
    return item;
  });

  if (loading) return <div style={{background:'#020617', height:'100vh', width:'100vw'}}></div>;

  return (
    <div className="dashboard-container">
      <div className="ambient-glow" />
      <div className="grid-lines" />
      <div className="scan-line" />

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;700&family=Inter:wght@300;400;600&family=Space+Mono&display=swap');

        /* LAYOUT & BG */
        .dashboard-container { position: fixed; inset: 0; background: #020617; display: flex; align-items: center; justify-content: center; font-family: 'Inter', sans-serif; overflow: hidden; }
        .ambient-glow { position: absolute; width: 800px; height: 800px; background: radial-gradient(circle, rgba(124, 58, 237, 0.15) 0%, transparent 70%); top: -200px; left: -200px; z-index: 0; pointer-events: none; }
        .grid-lines { position: absolute; inset: 0; background-image: linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px); background-size: 50px 50px; z-index: 0; }
        .scan-line { position: absolute; top: 0; left: 0; right: 0; height: 2px; background: rgba(124, 58, 237, 0.5); box-shadow: 0 0 10px #7c3aed; animation: scanDown 4s linear infinite; opacity: 0.3; z-index: 1; pointer-events: none; }
        @keyframes scanDown { 0% {top: -10%; opacity: 0;} 10% {opacity: 0.5;} 90% {opacity: 0.5;} 100% {top: 110%; opacity: 0;} }

        /* DASHBOARD */
        .glass-dashboard { position: relative; z-index: 10; width: 95%; max-width: 1100px; height: 650px; background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(124, 58, 237, 0.2); border-radius: 24px; backdrop-filter: blur(40px); box-shadow: 0 50px 100px -20px rgba(0,0,0,0.9); display: grid; grid-template-columns: 350px 1fr; overflow: hidden; animation: slideUpFade 0.8s cubic-bezier(0.2, 0.8, 0.2, 1); }
        @keyframes slideUpFade { from { transform: translateY(50px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

        /* VISUAL */
        .visual-col { position: relative; background: #000; border-right: 1px solid rgba(255,255,255,0.05); overflow: hidden; }
        .outfit-img { width: 100%; height: 100%; object-fit: cover; opacity: 0.9; transition: transform 0.5s ease; }
        .visual-col:hover .outfit-img { transform: scale(1.03); opacity: 1; }
        .overlay-info { position: absolute; bottom: 0; left: 0; right: 0; padding: 30px; background: linear-gradient(to top, #020617 20%, transparent); }
        .badge { display: inline-block; padding: 6px 12px; border-radius: 6px; background: #7c3aed; color: #fff; font-family: 'Rajdhani', sans-serif; font-weight: 700; font-size: 12px; letter-spacing: 2px; margin-bottom: 10px; text-transform: uppercase; }
        .outfit-name { font-family: 'Rajdhani', sans-serif; font-weight: 700; font-size: 32px; color: #fff; line-height: 1; margin-bottom: 5px; }
        .outfit-style { color: #94a3b8; font-size: 14px; letter-spacing: 1px; }

        /* DATA COL */
        .data-col { padding: 30px 40px; display: flex; flex-direction: column; overflow-y: auto; position: relative; }
        .data-col::-webkit-scrollbar { width: 6px; }
        .data-col::-webkit-scrollbar-thumb { background: #334155; border-radius: 10px; }

        .header-row { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 25px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 15px; flex-shrink: 0; }
        .page-title { font-family: 'Rajdhani', sans-serif; font-weight: 700; font-size: 36px; color: #fff; text-transform: uppercase; letter-spacing: -1px; }
        .page-sub { color: #7c3aed; font-size: 12px; letter-spacing: 2px; font-weight: 700; text-transform: uppercase; }

        /* --- INPUT TANGGAL STYLE --- */
        .date-input-group { text-align: right; }
        .date-label { font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
        .custom-date-input {
          background: rgba(124, 58, 237, 0.1);
          border: 1px solid rgba(124, 58, 237, 0.5);
          color: #c4b5fd;
          padding: 5px 10px;
          border-radius: 8px;
          font-family: 'Rajdhani', sans-serif;
          font-weight: bold;
          font-size: 16px;
          outline: none;
          cursor: pointer;
          text-transform: uppercase;
        }
        .custom-date-input::-webkit-calendar-picker-indicator { filter: invert(1); opacity: 0.5; cursor: pointer; }

        /* TIMELINE */
        .timeline { flex: 1; margin-bottom: 20px; overflow-y: auto; }
        .t-row { display: flex; gap: 15px; margin-bottom: 18px; }
        .t-time { width: 90px; flex-shrink: 0; font-family: 'Rajdhani', sans-serif; font-weight: 700; font-size: 13px; color: #7c3aed; text-transform: uppercase; padding-top: 2px; }
        .t-label { font-family: 'Rajdhani', sans-serif; font-weight: 700; font-size: 16px; color: #fff; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px; }
        .t-desc { color: #94a3b8; font-size: 13px; line-height: 1.4; }
        .t-desc.dynamic-text { color: #c4b5fd; font-weight: 600; }

        /* ACTION ROW */
        .action-row { display: flex; gap: 12px; flex-shrink: 0; }
        .btn-act { flex: 1; padding: 12px 20px; border: none; border-radius: 10px; font-family: 'Rajdhani', sans-serif; font-weight: 700; font-size: 14px; text-transform: uppercase; cursor: pointer; transition: all 0.3s; letter-spacing: 1px; }
        .btn-outline { background: transparent; border: 1px solid rgba(124, 58, 237, 0.5); color: #7c3aed; }
        .btn-outline:hover { background: rgba(124, 58, 237, 0.1); }
        .btn-primary { background: linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%); color: #fff; box-shadow: 0 8px 20px rgba(124, 58, 237, 0.3); }
        .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 12px 30px rgba(124, 58, 237, 0.4); }

        /* MODAL RESET */
        .popup-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 999; backdrop-filter: blur(5px); }
        .popup-card { background: #0f172a; border: 1px solid #7c3aed; border-radius: 16px; padding: 30px; text-align: center; max-width: 400px; box-shadow: 0 20px 50px rgba(124, 58, 237, 0.3); }
        .popup-actions { display: flex; gap: 12px; margin-top: 20px; }
        .btn-pop { flex: 1; padding: 12px; border: none; border-radius: 8px; font-weight: 700; cursor: pointer; text-transform: uppercase; font-size: 13px; }
        .btn-cancel { background: #334155; color: #fff; }
        .btn-confirm { background: #7c3aed; color: #fff; }

        /* RECEIPT MODAL */
        .receipt-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.95); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 20px; backdrop-filter: blur(10px); }
        .btn-close-overlay { position: absolute; top: 20px; right: 20px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: white; padding: 12px 18px; border-radius: 50%; cursor: pointer; font-size: 18px; font-weight: bold; transition: 0.3s; z-index: 1001; }
        .btn-close-overlay:hover { background: rgba(255,255,255,0.2); transform: rotate(90deg); }

        /* RECEIPT PAPER */
        .receipt-paper { background: #fff; color: #000; width: 320px; padding: 20px; border-radius: 8px; font-family: 'Space Mono', monospace; position: relative; box-shadow: 0 30px 60px rgba(0,0,0,0.5); }
        .rc-close-btn { position: absolute; top: 10px; right: 10px; background: transparent; border: 1px solid #000; color: #000; width: 24px; height: 24px; border-radius: 50%; cursor: pointer; font-size: 14px; font-weight: bold; display: flex; align-items: center; justify-content: center; }
        .rc-title { font-weight: 900; margin-bottom: 2px; }
        .rc-sub { font-size: 9px; color: #666; }
        .rc-info-row { border-top: 1px solid #000; padding-top: 8px; margin-top: 8px; }
        .rc-info-item { flex: 1; }
        .rc-info-label { display: block; font-size: 7px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
        .rc-info-val { display: block; font-weight: bold; font-size: 10px; }
        .rc-body { margin-top: 10px; }
        .rc-total { border-top: 1px solid #000; padding-top: 8px; margin-top: 8px; }
        .rc-footer { margin-top: 10px; }
        .rc-note { font-style: italic; font-size: 9px; color: #666; }
      `}</style>

      <div className="glass-dashboard">
        {/* LEFT: OUTFIT VISUAL */}
        <div className="visual-col">
          {outfit?.image ? (
            <img src={outfit.image} alt={outfit.name} className="outfit-img" />
          ) : (
            <div style={{width:'100%', height:'100%', background:'#000', display:'flex', alignItems:'center', justifyContent:'center', color:'#444', fontSize:14}}>
              No Outfit Selected
            </div>
          )}
          <div className="overlay-info">
            <div className="badge">ATTIRE CODE</div>
            <div className="outfit-name">{outfit?.name || "No Outfit"}</div>
            <div className="outfit-style">{outfit?.style || "Casual"}</div>
          </div>
        </div>

        {/* RIGHT: RUNDOWN DATA */}
        <div className="data-col">
          <div className="header-row">
            <div>
              <div className="page-sub">yoshyy x keyysi</div>
              <div className="page-title">Date Plan</div>
            </div>
            <div className="date-input-group">
              <div className="date-label">Reservation Date</div>
              <input 
                type="date" 
                className="custom-date-input"
                value={reservationDate}
                onChange={(e) => setReservationDate(e.target.value)}
              />
            </div>
          </div>

          <div className="timeline">
            {rundown.map((item, idx) => (
              <div key={idx} className="t-row">
                <div className="t-time">{item.time}</div>
                <div>
                  <div className="t-label">{item.label}</div>
                  <div className={`t-desc ${item.type === 'dynamic' ? 'dynamic-text' : ''}`}>
                    {item.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="action-row">
            <button className="btn-act btn-outline" onClick={() => setShowResetModal(true)}>
              Reset Plan
            </button>
            
            <button 
              className="btn-act" 
              style={{ background: 'linear-gradient(45deg, #7c3aed, #db2777)', color: '#fff', border: 'none' }}
              onClick={() => navigate('/photobox')}
            >
              After Party Photo 📸
            </button>

            <button className="btn-act btn-primary" onClick={() => setShowReceipt(true)}>
              Capture Plan ✨
            </button>
          </div>
        </div>
      </div>

      {/* MODAL RESET */}
      {showResetModal && (
        <div className="popup-modal">
          <div className="popup-card">
            <div style={{fontSize:40, marginBottom:10}}>🤔</div>
            <div style={{color:'white', fontWeight:'bold', fontSize:20}}>Reset Plan?</div>
            <div style={{color:'#94a3b8', fontSize:14, margin:'10px 0 20px'}}>Yakin mau ulang pilih tempat & outfit?</div>
            <div className="popup-actions">
              <button className="btn-pop btn-cancel" onClick={() => setShowResetModal(false)}>Batal</button>
              <button className="btn-pop btn-confirm" onClick={executeReset}>Ulang Aja</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL NOTA 3D */}
      {showReceipt && (
        <div className="receipt-overlay">
          <button className="btn-close-overlay" onClick={() => setShowReceipt(false)}>✕</button>
          
          <div className="receipt-paper" ref={receiptRef}>
            <button className="rc-close-btn" data-html2canvas-ignore onClick={() => setShowReceipt(false)}>✕</button>
            
            <div className="rc-header" style={{ textAlign: 'center' }}>
              <div className="rc-title" style={{ fontSize: '20px', fontWeight: '900' }}>DATE NIGHT RECEIPT</div>
              <div className="rc-sub" style={{ fontSize: '9px', letterSpacing: '1px' }}>OFFICIAL RESERVATION PROTOCOL</div>
              
              <div className="rc-info-row" style={{ marginTop: '8px', display: 'flex', justifyContent: 'space-between', border: 'none', paddingTop: 0 }}>
                <div className="rc-info-item">
                  <span className="rc-info-label" style={{ fontSize: '7px' }}>ISSUED DATE</span>
                  <span className="rc-info-val" style={{ fontSize: '10px', fontWeight: 'bold' }}>{new Date().toLocaleDateString('id-ID')}</span>
                </div>
                <div className="rc-info-item right" style={{ textAlign: 'right' }}>
                  <span className="rc-info-label" style={{ fontSize: '7px' }}>RESERVATION FOR</span>
                  <span className="rc-info-val" style={{ fontSize: '10px', fontWeight: 'bold' }}>{formatDateIndo(reservationDate)}</span>
                </div>
              </div>
            </div>

            <div className="rc-body">
              {rundown.map((item, idx) => (
                <div key={idx} style={{ 
                  display: 'flex', 
                  alignItems: 'baseline', 
                  padding: '4px 0', 
                  fontSize: '11px' 
                }}>
                  <span style={{ width: '80px', fontWeight: 'bold', fontFamily: "'Space Mono', monospace" }}>
                    {item.time}
                  </span>
                  <span style={{ flex: 1, textAlign: 'center', fontWeight: '900', textTransform: 'uppercase' }}>
                    {item.label}
                  </span>
                  <span style={{ width: '100px', textAlign: 'right', fontSize: '9px', fontStyle: 'italic', lineHeight: '1' }}>
                    {item.desc}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ borderTop: '1px dashed #000', margin: '10px 0' }}></div>

            <div className="rc-total" style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '13px', padding: '5px 0', border: 'none', marginTop: 0 }}>
              <span>TOTAL PRICE:</span>
              <span>PRICELESS 💖</span>
            </div>

            <div className="rc-footer" style={{ marginTop: '5px' }}>
              <div style={{ textAlign: 'center', fontSize: '8px', fontStyle: 'italic' }}>
                --- SCAN TO PLAY OUR BEAT ---
              </div>

              <div className="qr-container" style={{ textAlign: 'center', margin: '10px 0' }}>
                <img 
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(cfg.music || "spotify:playlist:3MFForBzzorHXo5wHz30Vw")}`}
                  alt="Spotify QR"
                  style={{ 
                    width: '85px', 
                    height: '85px', 
                    display: 'block',
                    margin: '0 auto',
                    border: '1px solid #000', 
                    padding: '3px',
                    backgroundColor: '#fff'
                  }} 
                />
              </div>
              
              <div style={{ fontSize: '9px', letterSpacing: '2px', fontWeight: 'bold', textAlign: 'center' }}>
                INV-CODE-{reservationDate.replace(/-/g,'')}
              </div>
              <div className="rc-note" style={{ marginTop: '4px', textAlign: 'center', fontSize: '9px' }}>"Please save this receipt as a valid ticket."</div>
              
              <button 
                onClick={handleDownloadImage}
                disabled={isCapturing}
                data-html2canvas-ignore
                style={{
                  marginTop: '12px', 
                  width: '100%', 
                  padding: '10px', 
                  background: isCapturing ? '#999' : '#000', 
                  color: '#fff', 
                  border: 'none', 
                  cursor: 'pointer', 
                  fontSize: '9px', 
                  textTransform: 'uppercase', 
                  fontWeight: 'bold'
                }}
              >
                {isCapturing ? "PRINTING..." : "SAVE AS IMAGE 📸"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}