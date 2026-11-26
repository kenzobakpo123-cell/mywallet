import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getViewer } from "@/lib/auth";
import { protectArcjet } from "@/lib/arcjet";
import { audit } from "@/lib/audit";
import { clearAuthCookies } from "@/lib/cookies";
import { db } from "@/lib/db";
import { forbidden, isSameOrigin } from "@/lib/security";
import { consumeRecoveryCode } from "@/lib/two-factor-recovery";
import { decryptTotpSecret, verifyTotp } from "@/lib/two-factor";

const schema = z.object({
  password: z.string().min(1),
  code: z.string().trim(),
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
  if (!parsed.success) return NextResponse.json({ error: "Password dan kode 2FA wajib diisi." }, { status: 400 });

  const user = await db.user.findUnique({
    where: { id: viewer.uid },
    select: { passwordHash: true, twoFactorEnabled: true, twoFactorSecret: true },
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
    void audit({ action: "TWO_FACTOR_DISABLE_FAILED", userId: viewer.uid, req });
    return NextResponse.json({ error: "Password atau kode 2FA tidak cocok." }, { status: 400 });
  }

  await db.$transaction([
    db.twoFactorRecovery.deleteMany({ where: { userId: viewer.uid } }),
    db.session.updateMany({ where: { userId: viewer.uid, revokedAt: null }, data: { revokedAt: new Date() } }),
    db.user.update({
      where: { id: viewer.uid },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorPendingSecret: null,
        tokenVersion: { increment: 1 },
      },
    }),
  ]);
  void audit({ action: "TWO_FACTOR_DISABLED", userId: viewer.uid, entity: "User", entityId: viewer.uid, req });

  const res = NextResponse.json({ ok: true, loggedOut: true });
  clearAuthCookies(res);
  return res;
}
