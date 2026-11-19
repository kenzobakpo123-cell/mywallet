import { SignJWT, jwtVerify } from "jose";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";

const ISSUER = "finwise";
const AUDIENCE = "finwise-app";
const ACCESS_TOKEN_EXPIRY = "15m";
/** Token akses dipakai tiap request; refresh token menentukan umur sesi. */
export const ACCESS_TOKEN_MAX_AGE = 15 * 60;
export const REFRESH_TOKEN_MAX_AGE = 30 * 86400;
export const TOKEN_MAX_AGE = ACCESS_TOKEN_MAX_AGE;

function secret(): Uint8Array {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) {
    // Fail closed: jangan pernah memakai kunci "undefined" / secret pendek.
    throw new Error("JWT_SECRET wajib diisi dengan string acak minimal 32 karakter.");
  }
  return new TextEncoder().encode(value);
}

export async function signToken(uid: number, tokenVersion = 0, sessionId?: number | null): Promise<string> {
  return new SignJWT({ tv: tokenVersion, ...(sessionId ? { sid: sessionId } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(uid))
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(secret());
}

export type Viewer = {
  uid: number;
  name: string;
  email: string;
  timezone: string;
  currency: string;
  /** Session yang sedang dipakai; null untuk token lama yang belum terikat sesi. */
  sid: number | null;
};

// Web memakai cookie httpOnly, aplikasi HP memakai header Authorization: Bearer
async function currentViewer(req: NextRequest): Promise<Viewer | null> {
  const h = req.headers.get("authorization");
  const t = h?.startsWith("Bearer ") ? h.slice(7).trim() : req.cookies.get("token")?.value;
  if (!t) return null;
  try {
    const { payload } = await jwtVerify(t, secret(), {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload.sub !== "string" || !/^\d+$/.test(payload.sub)) return null;
    const uid = Number(payload.sub);
    if (!Number.isSafeInteger(uid) || uid <= 0) return null;

    // Token dicabut saat logout / ganti password lewat tokenVersion di DB.
    const user = await db.user.findUnique({
      where: { id: uid },
      select: { id: true, name: true, email: true, tokenVersion: true, timezone: true, currency: true },
    });
    const tokenVersion = typeof payload.tv === "number" ? payload.tv : 0;
    if (!user || user.tokenVersion !== tokenVersion) return null;

    // Token baru terikat pada Session. Mencabut satu sesi langsung mematikan
    // token aksesnya tanpa perlu menaikkan tokenVersion semua perangkat.
    let sid: number | null = null;
    const rawSid = payload.sid;
    if (typeof rawSid === "number" && Number.isSafeInteger(rawSid) && rawSid > 0) sid = rawSid;
    else if (typeof rawSid === "string" && /^\d+$/.test(rawSid)) sid = Number(rawSid);
    if (sid) {
      const now = new Date();
      const session = await db.session.findFirst({
        where: { id: sid, userId: uid },
        select: { expiresAt: true, revokedAt: true, lastUsedAt: true },
      });
      if (!session || session.revokedAt || session.expiresAt <= now) return null;
      if (now.getTime() - session.lastUsedAt.getTime() > 60_000) {
        void db.session.update({ where: { id: sid }, data: { lastUsedAt: now } }).catch(() => {});
      }
    }

    return {
      uid: user.id,
      name: user.name,
      email: user.email,
      timezone: user.timezone || "UTC",
      currency: user.currency || "IDR",
      sid,
    };
  } catch {
    return null;
  }
}

export async function getViewer(req: NextRequest): Promise<Viewer | null> {
  return currentViewer(req);
}

export async function getUserId(req: NextRequest): Promise<number | null> {
  return (await currentViewer(req))?.uid ?? null;
}
