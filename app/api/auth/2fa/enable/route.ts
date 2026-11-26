import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getViewer } from "@/lib/auth";
import { protectArcjet } from "@/lib/arcjet";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { forbidden, isSameOrigin } from "@/lib/security";
import {
  decryptTotpSecret,
  hashRecoveryCode,
  isValidRecoveryCode,
  verifyTotp,
} from "@/lib/two-factor";

const schema = z.object({
  code: z.string().trim().regex(/^\d{6}$/),
  recoveryCodes: z.array(z.string().trim()).length(8),
});

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

export async function POST(req: NextRequest) {
  const viewer = await getViewer(req);
  if (!viewer) return NextResponse.json({ error: "Silakan masuk terlebih dahulu." }, { status: 401 });
  if (!isSameOrigin(req)) return forbidden();

  const guard = await protectArcjet(req, "write");
  if (guard.denied) {
    const headers = guard.retryAfter ? { "Retry-After": String(guard.retryAfter) } : undefined;
    return NextResponse.json({ error: guard.error }, { status: guard.status, headers });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad("Masukkan kode 6 digit dan 8 kode pemulihan.");

  const user = await db.user.findUnique({
    where: { id: viewer.uid },
    select: { twoFactorEnabled: true, twoFactorPendingSecret: true },
  });
  if (!user) return NextResponse.json({ error: "Akun tidak ditemukan." }, { status: 401 });
  if (user.twoFactorEnabled) return bad("Autentikasi dua faktor sudah aktif.");
  if (!user.twoFactorPendingSecret) return bad("Mulai lagi dari tombol Aktifkan 2FA.");

  const codes = parsed.data.recoveryCodes;
  if (!codes.every(isValidRecoveryCode)) return bad("Format kode pemulihan tidak valid.");
  const hashes = codes.map(hashRecoveryCode);
  if (new Set(hashes).size !== hashes.length) return bad("Kode pemulihan tidak boleh sama.");

  let secret: string;
  try {
    secret = decryptTotpSecret(user.twoFactorPendingSecret);
  } catch {
    return bad("Data 2FA kedaluwarsa. Mulai lagi dari tombol Aktifkan 2FA.");
  }
  if (!verifyTotp(secret, parsed.data.code)) {
    void audit({ action: "TWO_FACTOR_ENABLE_FAILED", userId: viewer.uid, req });
    return bad("Kode tidak cocok. Pastikan waktu perangkat sudah tepat.");
  }

  await db.$transaction([
    db.twoFactorRecovery.deleteMany({ where: { userId: viewer.uid } }),
    db.twoFactorRecovery.createMany({
      data: hashes.map((codeHash) => ({ userId: viewer.uid, codeHash })),
    }),
    db.user.update({
      where: { id: viewer.uid },
      data: {
        twoFactorEnabled: true,
        twoFactorSecret: user.twoFactorPendingSecret,
        twoFactorPendingSecret: null,
      },
    }),
    db.session.updateMany({
      where: { userId: viewer.uid, id: { not: viewer.sid ?? -1 }, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
  void audit({ action: "TWO_FACTOR_ENABLED", userId: viewer.uid, entity: "User", entityId: viewer.uid, req });

  return NextResponse.json({ ok: true });
}
