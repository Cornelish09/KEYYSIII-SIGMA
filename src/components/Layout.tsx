import React, { useRef, useEffect } from "react";
import type { AppState, ContentConfig } from "../lib/types";

// Komponen Dots Internal (Design tetap)
function SimpleDots({ step }: { step: number }) {
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
      {[1, 2, 3, 4, 5].map((s) => (
        <div 
          key={s} 
          style={{
            width: 8, height: 8, borderRadius: '50%',
            background: step >= s ? '#be123c' : 'rgba(190, 18, 60, 0.2)',
            transition: '0.3s'
          }}
        />
      ))}
    </div>
  );
}

export function Layout({
  children,
  state,
  cfg,
  onReset
}: {
  children: React.ReactNode;
  cfg: ContentConfig;
  state: AppState;
  onReset: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);

  // --- LOGIC AUDIO CENTER ---
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // KITA HAPUS LOGIC "PAUSE DI STEP 2".
    // Sekarang logicnya: Biarkan lagu mengalir apa adanya.
    // Browser akan otomatis lanjutin lagu saat pindah halaman (karena Layout tidak unmount).
    
    // Cek: Kalau lagu belum jalan & belum habis, coba jalankan pelan-pelan
    if (audio.paused && !audio.ended && state.step > 0) {
      audio.play().catch(() => {
        // Autoplay mungkin diblokir browser, gapapa.
        // Nanti user trigger lewat tombol di header/intro.
      });
    }
    
  }, [state.step]);

  return (
    <div style={{ 
      minHeight: "100vh", 
      paddingTop: "80px", 
      boxSizing: "border-box",
      background: "linear-gradient(135deg, #fff0f5 0%, #ffe4e1 100%)",
      color: "#881337",
      fontFamily: "'Inter', sans-serif"
    }}>
      
      {/* UPDATE PENTING: 
         1. 'loop' dihapus -> Biar play 1 kali aja sampai habis.
         2. id="bg-music" -> Biar bisa dikontrol dari mana aja.
      */}
      <audio
        id="bg-music"
        ref={audioRef}
        src={cfg.music || "/bgm.mp3"} 
        // loop={false} // Default audio tanpa attribute loop adalah false (tidak looping)
      />

      {state.step > 0 && (
        <div style={{ marginBottom: "20px" }}>
          <SimpleDots step={state.step} />
        </div>
      )}

      <main>
        {children}
      </main>
    </div>
  );
}