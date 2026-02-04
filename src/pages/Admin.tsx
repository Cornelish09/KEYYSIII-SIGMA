import { db } from "../firebase"; 
import { doc, setDoc } from "firebase/firestore"; 
import React, { useState, useEffect } from "react";
import type { ContentConfig, Place, Outfit } from "../lib/types";
import { loadConfig, saveConfig, resetConfig, clearLogs } from "../lib/storage";
import { logEvent } from "../lib/activity";

// --- 1. FUNGSI KOMPRESI (WAJIB ADA BIAR SINKRON KE HP) ---
const compressAndUpload = (e: React.ChangeEvent<HTMLInputElement>, callback: (base64: string) => void) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      const MAX_SIZE = 500; // Kecilin ke 500px biar kenceng di HP
      if (width > height) {
        if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; }
      } else {
        if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.5); // Kualitas 50%
      callback(dataUrl);
    };
    img.src = event.target?.result as string;
  };
  reader.readAsDataURL(file);
};

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
  };

  const updateConfig = async (newCfg: ContentConfig) => {
    setCfg(newCfg);     
    saveConfig(newCfg); 
  };

  const handleSave = async () => {
    try {
      setSaveStatus("idle");
      // PROSES KIRIM KE FIREBASE
      await setDoc(doc(db, "configs", "main-config"), cfg);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
      alert("SINKRONISASI BERHASIL! Cek HP lo sekarang.");
    } catch (err) {
      console.error(err);
      alert("GAGAL! Data kegedean atau koneksi putus.");
    }
  };

  const updatePlace = (idx: number, field: keyof Place, val: any) => {
    const newItems = [...cfg.places.items];
    newItems[idx] = { ...newItems[idx], [field]: val };
    updateConfig({ ...cfg, places: { ...cfg.places, items: newItems } });
  };

  const updateOutfit = (idx: number, field: keyof Outfit, val: any) => {
    const currentItems = cfg.outfits?.items || [];
    const newItems = [...currentItems];
    newItems[idx] = { ...newItems[idx], [field]: val };
    updateConfig({ ...cfg, outfits: { ...(cfg.outfits || { headline: "Outfit", subtitle: "Style" }), items: newItems } });
  };

  // ... (Fungsi toggleTag, addPlace, addOutfit, removeItem tetep sama kayak punya lo)
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

  const removeItem = (type: 'place' | 'outfit', idx: number) => {
    if(!confirm("Hapus?")) return;
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
          <h2 style={{ marginTop: 0 }}>🔒 Admin</h2>
          <input type="password" value={pass} onChange={e => setPass(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 6, marginBottom: 15, background: "#0f172a", color: "white", border: "1px solid #475569" }} />
          <button onClick={verify} style={{ width: "100%", padding: 10, background: "#3b82f6", color: "white", border: "none", borderRadius: 6, cursor: "pointer" }}>Login</button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-layout">
      <style>{`
        .admin-layout { display: flex; min-height: 100vh; background: #0f172a; color: #cbd5e1; }
        .sidebar { width: 240px; background: #1e293b; border-right: 1px solid #334155; padding: 20px; position: fixed; height: 100vh; }
        .main-content { flex: 1; margin-left: 240px; padding: 40px; }
        .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 24px; margin-bottom: 20px; }
        .input, .textarea { width: 100%; background: #020617; border: 1px solid #475569; color: white; padding: 10px; border-radius: 6px; margin-bottom: 10px; }
        .nav-btn { width: 100%; text-align: left; padding: 12px; border-radius: 8px; border: none; background: transparent; color: #94a3b8; cursor: pointer; }
        .nav-btn.active { background: #3b82f6; color: white; }
        .save-btn { position: fixed; top: 20px; right: 20px; z-index: 100; background: #10b981; color: white; padding: 12px 24px; border-radius: 50px; border: none; cursor: pointer; font-weight: bold; }
        .preview-box { width: 80px; height: 80px; background: #020617; border-radius: 8px; overflow: hidden; }
      `}</style>

      <button className="save-btn" onClick={handleSave}>
        {saveStatus === 'saved' ? "✅ SAVED" : "💾 SAVE TO CLOUD"}
      </button>

      <div className="sidebar">
        <h3 style={{ color: 'white' }}>⚡ Admin Panel</h3>
        <button className={`nav-btn ${activeTab === 'general' ? 'active' : ''}`} onClick={() => setActiveTab('general')}>🏠 General</button>
        <button className={`nav-btn ${activeTab === 'places' ? 'active' : ''}`} onClick={() => setActiveTab('places')}>📍 Places</button>
        <button className={`nav-btn ${activeTab === 'outfits' ? 'active' : ''}`} onClick={() => setActiveTab('outfits')}>👗 Outfits</button>
        <button className={`nav-btn ${activeTab === 'tools' ? 'active' : ''}`} onClick={() => setActiveTab('tools')}>🔧 Tools</button>
      </div>

      <div className="main-content">
        {activeTab === 'general' && (
          <div className="card">
            <label>Isi Surat</label>
            <textarea className="textarea" style={{height: 150}} value={cfg.letter?.text || ""} onChange={e => updateConfig({...cfg, letter: { ...cfg.letter, text: e.target.value }})} />
          </div>
        )}

        {activeTab === 'places' && (
          <div>
            <button className="btn btn-success" onClick={addPlace} style={{marginBottom: 20, padding: 10}}>+ Add Place</button>
            {cfg.places.items.map((p, idx) => (
              <div key={p.id} className="card">
                <input className="input" value={p.name} onChange={e => updatePlace(idx, "name", e.target.value)} placeholder="Nama Tempat" />
                <div style={{display: 'flex', gap: 10, alignItems: 'center'}}>
                  <div className="preview-box">{p.image && <img src={p.image} style={{width:'100%'}} />}</div>
                  <label style={{color: '#3b82f6', cursor: 'pointer'}}>
                    Ganti Foto
                    <input type="file" accept="image/*" style={{display:'none'}} onChange={e => compressAndUpload(e, (b64) => updatePlace(idx, "image", b64))} />
                  </label>
                </div>
                <button className="btn btn-danger" onClick={() => removeItem('place', idx)} style={{marginTop: 10}}>Hapus</button>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'outfits' && (
          <div>
            <button className="btn btn-success" onClick={addOutfit} style={{marginBottom: 20, padding: 10}}>+ Add Outfit</button>
            {(cfg.outfits?.items || []).map((o, idx) => (
              <div key={o.id} className="card">
                <input className="input" value={o.name} onChange={e => updateOutfit(idx, "name", e.target.value)} />
                <div style={{display: 'flex', gap: 10, alignItems: 'center'}}>
                  <div className="preview-box">{o.image && <img src={o.image} style={{width:'100%'}} />}</div>
                  <label style={{color: '#3b82f6', cursor: 'pointer'}}>
                    Ganti Foto
                    <input type="file" accept="image/*" style={{display:'none'}} onChange={e => compressAndUpload(e, (b64) => updateOutfit(idx, "image", b64))} />
                  </label>
                </div>
                <button className="btn btn-danger" onClick={() => removeItem('outfit', idx)} style={{marginTop: 10}}>Hapus</button>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'tools' && (
          <div className="card">
            <button className="btn btn-danger" onClick={() => { if(confirm("Reset?")) { resetConfig(); setCfg(loadConfig()); } }}>Factory Reset</button>
          </div>
        )}
      </div>
    </div>
  );
}