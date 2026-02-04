import type { AppState } from "./types";
import { saveState } from "./storage";

type AudioStatus = "idle" | "loading" | "playing" | "paused" | "error";

let audio: HTMLAudioElement | null = null;
let status: AudioStatus = "idle";
let currentUrl = "";

function ensureAudio(url: string): HTMLAudioElement {
  if (!audio) audio = new Audio();
  if (currentUrl !== url) {
    currentUrl = url;
    audio.src = url;
    audio.loop = true;
  }
  return audio;
}

export function getAudioStatus(): AudioStatus {
  return status;
}

export async function tryPlay(url: string, state: AppState, onStatus?: (s: AudioStatus) => void): Promise<void> {
  const a = ensureAudio(url);
  a.volume = clamp01(state.music.volume);
  if (!state.music.enabled) {
    status = "paused";
    onStatus?.(status);
    a.pause();
    return;
  }

  status = "loading";
  onStatus?.(status);

  try {
    await a.play();
    status = "playing";
    onStatus?.(status);
  } catch {
    status = "paused"; // autoplay blocked usually
    onStatus?.(status);
  }
}

export function pause(onStatus?: (s: AudioStatus) => void): void {
  if (!audio) return;
  audio.pause();
  status = "paused";
  onStatus?.(status);
}

export function setVolume(vol: number, state: AppState): AppState {
  const v = clamp01(vol);
  if (audio) audio.volume = v;
  const next = { ...state, music: { ...state.music, volume: v } };
  saveState(next);
  return next;
}

export function setEnabled(enabled: boolean, state: AppState): AppState {
  const next = { ...state, music: { ...state.music, enabled } };
  saveState(next);
  return next;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
