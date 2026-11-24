import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { protectArcjet } from "@/lib/arcjet";
import { hashToken, newToken } from "@/lib/tokens";
import { sendMail, verificationEmail } from "@/lib/email";
import { audit } from "@/lib/audit";

const schema = z.object({ email: z.string().trim().toLowerCase().email().max(120) });
const GENERIC = { ok: true, message: "Kalau akun belum terverifikasi, email verifikasi sudah dikirim." };

export async function POST(req: NextRequest) {
  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Alamat email tidak valid" }, { status: 400 });

  const guard = await protectArcjet(req, "login");
  if (guard.denied) {
    const headers = guard.retryAfter ? { "Retry-After": String(guard.retryAfter) } : undefined;
    return NextResponse.json({ error: guard.error }, { status: guard.status, headers });
  }

  const user = await db.user.findUnique({
    where: { email: p.data.email },
    select: { id: true, emailVerified: true },
  });
  // Balasan generik supaya tidak bisa dibedakan antara email terdaftar atau tidak.
  if (!user || user.emailVerified) return NextResponse.json(GENERIC);
  void audit({ action: "VERIFICATION_RESENT", userId: user.id, entity: "User", entityId: user.id, req });

  const rawToken = newToken();
  await db.user.update({
    where: { id: user.id },
    data: { verificationToken: hashToken(rawToken), verificationExpires: new Date(Date.now() + 24 * 60 * 60_000) },
  });

  const link = `${req.nextUrl.origin}/api/auth/verify-email?token=${rawToken}`;
  try {
    await sendMail({ to: p.data.email, subject: "Verifikasi email Finwise", html: verificationEmail(link) });
  } catch (error) {
    console.error("Gagal mengirim ulang verifikasi:", error);
    return NextResponse.json({ error: "Email gagal dikirim. Coba lagi nanti." }, { status: 500 });
  }
  return NextResponse.json(GENERIC);
}
