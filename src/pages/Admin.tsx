import { db, storage } from "../firebase"; 
import { doc, setDoc, deleteDoc, collection, query, orderBy, onSnapshot, addDoc } from "firebase/firestore"; 
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import React, { useState, useEffect, useRef } from "react";
import type { ContentConfig, Place, Outfit } from "../lib/types";
import { loadConfig, saveConfig, resetConfig } from "../lib/storage";
import { logEvent } from "../lib/activity";

// ==========================================
// 1. TIPE DATA (LAMA + BARU)
// ==========================================

// Tipe Template Lama (JANGAN DIHAPUS)
type PhotoSlot = { x: number; y: number; width: number; height: number; };
type PhotoTemplate = {
  id: string; name: string; imageUrl: string; photoCount: number;
  slots: PhotoSlot[]; canvasWidth: number; canvasHeight: number; createdAt: string;
};

// Tipe Photobox PRO (BARU)
type Frame = { id: string; name: string; imageUrl: string; type: 'image' | 'color'; color?: string; };
type Sticker = { id: string; name: string; imageUrl: string; createdAt?: string; };

// Helper
function randomId(prefix: string) { return prefix + "-" + Math.random().toString(16).slice(2); }
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
  
  // Tab Menu
  const [activeTab, setActiveTab] = useState<'general' | 'places' | 'outfits' | 'templates' | 'photobox' | 'gallery' | 'tools'>('general');
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");

  // --- STATE FITUR LAMA ---
  const [templates, setTemplates] = useState<PhotoTemplate[]>([]);
  const [uploadingTemplate, setUploadingTemplate] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PhotoTemplate | null>(null);
  const [oldUserPhotos, setOldUserPhotos] = useState<any[]>([]);

  // State Visual Editor Lama (Template)
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [editorMode, setEditorMode] = useState<'visual' | 'manual'>('visual');
  const SCALE = 0.35; 

  // --- STATE FITUR BARU (PHOTOBOX PRO) ---
  const [photoboxTab, setPhotoboxTab] = useState<'frames' | 'stickers' | 'raw' | 'final'>('frames');
  const [rawPhotos, setRawPhotos] = useState<any[]>([]);
  const [finalDesigns, setFinalDesigns] = useState<any[]>([]);
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [uploadingFrame, setUploadingFrame] = useState(false);
  const [uploadingSticker, setUploadingSticker] = useState(false);

  useEffect(() => { document.title = "Admin — Hangout Card"; }, []);

  // ---------------------------------------------------------
  // ⛔️ VISUAL EDITOR LOGIC LAMA (JANGAN UBAH)
  // ---------------------------------------------------------
  useEffect(() => {
    if (!editingTemplate || !canvasRef.current || editorMode !== 'visual') return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      editingTemplate.slots.forEach((slot, index) => {
        const isSelected = selectedSlot === index;
        ctx.strokeStyle = isSelected ? '#10b981' : '#3b82f6';
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.strokeRect(slot.x * SCALE, slot.y * SCALE, slot.width * SCALE, slot.height * SCALE);
        ctx.fillStyle = isSelected ? 'rgba(16, 185, 129, 0.2)' : 'rgba(59, 130, 246, 0.2)';
        ctx.fillRect(slot.x * SCALE, slot.y * SCALE, slot.width * SCALE, slot.height * SCALE);
        ctx.fillStyle = isSelected ? '#10b981' : '#3b82f6';
        ctx.font = 'bold 24px Arial';
        ctx.fillText(`${index + 1}`, slot.x * SCALE + 10, slot.y * SCALE + 30);
        if (isSelected) {
          ctx.fillStyle = '#10b981';
          ctx.fillRect((slot.x + slot.width) * SCALE - 10, (slot.y + slot.height) * SCALE - 10, 20, 20);
        }
      });
    };
    img.src = editingTemplate.imageUrl;
  }, [editingTemplate, selectedSlot, editorMode]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!editingTemplate) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) / SCALE;
    const mouseY = (e.clientY - rect.top) / SCALE;

    if (selectedSlot !== null) {
      const slot = editingTemplate.slots[selectedSlot];
      if (Math.abs(mouseX - (slot.x + slot.width)) < 25 && Math.abs(mouseY - (slot.y + slot.height)) < 25) {
        setIsResizing(true); setDragStart({ x: mouseX, y: mouseY }); return;
      }
    }
    for (let i = editingTemplate.slots.length - 1; i >= 0; i--) {
      const slot = editingTemplate.slots[i];
      if (mouseX >= slot.x && mouseX <= slot.x + slot.width && mouseY >= slot.y && mouseY <= slot.y + slot.height) {
        setSelectedSlot(i); setIsDragging(true); setDragStart({ x: mouseX - slot.x, y: mouseY - slot.y }); return;
      }
    }
    setSelectedSlot(null);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if ((!isDragging && !isResizing) || !editingTemplate || selectedSlot === null) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) / SCALE;
    const mouseY = (e.clientY - rect.top) / SCALE;
    const newSlots = [...editingTemplate.slots];
    const slot = newSlots[selectedSlot];

    if (isResizing) {
      slot.width = Math.max(50, mouseX - slot.x);
      slot.height = Math.max(50, mouseY - slot.y);
    } else if (isDragging) {
      slot.x = mouseX - dragStart.x;
      slot.y = mouseY - dragStart.y;
    }
    setEditingTemplate({ ...editingTemplate, slots: newSlots });
  };
  const handleMouseUp = () => { setIsDragging(false); setIsResizing(false); };

  // ---------------------------------------------------------
  // ✅ LISTENERS (RAW, FINAL, STICKERS, OLD TEMPLATES)
  // ---------------------------------------------------------
  useEffect(() => {
    if (activeTab === 'templates') {
      const q = query(collection(db, "photobox_templates"), orderBy("createdAt", "desc"));
      return onSnapshot(q, (snap) => setTemplates(snap.docs.map(d => ({ id: d.id, ...d.data() } as PhotoTemplate))));
    }
    if (activeTab === 'gallery') {
      const q = query(collection(db, "secret_photos"), orderBy("createdAt", "desc"));
      return onSnapshot(q, (snap) => setOldUserPhotos(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    }
    if (activeTab === 'photobox') {
      const unsubRaw = onSnapshot(query(collection(db, 'photobox_raw'), orderBy('createdAt', 'desc')), (s) => setRawPhotos(s.docs.map(d => ({ id: d.id, ...d.data() }))));
      const unsubFinal = onSnapshot(query(collection(db, 'photobox_final'), orderBy('createdAt', 'desc')), (s) => setFinalDesigns(s.docs.map(d => ({ id: d.id, ...d.data() }))));
      const unsubSticker = onSnapshot(query(collection(db, 'stickers'), orderBy('createdAt', 'desc')), (s) => setStickers(s.docs.map(d => ({ id: d.id, ...d.data() } as Sticker))));
      return () => { unsubRaw(); unsubFinal(); unsubSticker(); };
    }
  }, [activeTab]);

  // ---------------------------------------------------------
  // ✅ UPLOAD & ACTIONS (PHOTOBOX ONLY)
  // ---------------------------------------------------------
  const verify = () => { if (pass === (cfg.admin?.passcode || "")) setOk(true); };
  const updateConfig = (newCfg: ContentConfig) => { setCfg(prev => { const u = { ...prev, ...newCfg }; saveConfig(u); return u; }); };
  
  const handleSave = async () => {
    try {
      await setDoc(doc(db, "configs", "main_config"), cfg);
      saveConfig(cfg); 
      alert("✅ Saved!");
    } catch (e) { alert("❌ Error saving"); }
  };

  const uploadFile = async (file: File, path: string) => {
    const storagePath = storageRef(storage, `photobox/${path}/${Date.now()}_${file.name}`);
    await uploadBytes(storagePath, file);
    return await getDownloadURL(storagePath);
  };

  // Upload Template Lama
  const handleTemplateUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploadingTemplate(true);
    try {
      const url = await uploadFile(file, 'templates');
      const photoCount = parseInt(prompt("Jumlah foto (1-4)?") || "1");
      const defaultSlots = Array.from({length: photoCount}).map((_, i) => ({ x: 50, y: 50 + (i * 300), width: 400, height: 250 }));
      const newTemp: PhotoTemplate = { id: Date.now().toString(), name: "New Template", imageUrl: url, photoCount, slots: defaultSlots, canvasWidth: 707, canvasHeight: 2000, createdAt: new Date().toISOString() };
      await setDoc(doc(db, "photobox_templates", newTemp.id), newTemp);
      alert("✅ Template uploaded");
    } catch(e) { alert("❌ Gagal upload"); }
    setUploadingTemplate(false);
  };

  // Upload Frame Baru
  const uploadFrame = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploadingFrame(true);
    const url = await uploadFile(file, 'frames');
    const newFrame: Frame = { id: `frame_${Date.now()}`, name: file.name, imageUrl: url, type: 'image' };
    const updatedCfg = { ...cfg, photobox: { ...cfg.photobox, frames: [...(cfg.photobox?.frames || []), newFrame] } };
    await setDoc(doc(db, 'configs', 'main_config'), updatedCfg); updateConfig(updatedCfg);
    setUploadingFrame(false);
  };

  // Upload Sticker Baru
  const uploadSticker = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploadingSticker(true);
    const url = await uploadFile(file, 'stickers');
    await addDoc(collection(db, "stickers"), { name: file.name, imageUrl: url, createdAt: new Date().toISOString() });
    setUploadingSticker(false);
  };

  // Delete Items
  const deleteItem = async (type: string, id: string, url?: string) => {
    if(!confirm("Hapus item ini?")) return;
    try {
      if (type === 'frame') {
        const frames = cfg.photobox?.frames?.filter(f => f.id !== id) || [];
        const newCfg = { ...cfg, photobox: { ...cfg.photobox, frames } };
        await setDoc(doc(db, "configs", "main_config"), newCfg);
        updateConfig(newCfg);
      } else if (type === 'sticker') {
        await deleteDoc(doc(db, "stickers", id));
      } else if (type === 'template') {
        await deleteDoc(doc(db, "photobox_templates", id));
      } else {
        await deleteDoc(doc(db, type === 'raw' ? "photobox_raw" : "photobox_final", id));
      }
      if (url) await deleteObject(storageRef(storage, url)).catch(console.error);
    } catch(e) { console.error(e); }
  };

  // ⛔️ PLACES & OUTFITS LOGIC (JANGAN UBAH - SESUAI PERMINTAAN)
  const updateItem = (type: 'places'|'outfits', idx: number, field: string, val: any) => {
    const items = [...(cfg[type]?.items || [])]; items[idx] = { ...items[idx], [field]: val };
    updateConfig({ ...cfg, [type]: { ...cfg[type], items } });
  };
  const addItem = (type: 'places'|'outfits') => {
    const newItem: any = type === 'places' ? { id: randomId('p'), name: "New", image: "", tags: ["dinner"], swot: "" } : { id: randomId('o'), name: "New", image: "", style: "casual" };
    updateConfig({ ...cfg, [type]: { ...cfg[type], items: [newItem, ...(cfg[type]?.items || [])] } });
  };
  const removeItem = (type: 'places'|'outfits', idx: number) => {
    if(!confirm("Hapus?")) return;
    const items = [...(cfg[type]?.items || [])]; items.splice(idx, 1);
    updateConfig({ ...cfg, [type]: { ...cfg[type], items } });
  };
  const updateSwot = (idx: number, type: 'plus' | 'minus', val: string) => {
    const current = parseSwot(cfg.places.items[idx].swot);
    const newPlus = type === 'plus' ? val : current.plus;
    const newMinus = type === 'minus' ? val : current.minus;
    const combined = `${newPlus.split('\n').filter(l=>l.trim()).map(l=>`+ ${l}`).join('\n')}\n${newMinus.split('\n').filter(l=>l.trim()).map(l=>`- ${l}`).join('\n')}`.trim();
    updateItem('places', idx, 'swot', combined);
  };
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, callback: (base64: string) => void) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader(); reader.onload = (event) => { const img = new Image(); img.onload = () => { const canvas = document.createElement('canvas'); let width = img.width; let height = img.height; const MAX_SIZE = 1200; if (width > height) { if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; } } else { if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; } } canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d', { alpha: false }); ctx?.drawImage(img, 0, 0, width, height); callback(canvas.toDataURL('image/jpeg', 0.7)); }; img.src = event.target?.result as string; }; reader.readAsDataURL(file);
  };
  const addColorToPalette = (idx: number, color: string) => { const items = [...(cfg.outfits?.items || [])]; items[idx].palette = [...(items[idx].palette || []), color]; updateConfig({ ...cfg, outfits: { ...cfg.outfits!, items } }); };
  const removeColorFromPalette = (oIdx: number, cIdx: number) => { const items = [...(cfg.outfits?.items || [])]; items[oIdx].palette?.splice(cIdx, 1); updateConfig({ ...cfg, outfits: { ...cfg.outfits!, items } }); };
  const toggleTag = (idx: number, tag: string) => { const items = [...cfg.places.items]; const current = items[idx].tags || []; items[idx].tags = current.includes(tag) ? current.filter(t => t !== tag) : [...current.filter(t => !['dinner','snack','dessert'].includes(t)), tag]; updateConfig({ ...cfg, places: { ...cfg.places, items } }); };

  if (!ok) return <div style={{minHeight:"100vh",background:"#0f172a",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{background:"#1e293b",padding:30,borderRadius:12}}><input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="Passcode" style={{width:"100%",padding:10,marginBottom:10}}/><button onClick={verify} style={{width:"100%",padding:10,background:"blue",color:"white"}}>Login</button></div></div>;

  return (
    <div className="admin-layout">
      <style>{`
        .admin-layout { display: flex; min-height: 100vh; background: #0f172a; color: #cbd5e1; font-family: sans-serif; }
        .sidebar { width: 220px; background: #1e293b; padding: 20px; position: fixed; height: 100vh; border-right: 1px solid #334155; }
        .main-content { flex: 1; margin-left: 220px; padding: 40px; }
        .btn { padding: 8px 16px; border-radius: 6px; cursor: pointer; border: none; font-weight: bold; font-size:12px; }
        .btn-primary { background: #3b82f6; color: white; }
        .btn-danger { background: #ef4444; color: white; }
        .btn-success { background: #10b981; color: white; }
        .card { background: #1e293b; padding: 15px; border-radius: 12px; margin-bottom: 15px; border: 1px solid #334155; }
        .input { width: 100%; background: #020617; border: 1px solid #475569; color: white; padding: 8px; border-radius: 4px; margin-bottom: 8px; }
        .nav-btn { display: block; width: 100%; text-align: left; padding: 12px; background: transparent; color: #94a3b8; border: none; cursor: pointer; border-radius: 8px; margin-bottom: 5px; font-weight: 600; }
        .nav-btn.active { background: #3b82f6; color: white; }
        .grid-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 15px; }
        .sub-nav { display: flex; gap: 10px; margin-bottom: 20px; overflow-x: auto; }
        .sub-nav button { background: #475569; color: white; border: none; padding: 8px 16px; border-radius: 20px; cursor: pointer; white-space: nowrap; }
        .sub-nav button.active { background: #10b981; }
        .preview-box { width: 80px; height: 80px; background: #020617; border: 1px dashed #475569; display: flex; align-items: center; justify-content: center; }
        .tag-row { display: flex; gap: 5px; }
        .tag-chip { padding: 4px 8px; border-radius: 12px; border: 1px solid #475569; background: transparent; color: #94a3b8; cursor: pointer; font-size: 10px; }
        .tag-chip.active { background: #8b5cf6; color: white; }
      `}</style>

      <div className="sidebar">
        <h3 style={{color:'white', marginBottom:20}}>⚡ Admin</h3>
        <button className={`nav-btn ${activeTab==='general'?'active':''}`} onClick={()=>setActiveTab('general')}>🏠 General</button>
        <button className={`nav-btn ${activeTab==='places'?'active':''}`} onClick={()=>setActiveTab('places')}>📍 Places</button>
        <button className={`nav-btn ${activeTab==='outfits'?'active':''}`} onClick={()=>setActiveTab('outfits')}>👗 Outfits</button>
        <hr style={{borderColor:'#334155', margin:'15px 0'}}/>
        <button className={`nav-btn ${activeTab==='templates'?'active':''}`} onClick={()=>setActiveTab('templates')}>🎨 Template (Old)</button>
        <button className={`nav-btn ${activeTab==='photobox'?'active':''}`} onClick={()=>setActiveTab('photobox')}>📸 Photobox PRO</button>
        <hr style={{borderColor:'#334155', margin:'15px 0'}}/>
        <button className={`nav-btn ${activeTab==='gallery'?'active':''}`} onClick={()=>setActiveTab('gallery')}>🖼️ Gallery (Old)</button>
        <button className={`nav-btn ${activeTab==='tools'?'active':''}`} onClick={()=>setActiveTab('tools')}>🔧 Tools</button>
      </div>

      <div className="main-content">
        <button className="btn btn-primary" style={{position:'fixed', top:20, right:20, zIndex:100}} onClick={handleSave}>💾 SAVE ALL</button>

        {activeTab === 'general' && (
          <div><h2>General</h2><div className="card"><label>Music</label><input className="input" value={cfg.music||""} onChange={e=>updateConfig({music:e.target.value})} /></div><div className="card"><label>Letter</label><textarea className="input" style={{height:150}} value={cfg.letter?.text||""} onChange={e=>updateConfig({letter:{...cfg.letter,text:e.target.value}})} /></div></div>
        )}

        {/* ⛔️ PLACES MANAGER (ASLI GAK DIUBAH) */}
        {activeTab === 'places' && (
          <div>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}><h2>Places</h2><button className="btn btn-primary" onClick={()=>addItem('places')}>+ Add</button></div>
            {cfg.places.items.map((p, idx) => {
              const swot = parseSwot(p.swot);
              return (
                <div key={p.id} className="card">
                  <input className="input" value={p.name} onChange={e => updateItem('places', idx, "name", e.target.value)} placeholder="Nama Tempat" />
                  <div className="tag-row" style={{marginBottom:10}}>
                    {['dinner', 'snack', 'dessert'].map(tag => (
                      <button key={tag} className={`tag-chip ${p.tags.includes(tag) ? 'active' : ''}`} onClick={() => toggleTag(idx, tag)}>{tag}</button>
                    ))}
                  </div>
                  <div style={{display:'flex',gap:10,marginBottom:10}}>
                    <div className="preview-box">{p.image ? <img src={p.image} style={{width:'100%',height:'100%',objectFit:'cover'}}/> : "No Img"}</div>
                    <div style={{flex:1}}>
                      <input className="input" value={p.image} onChange={e => updateItem('places', idx, "image", e.target.value)} placeholder="Image URL"/>
                      <input type="file" onChange={e => handleImageUpload(e, b64 => updateItem('places', idx, "image", b64))} style={{fontSize:10,color:'white'}}/>
                    </div>
                  </div>
                  <textarea className="input" value={p.description} onChange={e => updateItem('places', idx, "description", e.target.value)} placeholder="Deskripsi"/>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                    <input className="input" value={p.budget||""} onChange={e => updateItem('places', idx, "budget", e.target.value)} placeholder="Budget"/>
                    <input className="input" value={p.openHours||""} onChange={e => updateItem('places', idx, "openHours", e.target.value)} placeholder="Jam Buka"/>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                    <textarea className="input" value={swot.plus} onChange={e => updateSwot(idx, 'plus', e.target.value)} placeholder="+ Kelebihan"/>
                    <textarea className="input" value={swot.minus} onChange={e => updateSwot(idx, 'minus', e.target.value)} placeholder="- Kekurangan"/>
                  </div>
                  <div style={{display:'flex',gap:10}}>
                    <input className="input" value={p.locationUrl} onChange={e => updateItem('places', idx, "locationUrl", e.target.value)} placeholder="Maps URL"/>
                    <button className="btn btn-danger" onClick={()=>removeItem('places', idx)}>Del</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ⛔️ OUTFITS MANAGER (ASLI GAK DIUBAH) */}
        {activeTab === 'outfits' && (
          <div>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}><h2>Outfits</h2><button className="btn btn-primary" onClick={()=>addItem('outfits')}>+ Add</button></div>
            {(cfg.outfits?.items || []).map((o, idx) => (
              <div key={o.id} className="card">
                <input className="input" value={o.name} onChange={e => updateItem('outfits', idx, "name", e.target.value)} placeholder="Nama Style" />
                <select className="input" value={o.style || 'casual'} onChange={e => updateItem('outfits', idx, "style", e.target.value)}>
                  <option value="casual">Casual</option><option value="formal">Formal</option><option value="sporty">Sporty</option><option value="vintage">Vintage</option>
                </select>
                <div style={{marginBottom:10}}>
                  <div style={{display:'flex',gap:5,marginBottom:5}}>
                    {(o.palette || []).map((color, cIdx) => (
                      <div key={cIdx} onClick={() => removeColorFromPalette(idx, cIdx)} style={{width:20,height:20,borderRadius:'50%',background:color,cursor:'pointer',border:'1px solid white'}} />
                    ))}
                    {(o.palette || []).length < 5 && <input type="color" onChange={(e) => addColorToPalette(idx, e.target.value)} style={{width:25,height:25,padding:0,border:'none',background:'transparent'}} />}
                  </div>
                </div>
                <div style={{display:'flex',gap:10,marginBottom:10}}>
                  <div className="preview-box">{o.image ? <img src={o.image} style={{width:'100%',height:'100%',objectFit:'cover'}}/> : "No Img"}</div>
                  <div style={{flex:1}}>
                    <input className="input" value={o.image} onChange={e => updateItem('outfits', idx, "image", e.target.value)} placeholder="Image URL"/>
                    <input type="file" onChange={e => handleImageUpload(e, b64 => updateItem('outfits', idx, "image", b64))} style={{fontSize:10,color:'white'}}/>
                  </div>
                </div>
                <input className="input" value={o.description} onChange={e => updateItem('outfits', idx, "description", e.target.value)} placeholder="Deskripsi (Cewek | Cowok)"/>
                <button className="btn btn-danger" onClick={()=>removeItem('outfits', idx)}>Delete</button>
              </div>
            ))}
          </div>
        )}

        {/* --- FITUR LAMA: TEMPLATE MANAGER --- */}
        {activeTab === 'templates' && (
          <div>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:20}}>
              <h2>🎨 Old Template Manager</h2>
              <label className="btn btn-success" style={{cursor:'pointer'}}>{uploadingTemplate?"⏳":"+ Upload PNG"}<input type="file" hidden onChange={handleTemplateUpload}/></label>
            </div>
            <div className="grid-cards">
              {templates.map(t => (
                <div key={t.id} className="card">
                  <img src={t.imageUrl} style={{width:'100%',height:200,objectFit:'contain',background:'#000'}}/>
                  <div style={{marginTop:10,display:'flex',gap:5}}>
                    <button className="btn btn-primary" style={{flex:1}} onClick={()=>setEditingTemplate(t)}>Edit Slots</button>
                    <button className="btn btn-danger" onClick={()=>deleteItem('template',t.id)}>🗑️</button>
                  </div>
                </div>
              ))}
            </div>
            {editingTemplate && (
              <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.9)',zIndex:999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
                <div style={{background:'#1e293b',padding:20,borderRadius:12,width:'90%',maxWidth:1000,maxHeight:'90vh',overflow:'auto'}}>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:15}}><h3 style={{color:'white',margin:0}}>Editor Slot</h3><button onClick={()=>setEditorMode(editorMode==='visual'?'manual':'visual')} className="btn btn-primary">Switch Mode</button></div>
                  {editorMode==='visual' ? 
                    <div style={{background:'#000',display:'flex',justifyContent:'center'}}><canvas ref={canvasRef} width={editingTemplate.canvasWidth*SCALE} height={editingTemplate.canvasHeight*SCALE} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} style={{cursor:isDragging?'grabbing':isResizing?'nwse-resize':'grab',maxWidth:'100%'}}/></div> 
                    : 
                    <div className="grid-cards">{editingTemplate.slots.map((s,i)=>(<div key={i} className="card">Slot {i+1}<input type="number" value={s.x} onChange={e=>{const ns=[...editingTemplate.slots];ns[i].x=parseInt(e.target.value);setEditingTemplate({...editingTemplate,slots:ns})}} className="input"/></div>))}</div>
                  }
                  <div style={{marginTop:15,display:'flex',gap:10}}>
                    <button className="btn btn-success" style={{flex:1}} onClick={()=>setDoc(doc(db, "photobox_templates", editingTemplate.id), { slots: editingTemplate.slots }, { merge: true }).then(() => { alert("✅ Saved!"); setEditingTemplate(null); })}>Simpan</button>
                    <button className="btn btn-danger" onClick={()=>setEditingTemplate(null)}>Batal</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* --- FITUR BARU: PHOTOBOX PRO --- */}
        {activeTab === 'photobox' && (
          <div>
            <h2>📸 Photobox PRO Manager</h2>
            <div className="sub-nav">
              <button className={photoboxTab==='frames'?'active':''} onClick={()=>setPhotoboxTab('frames')}>🖼️ Frames</button>
              <button className={photoboxTab==='stickers'?'active':''} onClick={()=>setPhotoboxTab('stickers')}>✨ Stickers</button>
              <button className={photoboxTab==='raw'?'active':''} onClick={()=>setPhotoboxTab('raw')}>🎞️ Raw Photos</button>
              <button className={photoboxTab==='final'?'active':''} onClick={()=>setPhotoboxTab('final')}>🎨 Final Results</button>
            </div>

            {photoboxTab === 'frames' && (
              <div>
                <label className="btn btn-primary" style={{display:'inline-block',marginBottom:20}}>{uploadingFrame?"⏳":"+ Upload Frame"}<input type="file" hidden onChange={uploadFrame}/></label>
                <div className="grid-cards">{cfg.photobox?.frames?.map(f=>(<div key={f.id} className="card"><div style={{height:150,background:`url(${f.imageUrl}) center/contain no-repeat`}}/><p>{f.name}</p><button className="btn btn-danger" onClick={()=>deleteItem('frame',f.id)}>Del</button></div>))}</div>
              </div>
            )}
            {photoboxTab === 'stickers' && (
              <div>
                <label className="btn btn-primary" style={{display:'inline-block',marginBottom:20}}>{uploadingSticker?"⏳":"+ Upload Sticker"}<input type="file" hidden onChange={uploadSticker}/></label>
                <div className="grid-cards">{stickers.map(s=>(<div key={s.id} className="card"><img src={s.imageUrl} style={{width:80,height:80,objectFit:'contain'}}/><button className="btn btn-danger" onClick={()=>deleteItem('sticker',s.id)}>Del</button></div>))}</div>
              </div>
            )}
            {photoboxTab === 'raw' && <div className="grid-cards">{rawPhotos.map(p=>(<div key={p.id} className="card"><img src={p.url} style={{width:'100%',borderRadius:8}}/><a href={p.url} target="_blank" className="btn btn-primary" style={{marginTop:10,display:'block',textAlign:'center',textDecoration:'none'}}>View</a><button className="btn btn-danger" style={{width:'100%',marginTop:5}} onClick={()=>deleteItem('raw',p.id,p.url)}>Del</button></div>))}</div>}
            
            {/* ✅ FIX BUG <a> TAG DISINI */}
            {photoboxTab === 'final' && <div className="grid-cards">{finalDesigns.map(d=>(<div key={d.id} className="card" style={{border:'2px solid #10b981'}}><img src={d.url} style={{width:'100%',borderRadius:8}}/><a href={d.url} download className="btn btn-success" style={{marginTop:10,display:'block',textAlign:'center',textDecoration:'none'}}>⬇️ Download</a><button className="btn btn-danger" style={{width:'100%',marginTop:5}} onClick={()=>deleteItem('final',d.id,d.url)}>Del</button></div>))}</div>}
          </div>
        )}

        {/* --- FITUR LAMA: GALLERY --- */}
        {activeTab === 'gallery' && (
          <div><h2>Gallery Lama</h2><div className="grid-cards">{oldUserPhotos.map(p=>(<div key={p.id} className="card"><img src={p.url} style={{width:'100%'}}/><a href={p.url} target="_blank" style={{color:'#3b82f6'}}>Open</a></div>))}</div>
        )}

        {activeTab === 'tools' && (
          <div><h2>Tools</h2><button className="btn btn-danger" onClick={()=>{if(confirm("Reset?")){resetConfig();window.location.reload();}}}>Reset Config</button></div>
        )}
      </div>
    </div>
  );
}