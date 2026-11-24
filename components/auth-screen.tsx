import type { FormEvent } from "react";

type Props = {
  mode: "login" | "register";
  msg: string;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onAuthEmail: (kind: "forgot-password" | "resend-verification") => void;
  onSwitchMode: () => void;
};

export default function AuthScreen({ mode, msg, onSubmit, onAuthEmail, onSwitchMode }: Props) {
  const isLogin = mode === "login";
  const positive = /berhasil|dibuat|terkirim|diproses|aktif/i.test(msg);

  return (
    <main className="auth-page">
      <section className="auth-showcase">
        <div className="auth-brand"><span className="brand-mark">Rp</span><span>Finwise</span></div>
        <div className="auth-rule" />
        <div className="auth-copy">
          <span className="eyebrow">Catatan uang harian</span>
          <h1>Uangmu, tercatat rapi.</h1>
          <p>Satu tempat untuk mencatat pemasukan, pengeluaran, dan ke mana uangmu pergi setiap bulan.</p>
        </div>
        <div className="auth-notes" aria-hidden="true">
          <div className="auth-note"><b>01</b><span>Catat cepat</span></div>
          <div className="auth-note"><b>02</b><span>Lihat pola pengeluaran</span></div>
          <div className="auth-note"><b>03</b><span>Atur batas bulanan</span></div>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <span className="auth-kicker">{isLogin ? "Selamat datang kembali" : "Mulai dari sini"}</span>
          <h2>{isLogin ? "Masuk ke akun" : "Buat akun baru"}</h2>
          <p className="auth-description">
            {isLogin ? "Isi detail akun kamu untuk melanjutkan." : "Daftar dulu, lalu verifikasi lewat email."}
          </p>

          <form className="auth-form" onSubmit={onSubmit}>
            {!isLogin && (
              <label>Nama lengkap
                <input name="name" placeholder="Nama kamu" required minLength={2} maxLength={60} />
              </label>
            )}
            <label>Email
              <input name="email" type="email" placeholder="nama@email.com" required />
            </label>
            <label>Password
              <input name="password" type="password" placeholder="Minimal 8 karakter" minLength={8} required />
            </label>
            {isLogin && (
              <div className="auth-links">
                <button type="button" className="text-button" onClick={() => onAuthEmail("forgot-password")}>Lupa password?</button>
                <button type="button" className="text-button" onClick={() => onAuthEmail("resend-verification")}>Kirim ulang verifikasi</button>
              </div>
            )}
            {msg && <p className={positive ? "success" : "err"}>{msg}</p>}
            <button className="primary-button" type="submit">{isLogin ? "Masuk" : "Buat akun"}</button>
          </form>

          <p className="auth-switch">
            {isLogin ? "Belum punya akun?" : "Sudah punya akun?"}{" "}
            <button type="button" className="text-button" onClick={onSwitchMode}>
              {isLogin ? "Daftar sekarang" : "Masuk"}
            </button>
          </p>
        </div>
      </section>
    </main>
  );
}
