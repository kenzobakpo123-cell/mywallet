import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { passwordSchema } from "@/lib/schemas";
import { protectArcjet } from "@/lib/arcjet";
import { hashToken } from "@/lib/tokens";
import { audit } from "@/lib/audit";

const schema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), password: passwordSchema });

export async function POST(req: NextRequest) {
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
  const user = await db.user.findFirst({ where, select: { id: true } });
  if (!user) return NextResponse.json({ error: "Tautan reset tidak valid atau sudah kedaluwarsa" }, { status: 400 });

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
  }
  return r.count
    ? NextResponse.json({ ok: true, message: "Password berhasil diubah. Silakan masuk." })
    : NextResponse.json({ error: "Tautan reset sudah dipakai" }, { status: 400 });
}
