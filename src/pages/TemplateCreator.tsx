/**
 * TemplateCreator.tsx
 * 
 * Cara pakai:
 * 1. Import ke Admin.tsx: import { TemplateCreator } from "./TemplateCreator";
 * 2. Render di tab templates: <TemplateCreator />
 * 
 * Cara bikin frame image:
 * - Bikin di Canva/Photoshop/Figma dengan ukuran bebas (rekomendasi: 900x1200px)
 * - Area foto HARUS TRANSPARAN (PNG dengan alpha channel)
 * - Export sebagai PNG (bukan JPG!)
 * - Slot akan ditaruh DI BAWAH frame, jadi area transparan = area foto
 */

import React, { useRef, useState, useEffect, useCallback } from "react";
import { db } from "../firebase";
import { collection, query, orderBy, onSnapshot, setDoc, doc, deleteDoc, updateDoc } from "firebase/firestore";

// ─── Types ───────────────────────────────────────────────────────────────────

type PhotoSlot = { x: number; y: number; width: number; height: number };

type PhotoTemplate = {
  id: string;
  name: string;
  imageUrl: string;
  photoCount: number;
  slots: PhotoSlot[];
  canvasWidth: number;
  canvasHeight: number;
  createdAt: string;
  tags?: string[];
};

type DrawMode = "draw" | "select";

// ─── Constants ───────────────────────────────────────────────────────────────

const CLOUDINARY_CLOUD = "dkfhlusok";
const CLOUDINARY_PRESET = "keyysi_sigma";

const SLOT_COLORS = [
  "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4",
  "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F",
  "#BB8FCE", "#F1948A",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function uploadToCloudinary(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", CLOUDINARY_PRESET);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`, {
    method: "POST", body: fd,
  });
  if (!res.ok) throw new Error("Cloudinary upload failed");
  return (await res.json()).secure_url;
}

async function getImageDimensions(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
    img.onerror = reject;
    img.src = url;
  });
}

function snap(v: number, grid = 10): number {
  return Math.round(v / grid) * grid;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function TemplateCreator() {
  // List
  const [templates, setTemplates] = useState<PhotoTemplate[]>([]);

  // Editor state
  const [editing, setEditing] = useState<PhotoTemplate | null>(null);
  const [drawMode, setDrawMode] = useState<DrawMode>("draw");
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);

  // Draw state (for new slot)
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState({ x: 0, y: 0 });
  const [drawRect, setDrawRect] = useState<PhotoSlot | null>(null);

  // Drag state (for moving existing slot)
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Resize state
  const [isResizing, setIsResizing] = useState(false);
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, w: 0, h: 0 });

  // Upload
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");

  // Form
  const [newName, setNewName] = useState("");
  const [newPhotoCount, setNewPhotoCount] = useState(3);
  const [newTags, setNewTags] = useState("");
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Scale for display
  const SCALE = editing ? Math.min(0.45, 700 / editing.canvasWidth) : 0.45;

  // ── Load templates ──────────────────────────────────────────────────────────
  useEffect(() => {
    const q = query(collection(db, "photobox_templates"), orderBy("createdAt", "desc"));
    return onSnapshot(q, snap => {
      setTemplates(snap.docs.map(d => ({ id: d.id, ...d.data() })) as PhotoTemplate[]);
    });
  }, []);

  // ── Draw canvas ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!editing || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = Math.round(editing.canvasWidth * SCALE);
    canvas.height = Math.round(editing.canvasHeight * SCALE);

    // Checkerboard bg (shows transparency)
    const size = 16;
    for (let y = 0; y < canvas.height; y += size) {
      for (let x = 0; x < canvas.width; x += size) {
        ctx.fillStyle = ((x / size + y / size) % 2 === 0) ? "#E8E8E8" : "#C8C8C8";
        ctx.fillRect(x, y, size, size);
      }
    }

    // Draw frame image
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      drawSlots(ctx);
    };
    img.onerror = () => { drawSlots(ctx); };
    img.src = editing.imageUrl;

    function drawSlots(ctx: CanvasRenderingContext2D) {
      if (!editing) return;

      // Draw existing slots
      editing.slots.forEach((slot, i) => {
        const color = SLOT_COLORS[i % SLOT_COLORS.length];
        const selected = selectedIdx === i;

        // Slot fill
        ctx.fillStyle = selected ? `${color}55` : `${color}33`;
        ctx.fillRect(slot.x * SCALE, slot.y * SCALE, slot.width * SCALE, slot.height * SCALE);

        // Border
        ctx.strokeStyle = color;
        ctx.lineWidth = selected ? 3 : 2;
        ctx.setLineDash(selected ? [] : [6, 3]);
        ctx.strokeRect(slot.x * SCALE, slot.y * SCALE, slot.width * SCALE, slot.height * SCALE);
        ctx.setLineDash([]);

        // Label
        const labelSize = Math.min(20, slot.height * SCALE * 0.3);
        ctx.font = `bold ${labelSize}px system-ui`;
        ctx.fillStyle = color;
        ctx.shadowColor = "rgba(0,0,0,0.5)";
        ctx.shadowBlur = 4;
        ctx.fillText(`📸 ${i + 1}`, slot.x * SCALE + 8, slot.y * SCALE + labelSize + 6);
        ctx.shadowBlur = 0;

        // Size label
        const sizeLabel = `${Math.round(slot.width)}×${Math.round(slot.height)}`;
        ctx.font = `11px system-ui`;
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fillText(sizeLabel, slot.x * SCALE + 8, (slot.y + slot.height) * SCALE - 8);

        // Resize handle
        if (selected) {
          ctx.fillStyle = color;
          ctx.fillRect(
            (slot.x + slot.width) * SCALE - 10,
            (slot.y + slot.height) * SCALE - 10,
            20, 20
          );
          ctx.strokeStyle = "white";
          ctx.lineWidth = 2;
          ctx.strokeRect(
            (slot.x + slot.width) * SCALE - 10,
            (slot.y + slot.height) * SCALE - 10,
            20, 20
          );
        }
      });

      // Draw in-progress rectangle
      if (drawRect) {
        ctx.strokeStyle = "#FF6B6B";
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.fillStyle = "rgba(255,107,107,0.15)";
        ctx.fillRect(drawRect.x * SCALE, drawRect.y * SCALE, drawRect.width * SCALE, drawRect.height * SCALE);
        ctx.strokeRect(drawRect.x * SCALE, drawRect.y * SCALE, drawRect.width * SCALE, drawRect.height * SCALE);
        ctx.setLineDash([]);
      }
    }
  }, [editing, selectedIdx, drawRect, SCALE]);

  // ── Canvas coordinate helper ────────────────────────────────────────────────
  const getCanvasPos = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left) / SCALE;
    const y = (e.clientY - rect.top) / SCALE;
    return { x: snapEnabled ? snap(x) : x, y: snapEnabled ? snap(y) : y };
  }, [SCALE, snapEnabled]);

  // ── Mouse handlers ──────────────────────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!editing) return;
    const { x, y } = getCanvasPos(e);

    if (drawMode === "draw") {
      // Start drawing a new slot
      setIsDrawing(true);
      setDrawStart({ x, y });
      setDrawRect({ x, y, width: 0, height: 0 });
      setSelectedIdx(null);
      return;
    }

    // SELECT mode: check resize handle first
    if (selectedIdx !== null) {
      const slot = editing.slots[selectedIdx];
      const hx = slot.x + slot.width, hy = slot.y + slot.height;
      if (Math.abs(x - hx) < 20 / SCALE && Math.abs(y - hy) < 20 / SCALE) {
        setIsResizing(true);
        setResizeStart({ x, y, w: slot.width, h: slot.height });
        return;
      }
    }

    // Check click on existing slot
    for (let i = editing.slots.length - 1; i >= 0; i--) {
      const s = editing.slots[i];
      if (x >= s.x && x <= s.x + s.width && y >= s.y && y <= s.y + s.height) {
        setSelectedIdx(i);
        setIsDragging(true);
        setDragOffset({ x: x - s.x, y: y - s.y });
        return;
      }
    }
    setSelectedIdx(null);
  }, [editing, drawMode, selectedIdx, getCanvasPos, SCALE]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!editing) return;
    const { x, y } = getCanvasPos(e);

    if (isDrawing) {
      const rx = Math.min(x, drawStart.x);
      const ry = Math.min(y, drawStart.y);
      const rw = Math.abs(x - drawStart.x);
      const rh = Math.abs(y - drawStart.y);
      setDrawRect({ x: rx, y: ry, width: rw, height: rh });
      return;
    }

    if (isResizing && selectedIdx !== null) {
      const newSlots = [...editing.slots];
      newSlots[selectedIdx] = {
        ...newSlots[selectedIdx],
        width: Math.max(40, resizeStart.w + (x - resizeStart.x)),
        height: Math.max(40, resizeStart.h + (y - resizeStart.y)),
      };
      setEditing({ ...editing, slots: newSlots });
      return;
    }

    if (isDragging && selectedIdx !== null) {
      const newSlots = [...editing.slots];
      newSlots[selectedIdx] = {
        ...newSlots[selectedIdx],
        x: x - dragOffset.x,
        y: y - dragOffset.y,
      };
      setEditing({ ...editing, slots: newSlots });
    }
  }, [editing, isDrawing, isResizing, isDragging, selectedIdx, drawStart, dragOffset, resizeStart, getCanvasPos]);

  const handleMouseUp = useCallback(() => {
    if (isDrawing && drawRect && drawRect.width > 20 && drawRect.height > 20) {
      // Commit new slot
      setEditing(prev => prev ? {
        ...prev,
        slots: [...prev.slots, { ...drawRect }],
        photoCount: prev.slots.length + 1,
      } : null);
      setSelectedIdx(editing ? editing.slots.length : 0);
    }
    setIsDrawing(false);
    setIsDragging(false);
    setIsResizing(false);
    setDrawRect(null);
  }, [isDrawing, isDragging, isResizing, drawRect, editing]);

  // ── File selection ──────────────────────────────────────────────────────────
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.includes("image/png")) {
      alert("⚠️ Harus PNG! File JPG tidak support transparansi.");
      return;
    }
    setPendingFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setShowUploadForm(true);
  };

  // ── Upload & create template ────────────────────────────────────────────────
  const handleCreateTemplate = async () => {
    if (!pendingFile || !newName.trim()) return;

    setUploading(true);
    setUploadProgress("📐 Membaca dimensi gambar...");
    try {
      const { w, h } = await getImageDimensions(pendingFile);

      setUploadProgress("☁️ Upload ke Cloudinary...");
      const imageUrl = await uploadToCloudinary(pendingFile);

      // Default slots — user will adjust in editor
      const margin = Math.round(Math.min(w, h) * 0.06);
      const gap = margin;
      const slots: PhotoSlot[] = [];
      const isPortrait = h / w >= 1.25;

      if (isPortrait) {
        const slotH = Math.max(80, Math.floor((h - gap * (newPhotoCount + 1)) / newPhotoCount));
        for (let i = 0; i < newPhotoCount; i++) {
          slots.push({ x: margin, y: gap + i * (slotH + gap), width: w - margin * 2, height: slotH });
        }
      } else {
        const cols = 2, rows = Math.ceil(newPhotoCount / cols);
        const sw = Math.floor((w - gap * (cols + 1)) / cols);
        const sh = Math.floor((h - gap * (rows + 1)) / rows);
        for (let i = 0; i < newPhotoCount; i++) {
          const r = Math.floor(i / cols), c = i % cols;
          slots.push({ x: gap + c * (sw + gap), y: gap + r * (sh + gap), width: sw, height: sh });
        }
      }

      setUploadProgress("💾 Menyimpan ke Firestore...");
      const id = Date.now().toString();
      const template: PhotoTemplate = {
        id, name: newName.trim(), imageUrl, photoCount: newPhotoCount,
        slots, canvasWidth: w, canvasHeight: h,
        createdAt: new Date().toISOString(),
        tags: newTags.split(",").map(t => t.trim()).filter(Boolean),
      };
      await setDoc(doc(db, "photobox_templates", id), template);

      // Open editor immediately
      setEditing(template);
      setDrawMode("select");
      setSelectedIdx(null);

      // Reset form
      setShowUploadForm(false);
      setPendingFile(null);
      setPreviewUrl(null);
      setNewName("");
      setNewPhotoCount(3);
      setNewTags("");

      setUploadProgress("✅ Berhasil! Sesuaikan slot di editor.");
    } catch (err) {
      console.error(err);
      alert("❌ Gagal upload. Cek koneksi dan Cloudinary preset kamu.");
    }
    setUploading(false);
  };

  // ── Delete slot ─────────────────────────────────────────────────────────────
  const deleteSelectedSlot = () => {
    if (!editing || selectedIdx === null) return;
    const newSlots = editing.slots.filter((_, i) => i !== selectedIdx);
    setEditing({ ...editing, slots: newSlots, photoCount: newSlots.length });
    setSelectedIdx(null);
  };

  // ── Save changes ────────────────────────────────────────────────────────────
  const saveChanges = async () => {
    if (!editing) return;
    try {
      await updateDoc(doc(db, "photobox_templates", editing.id), {
        slots: editing.slots,
        photoCount: editing.slots.length,
        name: editing.name,
        tags: editing.tags,
      });
      alert("✅ Template berhasil disimpan!");
      setEditing(null);
    } catch (err) {
      alert("❌ Gagal simpan");
    }
  };

  // ── Delete template ─────────────────────────────────────────────────────────
  const deleteTemplate = async (id: string) => {
    if (!confirm("Hapus template ini permanen?")) return;
    try {
      await deleteDoc(doc(db, "photobox_templates", id));
    } catch { alert("Gagal hapus"); }
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  // EDITOR VIEW
  if (editing) {
    return (
      <div style={{ display: "flex", height: "calc(100vh - 120px)", gap: 0, overflow: "hidden" }}>

        {/* Canvas Area */}
        <div style={{ flex: 1, background: "#0F172A", overflow: "auto", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 24 }}>
          <div>
            {/* Mode toolbar */}
            <div style={{ display: "flex", gap: 8, marginBottom: 16, justifyContent: "center" }}>
              <span style={{ color: "#94A3B8", fontSize: 13, alignSelf: "center", marginRight: 8 }}>Mode:</span>
              {(["draw", "select"] as DrawMode[]).map(mode => (
                <button key={mode} onClick={() => setDrawMode(mode)} style={{
                  padding: "8px 18px", borderRadius: 8, border: "none", cursor: "pointer",
                  background: drawMode === mode ? (mode === "draw" ? "#FF6B6B" : "#3B82F6") : "#1E293B",
                  color: drawMode === mode ? "white" : "#94A3B8",
                  fontWeight: 700, fontSize: 13,
                  transition: "all 0.2s",
                }}>
                  {mode === "draw" ? "✏️ Draw Slot Baru" : "🖱️ Select / Move"}
                </button>
              ))}
              <button onClick={() => setSnapEnabled(s => !s)} style={{
                padding: "8px 14px", borderRadius: 8, border: "1px solid #334155",
                background: snapEnabled ? "#1D4ED8" : "#1E293B",
                color: snapEnabled ? "#93C5FD" : "#64748B", cursor: "pointer", fontSize: 12,
              }}>
                🧲 Snap {snapEnabled ? "ON" : "OFF"}
              </button>
            </div>

            {/* Canvas */}
            <div style={{ position: "relative", borderRadius: 8, overflow: "hidden", boxShadow: "0 0 0 2px #334155, 0 20px 60px rgba(0,0,0,0.6)" }}>
              <canvas
                ref={canvasRef}
                style={{
                  display: "block",
                  cursor: drawMode === "draw" ? "crosshair" : isDragging ? "grabbing" : "default",
                  userSelect: "none",
                }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              />
            </div>

            <p style={{ color: "#475569", fontSize: 12, textAlign: "center", marginTop: 12 }}>
              {drawMode === "draw"
                ? "🖱️ Klik dan drag untuk buat slot foto baru"
                : selectedIdx !== null
                  ? "Drag = pindah slot · Pojok kanan bawah = resize"
                  : "Klik slot untuk pilih"}
            </p>
          </div>
        </div>

        {/* Sidebar */}
        <div style={{ width: 300, background: "#1E293B", borderLeft: "1px solid #334155", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Header */}
          <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid #334155" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <button onClick={() => setEditing(null)} style={{
                background: "none", border: "1px solid #475569", color: "#94A3B8",
                borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12,
              }}>← Kembali</button>
            </div>
            <input
              value={editing.name}
              onChange={e => setEditing({ ...editing, name: e.target.value })}
              style={{
                background: "#0F172A", border: "1px solid #334155", color: "white",
                borderRadius: 8, padding: "8px 12px", fontSize: 15, fontWeight: 700,
                width: "100%", boxSizing: "border-box", marginTop: 8,
              }}
            />
            <div style={{ color: "#64748B", fontSize: 12, marginTop: 6 }}>
              {editing.canvasWidth}×{editing.canvasHeight}px · {editing.slots.length} slot
            </div>
          </div>

          {/* Slots list */}
          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ color: "#94A3B8", fontSize: 13, fontWeight: 700 }}>
                📸 SLOTS ({editing.slots.length})
              </span>
              <button onClick={() => setDrawMode("draw")} style={{
                background: "#FF6B6B22", border: "1px solid #FF6B6B66",
                color: "#FF6B6B", borderRadius: 6, padding: "4px 10px",
                cursor: "pointer", fontSize: 11, fontWeight: 700,
              }}>
                + Tambah
              </button>
            </div>

            {editing.slots.length === 0 && (
              <div style={{ textAlign: "center", padding: "32px 16px", color: "#475569" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>✏️</div>
                <div style={{ fontSize: 13 }}>Belum ada slot.<br />Pilih mode Draw dan drag di canvas.</div>
              </div>
            )}

            {editing.slots.map((slot, i) => {
              const color = SLOT_COLORS[i % SLOT_COLORS.length];
              const selected = selectedIdx === i;
              return (
                <div
                  key={i}
                  onClick={() => { setSelectedIdx(i); setDrawMode("select"); }}
                  style={{
                    background: selected ? `${color}22` : "#0F172A",
                    border: `2px solid ${selected ? color : "#1E293B"}`,
                    borderRadius: 10, padding: 12, marginBottom: 8,
                    cursor: "pointer", transition: "all 0.15s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
                    <span style={{ color: "white", fontWeight: 700, fontSize: 13 }}>Slot {i + 1}</span>
                    {selected && (
                      <button
                        onClick={e => { e.stopPropagation(); deleteSelectedSlot(); }}
                        style={{ marginLeft: "auto", background: "#7F1D1D", border: "none", color: "#FCA5A5", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontSize: 11 }}
                      >
                        🗑️ Hapus
                      </button>
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    {(["x", "y", "width", "height"] as const).map(field => (
                      <div key={field}>
                        <label style={{ color: "#64748B", fontSize: 10, textTransform: "uppercase", display: "block", marginBottom: 2 }}>{field}</label>
                        <input
                          type="number"
                          value={Math.round(slot[field])}
                          onClick={e => e.stopPropagation()}
                          onChange={e => {
                            const newSlots = [...editing.slots];
                            newSlots[i] = { ...newSlots[i], [field]: parseInt(e.target.value) || 0 };
                            setEditing({ ...editing, slots: newSlots });
                          }}
                          style={{
                            background: "#1E293B", border: "1px solid #334155", color: "#E2E8F0",
                            borderRadius: 6, padding: "5px 8px", fontSize: 12, width: "100%", boxSizing: "border-box",
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div style={{ padding: 16, borderTop: "1px solid #334155", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ color: "#64748B", fontSize: 11, textAlign: "center" }}>
              💡 Tip: Slot disusun DARI BAWAH frame (foto masuk ke area transparan)
            </div>
            <button onClick={saveChanges} style={{
              width: "100%", padding: "12px", borderRadius: 10, border: "none",
              background: "#22C55E", color: "white", fontWeight: 700, fontSize: 14, cursor: "pointer",
            }}>
              ✅ Simpan Template
            </button>
          </div>
        </div>
      </div>
    );
  }

  // LIST VIEW
  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h2 style={{ color: "white", margin: "0 0 4px", fontSize: 22 }}>🖼️ Template Manager</h2>
          <p style={{ color: "#64748B", margin: 0, fontSize: 14 }}>{templates.length} template aktif</p>
        </div>
        <button
          onClick={() => fileRef.current?.click()}
          style={{
            background: "#FF6B6B", color: "white", border: "none",
            borderRadius: 10, padding: "12px 24px", fontWeight: 700, fontSize: 14, cursor: "pointer",
          }}
        >
          + Upload Template Baru
        </button>
        <input ref={fileRef} type="file" accept="image/png" onChange={handleFileSelect} style={{ display: "none" }} />
      </div>

      {/* How-to guide */}
      <div style={{ background: "#1E293B", borderRadius: 12, padding: 20, marginBottom: 24, border: "1px solid #334155" }}>
        <h3 style={{ color: "#F8FAFC", margin: "0 0 12px", fontSize: 15 }}>📋 Cara Bikin Template</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {[
            { n: "1", t: "Desain Frame", d: "Buka Canva/Photoshop. Buat gambar dengan area foto TRANSPARAN (PNG)." },
            { n: "2", t: "Export PNG", d: "Export sebagai PNG dengan transparansi aktif. Jangan JPG!" },
            { n: "3", t: "Upload & Setting", d: "Klik 'Upload Template Baru', isi nama, jumlah foto, upload file." },
            { n: "4", t: "Atur Slot di Editor", d: "Drag di canvas untuk bikin/pindah slot. Sesuaikan posisi sampai pas." },
          ].map(s => (
            <div key={s.n} style={{ background: "#0F172A", borderRadius: 8, padding: 14 }}>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: "#FF6B6B", color: "white", fontWeight: 900, fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 8 }}>{s.n}</div>
              <div style={{ color: "#E2E8F0", fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{s.t}</div>
              <div style={{ color: "#64748B", fontSize: 12, lineHeight: 1.5 }}>{s.d}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, padding: "10px 14px", background: "#0F172A", borderRadius: 8, fontSize: 12, color: "#F59E0B" }}>
          ⚠️ <strong>Konsep penting:</strong> Foto ditaruh DI BAWAH frame (layer sandwich). Area TRANSPARAN di PNG = tempat foto masuk. Frame gambar di-render di atas foto.
        </div>
      </div>

      {/* Upload form modal */}
      {showUploadForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#1E293B", borderRadius: 16, padding: 32, width: 480, border: "1px solid #334155" }}>
            <h3 style={{ color: "white", margin: "0 0 20px" }}>📋 Setup Template Baru</h3>

            {previewUrl && (
              <div style={{ marginBottom: 16, borderRadius: 8, overflow: "hidden", maxHeight: 200, background: "#0F172A", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <img src={previewUrl} style={{ maxWidth: "100%", maxHeight: 200, objectFit: "contain" }} alt="preview" />
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <label style={{ color: "#94A3B8", fontSize: 12, display: "block", marginBottom: 6 }}>NAMA TEMPLATE *</label>
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="cth: Aesthetic Film Strip"
                style={{ width: "100%", background: "#0F172A", border: "1px solid #334155", color: "white", borderRadius: 8, padding: "10px 12px", fontSize: 14, boxSizing: "border-box" }}
              />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ color: "#94A3B8", fontSize: 12, display: "block", marginBottom: 6 }}>JUMLAH FOTO (1–9)</label>
              <div style={{ display: "flex", gap: 8 }}>
                {[1, 2, 3, 4, 6].map(n => (
                  <button key={n} onClick={() => setNewPhotoCount(n)} style={{
                    flex: 1, padding: "10px 0", borderRadius: 8, border: "none", cursor: "pointer",
                    background: newPhotoCount === n ? "#FF6B6B" : "#0F172A",
                    color: newPhotoCount === n ? "white" : "#64748B",
                    fontWeight: 700, fontSize: 16,
                  }}>{n}</button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ color: "#94A3B8", fontSize: 12, display: "block", marginBottom: 6 }}>TAGS (pisah dengan koma, opsional)</label>
              <input
                value={newTags}
                onChange={e => setNewTags(e.target.value)}
                placeholder="cth: aesthetic, vintage, couple"
                style={{ width: "100%", background: "#0F172A", border: "1px solid #334155", color: "white", borderRadius: 8, padding: "10px 12px", fontSize: 14, boxSizing: "border-box" }}
              />
            </div>

            {uploading && (
              <div style={{ marginBottom: 16, padding: "10px 14px", background: "#0F172A", borderRadius: 8, color: "#60A5FA", fontSize: 13 }}>
                {uploadProgress}
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => { setShowUploadForm(false); setPendingFile(null); setPreviewUrl(null); }} style={{
                flex: 1, padding: "12px", borderRadius: 10, border: "1px solid #334155",
                background: "transparent", color: "#94A3B8", cursor: "pointer", fontWeight: 600,
              }}>
                Batal
              </button>
              <button onClick={handleCreateTemplate} disabled={uploading || !newName.trim()} style={{
                flex: 2, padding: "12px", borderRadius: 10, border: "none",
                background: uploading || !newName.trim() ? "#334155" : "#FF6B6B",
                color: uploading || !newName.trim() ? "#64748B" : "white",
                cursor: uploading || !newName.trim() ? "not-allowed" : "pointer",
                fontWeight: 700, fontSize: 14,
              }}>
                {uploading ? "Uploading..." : "✅ Upload & Buka Editor"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Template grid */}
      {templates.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 20px", color: "#475569" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🖼️</div>
          <div style={{ fontSize: 18, color: "#94A3B8", fontWeight: 700, marginBottom: 8 }}>Belum ada template</div>
          <div style={{ fontSize: 14 }}>Klik "Upload Template Baru" untuk mulai!</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 20 }}>
          {templates.map(t => (
            <div key={t.id} style={{ background: "#1E293B", borderRadius: 14, overflow: "hidden", border: "1px solid #334155" }}>
              <div style={{ height: 200, background: "#0F172A", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
                <img src={t.imageUrl} alt={t.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                <div style={{ position: "absolute", top: 8, right: 8, background: "#FF6B6B", color: "white", borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 700 }}>
                  📸 {t.slots.length} foto
                </div>
              </div>
              <div style={{ padding: 14 }}>
                <div style={{ color: "white", fontWeight: 700, marginBottom: 4 }}>{t.name}</div>
                <div style={{ color: "#64748B", fontSize: 12, marginBottom: 12 }}>
                  {t.canvasWidth}×{t.canvasHeight}px
                </div>
                {t.tags && t.tags.length > 0 && (
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
                    {t.tags.map(tag => (
                      <span key={tag} style={{ background: "#0F172A", color: "#64748B", borderRadius: 20, padding: "2px 8px", fontSize: 11 }}>{tag}</span>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => { setEditing(t); setSelectedIdx(null); setDrawMode("select"); }} style={{
                    flex: 1, padding: "8px", borderRadius: 8, border: "none",
                    background: "#3B82F6", color: "white", fontWeight: 700, fontSize: 12, cursor: "pointer",
                  }}>
                    ✏️ Edit Slot
                  </button>
                  <button onClick={() => deleteTemplate(t.id)} style={{
                    padding: "8px 12px", borderRadius: 8, border: "none",
                    background: "#7F1D1D", color: "#FCA5A5", fontWeight: 700, fontSize: 12, cursor: "pointer",
                  }}>
                    🗑️
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
