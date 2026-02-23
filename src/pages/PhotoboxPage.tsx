import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "../firebase";

/** ==== TYPES (match Admin collections) ==== */
type PhotoSlot = { x: number; y: number; width: number; height: number };

type PhotoTemplate = {
  id: string;
  name: string;
  imageUrl: string; // PNG transparent overlay (top layer)
  photoCount: number; // 1-4
  slots: PhotoSlot[];
  canvasWidth: number; // ex: 707
  canvasHeight: number; // ex: 2000
  createdAt: string;

  // Optional future “sandwich layering” support (backward compatible)
  underlayUrl?: string; // background layer (optional)
  overlayUrl?: string; // top layer override (optional)
  tags?: string[];
};

type SlotEdit = {
  // offsets are in SLOT px (not preview px)
  offsetX: number;
  offsetY: number;
  zoom: number; // 1..3
  filter: FilterKey;
};

type CapturedPhoto = {
  dataUrl: string; // captured from camera
};

type Step = "select" | "capture" | "edit" | "export";

type FilterKey = "none" | "bw" | "warm" | "cool" | "vintage";

function cssFilter(key: FilterKey) {
  switch (key) {
    case "bw":
      return "grayscale(1) contrast(1.05)";
    case "warm":
      return "saturate(1.15) contrast(1.05) sepia(0.2)";
    case "cool":
      return "saturate(1.1) contrast(1.05) hue-rotate(10deg)";
    case "vintage":
      return "sepia(0.35) contrast(1.05) saturate(0.9)";
    default:
      return "none";
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function randomId(prefix: string) {
  return `${prefix}-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}

function loadImage(url: string, crossOrigin = true): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image: " + url));
    img.src = url;
  });
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return await res.blob();
}

export function PhotoboxPage() {
  /** ==== DATA ==== */
  const [templates, setTemplates] = useState<PhotoTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<PhotoTemplate | null>(null);

  /** ==== UI ==== */
  const [step, setStep] = useState<Step>("select");
  const [search, setSearch] = useState("");
  const [countdownSec, setCountdownSec] = useState<number>(3);
  const [countdownNow, setCountdownNow] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);

  /** ==== CAMERA ==== */
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);

  /** ==== CAPTURE/EDIT ==== */
  const [shots, setShots] = useState<CapturedPhoto[]>([]);
  const [slotEdits, setSlotEdits] = useState<SlotEdit[]>([]);
  const [activeSlot, setActiveSlot] = useState<number>(0);

  /** ==== PREVIEW SCALE ==== */
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const [previewW, setPreviewW] = useState(360);

  /** ==== EXPORT ==== */
  const [exporting, setExporting] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  /** ==== Listen templates from Firestore ==== */
  useEffect(() => {
    const q = query(collection(db, "photobox_templates"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as PhotoTemplate[];
        setTemplates(list);
      },
      (err) => setErrorMsg("Gagal load template: " + err.message)
    );
    return () => unsub();
  }, []);

  /** ==== Resize observer for preview width ==== */
  useEffect(() => {
    const el = previewWrapRef.current;
    if (!el) return;

    const obs = new ResizeObserver(() => {
      setPreviewW(Math.max(320, Math.min(520, el.clientWidth)));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  /** ==== filtered templates ==== */
  const filteredTemplates = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return templates;
    return templates.filter((t) => {
      const hay = `${t.name} ${(t.tags || []).join(" ")} ${t.photoCount}`.toLowerCase();
      return hay.includes(s);
    });
  }, [templates, search]);

  /** ==== helper derived ==== */
  const needShots = selectedTemplate?.photoCount || 0;
  const canGoCapture = !!selectedTemplate;

  const overlayUrl = selectedTemplate?.overlayUrl || selectedTemplate?.imageUrl || "";
  const underlayUrl = selectedTemplate?.underlayUrl || "";

  const scale = useMemo(() => {
    if (!selectedTemplate) return 1;
    return previewW / selectedTemplate.canvasWidth;
  }, [previewW, selectedTemplate]);

  /** ==== camera start/stop ==== */
  async function startCamera() {
    setErrorMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (e: any) {
      setErrorMsg("Kamera nggak bisa diakses. Cek permission browser ya. (" + e?.message + ")");
    }
  }

  function stopCamera() {
    const s = streamRef.current;
    if (s) s.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  /** ==== select template -> init state ==== */
  function chooseTemplate(t: PhotoTemplate) {
    setSelectedTemplate(t);
    setResultUrl(null);
    setShots([]);
    setActiveSlot(0);

    // init slot edits
    const edits: SlotEdit[] = (t.slots || []).slice(0, t.photoCount).map(() => ({
      offsetX: 0,
      offsetY: 0,
      zoom: 1.15,
      filter: "none",
    }));
    setSlotEdits(edits);
  }

  /** ==== step transitions ==== */
  async function goCapture() {
    if (!selectedTemplate) return;
    setStep("capture");
    setShots([]);
    setActiveSlot(0);
    setResultUrl(null);
    await startCamera();
  }

  function goEdit() {
    stopCamera();
    setStep("edit");
  }

  function backToSelect() {
    stopCamera();
    setSelectedTemplate(null);
    setShots([]);
    setSlotEdits([]);
    setActiveSlot(0);
    setStep("select");
    setResultUrl(null);
    setErrorMsg(null);
  }

  /** ==== countdown capture logic ==== */
  async function captureOne() {
    if (!selectedTemplate) return;
    if (!videoRef.current || !captureCanvasRef.current) return;

    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // capture full video frame into canvas (store as dataURL)
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    canvas.width = vw;
    canvas.height = vh;
    ctx.drawImage(video, 0, 0, vw, vh);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);

    setFlash(true);
    setTimeout(() => setFlash(false), 120);

    setShots((prev) => {
      const next = [...prev, { dataUrl }];
      return next.slice(0, needShots);
    });
  }

  async function startCountdownAndShoot() {
    if (!selectedTemplate) return;
    if (countdownNow !== null) return; // already counting
    if (shots.length >= needShots) return;

    setErrorMsg(null);

    let t = countdownSec;
    setCountdownNow(t);

    const tick = () =>
      new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 1000);
      });

    while (t > 0) {
      // eslint-disable-next-line no-await-in-loop
      await tick();
      t -= 1;
      setCountdownNow(t);
    }

    setCountdownNow(null);
    await captureOne();

    // auto go edit if completed
    setTimeout(() => {
      if (shots.length + 1 >= needShots) {
        goEdit();
      } else {
        setActiveSlot(Math.min(shots.length + 1, needShots - 1));
      }
    }, 120);
  }

  function retakeSlot(slotIdx: number) {
    // allow retake specific slot: replace shot at index
    setShots((prev) => {
      const next = [...prev];
      next[slotIdx] = next[slotIdx] || { dataUrl: "" };
      next[slotIdx].dataUrl = ""; // clear -> user re-capture
      return next;
    });
    setStep("capture");
    setActiveSlot(slotIdx);
    startCamera();
  }

  /** ==== edit drag/zoom per slot ==== */
  const dragState = useRef<{
    dragging: boolean;
    startX: number;
    startY: number;
    baseOffX: number;
    baseOffY: number;
  }>({ dragging: false, startX: 0, startY: 0, baseOffX: 0, baseOffY: 0 });

  function onSlotPointerDown(e: React.PointerEvent, slotIdx: number) {
    if (step !== "edit") return;
    setActiveSlot(slotIdx);
    dragState.current.dragging = true;
    dragState.current.startX = e.clientX;
    dragState.current.startY = e.clientY;
    dragState.current.baseOffX = slotEdits[slotIdx]?.offsetX || 0;
    dragState.current.baseOffY = slotEdits[slotIdx]?.offsetY || 0;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }

  function onSlotPointerMove(e: React.PointerEvent, slotIdx: number) {
    if (!dragState.current.dragging) return;
    if (step !== "edit") return;

    const dxPreview = e.clientX - dragState.current.startX;
    const dyPreview = e.clientY - dragState.current.startY;

    // convert preview px -> real slot px
    const dx = dxPreview / scale;
    const dy = dyPreview / scale;

    setSlotEdits((prev) => {
      const next = [...prev];
      const cur = next[slotIdx];
      if (!cur) return prev;
      next[slotIdx] = {
        ...cur,
        offsetX: dragState.current.baseOffX + dx,
        offsetY: dragState.current.baseOffY + dy,
      };
      return next;
    });
  }

  function onSlotPointerUp(e: React.PointerEvent) {
    dragState.current.dragging = false;
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }

  /** ==== export composer (sandwich: underlay -> photos -> overlay) ==== */
  async function exportAndUpload() {
    if (!selectedTemplate) return;
    if (shots.length < needShots) {
      setErrorMsg("Foto kamu belum lengkap. Ambil semua shot dulu ya.");
      return;
    }

    setExporting(true);
    setErrorMsg(null);

    try {
      // load layers
      const overlay = overlayUrl ? await loadImage(overlayUrl, true) : null;
      const underlay = underlayUrl ? await loadImage(underlayUrl, true) : null;

      // load captured images
      const photoImgs: HTMLImageElement[] = [];
      for (let i = 0; i < needShots; i++) {
        const d = shots[i]?.dataUrl;
        if (!d) throw new Error("Shot #" + (i + 1) + " kosong. Retake dulu.");
        // eslint-disable-next-line no-await-in-loop
        photoImgs.push(await loadImage(d, false));
      }

      // compose canvas
      const out = document.createElement("canvas");
      out.width = selectedTemplate.canvasWidth;
      out.height = selectedTemplate.canvasHeight;
      const ctx = out.getContext("2d");
      if (!ctx) throw new Error("Canvas context gagal.");

      // optional background layer
      if (underlay) ctx.drawImage(underlay, 0, 0, out.width, out.height);

      // draw each photo into slot
      for (let i = 0; i < needShots; i++) {
        const slot = selectedTemplate.slots[i];
        const img = photoImgs[i];
        const edit = slotEdits[i] || { offsetX: 0, offsetY: 0, zoom: 1, filter: "none" };

        ctx.save();

        // clip to slot rect
        ctx.beginPath();
        ctx.rect(slot.x, slot.y, slot.width, slot.height);
        ctx.clip();

        // apply filter
        ctx.filter = cssFilter(edit.filter);

        /**
         * Cover-fit + user offset/zoom
         * - We want the image to fill slot (cover)
         */
        const iw = img.width;
        const ih = img.height;
        const slotAR = slot.width / slot.height;
        const imgAR = iw / ih;

        let drawW = slot.width;
        let drawH = slot.height;

        if (imgAR > slotAR) {
          // image wider -> fit height, crop sides
          drawH = slot.height;
          drawW = drawH * imgAR;
        } else {
          // image taller -> fit width, crop top/bottom
          drawW = slot.width;
          drawH = drawW / imgAR;
        }

        // apply zoom (scale around center)
        drawW *= edit.zoom;
        drawH *= edit.zoom;

        // center position + offset (offset in px)
        const cx = slot.x + slot.width / 2 + edit.offsetX;
        const cy = slot.y + slot.height / 2 + edit.offsetY;

        const x = cx - drawW / 2;
        const y = cy - drawH / 2;

        ctx.drawImage(img, x, y, drawW, drawH);

        ctx.restore();
        ctx.filter = "none";
      }

      // overlay top layer (PNG transparent)
      if (overlay) ctx.drawImage(overlay, 0, 0, out.width, out.height);

      // to blob
      const blob: Blob = await new Promise((resolve, reject) => {
        out.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Export blob gagal."))),
          "image/png",
          1.0
        );
      });

      // upload to Firebase Storage
      const fileId = randomId("photobox");
      const storageRef = ref(storage, `secret_photos/${fileId}.png`);
      await uploadBytes(storageRef, blob, { contentType: "image/png" });
      const url = await getDownloadURL(storageRef);

      // write doc so Admin Gallery can see it
      await addDoc(collection(db, "secret_photos"), {
        url,
        createdAt: new Date().toISOString(),
        createdAtServer: serverTimestamp(),
        templateId: selectedTemplate.id,
        templateName: selectedTemplate.name,
      });

      setResultUrl(url);
      setStep("export");
    } catch (e: any) {
      setErrorMsg(e?.message || "Export gagal.");
    } finally {
      setExporting(false);
    }
  }

  /** ==== UI styles (self-contained) ==== */
  const styles: React.CSSProperties = {
    minHeight: "100vh",
    background:
      "radial-gradient(1200px 800px at 20% 10%, rgba(59,130,246,0.25), transparent 60%), radial-gradient(900px 700px at 80% 20%, rgba(139,92,246,0.22), transparent 60%), #0b1220",
    color: "#e5e7eb",
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
  };

  return (
    <div style={styles}>
      {/* topbar */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          backdropFilter: "blur(14px)",
          background: "rgba(11,18,32,0.65)",
          borderBottom: "1px solid rgba(148,163,184,0.12)",
        }}
      >
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "14px 16px", display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ fontWeight: 900, letterSpacing: 0.3 }}>
            📸 Photobox
            <span style={{ fontWeight: 700, color: "#93c5fd", marginLeft: 10, fontSize: 12 }}>
              {selectedTemplate ? selectedTemplate.name : "Template Selection"}
            </span>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
            {selectedTemplate && (
              <button
                onClick={backToSelect}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(148,163,184,0.18)",
                  background: "rgba(2,6,23,0.55)",
                  color: "#e5e7eb",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                ⬅ Back
              </button>
            )}
          </div>
        </div>
      </div>

      {/* flash overlay */}
      {flash && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(255,255,255,0.85)",
            zIndex: 9999,
            pointerEvents: "none",
          }}
        />
      )}

      {/* content */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "18px 16px 60px" }}>
        {errorMsg && (
          <div
            style={{
              marginBottom: 14,
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid rgba(239,68,68,0.35)",
              background: "rgba(239,68,68,0.08)",
              color: "#fecaca",
              fontWeight: 700,
            }}
          >
            ⚠ {errorMsg}
          </div>
        )}

        {/* STEP: SELECT */}
        {step === "select" && (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr",
                gap: 14,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  borderRadius: 18,
                  border: "1px solid rgba(148,163,184,0.14)",
                  background: "rgba(2,6,23,0.45)",
                  padding: 16,
                }}
              >
                <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ fontSize: 18, fontWeight: 900 }}>Pilih Template</div>
                  <div style={{ color: "#94a3b8", fontWeight: 700, fontSize: 13 }}>
                    Konsep layering PNG transparan (sandwich): foto di bawah, frame di atas.
                  </div>
                  <div style={{ marginLeft: "auto", minWidth: 260 }}>
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search template..."
                      style={{
                        width: "100%",
                        padding: "11px 12px",
                        borderRadius: 12,
                        border: "1px solid rgba(148,163,184,0.18)",
                        background: "rgba(2,6,23,0.55)",
                        color: "#e5e7eb",
                        outline: "none",
                        fontWeight: 700,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                gap: 14,
              }}
            >
              {filteredTemplates.map((t) => {
                const isActive = selectedTemplate?.id === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => chooseTemplate(t)}
                    style={{
                      textAlign: "left",
                      borderRadius: 18,
                      border: isActive ? "1px solid rgba(59,130,246,0.65)" : "1px solid rgba(148,163,184,0.14)",
                      background: isActive ? "rgba(59,130,246,0.14)" : "rgba(2,6,23,0.45)",
                      padding: 12,
                      cursor: "pointer",
                      color: "#e5e7eb",
                      boxShadow: isActive ? "0 14px 40px rgba(59,130,246,0.16)" : "none",
                      transition: "transform .12s ease",
                    }}
                  >
                    <div
                      style={{
                        height: 280,
                        borderRadius: 14,
                        border: "1px solid rgba(148,163,184,0.12)",
                        background:
                          "repeating-conic-gradient(rgba(148,163,184,0.07) 0% 25%, rgba(148,163,184,0.02) 0% 50%) 50% / 18px 18px",
                        overflow: "hidden",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <img
                        src={t.imageUrl}
                        alt={t.name}
                        style={{ width: "100%", height: "100%", objectFit: "contain" }}
                      />
                    </div>
                    <div style={{ marginTop: 10, fontWeight: 900, fontSize: 15 }}>{t.name}</div>
                    <div style={{ marginTop: 4, color: "#94a3b8", fontWeight: 800, fontSize: 12 }}>
                      📸 {t.photoCount} shot • 📐 {t.canvasWidth}×{t.canvasHeight}
                    </div>
                  </button>
                );
              })}
            </div>

            <div style={{ marginTop: 16, display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                disabled={!canGoCapture}
                onClick={goCapture}
                style={{
                  padding: "12px 16px",
                  borderRadius: 14,
                  border: "1px solid rgba(59,130,246,0.35)",
                  background: canGoCapture ? "linear-gradient(135deg, rgba(59,130,246,0.9), rgba(139,92,246,0.9))" : "rgba(148,163,184,0.12)",
                  color: "#fff",
                  cursor: canGoCapture ? "pointer" : "not-allowed",
                  fontWeight: 900,
                  boxShadow: canGoCapture ? "0 18px 48px rgba(59,130,246,0.22)" : "none",
                }}
              >
                Start Photobooth →
              </button>
            </div>
          </>
        )}

        {/* STEP: CAPTURE */}
        {step === "capture" && selectedTemplate && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 16, alignItems: "start" }}>
            {/* camera */}
            <div
              style={{
                borderRadius: 18,
                border: "1px solid rgba(148,163,184,0.14)",
                background: "rgba(2,6,23,0.45)",
                padding: 14,
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontWeight: 900 }}>Camera</div>
                <div style={{ color: "#94a3b8", fontWeight: 800, fontSize: 12 }}>
                  Shot {Math.min(shots.length + 1, needShots)}/{needShots}
                </div>
              </div>

              <div style={{ position: "relative", borderRadius: 16, overflow: "hidden", border: "1px solid rgba(148,163,184,0.14)" }}>
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  style={{ width: "100%", height: 520, objectFit: "cover", background: "#000" }}
                />

                {/* countdown overlay */}
                {countdownNow !== null && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "rgba(2,6,23,0.55)",
                      fontSize: 120,
                      fontWeight: 1000,
                      letterSpacing: -2,
                      color: "#fff",
                      textShadow: "0 18px 60px rgba(0,0,0,0.55)",
                    }}
                  >
                    {countdownNow}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
                {/* countdown selector */}
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ color: "#94a3b8", fontWeight: 900, fontSize: 12 }}>COUNTDOWN</div>
                  {[0, 3, 5, 10].map((v) => (
                    <button
                      key={v}
                      onClick={() => setCountdownSec(v)}
                      style={{
                        padding: "9px 10px",
                        borderRadius: 12,
                        border: "1px solid rgba(148,163,184,0.18)",
                        background: countdownSec === v ? "rgba(59,130,246,0.25)" : "rgba(2,6,23,0.55)",
                        color: "#e5e7eb",
                        cursor: "pointer",
                        fontWeight: 900,
                        fontSize: 12,
                      }}
                    >
                      {v === 0 ? "OFF" : `${v}s`}
                    </button>
                  ))}
                </div>

                <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
                  <button
                    onClick={startCountdownAndShoot}
                    disabled={countdownNow !== null}
                    style={{
                      padding: "12px 14px",
                      borderRadius: 14,
                      border: "1px solid rgba(16,185,129,0.35)",
                      background: "linear-gradient(135deg, rgba(16,185,129,0.9), rgba(59,130,246,0.85))",
                      color: "#fff",
                      cursor: countdownNow !== null ? "not-allowed" : "pointer",
                      fontWeight: 950,
                      boxShadow: "0 18px 48px rgba(16,185,129,0.18)",
                    }}
                  >
                    📸 Shoot
                  </button>

                  {shots.length > 0 && (
                    <button
                      onClick={goEdit}
                      style={{
                        padding: "12px 14px",
                        borderRadius: 14,
                        border: "1px solid rgba(148,163,184,0.18)",
                        background: "rgba(2,6,23,0.55)",
                        color: "#e5e7eb",
                        cursor: "pointer",
                        fontWeight: 900,
                      }}
                    >
                      Next →
                    </button>
                  )}
                </div>
              </div>

              <canvas ref={captureCanvasRef} style={{ display: "none" }} />
            </div>

            {/* right panel */}
            <div
              style={{
                borderRadius: 18,
                border: "1px solid rgba(148,163,184,0.14)",
                background: "rgba(2,6,23,0.45)",
                padding: 14,
              }}
            >
              <div style={{ fontWeight: 900, marginBottom: 10 }}>Shots</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
                {Array.from({ length: needShots }).map((_, i) => {
                  const shot = shots[i]?.dataUrl;
                  const active = activeSlot === i;
                  return (
                    <button
                      key={i}
                      onClick={() => setActiveSlot(i)}
                      style={{
                        borderRadius: 14,
                        border: active ? "1px solid rgba(59,130,246,0.7)" : "1px solid rgba(148,163,184,0.14)",
                        background: "rgba(2,6,23,0.55)",
                        overflow: "hidden",
                        cursor: "pointer",
                        position: "relative",
                        height: 160,
                      }}
                    >
                      {shot ? (
                        <img src={shot} alt={`shot-${i}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontWeight: 900 }}>
                          {i + 1}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              <div style={{ marginTop: 12, color: "#94a3b8", fontWeight: 800, fontSize: 12, lineHeight: 1.55 }}>
                Tips:
                <div>• Pilih countdown sesuai yang kamu mau.</div>
                <div>• Shoot sampai lengkap → lanjut Edit.</div>
              </div>
            </div>
          </div>
        )}

        {/* STEP: EDIT */}
        {step === "edit" && selectedTemplate && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 16, alignItems: "start" }}>
            {/* preview */}
            <div
              style={{
                borderRadius: 18,
                border: "1px solid rgba(148,163,184,0.14)",
                background: "rgba(2,6,23,0.45)",
                padding: 14,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontWeight: 900 }}>Edit & Preview</div>
                <div style={{ color: "#94a3b8", fontWeight: 900, fontSize: 12 }}>Drag foto di slot • Zoom • Filter</div>
              </div>

              <div
                ref={previewWrapRef}
                style={{
                  borderRadius: 16,
                  border: "1px solid rgba(148,163,184,0.14)",
                  background: "#000",
                  overflow: "auto",
                  maxHeight: "78vh",
                  padding: 12,
                }}
              >
                <div
                  style={{
                    position: "relative",
                    width: selectedTemplate.canvasWidth * scale,
                    height: selectedTemplate.canvasHeight * scale,
                    margin: "0 auto",
                    background: "rgba(2,6,23,0.35)",
                    borderRadius: 16,
                    overflow: "hidden",
                  }}
                >
                  {/* underlay */}
                  {underlayUrl && (
                    <img
                      src={underlayUrl}
                      alt="underlay"
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  )}

                  {/* slots with photos */}
                  {selectedTemplate.slots.slice(0, needShots).map((slot, i) => {
                    const shot = shots[i]?.dataUrl;
                    const edit = slotEdits[i];
                    const isActive = activeSlot === i;

                    return (
                      <div
                        key={i}
                        onPointerDown={(e) => onSlotPointerDown(e, i)}
                        onPointerMove={(e) => onSlotPointerMove(e, i)}
                        onPointerUp={onSlotPointerUp}
                        style={{
                          position: "absolute",
                          left: slot.x * scale,
                          top: slot.y * scale,
                          width: slot.width * scale,
                          height: slot.height * scale,
                          borderRadius: 12,
                          outline: isActive ? "2px solid rgba(59,130,246,0.9)" : "1px solid rgba(148,163,184,0.18)",
                          boxShadow: isActive ? "0 18px 50px rgba(59,130,246,0.22)" : "none",
                          overflow: "hidden",
                          background: "rgba(2,6,23,0.35)",
                          cursor: "grab",
                          touchAction: "none",
                        }}
                      >
                        {shot ? (
                          <img
                            src={shot}
                            alt={`slot-${i}`}
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                              transform: `translate(${(edit?.offsetX || 0) * scale}px, ${(edit?.offsetY || 0) * scale}px) scale(${edit?.zoom || 1})`,
                              transformOrigin: "center",
                              filter: cssFilter(edit?.filter || "none"),
                              userSelect: "none",
                              pointerEvents: "none",
                            }}
                          />
                        ) : (
                          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontWeight: 950 }}>
                            Shot kosong — retake
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* overlay (PNG transparent) */}
                  {overlayUrl && (
                    <img
                      src={overlayUrl}
                      alt="overlay"
                      style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        pointerEvents: "none",
                      }}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* controls */}
            <div
              style={{
                borderRadius: 18,
                border: "1px solid rgba(148,163,184,0.14)",
                background: "rgba(2,6,23,0.45)",
                padding: 14,
              }}
            >
              <div style={{ fontWeight: 900, marginBottom: 10 }}>Controls</div>

              {/* slot picker */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                {Array.from({ length: needShots }).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveSlot(i)}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 14,
                      border: "1px solid rgba(148,163,184,0.18)",
                      background: activeSlot === i ? "rgba(59,130,246,0.25)" : "rgba(2,6,23,0.55)",
                      color: "#e5e7eb",
                      cursor: "pointer",
                      fontWeight: 900,
                      fontSize: 12,
                    }}
                  >
                    Slot {i + 1}
                  </button>
                ))}
              </div>

              {/* zoom */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ color: "#94a3b8", fontWeight: 900, fontSize: 12, marginBottom: 6 }}>ZOOM</div>
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.05}
                  value={slotEdits[activeSlot]?.zoom || 1.15}
                  onChange={(e) => {
                    const z = clamp(parseFloat(e.target.value), 1, 3);
                    setSlotEdits((prev) => {
                      const next = [...prev];
                      if (!next[activeSlot]) return prev;
                      next[activeSlot] = { ...next[activeSlot], zoom: z };
                      return next;
                    });
                  }}
                  style={{ width: "100%" }}
                />
                <div style={{ color: "#94a3b8", fontWeight: 900, fontSize: 12 }}>
                  {Math.round((slotEdits[activeSlot]?.zoom || 1) * 100)}%
                </div>
              </div>

              {/* filter */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ color: "#94a3b8", fontWeight: 900, fontSize: 12, marginBottom: 6 }}>FILTER</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {(["none", "bw", "warm", "cool", "vintage"] as FilterKey[]).map((k) => (
                    <button
                      key={k}
                      onClick={() => {
                        setSlotEdits((prev) => {
                          const next = [...prev];
                          if (!next[activeSlot]) return prev;
                          next[activeSlot] = { ...next[activeSlot], filter: k };
                          return next;
                        });
                      }}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 14,
                        border: "1px solid rgba(148,163,184,0.18)",
                        background: (slotEdits[activeSlot]?.filter || "none") === k ? "rgba(16,185,129,0.18)" : "rgba(2,6,23,0.55)",
                        color: "#e5e7eb",
                        cursor: "pointer",
                        fontWeight: 900,
                        fontSize: 12,
                      }}
                    >
                      {k.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* quick actions */}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  onClick={() => {
                    setSlotEdits((prev) => {
                      const next = [...prev];
                      if (!next[activeSlot]) return prev;
                      next[activeSlot] = { ...next[activeSlot], offsetX: 0, offsetY: 0, zoom: 1.15 };
                      return next;
                    });
                  }}
                  style={{
                    flex: 1,
                    padding: "12px 14px",
                    borderRadius: 14,
                    border: "1px solid rgba(148,163,184,0.18)",
                    background: "rgba(2,6,23,0.55)",
                    color: "#e5e7eb",
                    cursor: "pointer",
                    fontWeight: 950,
                  }}
                >
                  ♻ Reset Slot
                </button>

                <button
                  onClick={() => retakeSlot(activeSlot)}
                  style={{
                    flex: 1,
                    padding: "12px 14px",
                    borderRadius: 14,
                    border: "1px solid rgba(239,68,68,0.35)",
                    background: "rgba(239,68,68,0.12)",
                    color: "#fecaca",
                    cursor: "pointer",
                    fontWeight: 950,
                  }}
                >
                  🔁 Retake Slot
                </button>
              </div>

              <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
                <button
                  onClick={() => setStep("capture")}
                  style={{
                    padding: "12px 14px",
                    borderRadius: 14,
                    border: "1px solid rgba(148,163,184,0.18)",
                    background: "rgba(2,6,23,0.55)",
                    color: "#e5e7eb",
                    cursor: "pointer",
                    fontWeight: 950,
                  }}
                >
                  ⬅ Back Camera
                </button>

                <button
                  onClick={exportAndUpload}
                  disabled={exporting}
                  style={{
                    marginLeft: "auto",
                    padding: "12px 16px",
                    borderRadius: 14,
                    border: "1px solid rgba(16,185,129,0.35)",
                    background: "linear-gradient(135deg, rgba(16,185,129,0.9), rgba(59,130,246,0.85))",
                    color: "#fff",
                    cursor: exporting ? "not-allowed" : "pointer",
                    fontWeight: 1000,
                    boxShadow: "0 18px 48px rgba(16,185,129,0.18)",
                  }}
                >
                  {exporting ? "⏳ Exporting..." : "✅ Export & Upload"}
                </button>
              </div>

              <div style={{ marginTop: 12, color: "#94a3b8", fontWeight: 800, fontSize: 12, lineHeight: 1.55 }}>
                • Drag foto di slot untuk geser position. <br />
                • Zoom + filter per slot. <br />
                • Export = canvas “sandwich” (foto → overlay PNG).
              </div>
            </div>
          </div>
        )}

        {/* STEP: EXPORT */}
        {step === "export" && selectedTemplate && (
          <div
            style={{
              borderRadius: 18,
              border: "1px solid rgba(148,163,184,0.14)",
              background: "rgba(2,6,23,0.45)",
              padding: 16,
            }}
          >
            <div style={{ fontWeight: 1000, fontSize: 18 }}>✅ Berhasil!</div>
            <div style={{ color: "#94a3b8", fontWeight: 800, marginTop: 6 }}>
              Foto udah ke-upload dan admin panel harusnya langsung kebaca di tab <b>User Gallery</b>.
            </div>

            {resultUrl && (
              <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 320px", gap: 14, alignItems: "start" }}>
                <div style={{ borderRadius: 16, overflow: "hidden", border: "1px solid rgba(148,163,184,0.14)", background: "#000" }}>
                  <img src={resultUrl} alt="result" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                </div>
                <div>
                  <a
                    href={resultUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: "inline-block",
                      padding: "12px 14px",
                      borderRadius: 14,
                      border: "1px solid rgba(59,130,246,0.35)",
                      background: "rgba(59,130,246,0.16)",
                      color: "#bfdbfe",
                      fontWeight: 950,
                      textDecoration: "none",
                    }}
                  >
                    🔗 Open Full Image
                  </a>

                  <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
                    <button
                      onClick={backToSelect}
                      style={{
                        padding: "12px 14px",
                        borderRadius: 14,
                        border: "1px solid rgba(148,163,184,0.18)",
                        background: "rgba(2,6,23,0.55)",
                        color: "#e5e7eb",
                        cursor: "pointer",
                        fontWeight: 950,
                      }}
                    >
                      New Session
                    </button>

                    <button
                      onClick={() => {
                        setStep("edit");
                      }}
                      style={{
                        padding: "12px 14px",
                        borderRadius: 14,
                        border: "1px solid rgba(16,185,129,0.35)",
                        background: "rgba(16,185,129,0.14)",
                        color: "#bbf7d0",
                        cursor: "pointer",
                        fontWeight: 950,
                      }}
                    >
                      Edit Again
                    </button>
                  </div>

                  <div style={{ marginTop: 12, color: "#94a3b8", fontWeight: 800, fontSize: 12, lineHeight: 1.6 }}>
                    Kalau kamu mau konsep makin “jepreto vibes”, tinggal banyakin template PNG transparan dari Admin Template Manager.
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}