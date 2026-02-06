import { db } from "../firebase"; 
import { doc, setDoc } from "firebase/firestore"; 
import React, { useState, useEffect, useRef } from "react";
import type { ContentConfig, Place, Outfit } from "../lib/types";
import { loadConfig, saveConfig, resetConfig, clearLogs } from "../lib/storage";
import { logEvent } from "../lib/activity";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { storage } from "../firebase";

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

// User Photos Type
type UserPhoto = {
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
  const [activeTab, setActiveTab] = useState<'general' | 'places' | 'outfits' | 'tools' | 'gallery' | 'templates'>('general');
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");
  
  // ✅ TEMPLATE STATES
  const [templates, setTemplates] = useState<PhotoTemplate[]>([]);
  const [uploadingTemplate, setUploadingTemplate] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PhotoTemplate | null>(null);

  // ✅ GALLERY STATES
  const [userPhotos, setUserPhotos] = useState<UserPhoto[]>([]);

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

  // --- VISUAL EDITOR LOGIC (CANVAS DRAWING) ---
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

  // --- MOUSE HANDLERS FOR CANVAS ---
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!editingTemplate) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) / SCALE;
    const mouseY = (e.clientY - rect.top) / SCALE;

    if (selectedSlot !== null) {
      const slot = editingTemplate.slots[selectedSlot];
      const handleX = slot.x + slot.width;
      const handleY = slot.y + slot.height;
      
      if (Math.abs(mouseX - handleX) < 25 && Math.abs(mouseY - handleY) < 25) {
        setIsResizing(true);
        setDragStart({ x: mouseX, y: mouseY });
        return;
      }
    }

    for (let i = editingTemplate.slots.length - 1; i >= 0; i--) {
      const slot = editingTemplate.slots[i];
      if (mouseX >= slot.x && mouseX <= slot.x + slot.width && mouseY >= slot.y && mouseY <= slot.y + slot.height) {
        setSelectedSlot(i);
        setIsDragging(true);
        setDragStart({ x: mouseX - slot.x, y: mouseY - slot.y });
        return;
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

  const handleMouseUp = () => {
    setIsDragging(false);
    setIsResizing(false);
  };

  // --- AUTH & CONFIG LOGIC ---
  const verify = () => {
    const good = pass === (cfg.admin?.passcode || ""); 
    setOk(good);
    logEvent("admin_verify", { ok: good });
  };

  const updateConfig = (newCfg: ContentConfig) => {
    setCfg(prev => {
      const updated = { ...prev, ...newCfg };
      saveConfig(updated);
      return updated;
    });
  };

  const handleSave = async () => {
    try {
      const docRef = doc(db, "configs", "main_config");
      const dataToSave = { ...cfg };
      await setDoc(docRef, dataToSave);
      saveConfig(dataToSave); 
      localStorage.setItem("hangout_card_config_v1", JSON.stringify(dataToSave));
      window.dispatchEvent(new Event("storage"));
      alert("✅ Publish Berhasil! Coba cek HP, harusnya udah berubah.");
      logEvent("admin_save_success", { time: new Date().getTime() });
    } catch (e) {
      console.error("Error pas mau save:", e);
      alert("Waduh, gagal connect ke Firebase. Cek internet bro!");
    }
  };

  // --- LISTENERS ---
  useEffect(() => {
    let unsubscribe: any;
    const startListener = async () => {
      if (activeTab !== 'gallery') return;
      const { collection, query, orderBy, onSnapshot } = await import("firebase/firestore");
      const q = query(collection(db, "secret_photos"), orderBy("createdAt", "desc"));
      unsubscribe = onSnapshot(q, (snapshot) => {
        const photos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as UserPhoto[];
        setUserPhotos(photos);
      });
    };
    startListener();
    return () => { if (unsubscribe) unsubscribe(); };
  }, [activeTab]);

  useEffect(() => {
    let unsubscribe: any;
    const startListener = async () => {
      if (activeTab !== 'templates') return;
      const { collection, query, orderBy, onSnapshot } = await import("firebase/firestore");
      const q = query(collection(db, "photobox_templates"), orderBy("createdAt", "desc"));
      unsubscribe = onSnapshot(q, (snapshot) => {
        const temps = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as PhotoTemplate[];
        setTemplates(temps);
      });
    };
    startListener();
    return () => { if (unsubscribe) unsubscribe(); };
  }, [activeTab]);

  // --- TEMPLATE FUNCTIONS ---
  const uploadTemplateToCloudinary = async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", "keyysi_sigma");
    formData.append("cloud_name", "dkfhlusok"); 

    const response = await fetch("https://api.cloudinary.com/v1_1/dkfhlusok/image/upload", { method: "POST", body: formData });
    if (!response.ok) throw new Error("Upload failed");
    const data = await response.json();
    return data.secure_url;
  };

  const handleTemplateUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.includes('image/png')) { alert("❌ Hanya file PNG yang diperbolehkan!"); return; }

    const name = prompt("📝 Nama template (contoh: Valentine Frame):");
    if (!name) return;
    const photoCountStr = prompt("📸 Jumlah foto (1-4):");
    const photoCount = parseInt(photoCountStr || "1");
    if (photoCount < 1 || photoCount > 4) { alert("❌ Jumlah foto harus 1-4!"); return; }

    setUploadingTemplate(true);
    try {
      const imageUrl = await uploadTemplateToCloudinary(file);
      const defaultSlots: PhotoSlot[] = [];
      for (let i = 0; i < photoCount; i++) {
        defaultSlots.push({ x: 50, y: 50 + (i * 300), width: 400, height: 250 });
      }
      
      const { doc, setDoc } = await import("firebase/firestore");
      const templateId = Date.now().toString();
      const newTemplate: PhotoTemplate = {
        id: templateId, name, imageUrl, photoCount, slots: defaultSlots,
        canvasWidth: 707, canvasHeight: 2000, createdAt: new Date().toISOString()
      };

      await setDoc(doc(db, "photobox_templates", templateId), newTemplate);
      alert("✅ Template berhasil di-upload!");
    } catch (err) {
      console.error(err);
      alert("❌ Gagal upload template");
    }
    setUploadingTemplate(false);
  };

  const deleteTemplate = async (id: string) => {
    if (!confirm("🗑️ Hapus template ini?")) return;
    try {
      const { doc, deleteDoc } = await import("firebase/firestore");
      await deleteDoc(doc(db, "photobox_templates", id));
      alert("✅ Template berhasil dihapus!");
    } catch (err) { alert("❌ Gagal hapus template"); }
  };

  const saveSlotChanges = async (template: PhotoTemplate) => {
    try {
      const { doc, updateDoc } = await import("firebase/firestore");
      await updateDoc(doc(db, "photobox_templates", template.id), { slots: template.slots });
      alert("✅ Slot posisi berhasil disimpan!");
      setEditingTemplate(null);
    } catch (err) { alert("❌ Gagal simpan perubahan"); }
  };

  // --- CRUD HELPERS (Places & Outfits) ---
  const updatePlace = (idx: number, field: keyof Place, val: any) => {
    const newItems = [...cfg.places.items];
    newItems[idx] = { ...newItems[idx], [field]: val };
    updateConfig({ ...cfg, places: { ...cfg.places, items: newItems } });
  };
  
  const updateOutfit = (idx: number, field: keyof Outfit, val: any) => {
    const currentItems = cfg.outfits?.items || [];
    const newItems = [...currentItems];
    newItems[idx] = { ...newItems[idx], [field]: val };
    const newConfigData = { ...cfg, outfits: { ...(cfg.outfits || { headline: "", subtitle: "" }), items: newItems } };
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
        let width = img.width; let height = img.height; const MAX_SIZE = 1200; 
        if (width > height) { if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; } } 
        else { if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; } }
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx?.drawImage(img, 0, 0, width, height);
        callback(canvas.toDataURL('image/jpeg', 0.7));
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
    const newItem: Place = { 
      id: randomId("place"), 
      name: "New Place", 
      description: "", 
      image: "", 
      locationUrl: "", 
      tags: ["dinner"], 
      budget: "", 
      openHours: "", 
      swot: "" 
    };
    updateConfig({ ...cfg, places: { ...cfg.places, items: [newItem, ...cfg.places.items] } });
  };
  
  const addOutfit = () => {
    const newItem: Outfit = { 
      id: randomId("outfit"), 
      name: "New Style", 
      description: "", 
      image: "", 
      style: "casual", 
      palette: [] 
    };
    updateConfig({ ...cfg, outfits: { ...(cfg.outfits || { headline: "Outfit", subtitle: "Style" }), items: [newItem, ...(cfg.outfits?.items || [])] } });
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
          <input 
            type="password" 
            value={pass} 
            onChange={e => setPass(e.target.value)} 
            onKeyDown={e => e.key === 'Enter' && verify()} 
            placeholder="Enter Passcode" 
            style={{ width: "100%", padding: 10, borderRadius: 6, border: "1px solid #475569", background: "#0f172a", color: "white", marginBottom: 15 }} 
          />
          <button onClick={verify} style={{ width: "100%", padding: 10, background: "#3b82f6", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: "bold" }}>
            Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-layout">
      <style>{`
        * { box-sizing: border-box; }
        .admin-layout { display: flex; min-height: 100vh; background: #0f172a; color: #cbd5e1; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
        .sidebar { width: 240px; background: #1e293b; border-right: 1px solid #334155; padding: 20px; flex-shrink: 0; display: flex; flex-direction: column; position: fixed; height: 100vh; overflow-y: auto; }
        .main-content { flex: 1; margin-left: 240px; padding: 40px; max-width: 1400px; width: 100%; }
        h1, h2, h3 { color: white; margin-top: 0; }
        .section-title { font-size: 24px; font-weight: 800; margin-bottom: 24px; padding-bottom: 12px; border-bottom: 2px solid #334155; color: white; }
        
        .label { 
          display: block; 
          font-size: 12px; 
          font-weight: 700; 
          color: #94a3b8; 
          text-transform: uppercase; 
          margin-bottom: 8px; 
          letter-spacing: 0.5px; 
        }
        
        .nav-btn { 
          display: flex; 
          align-items: center; 
          gap: 10px; 
          width: 100%; 
          text-align: left; 
          padding: 12px 16px; 
          border-radius: 8px; 
          border: none; 
          background: transparent; 
          color: #94a3b8; 
          cursor: pointer; 
          font-weight: 600; 
          font-size: 14px; 
          transition: all 0.2s; 
          margin-bottom: 5px; 
        }
        .nav-btn:hover { background: rgba(255,255,255,0.05); color: white; }
        .nav-btn.active { background: #3b82f6; color: white; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3); }
        
        .card { 
          background: #1e293b; 
          border: 1px solid #334155; 
          border-radius: 16px; 
          padding: 24px; 
          margin-bottom: 20px; 
          position: relative; 
        }
        
        .input, .textarea, select { 
          width: 100%; 
          background: #0f172a; 
          border: 1px solid #334155; 
          color: white; 
          padding: 12px 14px; 
          border-radius: 8px; 
          font-size: 14px; 
          font-family: inherit; 
          transition: all 0.2s; 
        }
        .input:focus, .textarea:focus, select:focus { 
          outline: none; 
          border-color: #3b82f6; 
          background: #020617;
        }
        .textarea { min-height: 100px; resize: vertical; }
        
        .btn { 
          padding: 10px 20px; 
          border-radius: 8px; 
          font-weight: 600; 
          border: none; 
          cursor: pointer; 
          display: inline-flex; 
          align-items: center; 
          justify-content: center;
          gap: 8px; 
          font-size: 14px; 
          transition: all 0.2s; 
        }
        .btn:hover { transform: translateY(-1px); opacity: 0.9; }
        .btn-primary { background: #3b82f6; color: white; }
        .btn-success { background: #10b981; color: white; }
        .btn-danger { background: #ef4444; color: white; }
        .btn-secondary { background: #64748b; color: white; }
        
        .save-btn { 
          position: fixed; 
          top: 24px; 
          right: 24px; 
          z-index: 100; 
          background: #10b981; 
          color: white; 
          padding: 14px 28px; 
          border-radius: 12px; 
          font-weight: 700; 
          box-shadow: 0 10px 30px rgba(16, 185, 129, 0.4); 
          border: none; 
          cursor: pointer; 
          transition: all 0.3s; 
          font-size: 14px;
        }
        .save-btn:hover { transform: scale(1.05); box-shadow: 0 15px 40px rgba(16, 185, 129, 0.5); }
        
        .tag-row { 
          display: flex; 
          gap: 10px; 
          flex-wrap: wrap; 
        }
        .tag-chip { 
          padding: 8px 18px; 
          border-radius: 24px; 
          border: 2px solid #334155; 
          background: #0f172a; 
          color: #94a3b8; 
          cursor: pointer; 
          font-size: 13px; 
          font-weight: 600; 
          transition: all 0.2s;
        }
        .tag-chip:hover { border-color: #475569; }
        .tag-chip.active { 
          background: #8b5cf6; 
          color: white; 
          border-color: #8b5cf6; 
        }
        
        .preview-box { 
          width: 120px; 
          height: 120px; 
          border-radius: 12px; 
          background: #0f172a; 
          border: 2px dashed #334155; 
          display: flex; 
          align-items: center; 
          justify-content: center; 
          overflow: hidden; 
          flex-shrink: 0;
        }
        .preview-img { 
          width: 100%; 
          height: 100%; 
          object-fit: cover; 
        }
        
        .file-label { 
          cursor: pointer; 
          color: #3b82f6; 
          font-size: 13px; 
          font-weight: 600; 
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin-top: 8px; 
          transition: all 0.2s;
        }
        .file-label:hover { color: #60a5fa; }
        
        .grid-2 { 
          display: grid; 
          grid-template-columns: 1fr 1fr; 
          gap: 20px; 
        }
        
        .palette-container { 
          display: flex; 
          align-items: center; 
          gap: 10px; 
          margin-top: 10px; 
          flex-wrap: wrap; 
        }
        .palette-item { 
          width: 36px; 
          height: 36px; 
          border-radius: 50%; 
          border: 3px solid rgba(255,255,255,0.2); 
          cursor: pointer; 
          transition: transform 0.2s; 
          position: relative; 
        }
        .palette-item:hover { 
          transform: scale(1.15); 
          border-color: rgba(255,255,255,0.4);
        }
        .palette-item:hover::after { 
          content: '×'; 
          position: absolute; 
          inset: 0; 
          display: flex; 
          align-items: center; 
          justify-content: center; 
          font-size: 20px; 
          color: white; 
          font-weight: bold; 
          background: rgba(0,0,0,0.5);
          border-radius: 50%;
        }
        
        .color-picker-input { 
          width: 36px; 
          height: 36px; 
          padding: 0; 
          border: 2px dashed #475569; 
          border-radius: 50%;
          background: transparent; 
          cursor: pointer; 
        }
        
        .field-group {
          margin-bottom: 20px;
        }
        
        .photo-upload-section {
          display: flex;
          gap: 20px;
          align-items: flex-start;
          background: #0f172a;
          padding: 20px;
          border-radius: 12px;
          margin-bottom: 20px;
        }
        
        .swot-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
          margin-bottom: 20px;
        }
        
        .swot-box {
          background: #0f172a;
          padding: 16px;
          border-radius: 12px;
          border: 2px solid;
        }
        
        .swot-box.plus {
          border-color: #10b981;
        }
        
        .swot-box.minus {
          border-color: #ef4444;
        }
        
        .swot-label {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          font-weight: 700;
          text-transform: uppercase;
          margin-bottom: 10px;
          letter-spacing: 0.5px;
        }
        
        .swot-label.plus {
          color: #10b981;
        }
        
        .swot-label.minus {
          color: #ef4444;
        }
        
        .bottom-actions {
          display: flex;
          gap: 12px;
          padding-top: 20px;
          border-top: 1px solid #334155;
          margin-top: 20px;
        }
      `}</style>

      <button className="save-btn" onClick={handleSave}>
        {saveStatus === 'saved' ? "✅ PUBLISHED!" : "💾 PUBLISH CHANGES"}
      </button>

      <div className="sidebar">
        <h3 style={{ paddingBottom: 20, borderBottom: '1px solid #334155', marginBottom: 20 }}>⚡ Admin Panel</h3>
        <button className={`nav-btn ${activeTab === 'general' ? 'active' : ''}`} onClick={() => setActiveTab('general')}>
          🏠 General
        </button>
        <button className={`nav-btn ${activeTab === 'places' ? 'active' : ''}`} onClick={() => setActiveTab('places')}>
          📍 Places Manager
        </button>
        <button className={`nav-btn ${activeTab === 'outfits' ? 'active' : ''}`} onClick={() => setActiveTab('outfits')}>
          👗 Outfit Manager
        </button>
        <button className={`nav-btn ${activeTab === 'templates' ? 'active' : ''}`} onClick={() => setActiveTab('templates')}>
          🎨 Template Manager
        </button>
        <button className={`nav-btn ${activeTab === 'gallery' ? 'active' : ''}`} onClick={() => setActiveTab('gallery')}>
          📸 User Gallery
        </button>
        <button className={`nav-btn ${activeTab === 'tools' ? 'active' : ''}`} onClick={() => setActiveTab('tools')}>
          🔧 Tools
        </button>
      </div>

      <div className="main-content">
        {/* GENERAL TAB */}
        {activeTab === 'general' && (
          <div>
            <div className="section-title">General Settings</div>
            
            <div className="card">
              <label className="label">Background Music (MP3 URL)</label>
              <input 
                className="input" 
                value={cfg.music || ""} 
                onChange={e => updateConfig({...cfg, music: e.target.value})} 
                placeholder="https://example.com/audio/song.mp3" 
              />
            </div>

            <div className="card">
              <label className="label">Isi Surat (Letter)</label>
              <textarea 
                className="textarea" 
                style={{ height: 250 }} 
                value={cfg.letter?.text || ""} 
                onChange={e => updateConfig({...cfg, letter: { ...cfg.letter, text: e.target.value }})} 
                placeholder="Tulis surat untuk Keysia di sini..."
              />
            </div>
          </div>
        )}

        {/* PLACES TAB */}
        {activeTab === 'places' && (
          <div>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24}}>
              <div className="section-title" style={{marginBottom:0, border:0}}>Places Manager</div>
              <button className="btn btn-success" onClick={addPlace}>
                + Add Place
              </button>
            </div>

            {cfg.places.items.map((p, idx) => {
              const swot = parseSwot(p.swot);
              return (
                <div key={p.id} className="card">
                  {/* Top Grid: Name + Category */}
                  <div className="grid-2" style={{ marginBottom: 20 }}>
                    <div className="field-group">
                      <label className="label">Nama Tempat</label>
                      <input 
                        className="input" 
                        value={p.name} 
                        onChange={e => updatePlace(idx, "name", e.target.value)} 
                        placeholder="Nama tempat..."
                      />
                    </div>
                    <div className="field-group">
                      <label className="label">Kategori</label>
                      <div className="tag-row">
                        {['dinner', 'snack', 'dessert'].map(tag => (
                          <button 
                            key={tag} 
                            className={`tag-chip ${p.tags.includes(tag) ? 'active' : ''}`} 
                            onClick={() => toggleTag(idx, tag)}
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Photo Upload Section */}
                  <div className="photo-upload-section">
                    <div className="preview-box">
                      {p.image ? (
                        <img src={p.image} className="preview-img" alt="preview" />
                      ) : (
                        <span style={{fontSize:11, color:'#64748b'}}>No Image</span>
                      )}
                    </div>
                    <div style={{ flex: 1 }}>
                      <label className="label">Foto Tempat</label>
                      <input 
                        className="input" 
                        value={p.image} 
                        onChange={e => updatePlace(idx, "image", e.target.value)} 
                        placeholder="URL atau upload dari galeri..." 
                      />
                      <label className="file-label">
                        📤 Upload dari Galeri
                        <input 
                          type="file" 
                          accept="image/*" 
                          style={{display:'none'}} 
                          onChange={e => handleImageUpload(e, (b64) => updatePlace(idx, "image", b64))} 
                        />
                      </label>
                    </div>
                  </div>

                  {/* Description */}
                  <div className="field-group">
                    <label className="label">Deskripsi</label>
                    <textarea 
                      className="textarea" 
                      value={p.description} 
                      onChange={e => updatePlace(idx, "description", e.target.value)} 
                      placeholder="Deskripsiin tempat ini..."
                    />
                  </div>

                  {/* Budget + Open Hours */}
                  <div className="grid-2" style={{ marginBottom: 20 }}>
                    <div className="field-group">
                      <label className="label">Budget</label>
                      <input 
                        className="input" 
                        value={p.budget || ""} 
                        onChange={e => updatePlace(idx, "budget", e.target.value)} 
                        placeholder="50k - 100k"
                      />
                    </div>
                    <div className="field-group">
                      <label className="label">Jam Buka</label>
                      <input 
                        className="input" 
                        value={p.openHours || ""} 
                        onChange={e => updatePlace(idx, "openHours", e.target.value)} 
                        placeholder="10:00 - 22:00"
                      />
                    </div>
                  </div>

                  {/* SWOT Analysis */}
                  <div className="swot-grid">
                    <div className="swot-box plus">
                      <div className="swot-label plus">✅ Kelebihan (Plus)</div>
                      <textarea 
                        className="textarea" 
                        style={{background:'transparent', border:'none'}}
                        value={swot.plus} 
                        onChange={e => updateSwot(idx, 'plus', e.target.value)} 
                        placeholder="Tulis poin plus..."
                      />
                    </div>
                    <div className="swot-box minus">
                      <div className="swot-label minus">⚠️ Kekurangan (Minus)</div>
                      <textarea 
                        className="textarea" 
                        style={{background:'transparent', border:'none'}}
                        value={swot.minus} 
                        onChange={e => updateSwot(idx, 'minus', e.target.value)} 
                        placeholder="Tulis poin minus..."
                      />
                    </div>
                  </div>

                  {/* Bottom Actions */}
                  <div className="bottom-actions">
                    <input 
                      className="input" 
                      style={{flex:1}}
                      value={p.locationUrl} 
                      onChange={e => updatePlace(idx, "locationUrl", e.target.value)} 
                      placeholder="Link Google Maps" 
                    />
                    <button className="btn btn-danger" onClick={() => removeItem('place', idx)}>
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* OUTFITS TAB */}
        {activeTab === 'outfits' && (
          <div>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24}}>
              <div className="section-title" style={{marginBottom:0, border:0}}>Outfit Manager</div>
              <button className="btn btn-success" onClick={addOutfit}>
                + Add Outfit
              </button>
            </div>

            {(cfg.outfits?.items || []).map((o, idx) => (
              <div key={o.id} className="card">
                {/* Top Grid: Name + Style */}
                <div className="grid-2" style={{ marginBottom: 20 }}>
                  <div className="field-group">
                    <label className="label">Nama Style</label>
                    <input 
                      className="input" 
                      value={o.name} 
                      onChange={e => updateOutfit(idx, "name", e.target.value)} 
                      placeholder="Nama outfit style..."
                    />
                  </div>
                  <div className="field-group">
                    <label className="label">Kategori</label>
                    <select 
                      className="input" 
                      value={o.style || 'casual'} 
                      onChange={e => updateOutfit(idx, "style", e.target.value)}
                    >
                      <option value="casual">Casual</option>
                      <option value="formal">Formal</option>
                      <option value="sporty">Sporty</option>
                      <option value="vintage">Vintage</option>
                    </select>
                  </div>
                </div>

                {/* Color Palette */}
                <div style={{
                  marginBottom: 20, 
                  padding: 20, 
                  background: '#0f172a', 
                  borderRadius: 12,
                  border: '1px solid #1e293b'
                }}>
                  <label className="label">🎨 Palette Warna</label>
                  <div className="palette-container">
                    {(o.palette || []).map((color, cIdx) => (
                      <div 
                        key={cIdx} 
                        className="palette-item" 
                        style={{ background: color }} 
                        onClick={() => removeColorFromPalette(idx, cIdx)} 
                      />
                    ))}
                    {(o.palette || []).length < 5 && (
                      <input 
                        type="color" 
                        className="color-picker-input" 
                        onChange={(e) => addColorToPalette(idx, e.target.value)} 
                      />
                    )}
                  </div>
                  <p style={{fontSize:11, color:'#64748b', marginTop:10, marginBottom:0}}>
                    Klik warna untuk hapus • Maksimal 5 warna
                  </p>
                </div>

                {/* Photo Section */}
                <div className="photo-upload-section">
                  <div className="preview-box">
                    {o.image ? (
                      <img src={o.image} className="preview-img" alt="preview" />
                    ) : (
                      <span style={{fontSize:11, color:'#64748b'}}>No Image</span>
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="label">Foto Outfit</label>
                    <input 
                      className="input" 
                      value={o.image} 
                      onChange={e => updateOutfit(idx, "image", e.target.value)} 
                      placeholder="URL atau upload foto outfit..."
                    />
                    <label className="file-label">
                      📤 Upload Foto
                      <input 
                        type="file" 
                        accept="image/*" 
                        style={{display:'none'}} 
                        onChange={e => handleImageUpload(e, (b64) => updateOutfit(idx, "image", b64))} 
                      />
                    </label>
                  </div>
                </div>

                {/* Description */}
                <div className="field-group">
                  <label className="label">Deskripsi (Cewek | Cowok)</label>
                  <input 
                    className="input" 
                    value={o.description} 
                    onChange={e => updateOutfit(idx, "description", e.target.value)} 
                    placeholder="MAROON | BLACK"
                  />
                </div>

                {/* Delete Button */}
                <div className="bottom-actions">
                  <div style={{flex:1}}></div>
                  <button className="btn btn-danger" onClick={() => removeItem('outfit', idx)}>
                    Delete Outfit
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TEMPLATES TAB */}
        {activeTab === 'templates' && (
          <div>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24}}>
              <div className="section-title" style={{marginBottom:0, border:0}}>🎨 Photobox Template Manager</div>
              <label className="btn btn-success" style={{cursor:'pointer'}}>
                {uploadingTemplate ? "⏳ Uploading..." : "+ Upload Template"}
                <input 
                  type="file" 
                  accept="image/png" 
                  style={{display:'none'}} 
                  onChange={handleTemplateUpload} 
                  disabled={uploadingTemplate} 
                />
              </label>
            </div>

            <div className="card">
              <h3 style={{fontSize:14, color:'#94a3b8', marginTop:0, marginBottom:12}}>📋 PANDUAN UPLOAD TEMPLATE:</h3>
              <ul style={{color:'#cbd5e1', fontSize:13, lineHeight:1.8, paddingLeft:20}}>
                <li>✅ Format: <b>PNG dengan background TRANSPARAN</b></li>
                <li>📐 Size recommended: <b>707x2000px</b> (Photostrip Panjang)</li>
                <li>📍 Edit slot: Sekarang bisa <b>Drag & Resize</b> visual!</li>
              </ul>
            </div>

            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', 
              gap: '20px' 
            }}>
              {templates.map((template) => (
                <div key={template.id} className="card">
                  <div style={{ 
                    width: '100%', 
                    height: 350, 
                    background: 'repeating-conic-gradient(#0f172a 0% 25%, #1e293b 0% 50%) 50% / 20px 20px', 
                    borderRadius: 12, 
                    marginBottom: 15, 
                    overflow: 'hidden', 
                    position: 'relative' 
                  }}>
                    <img 
                      src={template.imageUrl} 
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }} 
                      alt={template.name} 
                    />
                    {template.slots.map((slot, idx) => (
                      <div 
                        key={idx} 
                        style={{ 
                          position: 'absolute', 
                          left: `${(slot.x / template.canvasWidth) * 100}%`, 
                          top: `${(slot.y / template.canvasHeight) * 100}%`, 
                          width: `${(slot.width / template.canvasWidth) * 100}%`, 
                          height: `${(slot.height / template.canvasHeight) * 100}%`, 
                          border: '2px dashed #3b82f6', 
                          background: 'rgba(59, 130, 246, 0.1)', 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center', 
                          fontSize: 12, 
                          color: '#3b82f6', 
                          fontWeight: 'bold' 
                        }}
                      >
                        SLOT {idx + 1}
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: '16px', color: '#fff', fontWeight: 'bold', marginBottom: 8 }}>
                    {template.name}
                  </div>
                  <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: 12 }}>
                    📸 {template.photoCount} foto | 📐 {template.canvasWidth}x{template.canvasHeight}
                  </div>
                  <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                    <button 
                      className="btn btn-primary" 
                      style={{flex:1, fontSize:12}} 
                      onClick={() => setEditingTemplate(template)}
                    >
                      ⚙️ Edit Slots
                    </button>
                    <button 
                      className="btn btn-danger" 
                      onClick={() => deleteTemplate(template.id)} 
                      style={{fontSize:12}}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* VISUAL EDITOR MODAL */}
            {editingTemplate && (
              <div style={{ 
                position: 'fixed', 
                inset: 0, 
                background: 'rgba(0,0,0,0.95)', 
                zIndex: 9999, 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                padding: 20,
                overflow: 'auto'
              }}>
                <div style={{ 
                  background: '#1e293b', 
                  borderRadius: 16, 
                  padding: 30, 
                  maxWidth: 1200, 
                  width: '100%', 
                  maxHeight: '95vh', 
                  overflowY: 'auto' 
                }}>
                  
                  {/* HEADER */}
                  <div style={{ 
                    marginBottom: 20, 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center' 
                  }}>
                    <div>
                      <h2 style={{ color: 'white', marginTop: 0, marginBottom: 8 }}>
                        ⚙️ Edit Slots: {editingTemplate.name}
                      </h2>
                      <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>
                        Canvas: {editingTemplate.canvasWidth} x {editingTemplate.canvasHeight} px
                      </p>
                    </div>
                    <button 
                      onClick={() => setEditorMode(editorMode === 'visual' ? 'manual' : 'visual')} 
                      style={{ 
                        padding: '8px 16px', 
                        background: editorMode === 'visual' ? '#3b82f6' : '#64748b', 
                        color: 'white', 
                        border: 'none', 
                        borderRadius: 8, 
                        cursor: 'pointer', 
                        fontSize: 13, 
                        fontWeight: 600 
                      }}
                    >
                      {editorMode === 'visual' ? '🎨 Visual Mode' : '🔢 Manual Mode'}
                    </button>
                  </div>

                  {editorMode === 'visual' ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 30 }}>
                      {/* CANVAS */}
                      <div>
                        <div style={{ 
                          background: '#0f172a', 
                          padding: 15, 
                          borderRadius: 12, 
                          marginBottom: 15 
                        }}>
                          <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>
                            💡 Klik slot → Drag untuk geser → Tarik pojok kanan bawah untuk resize
                          </p>
                        </div>
                        <div style={{ 
                          border: '2px solid #334155', 
                          borderRadius: 12, 
                          overflow: 'hidden', 
                          background: '#000', 
                          display: 'flex', 
                          justifyContent: 'center' 
                        }}>
                          <canvas 
                            ref={canvasRef} 
                            width={editingTemplate.canvasWidth * SCALE} 
                            height={editingTemplate.canvasHeight * SCALE}
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onMouseLeave={handleMouseUp}
                            style={{ 
                              cursor: isDragging ? 'grabbing' : isResizing ? 'nwse-resize' : 'grab', 
                              maxWidth: '100%' 
                            }} 
                          />
                        </div>
                      </div>

                      {/* SLOT INFO */}
                      <div style={{ 
                        background: '#0f172a', 
                        padding: 15, 
                        borderRadius: 12, 
                        height: 'fit-content' 
                      }}>
                        <h3 style={{ color: 'white', marginTop: 0, fontSize: 16 }}>
                          📸 Slots ({editingTemplate.slots.length})
                        </h3>
                        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                          {editingTemplate.slots.map((slot, idx) => (
                            <div 
                              key={idx} 
                              onClick={() => setSelectedSlot(idx)} 
                              style={{ 
                                background: selectedSlot === idx ? '#3b82f6' : '#1e293b', 
                                padding: 12, 
                                borderRadius: 8, 
                                marginBottom: 8, 
                                cursor: 'pointer', 
                                border: selectedSlot === idx ? '2px solid #60a5fa' : '2px solid transparent' 
                              }}
                            >
                              <div style={{ color: 'white', fontWeight: 600, marginBottom: 6, fontSize: 14 }}>
                                Slot {idx + 1}
                              </div>
                              <div style={{ color: '#94a3b8', fontSize: 11 }}>
                                X: {Math.round(slot.x)} | Y: {Math.round(slot.y)}<br />
                                W: {Math.round(slot.width)} | H: {Math.round(slot.height)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    // MANUAL MODE
                    <div style={{ 
                      display: 'grid', 
                      gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', 
                      gap: 15 
                    }}>
                      {editingTemplate.slots.map((slot, idx) => (
                        <div key={idx} style={{ background: '#0f172a', padding: 15, borderRadius: 12 }}>
                          <h4 style={{ color: '#3b82f6', marginTop: 0 }}>📸 Slot {idx + 1}</h4>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            {['x', 'y', 'width', 'height'].map(field => (
                              <div key={field}>
                                <label style={{ 
                                  color: '#94a3b8', 
                                  fontSize: 10, 
                                  textTransform: 'uppercase',
                                  display: 'block',
                                  marginBottom: 4
                                }}>
                                  {field}
                                </label>
                                <input 
                                  type="number" 
                                  className="input"
                                  value={(slot as any)[field]} 
                                  onChange={(e) => {
                                    const newSlots = [...editingTemplate.slots];
                                    (newSlots[idx] as any)[field] = parseInt(e.target.value) || 0;
                                    setEditingTemplate({...editingTemplate, slots: newSlots});
                                  }} 
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ACTION BUTTONS */}
                  <div style={{ 
                    display: 'flex', 
                    gap: 12, 
                    marginTop: 25, 
                    paddingTop: 20, 
                    borderTop: '1px solid #334155' 
                  }}>
                    <button 
                      onClick={() => saveSlotChanges(editingTemplate)} 
                      className="btn btn-success"
                      style={{ 
                        flex: 1, 
                        padding: '14px', 
                        fontSize: 15, 
                        fontWeight: 700 
                      }}
                    >
                      ✅ Simpan Perubahan
                    </button>
                    <button 
                      onClick={() => setEditingTemplate(null)} 
                      className="btn btn-secondary"
                      style={{ 
                        padding: '14px 24px', 
                        fontSize: 15, 
                        fontWeight: 600 
                      }}
                    >
                      ❌ Batal
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* GALLERY TAB */}
        {activeTab === 'gallery' && (
          <div>
            <div className="section-title">Hasil Foto Photobox</div>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', 
              gap: '20px' 
            }}>
              {userPhotos.length === 0 ? (
                <div className="card" style={{ 
                  textAlign: 'center', 
                  padding: '40px', 
                  color: '#64748b', 
                  gridColumn: '1 / -1' 
                }}>
                  📸 Belum ada foto yang masuk dari Keysia.
                </div>
              ) : (
                userPhotos.map((photo) => (
                  <div key={photo.id} className="card" style={{ padding: '10px' }}>
                    <img 
                      src={photo.url} 
                      style={{ 
                        width: '100%', 
                        borderRadius: '8px', 
                        marginBottom: '10px', 
                        border: '1px solid #334155' 
                      }} 
                      alt="User Capture" 
                    />
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                      📅 {new Date(photo.createdAt).toLocaleString('id-ID')}
                    </div>
                    <a 
                      href={photo.url} 
                      target="_blank" 
                      rel="noreferrer" 
                      style={{ 
                        color: '#3b82f6', 
                        fontSize: '12px', 
                        textDecoration: 'none', 
                        display: 'block', 
                        marginTop: '8px', 
                        fontWeight: 'bold' 
                      }}
                    >
                      Buka Full Image ↗
                    </a>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TOOLS TAB */}
        {activeTab === 'tools' && (
          <div>
            <div className="section-title">Backup & Restore</div>
            <div className="card">
              <h3 style={{fontSize:16, marginBottom:20}}>Data Management</h3>
              <div style={{ display: 'flex', gap: 15 }}>
                <button 
                  className="btn btn-primary" 
                  onClick={() => {
                    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(cfg));
                    const downloadAnchorNode = document.createElement('a');
                    downloadAnchorNode.setAttribute("href", dataStr);
                    downloadAnchorNode.setAttribute("download", "backup-hangout.json");
                    downloadAnchorNode.click();
                  }}
                >
                  📥 Download Backup
                </button>
                <button 
                  className="btn btn-danger" 
                  onClick={() => { 
                    if(confirm("Reset data ke awal? Semua perubahan lo bakal hilang.")) { 
                      resetConfig(); 
                      window.location.reload(); 
                    } 
                  }}
                >
                  🔄 Factory Reset
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}