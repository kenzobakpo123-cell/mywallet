import { NextRequest } from "next/server";

/** Rate limiter in-memory. Untuk multi-instance, ganti dengan Redis/Upstash. */
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

/** IP klien: hanya hop pertama x-forwarded-for, dan dibatasi karakternya. */
export function clientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = req.headers.get("x-real-ip")?.trim();
  const candidate = forwarded && /^[0-9a-fA-F.:]+$/.test(forwarded) ? forwarded : real && /^[0-9a-fA-F.:]+$/.test(real) ? real : null;
  return candidate ? candidate.slice(0, 191) : null;
}

export function clientKey(req: NextRequest, scope: string): string {
  return `${scope}:${clientIp(req) ?? "unknown"}`;
}

/** Tolak permintaan mutation lintas origin (CSRF). Klien native tidak mengirim Origin. */
export function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === req.nextUrl.host;
  } catch {
    return false;
  }
}

export const forbidden = () => new Response("Forbidden", { status: 403 });
