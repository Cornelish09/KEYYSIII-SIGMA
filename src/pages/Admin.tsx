import { db, storage } from "../firebase"; 
import { doc, setDoc, deleteDoc, collection, query, orderBy, onSnapshot, addDoc } from "firebase/firestore"; 
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import React, { useState, useEffect } from "react";
import type { ContentConfig } from "../lib/types";
import { loadConfig, saveConfig, resetConfig } from "../lib/storage";

// ==========================================
// TIPE DATA PHOTOBOX PRO
// ==========================================
type Frame = { id: string; name: string; imageUrl: string; type: 'image' | 'color'; color?: string; };
type Sticker = { id: string; name: string; imageUrl: string; createdAt?: string; };

// Helper ID
function randomId(prefix: string) { return prefix + "-" + Math.random().toString(16).slice(2); }

export function Admin() {
  // Config Utama
  const [cfg, setCfg] = useState<ContentConfig>(() => loadConfig());
  const [pass, setPass] = useState("");
  const [ok, setOk] = useState(false);
  
  // Tab Navigasi (TANPA TEMPLATE LAMA/SCALE)
  const [activeTab, setActiveTab] = useState<'general' | 'places' | 'outfits' | 'photobox' | 'tools'>('photobox');
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");

  // State Photobox PRO
  const [photoboxTab, setPhotoboxTab] = useState<'frames' | 'stickers' | 'gallery'>('frames');
  const [rawPhotos, setRawPhotos] = useState<any[]>([]);
  const [finalDesigns, setFinalDesigns] = useState<any[]>([]);
  const [stickers, setStickers] = useState<Sticker[]>([]);
  
  // Loading States
  const [uploadingFrame, setUploadingFrame] = useState(false);
  const [uploadingSticker, setUploadingSticker] = useState(false);
  const [uploadingItem, setUploadingItem] = useState<{idx: number, type: 'places'|'outfits'} | null>(null);

  useEffect(() => { document.title = "Admin — Hangout Card"; }, []);

  // ---------------------------------------------------------
  // LISTENERS (Realtime Updates untuk Photobox)
  // ---------------------------------------------------------
  useEffect(() => {
    if (activeTab === 'photobox') {
      // Listen Stickers
      const unsubStickers = onSnapshot(query(collection(db, 'stickers'), orderBy('createdAt', 'desc')), (s) => 
        setStickers(s.docs.map(d => ({ id: d.id, ...d.data() } as Sticker)))
      );
      // Listen Raw Photos
      const unsubRaw = onSnapshot(query(collection(db, 'photobox_raw'), orderBy('createdAt', 'desc')), (s) => 
        setRawPhotos(s.docs.map(d => ({ id: d.id, ...d.data() })))
      );
      // Listen Final Designs
      const unsubFinal = onSnapshot(query(collection(db, 'photobox_final'), orderBy('createdAt', 'desc')), (s) => 
        setFinalDesigns(s.docs.map(d => ({ id: d.id, ...d.data() })))
      );
      
      return () => { unsubStickers(); unsubRaw(); unsubFinal(); };
    }
  }, [activeTab]);

  // ---------------------------------------------------------
  // CORE ACTIONS
  // ---------------------------------------------------------
  const verify = () => { if (pass === (cfg.admin?.passcode || "")) setOk(true); };
  
  const updateConfig = (newCfg: ContentConfig) => { 
    setCfg(prev => { 
      const u = { ...prev, ...newCfg }; 
      saveConfig(u); 
      return u; 
    }); 
  };
  
  const handleSave = async () => {
    try {
      await setDoc(doc(db, "configs", "main_config"), cfg);
      saveConfig(cfg); 
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
      alert("✅ Data Tersimpan ke Database!");
    } catch (e) { alert("❌ Gagal menyimpan"); }
  };

  const uploadFile = async (file: File, path: string) => {
    const storagePath = storageRef(storage, `photobox/${path}/${Date.now()}_${file.name}`);
    await uploadBytes(storagePath, file);
    return await getDownloadURL(storagePath);
  };

  // ---------------------------------------------------------
  // LOGIC: GENERAL & RUNDOWN
  // ---------------------------------------------------------
  const addRundown = () => updateConfig({ ...cfg, rundown: [...(cfg.rundown||[]), { time: "00:00", activity: "" }] });
  const updateRundown = (i: number, f: string, v: string) => {
    const r = [...(cfg.rundown||[])]; r[i] = { ...r[i], [f]: v };
    updateConfig({ ...cfg, rundown: r });
  };
  const removeRundown = (i: number) => {
    const r = [...(cfg.rundown||[])]; r.splice(i, 1);
    updateConfig({ ...cfg, rundown: r });
  };

  // ---------------------------------------------------------
  // LOGIC: PLACES & OUTFITS
  // ---------------------------------------------------------
  const addItem = (type: 'places'|'outfits') => {
    const newItem: any = type === 'places' 
      ? { id: randomId('p'), name: "New Place", image: "", tags: [], swot: "" } 
      : { id: randomId('o'), name: "New Outfit", image: "", style: "" };
    updateConfig({ ...cfg, [type]: { ...cfg[type], items: [newItem, ...(cfg[type]?.items || [])] } });
  };

  const updateItem = (type: 'places'|'outfits', idx: number, field: string, val: any) => {
    const items = [...(cfg[type]?.items || [])];
    items[idx] = { ...items[idx], [field]: val };
    updateConfig({ ...cfg, [type]: { ...cfg[type], items } });
  };

  const removeItem = (type: 'places'|'outfits', idx: number) => {
    if(!confirm("Hapus item ini?")) return;
    const items = [...(cfg[type]?.items || [])];
    items.splice(idx, 1);
    updateConfig({ ...cfg, [type]: { ...cfg[type], items } });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'places'|'outfits', idx: number) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploadingItem({ idx, type });
    try {
      const url = await uploadFile(file, type);
      updateItem(type, idx, 'image', url);
    } catch (e) { alert("Gagal upload"); }
    setUploadingItem(null);
  };

  // ---------------------------------------------------------
  // LOGIC: PHOTOBOX PRO (FRAMES & STICKERS)
  // ---------------------------------------------------------
  const uploadFrame = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploadingFrame(true);
    try {
      const url = await uploadFile(file, 'frames');
      const newFrame: Frame = { id: `frame_${Date.now()}`, name: file.name, imageUrl: url, type: 'image' };
      const frames = [...(cfg.photobox?.frames || []), newFrame];
      updateConfig({ ...cfg, photobox: { ...cfg.photobox, frames } });
    } catch(e) { alert("Gagal upload frame"); }
    setUploadingFrame(false);
  };

  const uploadSticker = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploadingSticker(true);
    try {
      const url = await uploadFile(file, 'stickers');
      await addDoc(collection(db, "stickers"), { name: file.name, imageUrl: url, createdAt: new Date().toISOString() });
    } catch(e) { alert("Gagal upload sticker"); }
    setUploadingSticker(false);
  };

  const deleteAsset = async (type: 'frame'|'sticker'|'raw'|'final', id: string, url?: string) => {
    if(!confirm("Hapus permanen?")) return;
    try {
      if (type === 'frame') {
        const frames = cfg.photobox?.frames?.filter(f => f.id !== id) || [];
        updateConfig({ ...cfg, photobox: { ...cfg.photobox, frames } });
      } else {
        const col = type === 'sticker' ? 'stickers' : type === 'raw' ? 'photobox_raw' : 'photobox_final';
        await deleteDoc(doc(db, col, id));
      }
      if (url) await deleteObject(storageRef(storage, url)).catch(console.error);
    } catch(e) { console.error(e); }
  };

  // ---------------------------------------------------------
  // UI RENDER
  // ---------------------------------------------------------
  if (!ok) return (
    <div style={{minHeight:"100vh",background:"#0f172a",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:"#1e293b",padding:30,borderRadius:12, width:300}}>
        <h3 style={{color:'white', marginBottom:15}}>Admin Login</h3>
        <input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="Passcode" style={{width:"100%",padding:10,marginBottom:10,borderRadius:6,border:'none'}}/>
        <button onClick={verify} style={{width:"100%",padding:10,background:"#3b82f6",color:"white",border:'none',borderRadius:6,fontWeight:'bold',cursor:'pointer'}}>Login</button>
      </div>
    </div>
  );

  return (
    <div className="admin-layout">
      {/* GLOBAL STYLES */}
      <style>{`
        .admin-layout { display: flex; min-height: 100vh; background: #0f172a; color: #cbd5e1; font-family: sans-serif; }
        .sidebar { width: 220px; background: #1e293b; padding: 20px; position: fixed; height: 100vh; border-right: 1px solid #334155; }
        .main-content { flex: 1; margin-left: 220px; padding: 40px; }
        .btn { padding: 8px 16px; border-radius: 6px; cursor: pointer; border: none; font-weight: bold; font-size:12px; margin-right: 5px; transition: 0.2s; }
        .btn-primary { background: #3b82f6; color: white; }
        .btn-danger { background: #ef4444; color: white; }
        .btn-success { background: #10b981; color: white; }
        .btn:hover { opacity: 0.9; }
        .card { background: #1e293b; padding: 15px; border-radius: 12px; margin-bottom: 15px; border: 1px solid #334155; }
        .input { width: 100%; background: #020617; border: 1px solid #475569; color: white; padding: 8px; border-radius: 4px; margin-bottom: 8px; font-size: 14px; }
        .nav-btn { display: block; width: 100%; text-align: left; padding: 12px; background: transparent; color: #94a3b8; border: none; cursor: pointer; border-radius: 8px; margin-bottom: 5px; font-weight: 600; }
        .nav-btn.active { background: #3b82f6; color: white; }
        .nav-btn:hover { background: rgba(59,130,246,0.1); }
        .grid-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 15px; }
        .sub-nav { display: flex; gap: 10px; margin-bottom: 20px; overflow-x: auto; padding-bottom: 5px; }
        .sub-nav button { background: #475569; color: white; border: none; padding: 8px 16px; border-radius: 20px; cursor: pointer; white-space: nowrap; font-size: 12px; }
        .sub-nav button.active { background: #10b981; }
        textarea.input { min-height: 80px; resize: vertical; }
      `}</style>

      {/* SIDEBAR */}
      <div className="sidebar">
        <h3 style={{color:'white', marginBottom:20, paddingLeft:10}}>⚡ Admin</h3>
        
        <p style={{fontSize:10, textTransform:'uppercase', color:'#64748b', fontWeight:'bold', marginTop:10, paddingLeft:10}}>Main Config</p>
        <button className={`nav-btn ${activeTab==='general'?'active':''}`} onClick={()=>setActiveTab('general')}>🏠 General & Jadwal</button>
        <button className={`nav-btn ${activeTab==='places'?'active':''}`} onClick={()=>setActiveTab('places')}>📍 Places</button>
        <button className={`nav-btn ${activeTab==='outfits'?'active':''}`} onClick={()=>setActiveTab('outfits')}>👗 Outfits</button>
        
        <p style={{fontSize:10, textTransform:'uppercase', color:'#64748b', fontWeight:'bold', marginTop:20, paddingLeft:10}}>Photobox</p>
        <button className={`nav-btn ${activeTab==='photobox'?'active':''}`} onClick={()=>setActiveTab('photobox')}>📸 Photobox PRO</button>
        
        <p style={{fontSize:10, textTransform:'uppercase', color:'#64748b', fontWeight:'bold', marginTop:20, paddingLeft:10}}>System</p>
        <button className={`nav-btn ${activeTab==='tools'?'active':''}`} onClick={()=>setActiveTab('tools')}>🔧 Tools</button>
      </div>

      {/* CONTENT */}
      <div className="main-content">
        <button className="btn btn-primary" style={{position:'fixed', top:20, right:20, zIndex:100, padding:'10px 20px', boxShadow:'0 4px 12px rgba(0,0,0,0.3)'}} onClick={handleSave}>
          {saveStatus === "saved" ? "✅ SAVED!" : "💾 SAVE ALL CHANGES"}
        </button>

        {/* --- 1. GENERAL & RUNDOWN --- */}
        {activeTab === 'general' && (
          <div>
            <h2>🏠 General Settings</h2>
            <div className="card">
              <label style={{display:'block',marginBottom:5,fontWeight:'bold',fontSize:12}}>🎵 Music URL (MP3)</label>
              <input className="input" value={cfg.music||""} onChange={e=>updateConfig({music:e.target.value})} placeholder="https://..." />
            </div>

            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:30,marginBottom:15}}>
              <h3>📅 Rundown (Jadwal)</h3>
              <button className="btn btn-primary" onClick={addRundown}>+ Add Item</button>
            </div>
            
            {cfg.rundown?.map((r, i) => (
               <div key={i} className="card" style={{display:'flex', gap:10, alignItems:'center'}}>
                 <div style={{width:80}}>
                    <label style={{fontSize:10}}>Time</label>
                    <input className="input" style={{marginBottom:0}} value={r.time} onChange={e=>updateRundown(i, 'time', e.target.value)} placeholder="00:00" />
                 </div>
                 <div style={{flex:1}}>
                    <label style={{fontSize:10}}>Activity</label>
                    <input className="input" style={{marginBottom:0}} value={r.activity} onChange={e=>updateRundown(i, 'activity', e.target.value)} placeholder="Ngapaiin..." />
                 </div>
                 <button className="btn btn-danger" style={{marginTop:15}} onClick={()=>removeRundown(i)}>Del</button>
               </div>
            ))}
          </div>
        )}

        {/* --- 2. PLACES --- */}
        {activeTab === 'places' && (
          <div>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:15}}>
              <h2>📍 Places Manager</h2>
              <button className="btn btn-primary" onClick={()=>addItem('places')}>+ Add Place</button>
            </div>
            <div className="grid-cards">
              {cfg.places?.items.map((item:any,i:number)=>(
                <div key={i} className="card">
                  {/* Image Preview */}
                  <div style={{height:150, background: item.image ? `url(${item.image}) center/cover` : '#334155', borderRadius:8, marginBottom:10}} />
                  
                  {/* Upload Button */}
                  <label className="btn btn-primary" style={{display:'block',textAlign:'center',marginBottom:10, fontSize:10}}>
                    {uploadingItem?.idx===i && uploadingItem.type==='places' ? 'Uploading...' : '📸 Change Image'}
                    <input type="file" hidden onChange={e=>handleImageUpload(e, 'places', i)}/>
                  </label>

                  <input className="input" placeholder="Place Name" value={item.name} onChange={e=>updateItem('places',i,'name',e.target.value)}/>
                  <input className="input" placeholder="Tags (comma separated)" value={item.tags?.join(',')} onChange={e=>updateItem('places',i,'tags',e.target.value.split(','))} />
                  <textarea className="input" placeholder="SWOT / Desc" value={item.swot} onChange={e=>updateItem('places',i,'swot',e.target.value)} />
                  <button className="btn btn-danger" style={{width:'100%'}} onClick={()=>removeItem('places',i)}>Delete</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* --- 3. OUTFITS --- */}
        {activeTab === 'outfits' && (
          <div>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:15}}>
              <h2>👗 Outfits Manager</h2>
              <button className="btn btn-primary" onClick={()=>addItem('outfits')}>+ Add Outfit</button>
            </div>
            <div className="grid-cards">
              {cfg.outfits?.items.map((item:any,i:number)=>(
                <div key={i} className="card">
                  <div style={{height:180, background: item.image ? `url(${item.image}) center/contain no-repeat` : '#334155', borderRadius:8, marginBottom:10, backgroundColor:'#000'}} />
                  
                  <label className="btn btn-primary" style={{display:'block',textAlign:'center',marginBottom:10, fontSize:10}}>
                    {uploadingItem?.idx===i && uploadingItem.type==='outfits' ? 'Uploading...' : '📸 Change Image'}
                    <input type="file" hidden onChange={e=>handleImageUpload(e, 'outfits', i)}/>
                  </label>

                  <input className="input" placeholder="Outfit Name" value={item.name} onChange={e=>updateItem('outfits',i,'name',e.target.value)}/>
                  <input className="input" placeholder="Style" value={item.style} onChange={e=>updateItem('outfits',i,'style',e.target.value)}/>
                  <button className="btn btn-danger" style={{width:'100%'}} onClick={()=>removeItem('outfits',i)}>Delete</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* --- 4. PHOTOBOX PRO (FOCUS AREA) --- */}
        {activeTab === 'photobox' && (
          <div>
            <h2>📸 Photobox PRO Manager</h2>
            <div className="sub-nav">
              <button className={photoboxTab==='frames'?'active':''} onClick={()=>setPhotoboxTab('frames')}>🖼️ Frames</button>
              <button className={photoboxTab==='stickers'?'active':''} onClick={()=>setPhotoboxTab('stickers')}>✨ Stickers</button>
              <button className={photoboxTab==='gallery'?'active':''} onClick={()=>setPhotoboxTab('gallery')}>🎞️ Results</button>
            </div>

            {/* FRAMES MANAGER */}
            {photoboxTab === 'frames' && (
              <div>
                <div style={{marginBottom:20, padding:20, background:'#1e293b', borderRadius:12, border:'1px dashed #475569'}}>
                  <label className="btn btn-primary" style={{display:'inline-block'}}>
                    {uploadingFrame ? "⏳ Uploading..." : "+ Upload Frame (PNG)"}
                    <input type="file" hidden accept="image/png" onChange={uploadFrame}/>
                  </label>
                  <p style={{fontSize:12, color:'#94a3b8', marginTop:5}}>Upload frame transparan (PNG). Frame ini akan muncul otomatis di halaman Photobox.</p>
                </div>
                
                <div className="grid-cards">
                  {cfg.photobox?.frames?.map(f=>(
                    <div key={f.id} className="card">
                      <div style={{height:150,background:`url(${f.imageUrl}) center/contain no-repeat`}}/>
                      <p style={{textAlign:'center', fontWeight:'bold', margin:'10px 0'}}>{f.name}</p>
                      <button className="btn btn-danger" style={{width:'100%'}} onClick={()=>deleteAsset('frame',f.id)}>Hapus Frame</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* STICKERS MANAGER */}
            {photoboxTab === 'stickers' && (
              <div>
                 <div style={{marginBottom:20, padding:20, background:'#1e293b', borderRadius:12, border:'1px dashed #475569'}}>
                  <label className="btn btn-primary" style={{display:'inline-block'}}>
                    {uploadingSticker ? "⏳ Uploading..." : "+ Upload Sticker (PNG)"}
                    <input type="file" hidden accept="image/png" onChange={uploadSticker}/>
                  </label>
                  <p style={{fontSize:12, color:'#94a3b8', marginTop:5}}>Upload sticker lucu (PNG). User bisa drag & drop sticker ini.</p>
                </div>

                <div className="grid-cards" style={{gridTemplateColumns:'repeat(auto-fill, minmax(120px, 1fr))'}}>
                  {stickers.map(s=>(
                    <div key={s.id} className="card" style={{textAlign:'center'}}>
                      <img src={s.imageUrl} style={{width:80,height:80,objectFit:'contain', marginBottom:10}}/>
                      <button className="btn btn-danger" style={{width:'100%', fontSize:10}} onClick={()=>deleteAsset('sticker',s.id)}>Hapus</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* GALLERY RESULTS */}
            {photoboxTab === 'gallery' && (
              <div>
                <h3>🎨 Final Designs (Siap Cetak)</h3>
                <div className="grid-cards">
                  {finalDesigns.map(d=>(
                    <div key={d.id} className="card" style={{border:'2px solid #10b981'}}>
                      <img src={d.url} style={{width:'100%',borderRadius:8}}/>
                      <div style={{marginTop:10, display:'flex', gap:5}}>
                        <a href={d.url} download className="btn btn-success" style={{flex:1, textAlign:'center', textDecoration:'none'}}>⬇️ Save</a>
                        <button className="btn btn-danger" onClick={()=>deleteAsset('final',d.id,d.url)}>Del</button>
                      </div>
                    </div>
                  ))}
                  {finalDesigns.length === 0 && <p style={{color:'#64748b'}}>Belum ada hasil desain.</p>}
                </div>
                
                <h3 style={{marginTop:40}}>🎞️ Raw Captures (Foto Asli)</h3>
                <div className="grid-cards">
                  {rawPhotos.map(p=>(
                    <div key={p.id} className="card">
                      <img src={p.url} style={{width:'100%',borderRadius:8}}/>
                      <div style={{marginTop:10, display:'flex', gap:5}}>
                        <a href={p.url} target="_blank" className="btn btn-primary" style={{flex:1, textAlign:'center', textDecoration:'none'}}>View</a>
                        <button className="btn btn-danger" onClick={()=>deleteAsset('raw',p.id,p.url)}>Del</button>
                      </div>
                    </div>
                  ))}
                  {rawPhotos.length === 0 && <p style={{color:'#64748b'}}>Belum ada foto yang diambil.</p>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* --- 5. TOOLS --- */}
        {activeTab === 'tools' && (
          <div>
            <h2>🔧 System Tools</h2>
            <div className="card">
              <p>Gunakan tombol ini jika data error atau ingin mengulang dari awal.</p>
              <button 
                className="btn btn-danger" 
                onClick={() => {
                  if(confirm("YAKIN RESET DATA CONFIG?")) {
                    resetConfig();
                    window.location.reload();
                  }
                }}
              >
                ⚠️ Factory Reset Config
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}