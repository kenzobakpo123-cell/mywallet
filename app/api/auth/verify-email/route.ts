import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/tokens";
import { audit } from "@/lib/audit";

const page = (title: string, message: string, ok: boolean) =>
  new NextResponse(
    `<!doctype html><html lang="id"><meta charset="utf-8"><title>${title} - Finwise</title>
    <script>if(location.search){history.replaceState(null,'',location.pathname)}</script>
    <body style="font-family:Arial,sans-serif;max-width:520px;margin:80px auto;color:#1d2b25;text-align:center">
      <h1 style="color:${ok ? "#1f7a5a" : "#b42318"}">${title}</h1>
      <p>${message}</p>
      <a href="/" style="color:#1f7a5a">Kembali ke Finwise</a>
    </body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );

export async function GET(req: NextRequest) {
  // Jangan konsumsi token verifikasi kalau permintaan datang dari prefetch /
  // gambar di situs lain. Browser modern mengirim Sec-Fetch-Site pada request.
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "none" && fetchSite !== "same-origin") {
    return page("Tautan tidak valid", "Tautan verifikasi tidak valid.", false);
  }

  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return page("Tautan tidak valid", "Tautan verifikasi tidak valid.", false);
  }

  const r = await db.user.updateMany({
    where: { verificationToken: hashToken(token), verificationExpires: { gt: new Date() } },
    data: { emailVerified: new Date(), verificationToken: null, verificationExpires: null },
  });
  if (r.count) void audit({ action: "EMAIL_VERIFIED", entity: "User", req });
  return r.count
    ? page("Email terverifikasi", "Akun kamu sudah aktif. Silakan masuk.", true)
    : page("Tautan kedaluwarsa", "Tautan verifikasi sudah tidak berlaku. Minta kirim ulang dari halaman masuk.", false);
}
