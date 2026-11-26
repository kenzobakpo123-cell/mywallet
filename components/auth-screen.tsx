import type { FormEvent } from "react";

export type ForcedSetup = {
  challengeToken: string;
  otpauthUri: string;
  secret: string;
  recoveryCodes: string[];
};

type Props = {
  mode: "login" | "register";
  msg: string;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onAuthEmail: (kind: "forgot-password" | "resend-verification") => void;
  onSwitchMode: () => void;
  twoFactor: boolean;
  onTwoFactor: (e: FormEvent<HTMLFormElement>) => void;
  onCancelTwoFactor: () => void;
  forcedSetup: ForcedSetup | null;
  onForcedSetup: (e: FormEvent<HTMLFormElement>) => void;
  onCancelForcedSetup: () => void;
};

export default function AuthScreen({
  mode,
  msg,
  onSubmit,
  onAuthEmail,
  onSwitchMode,
  twoFactor,
  onTwoFactor,
  onCancelTwoFactor,
  forcedSetup,
  onForcedSetup,
  onCancelForcedSetup,
}: Props) {
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
          {forcedSetup ? (
            <>
              <span className="auth-kicker">Wajib untuk akun ini</span>
              <h2>Pasang authenticator</h2>
              <p className="auth-description">
                Tambahkan akun <strong>Finwise</strong> di aplikasi authenticator, lalu masukkan kode 6 digit untuk mengaktifkan 2FA.
              </p>
              <p className="modal-note">Kunci manual: <code className="secret-code">{forcedSetup.secret}</code></p>
              <a className="btn btn-quiet wide" href={forcedSetup.otpauthUri}>Buka di aplikasi authenticator</a>
              <div className="reset-warning">
                <div>
                  <p><strong>Simpan 8 kode pemulihan ini.</strong> Hanya ditampilkan sekali.</p>
                  <div className="code-grid">
                    {forcedSetup.recoveryCodes.map((code) => <code key={code}>{code}</code>)}
                  </div>
                </div>
              </div>
              <form className="auth-form" onSubmit={onForcedSetup}>
                <label>Kode 6 digit
                  <input name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" pattern="\d{6}" required />
                </label>
                {msg && <p className={positive ? "success" : "err"}>{msg}</p>}
                <button className="primary-button" type="submit">Aktifkan 2FA & masuk</button>
              </form>
              <p className="auth-switch">
                <button type="button" className="text-button" onClick={onCancelForcedSetup}>Kembali ke masuk</button>
              </p>
            </>
          ) : twoFactor ? (
            <>
              <span className="auth-kicker">Lapis keamanan tambahan</span>
              <h2>Verifikasi dua faktor</h2>
              <p className="auth-description">
                Masukkan kode 6 digit dari aplikasi authenticator, atau salah satu kode pemulihanmu.
              </p>
              <form className="auth-form" onSubmit={onTwoFactor}>
                <label>Kode verifikasi
                  <input
                    name="code"
                    inputMode="text"
                    autoComplete="one-time-code"
                    placeholder="123456 atau ABCD12-EF34"
                    required
                  />
                </label>
                {msg && <p className={positive ? "success" : "err"}>{msg}</p>}
                <button className="primary-button" type="submit">Verifikasi</button>
              </form>
              <p className="auth-switch">
                <button type="button" className="text-button" onClick={onCancelTwoFactor}>Kembali ke masuk</button>
              </p>
            </>
          ) : (
            <>
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
                  <input
                    name="password"
                    type="password"
                    placeholder={isLogin ? "Password kamu" : "Minimal 12 karakter"}
                    minLength={isLogin ? 8 : 12}
                    required
                  />
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
            </>
          )}
        </div>
      </section>
    </main>
  );
}
