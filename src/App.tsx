import { db } from "./firebase";
import { doc, onSnapshot } from "firebase/firestore"; 
import React from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import "./styles.css";

import type { AppState, ContentConfig } from "./lib/types";
// ✅ Gue panggil saveConfig biar datanya permanen di HP
import { loadConfig, loadState, resetState, saveState, saveConfig } from "./lib/storage"; 
import { ROUTE_FOR_STEP, stepForPath } from "./lib/flow";
import { logEvent } from "./lib/activity";

import { Layout } from "./components/Layout";
import { ToastArea, useToasts } from "./components/Toast";
import { Header } from "./components/Header";

// Pages ... (Gue skip bagian import ini biar gak kepanjangan, tetep pake punya lo)
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
  if (pageStep === null) return null;
  if (pathname.startsWith("/admin")) return null;
  if (pageStep > stateStep) return ROUTE_FOR_STEP[stateStep];
  return null;
}

export default function App() {
  const [cfg, setCfg] = React.useState<ContentConfig>(() => loadConfig());
  const [state, setState] = React.useState<AppState>(() => loadState());

  React.useEffect(() => {
    const docRef = doc(db, "configs", "main-config");
    
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data() as ContentConfig;
        console.log("Data Firebase Ter-update secara Real-time!");
        
        // 1. Update tampilan (state)
        setCfg(data);
        
        // 2. ✅ INI KUNCINYA: Simpan ke memori HP biar pas refresh gak balik ke data lama
        saveConfig(data); 
      }
    });

    return () => unsubscribe();
  }, []);

  const loc = useLocation();
  const nav = useNavigate();

  const toastApi: any = useToasts();
  const push: (title: string, msg: string) => void = toastApi?.push ?? (() => {});
  const toastList = toastApi?.items ?? toastApi?.toasts ?? [];
  const ToastAreaAny: any = ToastArea;

  React.useEffect(() => {
    logEvent("app_open", { path: window.location.pathname });
  }, []);

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
          <Route path="/done" element={<Navigate to="/final" replace />} />
          <Route path="/final/*" element={<Final cfg={cfg} state={state} />} />
          <Route path="/admin/*" element={<Admin />} />
          <Route path="/404" element={<NotFound />} />
          <Route path="*" element={<Navigate to="/404" replace />} />
        </Routes>
        <button style={{ display: "none" }} onClick={restartToStart} />
      </Layout>
      <ToastAreaAny items={toastList} toasts={toastList} />
    </>
  );
}