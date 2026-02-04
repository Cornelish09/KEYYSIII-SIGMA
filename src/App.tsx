import { db } from "./firebase";
import { doc, getDoc } from "firebase/firestore";
import React from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import "./styles.css";

import type { AppState, ContentConfig } from "./lib/types";
import { loadConfig, loadState, resetState, saveState } from "./lib/storage";
import { ROUTE_FOR_STEP, stepForPath } from "./lib/flow";
import { logEvent } from "./lib/activity";

import { Layout } from "./components/Layout";
import { ToastArea, useToasts } from "./components/Toast";
import { Header } from "./components/Header";

// Pages
import { Intro3D } from "./pages/Intro3D";
import { GameUnlock } from "./pages/GameUnlock";
import { Letter } from "./pages/Letter";
import { Places } from "./pages/Places";
import { Outfits } from "./pages/Outfits";
import { Final } from "./pages/Final";
import { Admin } from "./pages/Admin";
import { NotFound } from "./pages/NotFound";

function enforceStep(pathname: string, stateStep: AppState["step"]): string | null {
  const pageStep = stepForPath(pathname);

  // Biar route lain (mis: /final/*, /404) nggak kena gate
  if (pageStep === null) return null;

  // Admin bypass
  if (pathname.startsWith("/admin")) return null;

  // Cegah loncat step
  if (pageStep > stateStep) return ROUTE_FOR_STEP[stateStep];

  return null;
}

export default function App() {
  const [cfg, setCfg] = React.useState<ContentConfig>(() => loadConfig());
  const [state, setState] = React.useState<AppState>(() => loadState());

  // Tambahin useEffect ini di bawahnya:
  React.useEffect(() => {
    const syncFirebase = async () => {
      const docRef = doc(db, "configs", "main-config");
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setCfg(docSnap.data() as ContentConfig);
      }
    };
    syncFirebase();
  }, []);
  const loc = useLocation();
  const nav = useNavigate();

  // ✅ Kompatibel: useToasts bisa return {items,push} ATAU {toasts,push}
  const toastApi: any = useToasts();
  const push: (title: string, msg: string) => void = toastApi?.push ?? (() => {});
  const toastList = toastApi?.items ?? toastApi?.toasts ?? [];
  const ToastAreaAny: any = ToastArea;

  React.useEffect(() => {
    logEvent("app_open", { path: window.location.pathname });
  }, []);

  // Sync kalau config/state diubah dari tab lain (admin)
  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key?.includes("hangout_card_config_v1")) {
        setCfg(loadConfig());
        push("Updated", "Config berubah (Admin).");
      }
      if (e.key?.includes("hangout_card_state_v1")) {
        setState(loadState());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [push]);

  // Step gate
  React.useEffect(() => {
    const redirect = enforceStep(loc.pathname, state.step);
    if (redirect && redirect !== loc.pathname) {
      nav(redirect, { replace: true });
    }
  }, [loc.pathname, nav, state.step]);

  const onResetProgress = () => {
    if (!confirm("Reset progress? (Config Admin tetap)")) return;
    resetState();
    const next = loadState();
    setState(next);
    logEvent("reset_progress");
    push("Reset", "Progress direset.");
    nav("/", { replace: true });
  };

  // Optional: balik ke awal tapi keep config
  const restartToStart = () => {
    const next: AppState = {
      ...state,
      step: 0,
      unlocked: false,
      chosenPlaceId: undefined,
      chosenOutfitId: undefined,
    };
    saveState(next);
    setState(next);
    nav("/", { replace: true });
  };

  return (
    <>
      <Header onReset={onResetProgress} />

      <Layout cfg={cfg} state={state} onReset={onResetProgress}>
        <Routes>
          <Route path="/" element={<Intro3D cfg={cfg} state={state} setState={setState} />} />
          <Route path="/game" element={<GameUnlock cfg={cfg} state={state} setState={setState} />} />
          <Route path="/letter" element={<Letter cfg={cfg} state={state} setState={setState} />} />
          <Route path="/places" element={<Places cfg={cfg} state={state} setState={setState} />} />
          <Route path="/outfits" element={<Outfits cfg={cfg} state={state} setState={setState} />} />

          {/* alias lama kalau masih ada yang ke /done */}
          <Route path="/done" element={<Navigate to="/final" replace />} />

          {/* ✅ ini wajib karena Outfits navigate ke "/final" */}
          <Route path="/final/*" element={<Final cfg={cfg} state={state} />} />

          <Route path="/admin/*" element={<Admin />} />
          <Route path="/404" element={<NotFound />} />
          <Route path="*" element={<Navigate to="/404" replace />} />
        </Routes>

        {/* kalau kamu butuh tombol restart di Final, bisa dipindah ke Final nanti */}
        <button style={{ display: "none" }} onClick={restartToStart} />
      </Layout>

      {/* ✅ Kirim kedua prop biar aman */}
      <ToastAreaAny items={toastList} toasts={toastList} />
    </>
  );
}
