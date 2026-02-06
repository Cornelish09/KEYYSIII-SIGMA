import { db, storage } from "../firebase"; 
import { doc, setDoc, deleteDoc, collection, query, orderBy, onSnapshot } from "firebase/firestore"; 
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import React, { useState, useEffect } from "react";
import type { ContentConfig, Place, Outfit } from "../lib/types";
import { loadConfig, saveConfig, resetConfig } from "../lib/storage";
import { logEvent } from "../lib/activity";

// --- TYPES LOCAL ---
type Frame = {
  id: string;
  name: string;
  imageUrl?: string;
  color?: string;
  type: 'image' | 'color';
};

type Sticker = {
  id: string;
  name: string;
  imageUrl: string;
};

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
  
  // ✅ MAIN TABS (Photobox gw jadiin satu tab utama biar rapi)
  const [activeTab, setActiveTab] = useState<'general' | 'places' | 'outfits' | 'photobox' | 'tools'>('general');
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");

  // ========================================
  // 📸 PHOTOBOX STATES & LOGIC
  // ========================================
  const [photoboxTab, setPhotoboxTab] = useState<'frames' | 'stickers' | 'raw' | 'final'>('frames');
  const [rawPhotos, setRawPhotos] = useState<any[]>([]);
  const [finalDesigns, setFinalDesigns] = useState<any[]>([]);
  const [uploadingFrame, setUploadingFrame] = useState(false);
  const [uploadingSticker, setUploadingSticker] = useState(false);

  // 1. LISTENERS (Raw & Final)
  useEffect(() => {
    if (activeTab !== 'photobox') return;

    // Listen Raw Photos
    const qRaw = query(collection(db, 'photobox_raw'), orderBy('createdAt', 'desc'));
    const unsubRaw = onSnapshot(qRaw, (snap) => setRawPhotos(snap.docs.map(d => ({ id: d.id, ...d.data() }))));

    // Listen Final Designs
    const qFinal = query(collection(db, 'photobox_final'), orderBy('createdAt', 'desc'));
    const unsubFinal = onSnapshot(qFinal, (snap) => setFinalDesigns(snap.docs.map(d => ({ id: d.id, ...d.data() }))));

    return () => { unsubRaw(); unsubFinal(); };
  }, [activeTab]);

  // 2. UPLOAD HANDLERS
  const uploadFrame = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFrame(true);
    try {
      const timestamp = Date.now();
      const path = storageRef(storage, `photobox/frames/${timestamp}_${file.name}`);
      await uploadBytes(path, file);
      const url = await getDownloadURL(path);

      const newFrame: Frame = {
        id: `frame_${timestamp}`,
        name: file.name.replace(/\.[^/.]+$/, ''),
        imageUrl: url,
        type: 'image',
      };

      const updatedCfg = { ...cfg, photobox: { ...cfg.photobox, frames: [...(cfg.photobox?.frames || []), newFrame] } };
      await setDoc(doc(db, 'configs', 'main_config'), updatedCfg);
      updateConfig(updatedCfg);
      alert('✅ Frame uploaded!');
    } catch (e) { console.error(e); alert('❌ Upload failed'); } finally { setUploadingFrame(false); }
  };

  const uploadSticker = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingSticker(true);
    try {
      const timestamp = Date.now();
      const path = storageRef(storage, `photobox/stickers/${timestamp}_${file.name}`);
      await uploadBytes(path, file);
      const url = await getDownloadURL(path);

      const newSticker: Sticker = {
        id: `sticker_${timestamp}`,
        name: file.name.replace(/\.[^/.]+$/, ''),
        imageUrl: url,
      };

      const updatedCfg = { ...cfg, photobox: { ...cfg.photobox, stickers: [...(cfg.photobox?.stickers || []), newSticker] } };
      await setDoc(doc(db, 'configs', 'main_config'), updatedCfg);
      updateConfig(updatedCfg);
      alert('✅ Sticker uploaded!');
    } catch (e) { console.error(e); alert('❌ Upload failed'); } finally { setUploadingSticker(false); }
  };

  // 3. DELETE HANDLERS
  const deleteFrame = async (id: string) => {
    if (!confirm('Delete Frame?')) return;
    const updated = cfg.photobox?.frames?.filter(f => f.id !== id) || [];
    const newCfg = { ...cfg, photobox: { ...cfg.photobox, frames: updated } };
    await setDoc(doc(db, 'configs', 'main_config'), newCfg);
    updateConfig(newCfg);
  };

  const deleteSticker = async (id: string) => {
    if (!confirm('Delete Sticker?')) return;
    const updated = cfg.photobox?.stickers?.filter(s => s.id !== id) || [];
    const newCfg = { ...cfg, photobox: { ...cfg.photobox, stickers: updated } };
    await setDoc(doc(db, 'configs', 'main_config'), newCfg);
    updateConfig(newCfg);
  };

  const deletePhoto = async (collectionName: string, id: string, url?: string) => {
    if (!confirm('Delete Photo?')) return;
    try {
      await deleteDoc(doc(db, collectionName, id));
      if (url) { try { await deleteObject(storageRef(storage, url)); } catch(e) { console.log('Storage delete err', e) } }
      alert('✅ Deleted');
    } catch(e) { alert('❌ Error'); }
  };

  // ========================================
  // GENERAL ADMIN LOGIC
  // ========================================
  const verify = () => { const good = pass === (cfg.admin?.passcode || ""); setOk(good); logEvent("admin_verify", { ok: good }); };
  const updateConfig = (newCfg: any) => { setCfg(prev => { const updated = { ...prev, ...newCfg }; saveConfig(updated); return updated; }); };
  const handleSave = async () => {
    try {
      await setDoc(doc(db, "configs", "main_config"), cfg);
      saveConfig(cfg); 
      localStorage.setItem("hangout_card_config_v1", JSON.stringify(cfg));
      window.dispatchEvent(new Event("storage"));
      alert("✅ Saved to Firebase!");
    } catch (e) { alert("❌ Save failed"); }
  };

  // Helper CRUD for Places/Outfits
  const updateItem = (type: 'places'|'outfits', idx: number, field: string, val: any) => {
    const items = [...(cfg[type]?.items || [])];
    items[idx] = { ...items[idx], [field]: val };
    updateConfig({ ...cfg, [type]: { ...cfg[type], items } });
  };
  const addItem = (type: 'places'|'outfits') => {
    const newItem: any = type === 'places' 
      ? { id: randomId('p'), name: "New Place", description: "", image: "", tags: ["dinner"], swot: "" }
      : { id: randomId('o'), name: "New Style", image: "", style: "casual", palette: [] };
    updateConfig({ ...cfg, [type]: { ...cfg[type], items: [newItem, ...(cfg[type]?.items || [])] } });
  };
  const removeItem = (type: 'places'|'outfits', idx: number) => {
    if(!confirm("Remove?")) return;
    const items = [...(cfg[type]?.items || [])];
    items.splice(idx, 1);
    updateConfig({ ...cfg, [type]: { ...cfg[type], items } });
  };

  if (!ok) return (
    <div style={{ minHeight: "100vh", background: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#1e293b", padding: 30, borderRadius: 12 }}>
        <h2 style={{color:'white',marginTop:0}}>🔒 Admin Access</h2>
        <input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="Passcode" style={{width:"100%",padding:10,marginBottom:15}}/>
        <button onClick={verify} style={{width:"100%",padding:10,background:"#3b82f6",color:"white",border:"none"}}>Login</button>
      </div>
    </div>
  );

  return (
    <div className="admin-layout">
      <style>{`
        .admin-layout { display: flex; min-height: 100vh; background: #0f172a; color: #cbd5e1; font-family: sans-serif; }
        .sidebar { width: 240px; background: #1e293b; padding: 20px; position: fixed; height: 100vh; }
        .main-content { flex: 1; margin-left: 240px; padding: 40px; max-width: 1000px; }
        .btn { padding: 10px 20px; border-radius: 6px; cursor: pointer; border: none; font-weight: bold; }
        .btn-primary { background: #3b82f6; color: white; }
        .btn-danger { background: #ef4444; color: white; }
        .card { background: #1e293b; padding: 20px; border-radius: 12px; margin-bottom: 20px; border: 1px solid #334155; }
        .input { width: 100%; background: #020617; border: 1px solid #475569; color: white; padding: 10px; border-radius: 6px; margin-bottom: 10px; }
        .nav-btn { display: block; width: 100%; text-align: left; padding: 12px; background: transparent; color: #94a3b8; border: none; cursor: pointer; border-radius: 8px; margin-bottom: 5px; font-weight: 600; }
        .nav-btn.active { background: #3b82f6; color: white; }
        .grid-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 20px; }
        .sub-nav { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
        .sub-nav button { background: #475569; color: white; border: none; padding: 10px 20px; border-radius: 20px; cursor: pointer; }
        .sub-nav button.active { background: #10b981; }
      `}</style>

      <div className="sidebar">
        <h3 style={{color:'white', marginBottom:20}}>⚡ Admin Panel</h3>
        <button className={`nav-btn ${activeTab==='general'?'active':''}`} onClick={()=>setActiveTab('general')}>🏠 General</button>
        <button className={`nav-btn ${activeTab==='places'?'active':''}`} onClick={()=>setActiveTab('places')}>📍 Places</button>
        <button className={`nav-btn ${activeTab==='outfits'?'active':''}`} onClick={()=>setActiveTab('outfits')}>👗 Outfits</button>
        <button className={`nav-btn ${activeTab==='photobox'?'active':''}`} onClick={()=>setActiveTab('photobox')}>📸 Photobox Manager</button>
        <button className={`nav-btn ${activeTab==='tools'?'active':''}`} onClick={()=>setActiveTab('tools')}>🔧 Tools</button>
      </div>

      <div className="main-content">
        <button className="btn btn-primary" style={{position:'fixed', top:20, right:20, zIndex:100}} onClick={handleSave}>💾 SAVE CHANGES</button>

        {activeTab === 'general' && (
          <div>
            <h2>General Settings</h2>
            <div className="card"><label>Music URL</label><input className="input" value={cfg.music||""} onChange={e=>updateConfig({music:e.target.value})} /></div>
            <div className="card"><label>Letter Text</label><textarea className="input" style={{height:150}} value={cfg.letter?.text||""} onChange={e=>updateConfig({letter:{...cfg.letter,text:e.target.value}})} /></div>
          </div>
        )}

        {(activeTab === 'places' || activeTab === 'outfits') && (
          <div>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:20}}>
              <h2>{activeTab === 'places' ? 'Places' : 'Outfits'} Manager</h2>
              <button className="btn btn-primary" onClick={()=>addItem(activeTab)}>+ Add Item</button>
            </div>
            {cfg[activeTab]?.items.map((item: any, idx: number) => (
              <div key={item.id} className="card">
                <input className="input" value={item.name} onChange={e=>updateItem(activeTab, idx, 'name', e.target.value)} placeholder="Name" />
                <input className="input" value={item.image} onChange={e=>updateItem(activeTab, idx, 'image', e.target.value)} placeholder="Image URL" />
                <button className="btn btn-danger" onClick={()=>removeItem(activeTab, idx)}>Delete</button>
              </div>
            ))}
          </div>
        )}

        {/* 📸 PHOTOBOX TAB (NEW INTEGRATION) */}
        {activeTab === 'photobox' && (
          <div>
            <h2>📸 Photobox Management</h2>
            
            {/* SUB-TABS */}
            <div className="sub-nav">
              <button className={photoboxTab==='frames'?'active':''} onClick={()=>setPhotoboxTab('frames')}>🖼️ Frames</button>
              <button className={photoboxTab==='stickers'?'active':''} onClick={()=>setPhotoboxTab('stickers')}>✨ Stickers</button>
              <button className={photoboxTab==='raw'?'active':''} onClick={()=>setPhotoboxTab('raw')}>🎞️ Raw Photos</button>
              <button className={photoboxTab==='final'?'active':''} onClick={()=>setPhotoboxTab('final')}>🎨 Final Designs</button>
            </div>

            {/* 1. FRAMES */}
            {photoboxTab === 'frames' && (
              <div>
                <label className="btn btn-primary" style={{display:'inline-block', marginBottom:20}}>
                  {uploadingFrame ? '⏳ Uploading...' : '➕ Upload Frame (PNG)'}
                  <input type="file" accept="image/*" hidden onChange={uploadFrame} disabled={uploadingFrame} />
                </label>
                <div className="grid-cards">
                  {cfg.photobox?.frames?.map(f => (
                    <div key={f.id} className="card" style={{textAlign:'center'}}>
                      <div style={{height:150, background: f.type==='color'?f.color:`url(${f.imageUrl}) center/contain no-repeat`}} />
                      <p>{f.name}</p>
                      <button className="btn btn-danger" onClick={()=>deleteFrame(f.id)}>Delete</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 2. STICKERS */}
            {photoboxTab === 'stickers' && (
              <div>
                <label className="btn btn-primary" style={{display:'inline-block', marginBottom:20}}>
                  {uploadingSticker ? '⏳ Uploading...' : '➕ Upload Sticker (PNG)'}
                  <input type="file" accept="image/*" hidden onChange={uploadSticker} disabled={uploadingSticker} />
                </label>
                <div className="grid-cards">
                  {cfg.photobox?.stickers?.map(s => (
                    <div key={s.id} className="card" style={{textAlign:'center'}}>
                      <img src={s.imageUrl} style={{width:80, height:80, objectFit:'contain'}} />
                      <p>{s.name}</p>
                      <button className="btn btn-danger" onClick={()=>deleteSticker(s.id)}>Delete</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 3. RAW PHOTOS */}
            {photoboxTab === 'raw' && (
              <div className="grid-cards">
                {rawPhotos.map(p => (
                  <div key={p.id} className="card">
                    <img src={p.url} style={{width:'100%', borderRadius:8}} />
                    <p style={{fontSize:12, color:'#94a3b8'}}>{new Date(p.createdAt).toLocaleString()}</p>
                    <a href={p.url} target="_blank" className="btn btn-primary" style={{display:'block', textAlign:'center', marginTop:10, textDecoration:'none'}}>View</a>
                    <button className="btn btn-danger" style={{width:'100%', marginTop:5}} onClick={()=>deletePhoto('photobox_raw', p.id, p.url)}>Delete</button>
                  </div>
                ))}
              </div>
            )}

            {/* 4. FINAL DESIGNS */}
            {photoboxTab === 'final' && (
              <div className="grid-cards">
                {finalDesigns.map(d => (
                  <div key={d.id} className="card" style={{border:'2px solid #10b981'}}>
                    <img src={d.url} style={{width:'100%', borderRadius:8}} />
                    <p style={{fontSize:12, color:'#94a3b8'}}>{new Date(d.createdAt).toLocaleString()}</p>
                    <div style={{display:'flex', gap:5, marginTop:10}}>
                      <a href={d.url} download className="btn btn-primary" style={{flex:1, textAlign:'center', textDecoration:'none'}}>⬇️</a>
                      <button className="btn btn-danger" onClick={()=>deletePhoto('photobox_final', d.id, d.url)}>🗑️</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'tools' && (
          <div>
            <h2>Tools</h2>
            <button className="btn btn-danger" onClick={() => { if(confirm("Reset data?")) { resetConfig(); window.location.reload(); } }}>Factory Reset Config</button>
          </div>
        )}
      </div>
    </div>
  );
}