import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <div className="card">
      <div className="card-inner">
        <div className="card-title">404</div>
        <div className="card-sub">Halaman tidak ditemukan.</div>
        <div className="footerActions" style={{ marginTop: 12 }}>
          <Link to="/" className="btn primary" style={{ textDecoration: "none" }}>Balik ke awal</Link>
        </div>
      </div>
    </div>
  );
}
