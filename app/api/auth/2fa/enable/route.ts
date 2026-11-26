import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { protectArcjet } from "@/lib/arcjet";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { completeLogin } from "@/lib/login";
import { forbidden, isSameOrigin } from "@/lib/security";
import { twoFactorActor } from "@/lib/two-factor-actor";
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
const unauthorized = () => NextResponse.json({ error: "Silakan masuk terlebih dahulu." }, { status: 401 });

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => ({}));
  const actor = await twoFactorActor(req, raw);
  if (!actor) return NextResponse.json({ error: "Silakan masuk terlebih dahulu." }, { status: 401 });
  if (!isSameOrigin(req)) return forbidden();

  const guard = await protectArcjet(req, "write");
  if (guard.denied) {
    const headers = guard.retryAfter ? { "Retry-After": String(guard.retryAfter) } : undefined;
    return NextResponse.json({ error: guard.error }, { status: guard.status, headers });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) return bad("Masukkan kode 6 digit dan 8 kode pemulihan.");

  const user = await db.user.findUnique({
    where: { id: actor.uid },
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
    void audit({ action: "TWO_FACTOR_ENABLE_FAILED", userId: actor.uid, req });
    return bad("Kode tidak cocok. Pastikan waktu perangkat sudah tepat.");
  }

  await db.$transaction([
    db.twoFactorRecovery.deleteMany({ where: { userId: actor.uid } }),
    db.twoFactorRecovery.createMany({
      data: hashes.map((codeHash) => ({ userId: actor.uid, codeHash })),
    }),
    db.user.update({
      where: { id: actor.uid },
      data: {
        twoFactorEnabled: true,
        twoFactorSecret: user.twoFactorPendingSecret,
        twoFactorPendingSecret: null,
      },
    }),
    db.session.updateMany({
      where: { userId: actor.uid, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
  void audit({ action: "TWO_FACTOR_ENABLED", userId: actor.uid, entity: "User", entityId: actor.uid, req });

  // Akun wajib 2FA belum punya sesi, jadi sesi dibuat di sini setelah 2FA aktif.
  if (actor.forced) {
    const fresh = await db.user.findUnique({
      where: { id: actor.uid },
      select: { id: true, name: true, email: true, tokenVersion: true },
    });
    if (!fresh) return unauthorized();
    return completeLogin(req, { ...fresh, twoFactorEnabled: true }, actor.issueToken);
  }

  return NextResponse.json({ ok: true });
}
