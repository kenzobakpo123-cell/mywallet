import arcjet, { shield, slidingWindow, validateEmail } from "@arcjet/next";
import type { NextRequest } from "next/server";
import { clientKey, rateLimit } from "@/lib/security";

/**
 * Arcjet dipakai untuk Shield (WAF), validasi email, dan rate limit terpusat.
 * Kalau ARCJET_KEY belum diisi (misal di lokal sebelum daftar), sistem jatuh ke
 * rate limiter in-memory supaya aplikasi tetap bisa dipakai.
 *
 * Kalau Arcjet sedang error, kita TIDAK fail-open: fallback in-memory dipakai
 * dengan batas lebih ketat sehingga endpoint auth tidak menjadi wildcard.
 */
const key = process.env.ARCJET_KEY;

const base = key ? arcjet({ key, rules: [shield({ mode: "LIVE" })] }) : null;

// `login` hanya dipakai saat verifikasi password. Refresh, resend, dan forgot
// memakai `write` supaya tidak menguras kuota login pengguna yang sedang aktif.
const guards = base
  ? {
      login: base.withRule(slidingWindow({ mode: "LIVE", interval: "15m", max: 30 })),
      register: base
        .withRule(validateEmail({ mode: "LIVE", deny: ["DISPOSABLE", "INVALID", "NO_MX_RECORDS"] }))
        .withRule(slidingWindow({ mode: "LIVE", interval: "1h", max: 5 })),
      write: base.withRule(slidingWindow({ mode: "LIVE", interval: "1m", max: 60 })),
    }
  : null;

export type GuardName = "login" | "register" | "write";

type Verdict = { denied: boolean; status: number; error: string; retryAfter: number };

const allow = (): Verdict => ({ denied: false, status: 200, error: "", retryAfter: 0 });

const FALLBACK_LIMITS: Record<GuardName, { limit: number; window: number }> = {
  login: { limit: 10, window: 15 * 60_000 },
  register: { limit: 3, window: 60 * 60_000 },
  write: { limit: 30, window: 60_000 },
};

function fallback(name: GuardName, req: NextRequest): Verdict {
  const { limit, window } = FALLBACK_LIMITS[name];
  const hit = rateLimit(clientKey(req, name), limit, window);
  return hit.allowed
    ? allow()
    : { denied: true, status: 429, error: "Terlalu banyak permintaan. Tunggu sebentar.", retryAfter: hit.retryAfter };
}

export async function protectArcjet(req: NextRequest, name: GuardName, email?: string): Promise<Verdict> {
  if (!guards) return fallback(name, req);

  try {
    // `register` punya aturan validateEmail yang mewajibkan properti email;
    // guard lain tidak memerlukan properti tambahan.
    const decision =
      name === "register"
        ? await guards.register.protect(req, { email: email ?? "" })
        : await guards[name === "login" ? "login" : "write"].protect(req);

    if (decision.isErrored()) {
      console.error("Arcjet error:", decision.reason.message);
      return fallback(name, req);
    }

    if (decision.isDenied()) {
      if (decision.reason.isRateLimit()) {
        return {
          denied: true,
          status: 429,
          error: "Terlalu banyak permintaan. Tunggu sebentar.",
          retryAfter: Math.max(1, Math.ceil(decision.reason.reset)),
        };
      }
      if (decision.reason.isEmail()) {
        return { denied: true, status: 400, error: "Alamat email tidak valid.", retryAfter: 0 };
      }
      if (decision.reason.isBot()) {
        return { denied: true, status: 403, error: "Permintaan otomatis tidak diizinkan.", retryAfter: 0 };
      }
      if (decision.reason.isShield()) {
        return { denied: true, status: 403, error: "Permintaan ditolak.", retryAfter: 0 };
      }
      return { denied: true, status: 403, error: "Permintaan ditolak.", retryAfter: 0 };
    }

    return allow();
  } catch (error) {
    console.error("Arcjet exception:", error);
    return fallback(name, req);
  }
}
