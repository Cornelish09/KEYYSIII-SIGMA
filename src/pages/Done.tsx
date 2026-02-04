import React from "react";
import type { AppState, ContentConfig } from "../lib/types";
import { loadLogs, resetState } from "../lib/storage";
import { formatDateShort } from "../lib/utils";
import { logEvent } from "../lib/activity";

export function Done({
  cfg,
  state,
  onRestart
}: {
  cfg: ContentConfig;
  state: AppState;
  onRestart: () => void;
}) {
  const logs = React.useMemo(() => loadLogs().slice(-12).reverse(), []);

  const place = cfg.places.items.find((p) => p.id === state.chosenPlaceId);
  const outfit = cfg.outfits.items.find((o) => o.id === state.chosenOutfitId);

  const hardReset = () => {
    resetState();
    logEvent("reset_hard");
    onRestart();
  };

  return (
    <div className="card">
      <div className="card-inner">
        <div className="card-title">Yay, udah beres 🎉</div>
        <div className="card-sub">
          Sekarang tinggal real-life: atur hari & jam, terus berangkat 😼
        </div>

        <div className="grid">
          <div className="card" style={{ background: "rgba(255,255,255,.03)" }}>
            <div className="card-inner">
              <div className="badge">📌 Ringkasan</div>
              <div className="hr" />

              <div className="smallmuted">
                <p style={{ marginTop: 0 }}>
                  Tempat: <strong>{place?.name ?? "—"}</strong>
                </p>
                <p>
                  Outfit: <strong>{outfit?.title ?? "—"}</strong>
                </p>
                <p style={{ marginBottom: 0 }}>
                  Last activity: <strong>{state.stats.lastPlayedAt ? formatDateShort(state.stats.lastPlayedAt) : "—"}</strong>
                </p>
              </div>

              <div className="footerActions">
                <button className="btn primary" onClick={onRestart}>Balik ke awal</button>
                <button className="btn danger" onClick={hardReset}>Reset total</button>
              </div>

              <div className="smallmuted" style={{ marginTop: 10 }}>
                “Reset total” bakal hapus progress (tapi config Admin tetap).
              </div>
            </div>
          </div>

          <div className="card" style={{ background: "rgba(255,255,255,.03)" }}>
            <div className="card-inner">
              <div className="badge">🧾 Aktivitas terbaru</div>
              <div className="hr" />
              <div className="smallmuted">
                {logs.length === 0 ? (
                  <p style={{ marginTop: 0 }}>Belum ada log.</p>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {logs.map((l) => (
                      <li key={l.ts + l.type}>
                        <strong>{l.type}</strong> • {formatDateShort(l.ts)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="hr" />

              <div className="badge">💬 Closing</div>
              <div className="smallmuted" style={{ marginTop: 10 }}>
                Kirim screenshot ringkasan ini ke chat kamu kalau mau biar dia makin yakin 😄
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
