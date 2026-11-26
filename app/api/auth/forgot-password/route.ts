import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { protectArcjet } from "@/lib/arcjet";
import { hashToken, newToken } from "@/lib/tokens";
import { resetEmail, sendMail } from "@/lib/email";
import { audit } from "@/lib/audit";
import { publicOrigin } from "@/lib/origin";
import { forbidden, isSameOrigin } from "@/lib/security";
import { dbRateLimit } from "@/lib/rate-limit-db";

const schema = z.object({ email: z.string().trim().toLowerCase().email().max(120) });
const GENERIC = { ok: true, message: "Kalau email terdaftar, tautan reset password sudah dikirim." };

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return forbidden();

  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Alamat email tidak valid" }, { status: 400 });

  const guard = await protectArcjet(req, "write");
  if (guard.denied) {
    const headers = guard.retryAfter ? { "Retry-After": String(guard.retryAfter) } : undefined;
    return NextResponse.json({ error: guard.error }, { status: guard.status, headers });
  }

  // Batasi juga per email: IP saja bisa diputar penyerang, dan endpoint ini
  // mengirim email nyata yang biaya & dampaknya langsung terasa bagi korban.
  const byEmail = await dbRateLimit(`forgot:${p.data.email}`, 3, 15 * 60_000);
  if (!byEmail.allowed) {
    return NextResponse.json(
      { error: `Terlalu banyak permintaan untuk email ini. Coba lagi ${byEmail.retryAfter} detik.` },
      { status: 429, headers: { "Retry-After": String(byEmail.retryAfter) } },
    );
  }

  const user = await db.user.findUnique({ where: { email: p.data.email }, select: { id: true } });
  if (!user) return NextResponse.json(GENERIC);
  void audit({ action: "PASSWORD_RESET_REQUESTED", userId: user.id, entity: "User", entityId: user.id, req });

  const rawToken = newToken();
  await db.user.update({
    where: { id: user.id },
    data: { passwordResetToken: hashToken(rawToken), passwordResetExpires: new Date(Date.now() + 60 * 60_000) },
  });

  const link = `${publicOrigin()}/reset-password?token=${rawToken}`;
  try {
    await sendMail({ to: p.data.email, subject: "Reset password Finwise", html: resetEmail(link) });
  } catch (error) {
    console.error("Gagal mengirim email reset:", error);
    return NextResponse.json({ error: "Email gagal dikirim. Coba lagi nanti." }, { status: 500 });
  }
  return NextResponse.json(GENERIC);
}
