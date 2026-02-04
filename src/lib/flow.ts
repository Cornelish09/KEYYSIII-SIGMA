import { Step } from "./types";

export const ROUTE_FOR_STEP: Record<Step, string> = {
  0: "/",
  1: "/game",
  2: "/letter",
  3: "/places",
  4: "/outfits",
  5: "/final", // <--- INI WAJIB ADA BIAR GAK 404
};

export function stepForPath(path: string): Step | null {
  // Bersihin slash di akhir url biar gak error
  const p = path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;

  if (p === "/") return 0;
  if (p === "/game") return 1;
  if (p === "/letter") return 2;
  if (p === "/places") return 3;
  if (p === "/outfits") return 4;
  if (p === "/final") return 5; // <--- INI JUGA PENTING
  
  return null;
}