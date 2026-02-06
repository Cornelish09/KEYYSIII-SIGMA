import { db, storage } from "../firebase"; // ✅ Tambah storage
import { doc, setDoc, deleteDoc, addDoc, collection, query, orderBy, onSnapshot } from "firebase/firestore"; 
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage"; // ✅ Storage imports
import React, { useState, useEffect, useRef } from "react";
import type { ContentConfig, Place, Outfit } from "../lib/types";
import { loadConfig, saveConfig, resetConfig, clearLogs } from "../lib/storage";
import { logEvent } from "../lib/activity";

// ✅ Photo Template Types
type PhotoSlot = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PhotoTemplate = {
  id: string;
  name: string;
  imageUrl: string;
  photoCount: number;
  slots: PhotoSlot[];
  canvasWidth: number;
  canvasHeight: number;
  createdAt: string;
};

// ✅ Sticker Type (BARU)
type Sticker = {
  id: string;
  url: string;
  createdAt: string;
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
  
  // ✅ UPDATE TAB: Tambah 'stickers'
  const [activeTab, setActiveTab] = useState<'general' | 'places' | 'outfits' | 'tools' | 'gallery' | 'templates' | 'stickers'>('general');
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");
  const [userPhotos, setUserPhotos] = useState<any[]>([]);
  
  // ✅ TEMPLATE STATES
  const [templates, setTemplates] = useState<PhotoTemplate[]>([]);
  const [uploadingTemplate, setUploadingTemplate] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PhotoTemplate | null>(null);

  // ✅ STICKER STATES (BARU)
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [uploadingSticker, setUploadingSticker] = useState(false);

  // ✅ VISUAL EDITOR STATES
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [editorMode, setEditorMode] = useState<'visual' | 'manual'>('visual');
  
  const SCALE = 0.35; 

  useEffect(() => {
    document.title = "Admin — Hangout Card";
  }, []);

  // --- VISUAL EDITOR LOGIC ---
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
    const canvas = canvasRef.current;
    if (!canvas) return;
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
    const canvas = canvasRef.current;
    if (!canvas) return;
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

  // --- AUTH & SAVE ---
  const verify = () => { const good = pass === (cfg.admin?.passcode || ""); setOk(good); logEvent("admin_verify", { ok: good }); };
  const updateConfig = (newCfg: ContentConfig) => { setCfg(prev => { const updated = { ...prev, ...newCfg }; saveConfig(updated); return updated; }); };
  const handleSave = async () => {
    try {
      const docRef = doc(db, "configs", "main_config");
      const dataToSave = { ...cfg };
      await setDoc(docRef, dataToSave);
      saveConfig(dataToSave); 
      localStorage.setItem("hangout_card_config_v1", JSON.stringify(dataToSave));
      window.dispatchEvent(new Event("storage"));
      alert("✅ Publish Berhasil!");
    } catch (e) { alert("Waduh, gagal connect ke Firebase."); }
  };

  // --- LISTENERS (Gallery, Templates, Stickers) ---
  useEffect(() => {
    if (activeTab !== 'gallery') return;
    // ✅ Ganti collection ke 'photobooth_gallery' (sesuai konsep baru) atau 'secret_photos' (lama)
    // Kita listener dua-duanya biar aman, atau migrate ke yang baru
    const q = query(collection(db, "photobooth_gallery"), orderBy("createdAt", "desc")); 
    return onSnapshot(q, (snapshot) => {
      setUserPhotos(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'templates') return;
    const q = query(collection(db, "photobox_templates"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snapshot) => {
      setTemplates(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as PhotoTemplate[]);
    });
  }, [activeTab]);

  // ✅ LISTENER STICKERS
  useEffect(() => {
    if (activeTab !== 'stickers') return;
    const q = query(collection(db, "stickers"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snapshot) => {
      setStickers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Sticker[]);
    });
  }, [activeTab]);

  // --- UPLOADERS ---
  const uploadToCloudinary = async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", "keyysi_sigma");
    formData.append("cloud_name", "dkfhlusok"); 
    const response = await fetch("https://api.cloudinary.com/v1_1/dkfhlusok/image/upload", { method: "POST", body: formData });
    if (!response.ok) throw new Error("Upload failed");
    return (await response.json()).secure_url;
  };

  const handleTemplateUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.includes('image/png')) return alert("❌ Wajib PNG!");
    const name = prompt("📝 Nama template:");
    if (!name) return;
    const photoCount = parseInt(prompt("📸 Jumlah foto (1-4):") || "1");
    setUploadingTemplate(true);
    try {
      const imageUrl = await uploadToCloudinary(file);
      const defaultSlots: PhotoSlot[] = Array.from({length: photoCount}).map((_, i) => ({ x: 50, y: 50 + (i * 300), width: 400, height: 250 }));
      const templateId = Date.now().toString();
      const newTemplate: PhotoTemplate = { id: templateId, name, imageUrl, photoCount, slots: defaultSlots, canvasWidth: 707, canvasHeight: 2000, createdAt: new Date().toISOString() };
      await setDoc(doc(db, "photobox_templates", templateId), newTemplate);
      alert("✅ Template berhasil!");
    } catch (err) { alert("❌ Gagal upload"); }
    setUploadingTemplate(false);
  };

  // ✅ HANDLE STICKER UPLOAD
  const handleStickerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.includes('image/png')) return alert("❌ Sticker harus PNG background transparan!");
    setUploadingSticker(true);
    try {
      // Upload ke Firebase Storage (Lebih rapi buat aset kecil kayak stiker)
      const storageRef = ref(storage, `stickers/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      
      await addDoc(collection(db, "stickers"), { url, createdAt: new Date().toISOString() });
      alert("✅ Sticker added!");
    } catch (err) { console.error(err); alert("❌ Gagal upload sticker"); }
    setUploadingSticker(false);
  };

  const deleteTemplate = async (id: string) => { if (confirm("Hapus?")) deleteDoc(doc(db, "photobox_templates", id)); };
  
  const deleteSticker = async (id: string) => { if (confirm("Hapus Sticker?")) deleteDoc(doc(db, "stickers", id)); };

  const saveSlotChanges = async (template: PhotoTemplate) => {
    try { await setDoc(doc(db, "photobox_templates", template.id), { ...template, slots: template.slots }, {merge: true}); alert("✅ Saved!"); setEditingTemplate(null); } catch { alert("❌ Error"); }
  };

  // --- CRUD HELPERS ---
  const updatePlace = (idx: number, field: keyof Place, val: any) => { const newItems = [...cfg.places.items]; newItems[idx] = { ...newItems[idx], [field]: val }; updateConfig({ ...cfg, places: { ...cfg.places, items: newItems } }); };
  const updateOutfit = (idx: number, field: keyof Outfit, val: any) => { const newItems = [...(cfg.outfits?.items || [])]; newItems[idx] = { ...newItems[idx], [field]: val }; updateConfig({ ...cfg, outfits: { ...(cfg.outfits || { headline: "", subtitle: "" }), items: newItems } }); };
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, callback: (base64: string) => void) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader(); reader.onload = (event) => { const img = new Image(); img.onload = () => { const canvas = document.createElement('canvas'); let width = img.width; let height = img.height; const MAX_SIZE = 1200; if (width > height) { if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; } } else { if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; } } canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d', { alpha: false }); ctx?.drawImage(img, 0, 0, width, height); callback(canvas.toDataURL('image/jpeg', 0.7)); }; img.src = event.target?.result as string; }; reader.readAsDataURL(file);
  };
  const removeItem = (type: 'place' | 'outfit', idx: number) => { if(!confirm("Hapus?")) return; if (type === 'place') { const newItems = [...cfg.places.items]; newItems.splice(idx, 1); updateConfig({ ...cfg, places: { ...cfg.places, items: newItems } }); } else { const newItems = [...(cfg.outfits?.items || [])]; newItems.splice(idx, 1); updateConfig({ ...cfg, outfits: { ...cfg.outfits!, items: newItems } }); } };

  if (!ok) return <div style={{minHeight:"100vh",background:"#0f172a",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{background:"#1e293b",padding:30,borderRadius:12}}><h2 style={{color:'white',marginTop:0}}>🔒 Admin</h2><input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="Passcode" style={{width:"100%",padding:10,marginBottom:15}}/><button onClick={verify} style={{width:"100%",padding:10,background:"#3b82f6",color:"white",border:"none"}}>Login</button></div></div>;

  return (
    <div className="admin-layout">
      <style>{`
        .admin-layout { display: flex; min-height: 100vh; background: #0f172a; color: #cbd5e1; font-family: 'Inter', sans-serif; }
        .sidebar { width: 240px; background: #1e293b; border-right: 1px solid #334155; padding: 20px; flex-shrink: 0; display: flex; flex-direction: column; position: fixed; height: 100vh; }
        .main-content { flex: 1; margin-left: 240px; padding: 40px; max-width: 1000px; }
        .section-title { font-size: 24px; font-weight: 800; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 1px solid #334155; }
        .nav-btn { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 12px 16px; border-radius: 8px; border: none; background: transparent; color: #94a3b8; cursor: pointer; font-weight: 600; font-size: 14px; transition: 0.2s; margin-bottom: 5px; }
        .nav-btn:hover { background: rgba(255,255,255,0.05); color: white; }
        .nav-btn.active { background: #3b82f6; color: white; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4); }
        .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 24px; margin-bottom: 20px; position: relative; }
        .input, .textarea { width: 100%; background: #020617; border: 1px solid #475569; color: white; padding: 10px; border-radius: 6px; font-size: 14px; }
        .btn { padding: 10px 20px; border-radius: 6px; font-weight: 600; border: none; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; font-size: 14px; }
        .btn-primary { background: #3b82f6; color: white; }
        .btn-success { background: #10b981; color: white; }
        .btn-danger { background: #ef4444; color: white; }
        .save-btn { position: fixed; top: 20px; right: 20px; z-index: 100; background: #10b981; color: white; padding: 12px 24px; border-radius: 50px; font-weight: 700; box-shadow: 0 10px 20px rgba(0,0,0,0.3); border: none; cursor: pointer; transition: 0.3s; }
        .save-btn:hover { transform: scale(1.05); }
      `}</style>

      <button className="save-btn" onClick={handleSave}>{saveStatus === 'saved' ? "✅ ALL PUBLISHED!" : "💾 PUBLISH CHANGES"}</button>

      <div className="sidebar">
        <h3 style={{ paddingBottom: 20, borderBottom: '1px solid #334155', marginBottom: 20, color: 'white' }}>⚡ Admin Panel</h3>
        <button className={`nav-btn ${activeTab === 'general' ? 'active' : ''}`} onClick={() => setActiveTab('general')}>🏠 General</button>
        <button className={`nav-btn ${activeTab === 'places' ? 'active' : ''}`} onClick={() => setActiveTab('places')}>📍 Places Manager</button>
        <button className={`nav-btn ${activeTab === 'outfits' ? 'active' : ''}`} onClick={() => setActiveTab('outfits')}>👗 Outfit Manager</button>
        {/* ✅ TAB BARU */}
        <button className={`nav-btn ${activeTab === 'templates' ? 'active' : ''}`} onClick={() => setActiveTab('templates')}>🎨 Frame Templates</button>
        <button className={`nav-btn ${activeTab === 'stickers' ? 'active' : ''}`} onClick={() => setActiveTab('stickers')}>✨ Sticker Manager</button>
        <button className={`nav-btn ${activeTab === 'gallery' ? 'active' : ''}`} onClick={() => setActiveTab('gallery')}>📸 User Gallery</button>
        <button className={`nav-btn ${activeTab === 'tools' ? 'active' : ''}`} onClick={() => setActiveTab('tools')}>🔧 Tools</button>
      </div>

      <div className="main-content">
        {activeTab === 'general' && (
          <div>
            <div className="section-title">General Settings</div>
            <div className="card"><label style={{display:'block',marginBottom:8,fontWeight:'bold',fontSize:12}}>Background Music</label><input className="input" value={cfg.music || ""} onChange={e => updateConfig({...cfg, music: e.target.value})} placeholder="/audio/song.mp3" /></div>
            <div className="card"><label style={{display:'block',marginBottom:8,fontWeight:'bold',fontSize:12}}>Letter Text</label><textarea className="textarea" style={{ height: 200 }} value={cfg.letter?.text || ""} onChange={e => updateConfig({...cfg, letter: { ...cfg.letter, text: e.target.value }})} /></div>
          </div>
        )}

        {/* --- PLACES & OUTFITS (SHORTENED FOR BREVITY, LOGIC SAME) --- */}
        {activeTab === 'places' && (
          <div>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:20}}><div className="section-title">Places</div><button className="btn btn-success" onClick={() => { const newItem: Place = { id: randomId("place"), name: "New Place", description: "", image: "", locationUrl: "", tags: ["dinner"], budget: "", openHours: "", swot: "" }; updateConfig({ ...cfg, places: { ...cfg.places, items: [newItem, ...cfg.places.items] } }); }}>+ Add</button></div>
            {cfg.places.items.map((p, idx) => (<div key={p.id} className="card"><div style={{marginBottom:10}}><input className="input" value={p.name} onChange={e => updatePlace(idx, "name", e.target.value)} /></div><div style={{display:'flex',gap:10}}><img src={p.image} style={{width:50,height:50,objectFit:'cover',borderRadius:4}}/><input className="input" value={p.image} onChange={e => updatePlace(idx, "image", e.target.value)} /><input type="file" onChange={e => handleImageUpload(e, b64 => updatePlace(idx, "image", b64))}/></div><button className="btn btn-danger" style={{marginTop:10}} onClick={() => removeItem('place', idx)}>Delete</button></div>))}
          </div>
        )}
        {activeTab === 'outfits' && (
          <div>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:20}}><div className="section-title">Outfits</div><button className="btn btn-success" onClick={() => { const newItem: Outfit = { id: randomId("outfit"), name: "New Style", description: "", image: "", style: "casual", palette: [] }; updateConfig({ ...cfg, outfits: { ...(cfg.outfits || { headline: "", subtitle: "" }), items: [newItem, ...(cfg.outfits?.items || [])] } }); }}>+ Add</button></div>
            {(cfg.outfits?.items || []).map((o, idx) => (<div key={o.id} className="card"><input className="input" value={o.name} onChange={e => updateOutfit(idx, "name", e.target.value)} style={{marginBottom:10}} /><div style={{display:'flex',gap:10}}><img src={o.image} style={{width:50,height:50,objectFit:'cover',borderRadius:4}}/><input className="input" value={o.image} onChange={e => updateOutfit(idx, "image", e.target.value)} /><input type="file" onChange={e => handleImageUpload(e, b64 => updateOutfit(idx, "image", b64))}/></div><button className="btn btn-danger" style={{marginTop:10}} onClick={() => removeItem('outfit', idx)}>Delete</button></div>))}
          </div>
        )}

        {/* ✅ TEMPLATE MANAGER (EXISTING CANVAS EDITOR) */}
        {activeTab === 'templates' && (
          <div>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20}}>
              <div className="section-title" style={{marginBottom:0, border:0}}>🎨 Frame Templates</div>
              <label className="btn btn-success" style={{cursor:'pointer'}}>
                {uploadingTemplate ? "⏳..." : "+ Upload Frame"}
                <input type="file" accept="image/png" style={{display:'none'}} onChange={handleTemplateUpload} disabled={uploadingTemplate} />
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '20px' }}>
              {templates.map((template) => (
                <div key={template.id} className="card">
                  <div style={{ height: 250, background: '#000', borderRadius: 8, marginBottom: 10, overflow:'hidden' }}><img src={template.imageUrl} style={{width:'100%',height:'100%',objectFit:'contain'}} /></div>
                  <div style={{fontWeight:'bold',color:'white'}}>{template.name}</div>
                  <div style={{display:'flex',gap:10,marginTop:10}}>
                    <button className="btn btn-primary" style={{flex:1}} onClick={() => setEditingTemplate(template)}>⚙️ Slots</button>
                    <button className="btn btn-danger" onClick={() => deleteTemplate(template.id)}>🗑️</button>
                  </div>
                </div>
              ))}
            </div>

            {/* MODAL EDITOR CANVAS */}
            {editingTemplate && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                <div style={{ background: '#1e293b', borderRadius: 16, padding: 30, maxWidth: 1000, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:20}}>
                    <h2 style={{color:'white',margin:0}}>⚙️ Edit: {editingTemplate.name}</h2>
                    <button onClick={() => setEditorMode(editorMode==='visual'?'manual':'visual')} className="btn btn-secondary">{editorMode==='visual'?'🔢 Manual Mode':'🎨 Visual Mode'}</button>
                  </div>
                  {editorMode === 'visual' ? (
                    <div style={{display:'flex',justifyContent:'center',background:'#000',padding:20,borderRadius:10}}>
                      <canvas ref={canvasRef} width={editingTemplate.canvasWidth * SCALE} height={editingTemplate.canvasHeight * SCALE} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} style={{cursor:isDragging?'grabbing':isResizing?'nwse-resize':'grab',maxWidth:'100%'}} />
                    </div>
                  ) : (
                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:10}}>
                      {editingTemplate.slots.map((s,i)=>(<div key={i} className="card"><h4 style={{marginTop:0,color:'#3b82f6'}}>Slot {i+1}</h4><input type="number" value={s.x} onChange={e=>{const ns=[...editingTemplate.slots];ns[i].x=parseInt(e.target.value);setEditingTemplate({...editingTemplate,slots:ns})}} placeholder="X" className="input" style={{marginBottom:5}}/><input type="number" value={s.y} onChange={e=>{const ns=[...editingTemplate.slots];ns[i].y=parseInt(e.target.value);setEditingTemplate({...editingTemplate,slots:ns})}} placeholder="Y" className="input" style={{marginBottom:5}}/><input type="number" value={s.width} onChange={e=>{const ns=[...editingTemplate.slots];ns[i].width=parseInt(e.target.value);setEditingTemplate({...editingTemplate,slots:ns})}} placeholder="W" className="input" style={{marginBottom:5}}/><input type="number" value={s.height} onChange={e=>{const ns=[...editingTemplate.slots];ns[i].height=parseInt(e.target.value);setEditingTemplate({...editingTemplate,slots:ns})}} placeholder="H" className="input"/></div>))}
                    </div>
                  )}
                  <div style={{display:'flex',gap:10,marginTop:20}}>
                    <button className="btn btn-success" style={{flex:1}} onClick={() => saveSlotChanges(editingTemplate)}>✅ Save Changes</button>
                    <button className="btn btn-secondary" onClick={() => setEditingTemplate(null)}>❌ Cancel</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ✅ STICKER MANAGER (TAB BARU) */}
        {activeTab === 'stickers' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div className="section-title" style={{ marginBottom: 0, border: 0 }}>✨ Sticker Manager</div>
              <label className="btn btn-success" style={{ cursor: 'pointer' }}>
                {uploadingSticker ? "⏳ Uploading..." : "+ Upload Sticker"}
                <input type="file" accept="image/png" style={{ display: 'none' }} onChange={handleStickerUpload} disabled={uploadingSticker} />
              </label>
            </div>
            <div style={{ background: '#1e293b', padding: 20, borderRadius: 12, marginBottom: 20 }}>
              <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>💡 Upload gambar **PNG Transparan** (Emoji, Icon, Hiasan). User nanti bisa tempel ini sesuka hati di foto mereka!</p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '15px' }}>
              {stickers.map((s) => (
                <div key={s.id} className="card" style={{ padding: 15, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <img src={s.url} style={{ width: 80, height: 80, objectFit: 'contain', marginBottom: 10 }} alt="sticker" />
                  <button className="btn btn-danger" style={{ fontSize: 11, padding: '5px 10px' }} onClick={() => deleteSticker(s.id)}>Hapus</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ✅ GALLERY UPGRADE (RAW vs FINAL) */}
        {activeTab === 'gallery' && (
          <div>
            <div className="section-title">📸 Live User Gallery</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '20px' }}>
              {userPhotos.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: '40px', color: '#64748b', gridColumn: '1 / -1' }}>Belum ada foto masuk.</div>
              ) : (
                userPhotos.map((photo) => (
                  <div key={photo.id} className="card" style={{ padding: '10px', border: photo.type === 'final' ? '2px solid #3b82f6' : '1px solid #334155' }}>
                    {/* Badge Tipe Foto */}
                    <div style={{ 
                      fontSize: 10, fontWeight: 'bold', 
                      color: photo.type === 'final' ? '#fff' : '#94a3b8',
                      background: photo.type === 'final' ? '#3b82f6' : 'rgba(255,255,255,0.1)',
                      padding: '4px 8px', borderRadius: 4, display: 'inline-block', marginBottom: 8 
                    }}>
                      {photo.type === 'final' ? '🎨 FINAL DESIGN' : '🎞️ RAW CAPTURE'}
                    </div>

                    <img src={photo.url} style={{ width: '100%', borderRadius: '8px', marginBottom: '10px', border: '1px solid #334155', background: '#000' }} alt="User Capture" />
                    
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>📅 {new Date(photo.createdAt).toLocaleString('id-ID')}</div>
                    <a href={photo.url} target="_blank" rel="noreferrer" style={{ color: '#3b82f6', fontSize: '12px', textDecoration: 'none', display: 'block', marginTop: '8px', fontWeight: 'bold' }}>Buka Full Image ↗</a>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'tools' && (
          <div className="card">
            <h3>Backup & Restore</h3>
            <div style={{ display: 'flex', gap: 15, marginTop: 20 }}>
              <button className="btn btn-primary" onClick={() => {
                const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(cfg));
                const downloadAnchorNode = document.createElement('a'); downloadAnchorNode.setAttribute("href", dataStr); downloadAnchorNode.setAttribute("download", "backup.json"); downloadAnchorNode.click();
              }}>Download</button>
              <button className="btn btn-danger" onClick={() => { if(confirm("Reset?")) { resetConfig(); window.location.reload(); } }}>Reset</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}