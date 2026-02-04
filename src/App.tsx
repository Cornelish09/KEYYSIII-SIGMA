import { db } from "./firebase";
import { doc, onSnapshot } from "firebase/firestore"; 
import React from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import "./styles.css";

import type { AppState, ContentConfig } from "./lib/types";
import { loadConfig, loadState, resetState, saveState, saveConfig } from "./lib/storage";
import { ROUTE_FOR_STEP, stepForPath } from "./lib/flow";
import { logEvent } from "./lib/activity";

import { Layout } from "./components/Layout";
import { ToastArea, useToasts } from "./components/Toast";
import { Header } from "./components/Header";

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

  // ✅ LOGIKA SINKRONISASI TOTAL (SUMBER KEBENARAN: FIREBASE)
  React.useEffect(() => {
    const docRef = doc(db, "configs", "main-config");
    
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const cloudData = docSnap.data() as ContentConfig;
        
        // Paksa ganti state UI
        setCfg(cloudData);
        
        // Paksa simpan ke storage agar saat refresh data cloud tetap ada
        saveConfig(cloudData); 
        localStorage.setItem("hangout_card_config_v1", JSON.stringify(cloudData));
        
        console.log("🔔 Cloud Sync: Data terbaru berhasil diterapkan ke semua user.");
      }
    }, (error) => {
      console.error("Firebase Sync Error:", error);
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
      }
      if (e.key?.includes("hangout_card_state_v1")) {
        setState(loadState());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  React.useEffect(() => {
    const redirect = enforceStep(loc.pathname, state.step);
    if (redirect && redirect !== loc.pathname) {
      nav(redirect, { replace: true });
    }
  }, [loc.pathname, nav, state.step]);

  const onResetProgress = () => {
    if (!confirm("Reset progress?")) return;
    resetState();
    setState(loadState());
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
      </Layout>
      <ToastAreaAny items={toastList} toasts={toastList} />
    </>
  );
}