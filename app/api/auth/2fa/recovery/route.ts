import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getViewer } from "@/lib/auth";
import { protectArcjet } from "@/lib/arcjet";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { deviceLabel } from "@/lib/device";
import { recoveryRegeneratedEmail, sendMail } from "@/lib/email";
import { publicOrigin } from "@/lib/origin";
import { clientIp, forbidden, isSameOrigin } from "@/lib/security";
import { consumeRecoveryCode } from "@/lib/two-factor-recovery";
import { decryptTotpSecret, generateRecoveryCodes, hashRecoveryCode, verifyTotp } from "@/lib/two-factor";

const schema = z.object({
  password: z.string().min(1),
  code: z.string().trim().min(1),
});

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
  if (!parsed.success) {
    return NextResponse.json({ error: "Password dan kode 2FA wajib diisi." }, { status: 400 });
  }

  const user = await db.user.findUnique({
    where: { id: viewer.uid },
    select: { passwordHash: true, twoFactorEnabled: true, twoFactorSecret: true, email: true },
  });
  if (!user?.twoFactorEnabled || !user.twoFactorSecret) {
    return NextResponse.json({ error: "Autentikasi dua faktor belum aktif." }, { status: 400 });
  }

  const passwordOk = await bcrypt.compare(parsed.data.password, user.passwordHash);
  let codeOk = false;
  try {
    codeOk = await consumeRecoveryCode(viewer.uid, parsed.data.code);
    if (!codeOk) codeOk = verifyTotp(decryptTotpSecret(user.twoFactorSecret), parsed.data.code);
  } catch {
    codeOk = false;
  }
  if (!passwordOk || !codeOk) {
    void audit({ action: "TWO_FACTOR_RECOVERY_REGEN_FAILED", userId: viewer.uid, req });
    return NextResponse.json({ error: "Password atau kode 2FA tidak cocok." }, { status: 400 });
  }

  const recoveryCodes = generateRecoveryCodes();
  const hashes = recoveryCodes.map(hashRecoveryCode);
  await db.$transaction([
    db.twoFactorRecovery.deleteMany({ where: { userId: viewer.uid } }),
    db.twoFactorRecovery.createMany({
      data: hashes.map((codeHash) => ({ userId: viewer.uid, codeHash })),
    }),
  ]);
  void audit({
    action: "TWO_FACTOR_RECOVERY_REGENERATED",
    userId: viewer.uid,
    entity: "User",
    entityId: viewer.uid,
    req,
  });

  const link = `${publicOrigin()}/#security`;
  void sendMail({
    to: user.email,
    subject: "Kode pemulihan Finwise dibuat ulang",
    html: recoveryRegeneratedEmail(link, deviceLabel(req.headers.get("user-agent")), clientIp(req) ?? ""),
  }).catch((error) => console.error("Gagal mengirim notifikasi kode pemulihan:", error));

  return NextResponse.json({ recoveryCodes });
}
