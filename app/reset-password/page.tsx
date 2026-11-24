"use client";
import Link from "next/link";
import { useEffect, useSyncExternalStore, useState } from "react";

const subscribe = () => () => {};
const readToken = () => new URLSearchParams(window.location.search).get("token") ?? "";
const serverToken = () => "";

export default function ResetPasswordPage() {
  // Token ada di URL, dibaca sebagai snapshot klien tanpa setState di effect.
  const token = useSyncExternalStore(subscribe, readToken, serverToken);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);

  // Token sudah tersimpan di `token`. Buang dari URL supaya tidak tertinggal di
  // history browser, tab sync, atau log proxy.
  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage("");
    const r = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setMessage(d.error ?? "Gagal mengubah password");
    setDone(true);
    setMessage(d.message ?? "Password berhasil diubah.");
  }

  return (
    <main className="auth-page">
      <section className="auth-panel" style={{ gridColumn: "1 / -1" }}>
        <div className="auth-card">
          <span className="auth-kicker">Keamanan akun</span>
          <h2>Reset password</h2>
          <p className="auth-description">Masukkan password baru untuk akun Finwise kamu.</p>
          <form className="auth-form" onSubmit={submit}>
            <label>Password baru
              <input
                type="password"
                minLength={8}
                maxLength={100}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimal 8 karakter"
                required
              />
            </label>
            {message && <p className={done ? "success" : "err"}>{message}</p>}
            <button className="primary-button" type="submit" disabled={!token || done}>Simpan password</button>
          </form>
          <p className="auth-switch">
            <Link href="/" style={{ color: "#1f7a5a" }}>Kembali ke halaman masuk</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
