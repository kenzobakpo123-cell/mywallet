import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { signToken } from "@/lib/auth";
import { clearAuthCookies, setAuthCookies } from "@/lib/cookies";
import { clientIp, forbidden, isSameOrigin, rateLimit } from "@/lib/security";
import { hashToken, newToken } from "@/lib/tokens";
import { protectArcjet } from "@/lib/arcjet";
import { audit } from "@/lib/audit";

const nativeSchema = z.object({ refreshToken: z.string().regex(/^[a-f0-9]{64}$/) });
const unauthorized = () => NextResponse.json({ error: "Sesi sudah berakhir. Silakan masuk lagi." }, { status: 401 });

/**
 * Web mengirim refresh lewat cookie httpOnly; klien native mengirimkan token di
 * body. Refresh diputar (rotated) tiap dipakai.
 *
 * Dua lapis keamanan:
 * 1. updateMany bersyarat -> hanya SATU request yang bisa memutar token yang sama
 *    (race condition tidak menghasilkan dua access token).
 * 2. previousTokenHash -> kalau token lama dipakai lagi, itu tanda token bocor;
 *    semua sesi user dicabut dan tokenVersion dinaikkan.
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return forbidden();

  const guard = await protectArcjet(req, "write");
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

  const oldHash = hashToken(rawToken);
  const now = new Date();

  // Token yang sudah diputar tidak boleh dipakai lagi. Kalau dipakai, anggap
  // token tersebut bocor dan cabut seluruh sesi.
  const replay = await db.session.findFirst({
    where: { previousTokenHash: oldHash },
    select: { id: true, userId: true },
  });
  if (replay) {
    await db.session.updateMany({
      where: { userId: replay.userId, revokedAt: null },
      data: { revokedAt: now },
    });
    await db.user.update({ where: { id: replay.userId }, data: { tokenVersion: { increment: 1 } } });
    void audit({
      action: "SESSION_TOKEN_REUSE",
      userId: replay.userId,
      entity: "Session",
      entityId: replay.id,
      req,
    });
    const res = NextResponse.json(
      { error: "Token sesi terdeteksi dipakai ulang. Semua perangkat telah dicabut. Silakan masuk lagi." },
      { status: 401 },
    );
    clearAuthCookies(res);
    return res;
  }

  const nextRefresh = newToken();
  const rotated = await db.session.updateMany({
    where: { tokenHash: oldHash, revokedAt: null, expiresAt: { gt: now } },
    data: { tokenHash: hashToken(nextRefresh), previousTokenHash: oldHash, lastUsedAt: now },
  });
  if (rotated.count !== 1) return unauthorized();

  // Baca sesi memakai hash BARU supaya tidak ada window race antara findUnique
  // dan update.
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(nextRefresh) },
    select: { id: true, userId: true, user: { select: { tokenVersion: true } } },
  });
  if (!session) return unauthorized();

  const accessToken = await signToken(session.userId, session.user.tokenVersion, session.id);
  const res = NextResponse.json(
    native ? { ok: true, token: accessToken, refreshToken: nextRefresh } : { ok: true },
  );
  setAuthCookies(res, accessToken, nextRefresh);
  void audit({ action: "SESSION_REFRESH", userId: session.userId, entity: "Session", entityId: session.id, req });
  return res;
}
