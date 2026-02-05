import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import html2canvas from "html2canvas"; 
import type { AppState, ContentConfig, Outfit } from "../lib/types";
import { saveState } from "../lib/storage"; 

// Tipe data itinerary
type Itinerary = { dinner: string | null; snack: string | null; dessert: string | null; };

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

  // --- STATE BARU: TANGGAL RESERVASI ---
  // Default ke hari ini (format YYYY-MM-DD untuk input date)
  const [reservationDate, setReservationDate] = useState(new Date().toISOString().split('T')[0]);

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

  // Ambil rundown dari config (Admin), kalau kosong baru pakai default
  const baseRundown = cfg.rundown && cfg.rundown.length > 0 
    ? cfg.rundown 
    : [
        { time: "16:30 - 17:30", label: "PICK UP", desc: `${cfg.couple.yourName} jemput ${cfg.couple.herName}`, type: "static" },
        { time: "18:15 - 19:30", label: "DINNER", desc: "", type: "dinner" },
        { time: "19:30 - 19:45", label: "SNACK", desc: "", type: "snack" },
        { time: "20:30 - 21:00", label: "DESSERT", desc: "", type: "dessert" },
        { time: "22:00 - 22:30", label: "DROP OFF", desc: `Nganter ${cfg.couple.herName} pulang`, type: "static" }
      ];

  const rundown = baseRundown.map((item: any) => {
    if (item.type === 'dinner') return { ...item, desc: getPlaceName(plan?.dinner, item.desc || "Belum pilih tempat"), type: 'dynamic' };
    if (item.type === 'snack') return { ...item, desc: getPlaceName(plan?.snack, item.desc || "Belum pilih snack"), type: 'dynamic' };
    if (item.type === 'dessert') return { ...item, desc: getPlaceName(plan?.dessert, item.desc || "Belum pilih dessert"), type: 'dynamic' };
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
        .t-row { display: grid; grid-template-columns: 110px 1fr; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.03); transition: background 0.2s; }
        .t-row:hover { background: rgba(255,255,255,0.02); }
        .t-time { font-family: 'Rajdhani', sans-serif; font-weight: 700; font-size: 15px; color: #94a3b8; letter-spacing: 0.5px; }
        .t-label { font-size: 13px; font-weight: 700; color: #fff; margin-bottom: 2px; text-transform: uppercase; }
        .t-desc { font-size: 13px; color: #64748b; line-height: 1.4; }
        .dynamic-text { color: #c4b5fd; font-weight: 500; } 

        .action-row { margin-top: 20px; display: flex; gap: 15px; flex-shrink: 0; }
        .btn-act { flex: 1; padding: 14px; border-radius: 8px; border: none; cursor: pointer; font-family: 'Rajdhani', sans-serif; font-weight: 700; font-size: 14px; letter-spacing: 2px; text-transform: uppercase; transition: all 0.2s; }
        .btn-primary { background: #fff; color: #020617; }
        .btn-primary:hover { background: #e2e8f0; transform: translateY(-2px); box-shadow: 0 5px 15px rgba(255,255,255,0.2); }
        .btn-outline { background: transparent; border: 1px solid rgba(255,255,255,0.2); color: #94a3b8; }
        .btn-outline:hover { border-color: #fff; color: #fff; }

        /* MODALS */
        .popup-modal { position: fixed; inset: 0; z-index: 200; background: rgba(2, 6, 23, 0.8); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; animation: fadeIn 0.3s ease; }
        .popup-card { background: #0f172a; border: 1px solid #7c3aed; padding: 30px; width: 90%; max-width: 350px; border-radius: 20px; text-align: center; box-shadow: 0 0 30px rgba(124, 58, 237, 0.3); animation: popBounce 0.4s forwards; }
        @keyframes popBounce { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .popup-actions { display: flex; gap: 10px; margin-top: 20px; }
        .btn-pop { flex: 1; padding: 12px; border-radius: 12px; border: none; cursor: pointer; font-weight: bold; }
        .btn-cancel { background: transparent; border: 1px solid #334155; color: #94a3b8; }
        .btn-confirm { background: linear-gradient(135deg, #f43f5e 0%, #e11d48 100%); color: #fff; }

        /* RECEIPT OVERLAY */
        .receipt-overlay { position: fixed; inset: 0; z-index: 100; background: rgba(0,0,0,0.85); backdrop-filter: blur(10px); display: flex; align-items: center; justify-content: center; perspective: 1500px; animation: fadeIn 0.3s ease; }
        .receipt-paper { width: 380px; background: #fff; color: #000; padding: 30px 25px; font-family: 'Space Mono', monospace; box-shadow: 0 0 50px rgba(0,0,0,0.5); transform-origin: top center; animation: printOut 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) forwards; position: relative; }
        .receipt-paper::after { content: ''; position: absolute; bottom: -10px; left: 0; right: 0; height: 10px; background: radial-gradient(circle, transparent 6px, #fff 7px); background-size: 15px 15px; background-position: -8px 0; }
        @keyframes printOut { 0% { transform: translateY(-500px) rotateX(20deg); opacity: 0; } 100% { transform: translateY(0) rotateX(0deg); opacity: 1; } }
        
        .rc-close-btn { position: absolute; top: 10px; right: 10px; background: none; border: none; font-size: 20px; color: #000; cursor: pointer; padding: 5px; line-height: 1; z-index:10; }
        .btn-close-overlay { position: absolute; top: 20px; right: 20px; background: transparent; border: 1px solid #fff; color: #fff; width: 40px; height: 40px; border-radius: 50%; cursor: pointer; font-size: 20px; display: flex; align-items: center; justify-content: center; transition: 0.2s; }
        .btn-close-overlay:hover { background: #fff; color: #000; }

        /* RECEIPT CONTENT */
        .rc-header { text-align: center; border-bottom: 2px dashed #000; padding-bottom: 15px; margin-bottom: 15px; }
        .rc-title { font-weight: bold; font-size: 20px; margin-bottom: 5px; }
        .rc-sub { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #444; }
        
        /* NEW: RECEIPT INFO ROW (ISSUED & RESERVATION) */
        .rc-info-row { display: flex; justify-content: space-between; margin-top: 10px; border-top: 1px solid #eee; padding-top: 5px; }
        .rc-info-item { font-size: 9px; display: flex; flex-direction: column; text-align: left; }
        .rc-info-item.right { text-align: right; }
        .rc-info-label { color: #666; font-size: 8px; }
        .rc-info-val { font-weight: bold; text-transform: uppercase; }

        .rc-item { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 11px; line-height: 1.4; }
        .rc-time { font-weight: bold; min-width: 85px; }
        .rc-desc { text-align: right; max-width: 200px; }
        .rc-total { border-top: 2px dashed #000; margin-top: 20px; padding-top: 15px; display: flex; justify-content: space-between; font-weight: bold; font-size: 14px; }
        .rc-footer { margin-top: 30px; text-align: center; }
        .barcode-fake { font-size: 28px; letter-spacing: 5px; transform: scaleY(0.7); margin-bottom: 5px; }
        .rc-note { font-size: 10px; color: #444; font-style: italic; margin-top: 10px; }

        @media (max-width: 900px) {
          .glass-dashboard { grid-template-columns: 1fr; height: 100vh; border-radius: 0; border: none; }
          .visual-col { height: 200px; flex-shrink: 0; }
          .page-title { font-size: 28px; }
          .t-row { grid-template-columns: 90px 1fr; }
        }
      `}</style>

      {/* DASHBOARD */}
      <div className="glass-dashboard">
        <div className="visual-col">
          {outfit && outfit.image ? (
            <img src={outfit.image} className="outfit-img" alt="Outfit" />
          ) : (
            <div style={{width:'100%', height:'100%', background:'#0f172a', display:'flex', alignItems:'center', justifyContent:'center', color:'#334155'}}>NO IMAGE</div>
          )}
          <div className="overlay-info">
            <div className="badge">Attire Code</div>
            <div className="outfit-name">{outfit ? (outfit.name || outfit.title || "No Name") : "No Selection"}</div>
            <div className="outfit-style">{outfit?.style || "Style"} Aesthetic</div>
          </div>
        </div>

        <div className="data-col">
          <div className="header-row">
            <div>
              <div className="page-sub">The Master Plan</div>
              <div className="page-title">Date Itinerary</div>
            </div>
            
            {/* INPUT TANGGAL (POJOK KANAN ATAS) */}
            <div className="date-input-group">
              <div className="date-label">Reservation Date</div>
              <input 
                type="date" 
                className="custom-date-input"
                value={reservationDate}
                onChange={(e) => {
                  const newDate = e.target.value;
                  setReservationDate(newDate);
                  // Simpan ke storage biar permanen
                  saveState({ ...state, reservationDate: newDate });
                }}
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
            
            {/* HEADER DENGAN GARIS TEBAL DI BAWAHNYA */}
            <div className="rc-header" style={{ borderBottom: '2px solid #000', paddingBottom: '15px', marginBottom: '0' }}>
              <div className="rc-title">DATE NIGHT RECEIPT</div>
              <div className="rc-sub">ISSUED BY: OFFICIAL DATE PROTOCOL</div>
              
              <div className="rc-info-row" style={{ border: 'none', marginTop: '10px' }}>
                <div className="rc-info-item">
                  <span className="rc-info-label">ISSUED DATE</span>
                  <span className="rc-info-val">{new Date().toLocaleDateString('id-ID')}</span>
                </div>
                <div className="rc-info-item right">
                  <span className="rc-info-label">RESERVATION FOR</span>
                  <span className="rc-info-val">
                    {formatDateIndo(reservationDate)}
                  </span>
                </div>
              </div>
            </div>

            {/* BODY RUNDOWN - ATASNYA POLOS (KARENA UDAH ADA GARIS TEBAL HEADER) */}
            <div className="rc-body" style={{ marginTop: '10px' }}>
              {rundown.map((item, idx) => (
                <div key={idx} style={{ 
                  display: 'flex', 
                  alignItems: 'baseline', 
                  padding: '4px 0', 
                  fontSize: '11px' 
                }}>
                  <span style={{ width: '85px', fontWeight: 'bold', fontFamily: "'Space Mono', monospace", flexShrink: 0 }}>
                    {item.time}
                  </span>
                  <span style={{ flex: 1, textAlign: 'center', fontWeight: 800, textTransform: 'uppercase', padding: '0 5px' }}>
                    {item.label}
                  </span>
                  <span style={{ width: '110px', textAlign: 'right', fontSize: '9px', fontStyle: 'italic', color: '#333', flexShrink: 0, lineHeight: '1.1' }}>
                    {item.desc}
                  </span>
                </div>
              ))}

              {/* CUMA SATU GARIS PUTUS-PUTUS DI BAWAH RUNDOWN */}
              <div style={{ borderBottom: '1px dashed #000', marginTop: '8px' }}></div>
            </div>

            <div className="rc-total" style={{ marginTop: '10px', paddingTop: '0', border: 'none' }}>
              <span>TOTAL PRICE:</span>
              <span>PRICELESS 💖</span>
            </div>

            <div className="rc-footer">
              <div style={{ textAlign: 'center', fontSize: '9px', color: '#444', marginTop: '10px', fontStyle: 'italic' }}>
                --- SCAN TO PLAY OUR BEAT ---
              </div>

              <div className="qr-container" style={{ textAlign: 'center', margin: '10px 0' }}>
                <img 
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(cfg.music || "spotify:playlist:3MFForBzzorHXo5wHz30Vw")}`}
                  alt="Spotify QR"
                  style={{ 
                    width: '90px', 
                    height: '90px', 
                    display: 'block',
                    margin: '0 auto',
                    border: '1px solid #000',
                    padding: '4px',
                    backgroundColor: '#fff'
                  }} 
                />
              </div>
              
              <div style={{fontSize:10, letterSpacing:2, fontWeight:'bold'}}>
                INV-CODE-{reservationDate.replace(/-/g,'')}
              </div>
              <div className="rc-note" style={{marginTop: 5}}>"Please save this receipt as a valid ticket."</div>
              
              <button 
                onClick={handleDownloadImage}
                disabled={isCapturing}
                data-html2canvas-ignore
                style={{
                  marginTop:15, 
                  width:'100%', 
                  padding:12, 
                  background: isCapturing ? '#999' : '#000', 
                  color:'#fff', 
                  border:'none', 
                  cursor:'pointer', 
                  fontSize:10, 
                  textTransform:'uppercase', 
                  fontWeight:'bold'
                }}
              >
                {isCapturing ? "PRINTING IMAGE..." : "CLICK TO SAVE AS IMAGE 📸"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}