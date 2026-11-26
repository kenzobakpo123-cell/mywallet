import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { strongPasswordSchema } from "@/lib/schemas";
import { protectArcjet } from "@/lib/arcjet";
import { hashToken } from "@/lib/tokens";
import { audit } from "@/lib/audit";
import { deviceLabel } from "@/lib/device";
import { passwordChangedEmail, sendMail } from "@/lib/email";
import { publicOrigin } from "@/lib/origin";
import { clientIp, forbidden, isSameOrigin } from "@/lib/security";
import { consumeRecoveryCode } from "@/lib/two-factor-recovery";
import { decryptTotpSecret, verifyTotp } from "@/lib/two-factor";

const schema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  password: strongPasswordSchema,
  // Wajib kalau akun memakai 2FA; email saja tidak cukup untuk mengubah password.
  code: z.string().trim().min(1).optional(),
});

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return forbidden();

  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success) {
    return NextResponse.json({ error: "Token tidak valid atau password tidak memenuhi syarat" }, { status: 400 });
  }

  const guard = await protectArcjet(req, "write");
  if (guard.denied) {
    const headers = guard.retryAfter ? { "Retry-After": String(guard.retryAfter) } : undefined;
    return NextResponse.json({ error: guard.error }, { status: guard.status, headers });
  }

  const where = {
    passwordResetToken: hashToken(p.data.token),
    passwordResetExpires: { gt: new Date() },
  };
  const user = await db.user.findFirst({
    where,
    select: { id: true, email: true, twoFactorEnabled: true, twoFactorSecret: true },
  });
  if (!user) return NextResponse.json({ error: "Tautan reset tidak valid atau sudah kedaluwarsa" }, { status: 400 });

  // Tautan dari email bukan satu-satunya bukti: akun ber-2FA harus membuktikan
  // kepemilikan authenticator/kode pemulihan sebelum password bisa diganti.
  if (user.twoFactorEnabled) {
    if (!p.data.code) {
      return NextResponse.json(
        { error: "Akun ini memakai 2FA. Masukkan kode authenticator atau kode pemulihan." },
        { status: 400 },
      );
    }
    let codeOk = false;
    try {
      codeOk = await consumeRecoveryCode(user.id, p.data.code);
      if (!codeOk && user.twoFactorSecret) {
        codeOk = verifyTotp(decryptTotpSecret(user.twoFactorSecret), p.data.code);
      }
    } catch {
      codeOk = false;
    }
    if (!codeOk) {
      void audit({ action: "PASSWORD_RESET_2FA_FAILED", userId: user.id, req });
      return NextResponse.json({ error: "Kode 2FA tidak cocok." }, { status: 400 });
    }
  }

  // passwordHash diperbarui, token dihapus, dan sesi lama dicabut.
  const r = await db.user.updateMany({
    where: { id: user.id, ...where },
    data: {
      passwordHash: await bcrypt.hash(p.data.password, 12),
      passwordResetToken: null,
      passwordResetExpires: null,
      tokenVersion: { increment: 1 },
    },
  });
  if (r.count) {
    // Cabut semua refresh token supaya tidak bisa dipakai untuk membuat token baru.
    await db.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    void audit({ action: "PASSWORD_RESET", userId: user.id, entity: "User", entityId: user.id, req });

    const link = `${publicOrigin()}/#sessions`;
    void sendMail({
      to: user.email,
      subject: "Password Finwise kamu diubah",
      html: passwordChangedEmail(link, deviceLabel(req.headers.get("user-agent")), clientIp(req) ?? ""),
    }).catch((error) => console.error("Gagal mengirim notifikasi perubahan password:", error));
  }
  return r.count
    ? NextResponse.json({ ok: true, message: "Password berhasil diubah. Silakan masuk." })
    : NextResponse.json({ error: "Tautan reset sudah dipakai" }, { status: 400 });
}
