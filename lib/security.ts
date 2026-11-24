import type { NextRequest } from "next/server";
import { isAllowedWebOrigin } from "@/lib/origin";

/** Rate limiter in-memory. Dipakai sebagai fallback bila Arcjet sedang error. */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
let lastCleanup = 0;

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup > 60_000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    lastCleanup = now;
  }
  const rec = buckets.get(key);
  if (!rec || rec.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }
  if (rec.count >= limit) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((rec.resetAt - now) / 1000)) };
  }
  rec.count += 1;
  return { allowed: true, retryAfter: 0 };
}

const IP_PATTERN = /^[0-9a-fA-F.:]+$/;

/**
 * IP klien dari proxy yang dipercaya.
 *
 * - Vercel mengirim `x-vercel-forwarded-for` yang tidak bisa diatur klien.
 * - `x-forwarded-for` adalah rantai; hop TERAKHIR ditambahkan proxy terdekat,
 *   jadi hop pertama bisa dipalsukan klien dan tidak boleh dipakai.
 */
export function clientIp(req: NextRequest): string | null {
  const vercelHop = req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  const forwarded = req.headers.get("x-forwarded-for")?.split(",").map((part) => part.trim()).filter(Boolean);
  const lastHop = forwarded?.[forwarded.length - 1];
  const real = req.headers.get("x-real-ip")?.trim();

  const candidate = [vercelHop, lastHop, real].find((value) => value && IP_PATTERN.test(value));
  return candidate ? candidate.slice(0, 191) : null;
}

export function clientKey(req: NextRequest, scope: string): string {
  return `${scope}:${clientIp(req) ?? "unknown"}`;
}

/**
 * CSRF guard untuk mutation berbasis cookie.
 *
 * - Klien native memakai Bearer atau header `X-Finwise-Client: native`.
 *   Browser tidak bisa mengirim keduanya lintas origin tanpa preflight CORS,
 *   jadi keduanya aman dari CSRF.
 * - Web wajib mengirim Origin dari APP_URL. Request tanpa Origin hanya
 *   diterima bila browser menandai same-origin / none lewat Sec-Fetch-Site.
 */
export function isSameOrigin(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return true;
  if (req.headers.get("x-finwise-client") === "native") return true;

  const origin = req.headers.get("origin");
  const fetchSite = req.headers.get("sec-fetch-site");

  if (!origin) return fetchSite === "same-origin" || fetchSite === "none";
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  return isAllowedWebOrigin(origin);
}

export const forbidden = () => new Response("Forbidden", { status: 403 });
