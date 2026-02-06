import { db } from "../firebase"; 
import { doc, setDoc } from "firebase/firestore"; 
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
  const [activeTab, setActiveTab] = useState<'general' | 'places' | 'outfits' | 'tools' | 'gallery'>('general');
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");
  const [userPhotos, setUserPhotos] = useState<any[]>([]);

  useEffect(() => {
    document.title = "Admin — Hangout Card";
  }, []);

  const verify = () => {
    const good = pass === (cfg.admin?.passcode || ""); 
    setOk(good);
    logEvent("admin_verify", { ok: good });
  };

  // --- LOGIKA PENYIMPANAN ---
  // GANTI: Supaya update state lebih reaktif
  const updateConfig = (newCfg: ContentConfig) => {
    setCfg(prev => {
      const updated = { ...prev, ...newCfg };
      saveConfig(updated); // Simpan ke local storage
      return updated;
    });
  };

  const handleSave = async () => {
    try {
      const docRef = doc(db, "configs", "main_config"); // Pake underscore (_) biar sama kayak storage.ts
      
      // 1. Ambil data terbaru dari state admin
      const dataToSave = { ...cfg };

      // 2. Kirim ke Firebase (Cloud)
      await setDoc(docRef, dataToSave);
      
      // 3. PAKSA simpan ke LocalStorage Laptop lo juga (biar gak bentrok)
      saveConfig(dataToSave); 
      localStorage.setItem("hangout_card_config_v1", JSON.stringify(dataToSave));

      // 4. Kasih tau browser kalau ada perubahan data (untuk tab user di laptop)
      window.dispatchEvent(new Event("storage"));

      alert("✅ Publish Berhasil! Coba cek HP, harusnya udah berubah.");
      
      // Log aktivitas biar lo tau ini jalan
      logEvent("admin_save_success", { time: new Date().getTime() });
      
    } catch (e) {
      console.error("Error pas mau save:", e);
      alert("Waduh, gagal connect ke Firebase. Cek internet bro!");
    }
  };

  // --- LOGIKA REAL-TIME GALLERY ---
  useEffect(() => {
    let unsubscribe: any;

    const startListener = async () => {
      if (activeTab !== 'gallery') return;
      
      // Import onSnapshot biar real-time
      const { collection, query, orderBy, onSnapshot } = await import("firebase/firestore");
      const q = query(collection(db, "secret_photos"), orderBy("createdAt", "desc"));

      unsubscribe = onSnapshot(q, (snapshot) => {
        const photos = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setUserPhotos(photos);
      });
    };

    startListener();
    return () => { if (unsubscribe) unsubscribe(); };
  }, [activeTab]);

  // --- CRUD HELPERS ---
  const updatePlace = (idx: number, field: keyof Place, val: any) => {
    const newItems = [...cfg.places.items];
    newItems[idx] = { ...newItems[idx], [field]: val };
    updateConfig({ ...cfg, places: { ...cfg.places, items: newItems } });
  };

  const updateOutfit = (idx: number, field: keyof Outfit, val: any) => {
    const currentItems = cfg.outfits?.items || [];
    const newItems = [...currentItems];
    newItems[idx] = { ...newItems[idx], [field]: val };
    const newConfigData = { 
      ...cfg, 
      outfits: { ...(cfg.outfits || { headline: "Choose Outfit", subtitle: "Pick your style" }), items: newItems } 
    };
    updateConfig(newConfigData); 
  };

  const addColorToPalette = (idx: number, color: string) => {
    const items = [...(cfg.outfits?.items || [])];
    const currentPalette = items[idx].palette || [];
    if(currentPalette.length >= 5) { alert("Maksimal 5 warna!"); return; }
    items[idx].palette = [...currentPalette, color];
    updateConfig({ ...cfg, outfits: { ...(cfg.outfits || { headline: "", subtitle: "" }), items } });
  };

  const removeColorFromPalette = (oIdx: number, cIdx: number) => {
    const items = [...(cfg.outfits?.items || [])];
    const newPalette = [...(items[oIdx].palette || [])];
    newPalette.splice(cIdx, 1);
    items[oIdx].palette = newPalette;
    updateConfig({ ...cfg, outfits: { ...(cfg.outfits || { headline: "", subtitle: "" }), items } });
  };

  const updateSwot = (idx: number, type: 'plus' | 'minus', val: string) => {
    const current = parseSwot(cfg.places.items[idx].swot);
    const newPlus = type === 'plus' ? val : current.plus;
    const newMinus = type === 'minus' ? val : current.minus;
    const combined = `${newPlus.split('\n').filter(l=>l.trim()).map(l=>`+ ${l}`).join('\n')}\n${newMinus.split('\n').filter(l=>l.trim()).map(l=>`- ${l}`).join('\n')}`.trim();
    updatePlace(idx, 'swot', combined);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, callback: (base64: string) => void) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const MAX_SIZE = 1200; 
        if (width > height) {
          if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; }
        } else {
          if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx?.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7); // 0.7 biar file size lebih aman buat Firebase
        callback(dataUrl);
      };
      img.src = event.target?.result as string;
    };
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
    const newItem: Place = { id: randomId("place"), name: "New Place", description: "", image: "", locationUrl: "", tags: ["dinner"], budget: "", openHours: "", swot: "" };
    updateConfig({ ...cfg, places: { ...cfg.places, items: [newItem, ...cfg.places.items] } });
  };

  const addOutfit = () => {
    const newItem: Outfit = { id: randomId("outfit"), name: "New Style", description: "", image: "", style: "casual", palette: [] };
    updateConfig({ ...cfg, outfits: { ...(cfg.outfits || { headline: "Outfit", subtitle: "Style" }), items: [newItem, ...(cfg.outfits?.items || [])] } });
  };

  const addRundownItem = () => {
    const currentRundown = cfg.rundown || [];
    const newItem = { time: "00:00", label: "BARU", desc: "", type: "static" };
    updateConfig({ ...cfg, rundown: [...currentRundown, newItem] });
  };

  const removeRundownItem = (idx: number) => {
    if(!confirm("Hapus jadwal ini?")) return;
    const newRd = [...(cfg.rundown || [])];
    newRd.splice(idx, 1);
    updateConfig({ ...cfg, rundown: newRd });
  };

  const removeItem = (type: 'place' | 'outfit', idx: number) => {
    if(!confirm("Yakin hapus?")) return;
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
          <input type="password" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && verify()} placeholder="Enter Passcode" style={{ width: "100%", padding: 10, borderRadius: 6, border: "1px solid #475569", background: "#0f172a", color: "white", marginBottom: 15 }} />
          <button onClick={verify} style={{ width: "100%", padding: 10, background: "#3b82f6", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: "bold" }}>Login</button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-layout">
      <style>{`
        .admin-layout { display: flex; min-height: 100vh; background: #0f172a; color: #cbd5e1; font-family: 'Inter', sans-serif; }
        .sidebar { width: 240px; background: #1e293b; border-right: 1px solid #334155; padding: 20px; flex-shrink: 0; display: flex; flex-direction: column; position: fixed; height: 100vh; }
        .main-content { flex: 1; margin-left: 240px; padding: 40px; max-width: 1000px; }
        h1, h2, h3 { color: white; margin-top: 0; }
        .section-title { font-size: 24px; font-weight: 800; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 1px solid #334155; }
        .label { display: block; font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.5px; }
        .nav-btn { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 12px 16px; border-radius: 8px; border: none; background: transparent; color: #94a3b8; cursor: pointer; font-weight: 600; font-size: 14px; transition: 0.2s; margin-bottom: 5px; }
        .nav-btn:hover { background: rgba(255,255,255,0.05); color: white; }
        .nav-btn.active { background: #3b82f6; color: white; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4); }
        .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 24px; margin-bottom: 20px; position: relative; }
        .input, .textarea { width: 100%; background: #020617; border: 1px solid #475569; color: white; padding: 10px; border-radius: 6px; font-size: 14px; font-family: inherit; transition: 0.2s; }
        .input:focus, .textarea:focus { outline: none; border-color: #a78bfa; }
        .textarea { min-height: 80px; resize: vertical; }
        .btn { padding: 10px 20px; border-radius: 6px; font-weight: 600; border: none; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; font-size: 14px; transition: 0.2s; }
        .btn-primary { background: #3b82f6; color: white; }
        .btn-success { background: #10b981; color: white; }
        .btn-danger { background: #ef4444; color: white; }
        .save-btn { position: fixed; top: 20px; right: 20px; z-index: 100; background: #10b981; color: white; padding: 12px 24px; border-radius: 50px; font-weight: 700; box-shadow: 0 10px 20px rgba(0,0,0,0.3); border: none; cursor: pointer; transition: 0.3s; }
        .save-btn:hover { transform: scale(1.05); }
        .tag-row { display: flex; gap: 8px; flex-wrap: wrap; }
        .tag-chip { padding: 6px 12px; border-radius: 20px; border: 1px solid #475569; background: transparent; color: #94a3b8; cursor: pointer; font-size: 12px; font-weight: 600; }
        .tag-chip.active { background: #8b5cf6; color: white; border-color: #8b5cf6; }
        .preview-box { width: 80px; height: 80px; border-radius: 8px; background: #020617; border: 1px dashed #475569; display: flex; align-items: center; justify-content: center; overflow: hidden; }
        .preview-img { width: 100%; height: 100%; object-fit: cover; }
        .file-label { cursor: pointer; color: #3b82f6; font-size: 12px; font-weight: 600; display: inline-block; margin-top: 5px; }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .palette-container { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
        .palette-item { width: 28px; height: 28px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.2); cursor: pointer; transition: transform 0.2s; position: relative; }
        .palette-item:hover { transform: scale(1.1); }
        .palette-item:hover::after { content: '×'; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 16px; color: rgba(255,255,255,0.8); font-weight: bold; }
        .color-picker-input { width: 32px; height: 32px; padding: 0; border: none; background: transparent; cursor: pointer; }
      `}</style>

      <button className="save-btn" onClick={handleSave}>
        {saveStatus === 'saved' ? "✅ ALL PUBLISHED!" : "💾 PUBLISH CHANGES"}
      </button>

      <div className="sidebar">
        <h3 style={{ paddingBottom: 20, borderBottom: '1px solid #334155', marginBottom: 20 }}>⚡ Admin Panel</h3>
        <button className={`nav-btn ${activeTab === 'general' ? 'active' : ''}`} onClick={() => setActiveTab('general')}>🏠 General</button>
        <button className={`nav-btn ${activeTab === 'places' ? 'active' : ''}`} onClick={() => setActiveTab('places')}>📍 Places Manager</button>
        <button className={`nav-btn ${activeTab === 'outfits' ? 'active' : ''}`} onClick={() => setActiveTab('outfits')}>👗 Outfit Manager</button>
        <button className={`nav-btn ${activeTab === 'tools' ? 'active' : ''}`} onClick={() => setActiveTab('tools')}>🔧 Tools</button>
        <button className={`nav-btn ${activeTab === 'gallery' ? 'active' : ''}`} onClick={() => setActiveTab('gallery')}>📸 User Gallery</button>
      </div>

      <div className="main-content">
        {activeTab === 'general' && (
          <div>
            <div className="section-title">General Settings</div>
            
            {/* 1. MUSIC & LETTER */}
            <div className="card">
              <label className="label">Background Music (MP3 URL)</label>
              <input className="input" value={cfg.music || ""} onChange={e => updateConfig({...cfg, music: e.target.value})} placeholder="/audio/song.mp3" />
            </div>
            
            <div className="card">
              <label className="label">Isi Surat (Letter)</label>
              <textarea className="textarea" style={{ height: 200 }} value={cfg.letter?.text || ""} onChange={e => updateConfig({...cfg, letter: { ...cfg.letter, text: e.target.value }})} />
            </div>

            {/* 2. RUNDOWN MANAGER */}
            <div className="card">
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20}}>
                <h3 style={{fontSize:16, margin:0}}>Edit Rundown Acara</h3>
                <button 
                  className="btn btn-success" 
                  style={{padding:'5px 12px', fontSize:12}}
                  onClick={() => {
                    const currentRd = cfg.rundown || [];
                    const newItem = { time: "16:30", label: "BARU", desc: "Deskripsi...", type: "static" };
                    updateConfig({...cfg, rundown: [...currentRd, newItem]});
                  }}
                >
                  + Tambah Jadwal
                </button>
              </div>

              {(cfg.rundown || []).length === 0 && (
                <div style={{textAlign:'center', padding:'20px', border:'1px dashed #334155', borderRadius:8, color:'#64748b', fontSize:13}}>
                  Belum ada rundown. Klik tombol tambah di atas.
                </div>
              )}

              {(cfg.rundown || []).map((rd, idx) => (
                <div key={idx} style={{display:'flex', gap:10, marginBottom:10, background:'#0f172a', padding:10, borderRadius:8, alignItems:'center'}}>
                  <input className="input" style={{flex:1}} value={rd.time} onChange={(e) => {
                    const newRd = [...cfg.rundown!];
                    newRd[idx].time = e.target.value;
                    updateConfig({...cfg, rundown: newRd});
                  }} placeholder="Jam" />
                  
                  <input className="input" style={{flex:1}} value={rd.label} onChange={(e) => {
                    const newRd = [...cfg.rundown!];
                    newRd[idx].label = e.target.value;
                    updateConfig({...cfg, rundown: newRd});
                  }} placeholder="Label" />
                  
                  <input className="input" style={{flex:2}} value={rd.desc} onChange={(e) => {
                    const newRd = [...cfg.rundown!];
                    newRd[idx].desc = e.target.value;
                    updateConfig({...cfg, rundown: newRd});
                  }} placeholder="Deskripsi" />
                  
                  <select className="input" style={{flex:1.2}} value={rd.type} onChange={(e) => {
                    const newRd = [...cfg.rundown!];
                    newRd[idx].type = e.target.value as any;
                    updateConfig({...cfg, rundown: newRd});
                  }}>
                    <option value="static">Static (Teks)</option>
                    <option value="dinner">Dinner (Pilihan User)</option>
                    <option value="snack">Snack (Pilihan User)</option>
                    <option value="dessert">Dessert (Pilihan User)</option>
                  </select>

                  <button 
                    onClick={() => {
                      if(confirm("Hapus baris ini?")) {
                        const newRd = [...cfg.rundown!];
                        newRd.splice(idx, 1);
                        updateConfig({...cfg, rundown: newRd});
                      }
                    }}
                    style={{background:'none', border:'none', color:'#ef4444', cursor:'pointer', fontSize:18, fontWeight:'bold', padding:'0 5px'}}
                  >
                    ×
                  </button>
                </div>
              ))}
              
              <p style={{fontSize:11, color:'#64748b', marginTop:15}}>
                * <b>Static:</b> Teks deskripsi bebas. <br/>
                * <b>Pilihan User:</b> Otomatis nampilin nama tempat yang dipilih Keysia nanti.
              </p>
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
                      <input className="input" value={p.image} onChange={e => updatePlace(idx, "image", e.target.value)} placeholder="URL..." />
                      <label className="file-label">📤 Upload Galeri<input type="file" accept="image/*" style={{display:'none'}} onChange={e => handleImageUpload(e, (b64) => updatePlace(idx, "image", b64))} /></label>
                    </div>
                  </div>
                  <div style={{ marginBottom: 20 }}><label className="label">Deskripsi</label><textarea className="textarea" value={p.description} onChange={e => updatePlace(idx, "description", e.target.value)} /></div>
                  <div className="grid-2" style={{ marginBottom: 20 }}>
                    <div><label className="label">Budget</label><input className="input" value={p.budget || ""} onChange={e => updatePlace(idx, "budget", e.target.value)} /></div>
                    <div><label className="label">Jam Buka</label><input className="input" value={p.openHours || ""} onChange={e => updatePlace(idx, "openHours", e.target.value)} /></div>
                  </div>
                  <div className="grid-2" style={{ marginBottom: 20 }}>
                    <div><label className="label" style={{color:'#34d399'}}>✅ Kelebihan</label><textarea className="textarea" value={swot.plus} onChange={e => updateSwot(idx, 'plus', e.target.value)} /></div>
                    <div><label className="label" style={{color:'#f87171'}}>⚠️ Kekurangan</label><textarea className="textarea" value={swot.minus} onChange={e => updateSwot(idx, 'minus', e.target.value)} /></div>
                  </div>
                  <div style={{ display: 'flex', gap: 15, paddingTop: 15, borderTop: '1px solid #334155' }}>
                    <div style={{flex:1}}><input className="input" value={p.locationUrl} onChange={e => updatePlace(idx, "locationUrl", e.target.value)} placeholder="Link Maps" /></div>
                    <button className="btn btn-danger" onClick={() => removeItem('place', idx)}>Delete</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'outfits' && (
          <div>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20}}>
              <div className="section-title" style={{marginBottom:0, border:0}}>Outfit Manager</div>
              <button className="btn btn-success" onClick={addOutfit}>+ Add Outfit</button>
            </div>
            {(cfg.outfits?.items || []).map((o, idx) => (
              <div key={o.id} className="card">
                <div className="grid-2" style={{ marginBottom: 20 }}>
                  <div><label className="label">Nama Style</label><input className="input" value={o.name} onChange={e => updateOutfit(idx, "name", e.target.value)} /></div>
                  <div><label className="label">Kategori</label>
                    <select className="input" value={o.style || 'casual'} onChange={e => updateOutfit(idx, "style", e.target.value)}>
                      <option value="casual">Casual</option><option value="formal">Formal</option><option value="sporty">Sporty</option><option value="vintage">Vintage</option>
                    </select>
                  </div>
                </div>
                <div style={{marginBottom: 20, padding: 15, background: '#020617', borderRadius: 8}}>
                   <label className="label">🎨 Palette</label>
                   <div className="palette-container">
                     {(o.palette || []).map((color, cIdx) => (
                       <div key={cIdx} className="palette-item" style={{ background: color }} onClick={() => removeColorFromPalette(idx, cIdx)} />
                     ))}
                     {(o.palette || []).length < 5 && <input type="color" className="color-picker-input" onChange={(e) => addColorToPalette(idx, e.target.value)} />}
                   </div>
                </div>
                <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
                  <div className="preview-box" style={{ width: 100, height: 120 }}>{o.image ? <img src={o.image} className="preview-img" alt="preview" /> : <span style={{fontSize:10}}>No Img</span>}</div>
                  <div style={{ flex: 1 }}>
                    <label className="label">Foto Outfit</label>
                    <input className="input" value={o.image} onChange={e => updateOutfit(idx, "image", e.target.value)} />
                    <label className="file-label">📤 Upload Foto<input type="file" accept="image/*" style={{display:'none'}} onChange={e => handleImageUpload(e, (b64) => updateOutfit(idx, "image", b64))} /></label>
                  </div>
                </div>
                <label className="label">Deskripsi (Cewek | Cowok)</label>
                <input className="input" value={o.description} onChange={e => updateOutfit(idx, "description", e.target.value)} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 15, marginTop: 15, borderTop: '1px solid #334155' }}>
                   <button className="btn btn-danger" onClick={() => removeItem('outfit', idx)}>Delete Outfit</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'tools' && (
          <div className="card">
            <h3 style={{fontSize:16}}>Backup & Restore</h3>
            <div style={{ display: 'flex', gap: 15, marginTop: 20 }}>
              <button className="btn btn-primary" onClick={() => {
                   const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(cfg));
                   const downloadAnchorNode = document.createElement('a');
                   downloadAnchorNode.setAttribute("href", dataStr);
                   downloadAnchorNode.setAttribute("download", "backup-hangout.json");
                   downloadAnchorNode.click();
              }}>Download Backup</button>
              <button className="btn btn-danger" onClick={() => { if(confirm("Reset data ke awal? Semua perubahan lo bakal hilang.")) { resetConfig(); window.location.reload(); } }}>Factory Reset</button>
            </div>
          </div>
        )}

        {activeTab === 'gallery' && (
          <div>
            <div className="section-title">Hasil Foto Photobox</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '20px' }}>
              {userPhotos.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                  📸 Belum ada foto yang masuk dari Keysia.
                </div>
              ) : (
                userPhotos.map((photo) => (
                  <div key={photo.id} className="card" style={{ padding: '10px' }}>
                    <img 
                      src={photo.url} 
                      style={{ width: '100%', borderRadius: '8px', marginBottom: '10px', border: '1px solid #334155' }} 
                      alt="User Capture" 
                    />
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                      📅 {new Date(photo.createdAt).toLocaleString('id-ID')}
                    </div>
                    <a 
                      href={photo.url} 
                      target="_blank" 
                      rel="noreferrer" 
                      style={{ color: '#3b82f6', fontSize: '12px', textDecoration: 'none', display: 'block', marginTop: '8px', fontWeight: 'bold' }}
                    >
                      Buka Full Image ↗
                    </a>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}