import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { signToken } from "@/lib/auth";
import { setAuthCookies } from "@/lib/cookies";
import { clientIp, forbidden, isSameOrigin, rateLimit } from "@/lib/security";
import { hashToken, newToken } from "@/lib/tokens";
import { protectArcjet } from "@/lib/arcjet";
import { audit } from "@/lib/audit";

const nativeSchema = z.object({ refreshToken: z.string().regex(/^[a-f0-9]{64}$/) });
const unauthorized = () => NextResponse.json({ error: "Sesi sudah berakhir. Silakan masuk lagi." }, { status: 401 });

/**
 * Web mengirim refresh lewat cookie httpOnly; klien native mengirimkan token di
 * body. Refresh diputar (rotated) tiap dipakai, jadi token lama langsung mati.
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return forbidden();

  const guard = await protectArcjet(req, "login");
  if (guard.denied) {
    const headers = guard.retryAfter ? { "Retry-After": String(guard.retryAfter) } : undefined;
    return NextResponse.json({ error: guard.error }, { status: guard.status, headers });
  }

  const limited = rateLimit(`refresh:${clientIp(req) ?? "unknown"}`, 30, 60_000);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: `Terlalu banyak permintaan. Coba lagi ${limited.retryAfter} detik.` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  const parsed = nativeSchema.safeParse(await req.json().catch(() => null));
  const native = parsed.success;
  const rawToken = native ? parsed.data.refreshToken : req.cookies.get("refresh_token")?.value;
  if (!rawToken || !/^[a-f0-9]{64}$/.test(rawToken)) return unauthorized();

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      revokedAt: true,
      user: { select: { tokenVersion: true } },
    },
  });
  const now = new Date();
  if (!session || session.revokedAt || session.expiresAt <= now) return unauthorized();

  const nextRefresh = newToken();
  await db.session.update({
    where: { id: session.id },
    data: { tokenHash: hashToken(nextRefresh), lastUsedAt: now },
  });
  const accessToken = await signToken(session.userId, session.user.tokenVersion, session.id);

  const res = NextResponse.json(
    native ? { ok: true, token: accessToken, refreshToken: nextRefresh } : { ok: true },
  );
  setAuthCookies(res, accessToken, nextRefresh);
  void audit({ action: "SESSION_REFRESH", userId: session.userId, entity: "Session", entityId: session.id, req });
  return res;
}
