import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/auth";
import { protectArcjet } from "@/lib/arcjet";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { forbidden, isSameOrigin } from "@/lib/security";
import { encryptTotpSecret, generateRecoveryCodes, newTotpSecret, otpauthUri } from "@/lib/two-factor";

const unauthorized = () => NextResponse.json({ error: "Silakan masuk terlebih dahulu." }, { status: 401 });

export async function POST(req: NextRequest) {
  const viewer = await getViewer(req);
  if (!viewer) return unauthorized();
  if (!isSameOrigin(req)) return forbidden();

  const guard = await protectArcjet(req, "write");
  if (guard.denied) {
    const headers = guard.retryAfter ? { "Retry-After": String(guard.retryAfter) } : undefined;
    return NextResponse.json({ error: guard.error }, { status: guard.status, headers });
  }

  const user = await db.user.findUnique({
    where: { id: viewer.uid },
    select: { email: true, twoFactorEnabled: true },
  });
  if (!user) return unauthorized();
  if (user.twoFactorEnabled) {
    return NextResponse.json({ error: "Autentikasi dua faktor sudah aktif." }, { status: 409 });
  }

  const secret = newTotpSecret();
  const recoveryCodes = generateRecoveryCodes();
  await db.user.update({
    where: { id: viewer.uid },
    data: { twoFactorPendingSecret: encryptTotpSecret(secret) },
  });
  void audit({ action: "TWO_FACTOR_SETUP", userId: viewer.uid, entity: "User", entityId: viewer.uid, req });

  return NextResponse.json({
    otpauthUri: otpauthUri(user.email, secret),
    secret,
    recoveryCodes,
  });
}
