import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { protectArcjet } from "@/lib/arcjet";
import { hashToken, newToken } from "@/lib/tokens";
import { resetEmail, sendMail } from "@/lib/email";
import { audit } from "@/lib/audit";

const schema = z.object({ email: z.string().trim().toLowerCase().email().max(120) });
const GENERIC = { ok: true, message: "Kalau email terdaftar, tautan reset password sudah dikirim." };

export async function POST(req: NextRequest) {
  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Alamat email tidak valid" }, { status: 400 });

  const guard = await protectArcjet(req, "write");
  if (guard.denied) {
    const headers = guard.retryAfter ? { "Retry-After": String(guard.retryAfter) } : undefined;
    return NextResponse.json({ error: guard.error }, { status: guard.status, headers });
  }

  const user = await db.user.findUnique({ where: { email: p.data.email }, select: { id: true } });
  if (!user) return NextResponse.json(GENERIC);
  void audit({ action: "PASSWORD_RESET_REQUESTED", userId: user.id, entity: "User", entityId: user.id, req });

  const rawToken = newToken();
  await db.user.update({
    where: { id: user.id },
    data: { passwordResetToken: hashToken(rawToken), passwordResetExpires: new Date(Date.now() + 60 * 60_000) },
  });

  const link = `${req.nextUrl.origin}/reset-password?token=${rawToken}`;
  try {
    await sendMail({ to: p.data.email, subject: "Reset password Finwise", html: resetEmail(link) });
  } catch (error) {
    console.error("Gagal mengirim email reset:", error);
    return NextResponse.json({ error: "Email gagal dikirim. Coba lagi nanti." }, { status: 500 });
  }
  return NextResponse.json(GENERIC);
}
