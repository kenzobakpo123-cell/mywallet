import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { protectArcjet } from "@/lib/arcjet";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { deviceLabel } from "@/lib/device";
import { recoveryUsedEmail, sendMail } from "@/lib/email";
import { completeLogin } from "@/lib/login";
import { publicOrigin } from "@/lib/origin";
import { clientIp, forbidden, isSameOrigin, rateLimit } from "@/lib/security";
import { consumeRecoveryCode } from "@/lib/two-factor-recovery";
import { decryptTotpSecret, verifyTotp, verifyTwoFactorChallenge } from "@/lib/two-factor";

const schema = z.object({
  challengeToken: z.string().min(20),
  code: z.string().trim(),
});

const unauthorized = () => NextResponse.json({ error: "Verifikasi 2FA gagal. Silakan masuk lagi." }, { status: 401 });

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return forbidden();

  const guard = await protectArcjet(req, "login");
  if (guard.denied) {
    const headers = guard.retryAfter ? { "Retry-After": String(guard.retryAfter) } : undefined;
    return NextResponse.json({ error: guard.error }, { status: guard.status, headers });
  }

  const limited = rateLimit(`2fa:${clientIp(req) ?? "unknown"}`, 10, 15 * 60_000);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: `Terlalu banyak percobaan 2FA. Coba lagi ${limited.retryAfter} detik.` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return unauthorized();

  const challenge = await verifyTwoFactorChallenge(parsed.data.challengeToken);
  if (!challenge) return unauthorized();

  const user = await db.user.findUnique({
    where: { id: challenge.uid },
    select: {
      id: true,
      name: true,
      email: true,
      tokenVersion: true,
      twoFactorEnabled: true,
      twoFactorSecret: true,
    },
  });
  if (!user || !user.twoFactorEnabled || !user.twoFactorSecret || user.tokenVersion !== challenge.tv) {
    return unauthorized();
  }

  let usedRecovery = false;
  let valid = false;
  try {
    usedRecovery = await consumeRecoveryCode(user.id, parsed.data.code);
    valid = usedRecovery || verifyTotp(decryptTotpSecret(user.twoFactorSecret), parsed.data.code);
  } catch {
    valid = false;
  }
  if (!valid) {
    void audit({ action: "TWO_FACTOR_FAILED", userId: user.id, req });
    return unauthorized();
  }

  if (usedRecovery) {
    void audit({ action: "TWO_FACTOR_RECOVERY_USED", userId: user.id, entity: "User", entityId: user.id, req });
    const link = `${publicOrigin()}/#sessions`;
    void sendMail({
      to: user.email,
      subject: "Kode pemulihan Finwise dipakai",
      html: recoveryUsedEmail(link, deviceLabel(req.headers.get("user-agent")), clientIp(req) ?? ""),
    }).catch((error) => console.error("Gagal mengirim notifikasi kode pemulihan:", error));
  } else {
    void audit({ action: "TWO_FACTOR_SUCCESS", userId: user.id, entity: "User", entityId: user.id, req });
  }

  return completeLogin(req, user, challenge.issueToken);
}
