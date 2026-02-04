import { db } from "../firebase"; // Panggil koneksi firebase lo
import { doc, setDoc } from "firebase/firestore"; // Panggil fungsi buat nulis data
import React, { useState, useEffect } from "react";
import type { ContentConfig, Place, Outfit } from "../lib/types";
import { loadConfig, saveConfig, resetConfig, clearLogs } from "../lib/storage";
import { logEvent } from "../lib/activity";

// --- HELPER FUNCTIONS ---
function randomId(prefix: string) {
  return prefix + "-" + Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

const parseSwot = (raw: string | undefined) => {
  if (!raw) return { plus: "", minus: "" };
  const lines = raw.split('\n');
  const plusLines = lines.filter(l => l.trim().startsWith('+')).map(l => l.replace(/^\+\s*/, ''));
  const minusLines = lines.filter(l => l.trim().startsWith('-')).map(l => l.replace(/^\-\s*/, ''));
  return { plus: plusLines.join('\n'), minus: minusLines.join('\n') };
};

export function Admin() {
  const [cfg, setCfg] = useState<ContentConfig>(() => loadConfig());
  const [pass, setPass] = useState("");
  const [ok, setOk] = useState(false);
  const [activeTab, setActiveTab] = useState<'general' | 'places' | 'outfits' | 'tools'>('general');
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");

  useEffect(() => {
    document.title = "Admin — Hangout Card";
  }, []);

  const verify = () => {
    const good = pass === (cfg.admin?.passcode || ""); 
    setOk(good);
    logEvent("admin_verify", { ok: good });
  };

  // --- SAVE LOGIC ---
  const handleSave = async () => {
    try {
      // 1. Tetap simpan lokal buat jaga-jaga
      saveConfig(cfg); 

      // 2. KIRIM KE FIREBASE (Ini yang bikin ONLINE!)
      // Kita simpan semua kodingan lo ke dalam satu dokumen bernama 'main-config'
      await setDoc(doc(db, "configs", "main-config"), cfg);

      setSaveStatus("saved");
      logEvent("settings_updated", { tab: activeTab });
      setTimeout(() => setSaveStatus("idle"), 2000);
      alert("Data BERHASIL dikirim ke Firebase (Online)!");
    } catch (error) {
      console.error("Error saving to Firebase:", error);
      alert("Gagal kirim ke Firebase. Cek Rules lo!");
    }
  };

  const updateConfig = async (newCfg: ContentConfig) => {
    setCfg(newCfg);
    saveConfig(newCfg); 
    
    // TAMBAHKAN INI: Biar setiap ada perubahan (hapus/tambah), langsung lapor ke Firebase
    try {
      await setDoc(doc(db, "configs", "main-config"), newCfg);
      console.log("Auto-sync Firebase Berhasil!");
    } catch (err) {
      console.error("Auto-sync gagal:", err);
    }
  };

  // --- CRUD HELPERS ---
  const updatePlace = (idx: number, field: keyof Place, val: any) => {
    const newItems = [...cfg.places.items];
    newItems[idx] = { ...newItems[idx], [field]: val };
    updateConfig({ ...cfg, places: { ...cfg.places, items: newItems } });
  };

  // 1. Fungsi Update Config (Otak utamanya)
  const updateConfig = async (newCfg: ContentConfig) => {
    setCfg(newCfg);     // Update tampilan di layar laptop
    saveConfig(newCfg); // Simpan di memori lokal laptop
    
    // LANGSUNG KIRIM KE FIREBASE (Pake newCfg, jangan cfg!)
    try {
      await setDoc(doc(db, "configs", "main-config"), newCfg);
      console.log("✅ Berhasil Sinkron ke Firebase!");
    } catch (err) {
      console.error("❌ Gagal Sinkron:", err);
    }
  };

  // 2. Fungsi Update Outfit (Khusus buat bagian Outfit)
  const updateOutfit = (idx: number, field: keyof Outfit, val: any) => {
    const currentOutfits = cfg.outfits?.items || [];
    const newItems = [...currentOutfits];
    newItems[idx] = { ...newItems[idx], [field]: val };
    
    const newConfigData = { 
      ...cfg, 
      outfits: { 
        ...(cfg.outfits || { headline: "Choose Outfit", subtitle: "Pick your style" }), 
        items: newItems 
      } 
    };

    // WAJIB PANGGIL INI BIAR FIREBASE NYALA!
    updateConfig(newConfigData); 
  };

  // --- FITUR BARU: COLOR PALETTE ---
  const addColorToPalette = (idx: number, color: string) => {
    const items = [...(cfg.outfits?.items || [])];
    const currentPalette = items[idx].palette || [];
    
    // Limit 5 warna biar ga penuh
    if(currentPalette.length >= 5) {
      alert("Maksimal 5 warna bro!");
      return;
    }
    
    items[idx].palette = [...currentPalette, color];
    updateConfig({ 
      ...cfg, 
      outfits: { ...(cfg.outfits || { headline: "", subtitle: "" }), items } 
    });
  };

  const removeColorFromPalette = (oIdx: number, cIdx: number) => {
    const items = [...(cfg.outfits?.items || [])];
    const newPalette = [...(items[oIdx].palette || [])];
    newPalette.splice(cIdx, 1);
    items[oIdx].palette = newPalette;
    updateConfig({ 
      ...cfg, 
      outfits: { ...(cfg.outfits || { headline: "", subtitle: "" }), items } 
    });
  };

  const updateSwot = (idx: number, type: 'plus' | 'minus', val: string) => {
    const current = parseSwot(cfg.places.items[idx].swot);
    const newPlus = type === 'plus' ? val : current.plus;
    const newMinus = type === 'minus' ? val : current.minus;
    
    const plusFormatted = newPlus.split('\n').filter(l => l.trim()).map(l => `+ ${l}`).join('\n');
    const minusFormatted = newMinus.split('\n').filter(l => l.trim()).map(l => `- ${l}`).join('\n');
    
    const combined = `${plusFormatted}\n${minusFormatted}`.trim();
    updatePlace(idx, 'swot', combined);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, callback: (base64: string) => void) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) alert("⚠️ File terlalu besar! Disarankan < 2MB.");

    const reader = new FileReader();
    reader.onloadend = () => callback(reader.result as string);
    reader.readAsDataURL(file);
  };

  const toggleTag = (idx: number, tag: string) => {
    const newItems = [...cfg.places.items];
    const currentTags = newItems[idx].tags || [];
    if (currentTags.includes(tag)) {
      newItems[idx].tags = currentTags.filter(t => t !== tag);
    } else {
      const cleanedTags = currentTags.filter(t => !['dinner', 'snack', 'dessert'].includes(t));
      newItems[idx].tags = [...cleanedTags, tag];
    }
    updateConfig({ ...cfg, places: { ...cfg.places, items: newItems } });
  };

  const addPlace = () => {
    const newItem: Place = {
      id: randomId("place"), name: "New Place", description: "", image: "", locationUrl: "", tags: ["dinner"], budget: "", openHours: "", swot: ""
    };
    updateConfig({ ...cfg, places: { ...cfg.places, items: [newItem, ...cfg.places.items] } });
  };

  const addOutfit = () => {
    const newItem: Outfit = {
      id: randomId("outfit"), name: "New Style", description: "", image: "", style: "casual", palette: []
    };
    const currentOutfits = cfg.outfits?.items || [];
    updateConfig({ 
      ...cfg, 
      outfits: { ...(cfg.outfits || { headline: "Outfit", subtitle: "Style" }), items: [newItem, ...currentOutfits] } 
    });
  };

  const removeItem = (type: 'place' | 'outfit', idx: number) => {
    if(!confirm("Yakin hapus item ini?")) return;
    if (type === 'place') {
      const newItems = [...cfg.places.items];
      newItems.splice(idx, 1);
      updateConfig({ ...cfg, places: { ...cfg.places, items: newItems } });
    } else {
      const newItems = [...(cfg.outfits?.items || [])];
      newItems.splice(idx, 1);
      updateConfig({ ...cfg, outfits: { ...cfg.outfits!, items: newItems } });
    }
  };

  if (!ok) {
    return (
      <div style={{ minHeight: "100vh", background: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center", color: "white" }}>
        <div style={{ background: "#1e293b", padding: 30, borderRadius: 12, border: "1px solid #334155", width: 300 }}>
          <h2 style={{ marginTop: 0 }}>🔒 Admin Access</h2>
          <input type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder="Enter Passcode" style={{ width: "100%", padding: 10, borderRadius: 6, border: "1px solid #475569", background: "#0f172a", color: "white", marginBottom: 15 }} />
          <button onClick={verify} style={{ width: "100%", padding: 10, background: "#3b82f6", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: "bold" }}>Login</button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-layout">
      <style>{`
        /* LAYOUT & GLOBAL */
        .admin-layout { display: flex; min-height: 100vh; background: #0f172a; color: #cbd5e1; font-family: 'Inter', sans-serif; }
        .sidebar { width: 240px; background: #1e293b; border-right: 1px solid #334155; padding: 20px; flex-shrink: 0; display: flex; flex-direction: column; position: fixed; height: 100vh; }
        .main-content { flex: 1; margin-left: 240px; padding: 40px; max-width: 1000px; }
        
        h1, h2, h3 { color: white; margin-top: 0; }
        .section-title { font-size: 24px; font-weight: 800; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 1px solid #334155; }
        .label { display: block; font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.5px; }
        
        .nav-btn {
          display: flex; alignItems: center; gap: 10px; width: 100%; text-align: left;
          padding: 12px 16px; border-radius: 8px; border: none; background: transparent;
          color: #94a3b8; cursor: pointer; font-weight: 600; font-size: 14px; transition: 0.2s; margin-bottom: 5px;
        }
        .nav-btn:hover { background: rgba(255,255,255,0.05); color: white; }
        .nav-btn.active { background: #3b82f6; color: white; shadow: 0 4px 12px rgba(59, 130, 246, 0.4); }

        .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 24px; margin-bottom: 20px; position: relative; }
        .input, .textarea { width: 100%; background: #020617; border: 1px solid #475569; color: white; padding: 10px; border-radius: 6px; font-size: 14px; font-family: inherit; transition: 0.2s; }
        .input:focus, .textarea:focus { outline: none; border-color: #a78bfa; }
        .textarea { min-height: 80px; resize: vertical; }

        .btn { padding: 10px 20px; border-radius: 6px; font-weight: 600; border: none; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; font-size: 14px; transition: 0.2s; }
        .btn:hover { filter: brightness(1.1); }
        .btn-primary { background: #3b82f6; color: white; }
        .btn-success { background: #10b981; color: white; }
        .btn-danger { background: #ef4444; color: white; }
        .btn-outline { background: transparent; border: 1px solid #475569; color: #cbd5e1; }
        .btn-outline:hover { border-color: white; color: white; }
        
        .save-btn {
          position: fixed; top: 20px; right: 20px; z-index: 100;
          background: #10b981; color: white; padding: 12px 24px; border-radius: 50px;
          font-weight: 700; box-shadow: 0 10px 20px rgba(0,0,0,0.3); border: none; cursor: pointer; transition: 0.3s;
        }
        .save-btn.saved { background: #059669; transform: scale(0.95); }

        .tag-row { display: flex; gap: 8px; flex-wrap: wrap; }
        .tag-chip { padding: 6px 12px; border-radius: 20px; border: 1px solid #475569; background: transparent; color: #94a3b8; cursor: pointer; font-size: 12px; font-weight: 600; }
        .tag-chip.active { background: #8b5cf6; color: white; border-color: #8b5cf6; }

        .preview-box { width: 80px; height: 80px; border-radius: 8px; background: #020617; border: 1px dashed #475569; display: flex; align-items: center; justify-content: center; overflow: hidden; }
        .preview-img { width: 100%; height: 100%; object-fit: cover; }
        .file-label { cursor: pointer; color: #3b82f6; font-size: 12px; font-weight: 600; display: inline-block; margin-top: 5px; }

        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }

        /* --- STYLES BARU BUAT COLOR PICKER --- */
        .palette-container { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
        .palette-item { width: 28px; height: 28px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.2); cursor: pointer; transition: transform 0.2s; position: relative; }
        .palette-item:hover { transform: scale(1.1); border-color: white; }
        .palette-item:hover::after { content: '×'; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 16px; color: rgba(0,0,0,0.5); font-weight: bold; }
        .color-picker-input { width: 32px; height: 32px; padding: 0; border: none; background: transparent; cursor: pointer; }
      `}</style>

      <button className={`save-btn ${saveStatus === 'saved' ? 'saved' : ''}`} onClick={handleSave}>
        {saveStatus === 'saved' ? "✅ All Saved!" : "💾 SAVE CHANGES"}
      </button>

      <div className="sidebar">
        <h3 style={{ paddingBottom: 20, borderBottom: '1px solid #334155', marginBottom: 20 }}>
          ⚡ Admin Panel
        </h3>
        <button className={`nav-btn ${activeTab === 'general' ? 'active' : ''}`} onClick={() => setActiveTab('general')}>🏠 General</button>
        <button className={`nav-btn ${activeTab === 'places' ? 'active' : ''}`} onClick={() => setActiveTab('places')}>📍 Places Manager</button>
        <button className={`nav-btn ${activeTab === 'outfits' ? 'active' : ''}`} onClick={() => setActiveTab('outfits')}>👗 Outfit Manager</button>
        <button className={`nav-btn ${activeTab === 'tools' ? 'active' : ''}`} onClick={() => setActiveTab('tools')}>🔧 Tools</button>
      </div>

      <div className="main-content">
        
        {activeTab === 'general' && (
          <div>
            <div className="section-title">General Settings</div>
            <div className="card">
              <label className="label">Background Music (MP3 URL)</label>
              <input className="input" value={cfg.music || ""} onChange={e => updateConfig({...cfg, music: e.target.value})} placeholder="/audio/song.mp3" />
            </div>
            <div className="card">
              <label className="label">Isi Surat (Letter)</label>
              <textarea className="textarea" style={{ height: 200 }} value={cfg.letter?.text || ""} onChange={e => updateConfig({...cfg, letter: { ...cfg.letter, text: e.target.value }})} />
            </div>
          </div>
        )}

        {activeTab === 'places' && (
          <div>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20}}>
              <div className="section-title" style={{marginBottom:0, border:0}}>Places Manager</div>
              <button className="btn btn-success" onClick={addPlace}>+ Add Place</button>
            </div>
            {cfg.places.items.map((p, idx) => {
              const swot = parseSwot(p.swot);
              return (
                <div key={p.id} className="card">
                  <div className="grid-2" style={{ marginBottom: 20 }}>
                    <div><label className="label">Nama Tempat</label><input className="input" value={p.name} onChange={e => updatePlace(idx, "name", e.target.value)} /></div>
                    <div>
                      <label className="label">Kategori</label>
                      <div className="tag-row">
                        {['dinner', 'snack', 'dessert'].map(tag => (
                          <button key={tag} className={`tag-chip ${p.tags.includes(tag) ? 'active' : ''}`} onClick={() => toggleTag(idx, tag)}>{tag}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 20, marginBottom: 20, background: '#0f172a', padding: 15, borderRadius: 8 }}>
                    <div className="preview-box">{p.image ? <img src={p.image} className="preview-img" alt="preview" /> : <span style={{fontSize:10}}>No Img</span>}</div>
                    <div style={{ flex: 1 }}>
                      <label className="label">Foto Tempat</label>
                      <input className="input" value={p.image} onChange={e => updatePlace(idx, "image", e.target.value)} placeholder="Paste URL atau Upload..." />
                      <label className="file-label">📤 Upload dari Galeri<input type="file" accept="image/*" style={{display:'none'}} onChange={e => handleImageUpload(e, (b64) => updatePlace(idx, "image", b64))} /></label>
                    </div>
                  </div>
                  <div style={{ marginBottom: 20 }}><label className="label">Deskripsi</label><textarea className="textarea" value={p.description} onChange={e => updatePlace(idx, "description", e.target.value)} /></div>
                  <div className="grid-2" style={{ marginBottom: 20 }}>
                    <div><label className="label">Budget</label><input className="input" value={p.budget || ""} onChange={e => updatePlace(idx, "budget", e.target.value)} placeholder="50k - 100k" /></div>
                    <div><label className="label">Jam Buka</label><input className="input" value={p.openHours || ""} onChange={e => updatePlace(idx, "openHours", e.target.value)} placeholder="10:00 - 22:00" /></div>
                  </div>
                  <div className="grid-2" style={{ marginBottom: 20 }}>
                    <div><label className="label" style={{color:'#34d399'}}>✅ Kelebihan (Plus)</label><textarea className="textarea" style={{borderColor:'rgba(52, 211, 153, 0.3)', background:'rgba(52, 211, 153, 0.05)'}} value={swot.plus} onChange={e => updateSwot(idx, 'plus', e.target.value)} placeholder="Tulis poin plus..." /></div>
                    <div><label className="label" style={{color:'#f87171'}}>⚠️ Kekurangan (Minus)</label><textarea className="textarea" style={{borderColor:'rgba(248, 113, 113, 0.3)', background:'rgba(248, 113, 113, 0.05)'}} value={swot.minus} onChange={e => updateSwot(idx, 'minus', e.target.value)} placeholder="Tulis poin minus..." /></div>
                  </div>
                  <div style={{ display: 'flex', gap: 15, paddingTop: 15, borderTop: '1px solid #334155' }}>
                    <div style={{flex:1}}><input className="input" value={p.locationUrl} onChange={e => updatePlace(idx, "locationUrl", e.target.value)} placeholder="Link Google Maps" /></div>
                    <button className="btn btn-danger" onClick={() => removeItem('place', idx)}>Delete</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* --- INI TAB OUTFIT YANG GW TAMBAHIN --- */}
        {activeTab === 'outfits' && (
          <div>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20}}>
              <div className="section-title" style={{marginBottom:0, border:0}}>Outfit Manager</div>
              <button className="btn btn-success" onClick={addOutfit}>+ Add Outfit</button>
            </div>

            {(cfg.outfits?.items || []).map((o, idx) => (
              <div key={o.id} className="card">
                <div className="grid-2" style={{ marginBottom: 20 }}>
                  <div><label className="label">Nama Style</label><input className="input" value={o.name} onChange={e => updateOutfit(idx, "name", e.target.value)} placeholder="Casual Date" /></div>
                  <div>
                     <label className="label">Kategori</label>
                     <select className="input" value={o.style || 'casual'} onChange={e => updateOutfit(idx, "style", e.target.value)}>
                       <option value="casual">Casual</option><option value="formal">Formal</option><option value="sporty">Sporty</option><option value="vintage">Vintage</option>
                     </select>
                  </div>
                </div>
                
                {/* --- BAGIAN WARNA (PALETTE) --- */}
                <div style={{marginBottom: 20, padding: 15, background: '#020617', borderRadius: 8, border: '1px solid #334155'}}>
                   <label className="label" style={{marginBottom:8}}>🎨 Color Palette (Klik untuk tambah/hapus)</label>
                   <div className="palette-container">
                      {(o.palette || []).map((color, cIdx) => (
                        <div 
                          key={cIdx} 
                          className="palette-item" 
                          style={{ background: color }} 
                          onClick={() => removeColorFromPalette(idx, cIdx)} 
                          title="Klik untuk hapus"
                        />
                      ))}
                      {(o.palette || []).length < 5 && (
                        <div style={{display:'flex', alignItems:'center', gap:5}}>
                          <input type="color" className="color-picker-input" onChange={(e) => addColorToPalette(idx, e.target.value)} />
                          <span style={{fontSize:10, color:'#64748b'}}>+ Add Color</span>
                        </div>
                      )}
                   </div>
                </div>

                <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
                  <div className="preview-box" style={{ width: 100, height: 120 }}>{o.image ? <img src={o.image} className="preview-img" alt="preview" /> : <span style={{fontSize:10}}>No Img</span>}</div>
                  <div style={{ flex: 1 }}>
                     <label className="label">Foto Outfit</label>
                     <input className="input" value={o.image} onChange={e => updateOutfit(idx, "image", e.target.value)} placeholder="URL..." />
                     <label className="file-label">📤 Upload Foto Outfit<input type="file" accept="image/*" style={{display:'none'}} onChange={e => handleImageUpload(e, (b64) => updateOutfit(idx, "image", b64))} /></label>
                  </div>
                </div>
                
                {/* Deskripsi (Format Cewek | Cowok) */}
                <div style={{marginBottom: 10}}>
                   <label className="label">Deskripsi (Pisahkan dengan garis tegak | )</label>
                   <input className="input" value={o.description} onChange={e => updateOutfit(idx, "description", e.target.value)} placeholder="Contoh: Dress Putih | Kemeja Cream" />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 15, borderTop: '1px solid #334155' }}>
                   <button className="btn btn-danger" onClick={() => removeItem('outfit', idx)}>Delete Outfit</button>
                </div>
              </div>
            ))}
            {(cfg.outfits?.items || []).length === 0 && <div style={{textAlign:'center', color:'#64748b', padding:40}}>Belum ada outfit. Klik tombol Add di atas.</div>}
          </div>
        )}

        {activeTab === 'tools' && (
          <div>
            <div className="section-title">System Tools</div>
            <div className="card">
              <h3 style={{fontSize:16}}>Backup & Restore</h3>
              <p style={{color:'#94a3b8', fontSize:14}}>Download data config sebagai file JSON untuk backup, atau reset ulang jika terjadi error.</p>
              <div style={{ display: 'flex', gap: 15, marginTop: 20 }}>
                <button className="btn btn-primary" onClick={() => {
                   const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(cfg));
                   const downloadAnchorNode = document.createElement('a');
                   downloadAnchorNode.setAttribute("href", dataStr);
                   downloadAnchorNode.setAttribute("download", "backup_config.json");
                   document.body.appendChild(downloadAnchorNode);
                   downloadAnchorNode.click();
                   downloadAnchorNode.remove();
                }}>Download Backup JSON</button>
                <button className="btn btn-danger" onClick={() => { if(confirm("Yakin reset semua data ke awal?")) { resetConfig(); setCfg(loadConfig()); } }}>Factory Reset</button>
                <button className="btn btn-outline" onClick={() => { clearLogs(); alert("Logs cleared"); }}>Clear Logs</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}