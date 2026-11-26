import { Resend } from "resend";
import { escapeHtml } from "@/lib/html";

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM || "Finwise <onboarding@resend.dev>";
const resend = apiKey ? new Resend(apiKey) : null;

type Mail = { to: string; subject: string; html: string };

/**
 * Di production RESEND_API_KEY wajib diisi. Di lokal, kalau belum ada key,
 * email hanya dicetak ke terminal supaya alur bisa dicoba tanpa layanan email.
 */
export async function sendMail(mail: Mail): Promise<void> {
  if (!resend) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("EMAIL_NOT_CONFIGURED");
    }
    console.info("\n[DEV EMAIL — tidak dikirim]\nKepada:", mail.to, "\nSubjek:", mail.subject, "\n", mail.html, "\n");
    return;
  }

  const { error } = await resend.emails.send({ from, ...mail });
  if (error) throw new Error(error.message);
}

const shell = (title: string, body: string, link: string, label: string) => {
  const safeLink = escapeHtml(link);
  return `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1d2b25">
  <h2 style="color:#1f7a5a">${escapeHtml(title)}</h2>
  <p>${body}</p>
  <p><a href="${safeLink}" style="background:#1f7a5a;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;display:inline-block">${escapeHtml(label)}</a></p>
  <p style="color:#78857e;font-size:12px">Kalau tombol tidak bekerja, salin alamat ini ke browser:<br />${safeLink}</p>
  <p style="color:#78857e;font-size:12px">Tautan ini berlaku terbatas. Kalau kamu tidak meminta ini, abaikan email ini.</p>
</div>`;
};

export const verificationEmail = (link: string) =>
  shell("Verifikasi email Finwise", "Terima kasih sudah daftar. Verifikasi alamat emailmu untuk mengaktifkan akun.", link, "Verifikasi email");

export const resetEmail = (link: string) =>
  shell("Reset password Finwise", "Kami menerima permintaan reset password untuk akunmu.", link, "Reset password");

/** Dikirim saat akun masuk dari perangkat yang belum pernah dipakai. */
export const loginNoticeEmail = (link: string, device: string, ip: string) =>
  shell(
    "Login baru di Finwise",
    `Ada proses masuk ke akunmu dari <strong>${escapeHtml(device)}</strong>${ip ? ` (IP ${escapeHtml(ip)})` : ""}. ` +
      "Kalau itu kamu, tidak perlu melakukan apa pun. Kalau bukan kamu, buka halaman kelola perangkat untuk mencabut sesi tersebut dan ganti password.",
    link,
    "Kelola perangkat",
  );

/** Dikirim saat ada password salah untuk akun yang benar-benar ada. */
export const loginFailedEmail = (link: string, device: string, ip: string) =>
  shell(
    "Ada percobaan login gagal",
    `Ada percobaan masuk dengan password yang salah dari <strong>${escapeHtml(device)}</strong>${ip ? ` (IP ${escapeHtml(ip)})` : ""}. ` +
      "Kalau itu kamu, tidak perlu melakukan apa pun. Kalau bukan kamu, cabut sesi asing dan ganti password sekarang.",
    link,
    "Periksa perangkat",
  );

/** Dikirim saat kode pemulihan 2FA dipakai. */
export const recoveryUsedEmail = (link: string, device: string, ip: string) =>
  shell(
    "Kode pemulihan Finwise dipakai",
    `Seseorang baru saja masuk ke akunmu memakai <strong>kode pemulihan 2FA</strong> dari <strong>${escapeHtml(device)}</strong>${ip ? ` (IP ${escapeHtml(ip)})` : ""}. ` +
      "Kalau itu kamu, sebaiknya buat kode pemulihan baru. Kalau bukan kamu, cabut semua sesi dan ganti password.",
    link,
    "Periksa keamanan",
  );
