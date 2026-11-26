import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const APP = "https://mywallet-virid-eight.vercel.app";
const JWT = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH";

const m = vi.hoisted(() => {
  const db = {
    user: { findUnique: vi.fn() },
  };
  return {
    db,
    protectArcjet: vi.fn(async (): Promise<{ denied: boolean; status?: number; error?: string; retryAfter?: number }> => ({ denied: false })),
    audit: vi.fn(async () => {}),
    sendMail: vi.fn(async () => {}),
    recoveryUsedEmail: vi.fn(() => "<p>kode pemulihan dipakai</p>"),
    completeLogin: vi.fn(async () => new Response(null, { status: 200 })),
    consumeRecoveryCode: vi.fn(async (): Promise<boolean> => false),
    decryptTotpSecret: vi.fn(() => "plain-secret"),
    verifyTotp: vi.fn((): boolean => true),
    rateLimit: vi.fn((): { allowed: boolean; retryAfter: number } => ({ allowed: true, retryAfter: 0 })),
    deviceLabel: vi.fn(() => "Safari di iPhone"),
    clientIp: vi.fn((): string | null => "203.0.113.7"),
  };
});

vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/arcjet", () => ({ protectArcjet: m.protectArcjet }));
vi.mock("@/lib/audit", () => ({ audit: m.audit }));
vi.mock("@/lib/email", () => ({ sendMail: m.sendMail, recoveryUsedEmail: m.recoveryUsedEmail }));
vi.mock("@/lib/login", () => ({ completeLogin: m.completeLogin }));
vi.mock("@/lib/device", () => ({ deviceLabel: m.deviceLabel }));
vi.mock("@/lib/two-factor-recovery", () => ({ consumeRecoveryCode: m.consumeRecoveryCode }));
vi.mock("@/lib/two-factor", async () => {
  const actual = await vi.importActual<typeof import("@/lib/two-factor")>("@/lib/two-factor");
  return { ...actual, decryptTotpSecret: m.decryptTotpSecret, verifyTotp: m.verifyTotp };
});
vi.mock("@/lib/security", async () => {
  const actual = await vi.importActual<typeof import("@/lib/security")>("@/lib/security");
  return { ...actual, rateLimit: m.rateLimit, clientIp: m.clientIp };
});

import { POST } from "@/app/api/auth/2fa/verify-login/route";
import { signTwoFactorChallenge } from "@/lib/two-factor";

const user = {
  id: 7,
  name: "Ken",
  email: "ken@example.com",
  tokenVersion: 3,
  twoFactorEnabled: true,
  twoFactorSecret: "encrypted-secret",
};

const request = (body: unknown, origin: string | null = APP, native = false) =>
  new NextRequest(`${APP}/api/auth/2fa/verify-login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
      ...(native ? { "x-finwise-client": "native" } : {}),
    },
    body: JSON.stringify(body),
  });

async function challenge() {
  process.env.JWT_SECRET = JWT;
  return signTwoFactorChallenge({ uid: user.id, tv: user.tokenVersion, issueToken: true });
}

describe("POST /api/auth/2fa/verify-login", () => {
  beforeEach(() => {
    process.env.APP_URL = APP;
    process.env.JWT_SECRET = JWT;
    vi.clearAllMocks();
    m.db.user.findUnique.mockResolvedValue(user);
    m.rateLimit.mockReturnValue({ allowed: true, retryAfter: 0 });
    m.consumeRecoveryCode.mockResolvedValue(false);
    m.verifyTotp.mockReturnValue(true);
    m.protectArcjet.mockResolvedValue({ denied: false });
  });

  it("menolak Origin jahat", async () => {
    const res = await POST(request({ challengeToken: "x", code: "123456" }, "https://attacker.tld"));
    expect(res.status).toBe(403);
    expect(m.db.user.findUnique).not.toHaveBeenCalled();
  });

  it("menerima klien native tanpa Origin", async () => {
    const token = await challenge();
    const res = await POST(request({ challengeToken: token, code: "123456" }, null, true));
    expect(res.status).toBe(200);
  });

  it("menolak challenge yang tidak valid", async () => {
    const res = await POST(request({ challengeToken: "bukan-jwt", code: "123456" }));
    expect(res.status).toBe(401);
    expect(m.completeLogin).not.toHaveBeenCalled();
  });

  it("menolak kode yang salah", async () => {
    const token = await challenge();
    m.verifyTotp.mockReturnValue(false);
    const res = await POST(request({ challengeToken: token, code: "000000" }));
    expect(res.status).toBe(401);
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "TWO_FACTOR_FAILED" }));
    expect(m.completeLogin).not.toHaveBeenCalled();
  });

  it("menolak challenge bila tokenVersion sudah berubah", async () => {
    const token = await challenge();
    m.db.user.findUnique.mockResolvedValueOnce({ ...user, tokenVersion: 4 });
    const res = await POST(request({ challengeToken: token, code: "123456" }));
    expect(res.status).toBe(401);
    expect(m.completeLogin).not.toHaveBeenCalled();
  });

  it("menyelesaikan login dengan TOTP yang benar", async () => {
    const token = await challenge();
    const res = await POST(request({ challengeToken: token, code: "123456" }));
    expect(res.status).toBe(200);
    expect(m.completeLogin).toHaveBeenCalledWith(expect.anything(), user, true);
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "TWO_FACTOR_SUCCESS" }));
    expect(m.sendMail).not.toHaveBeenCalled();
  });

  it("mengirim notifikasi saat kode pemulihan dipakai", async () => {
    const token = await challenge();
    m.consumeRecoveryCode.mockResolvedValue(true);
    const res = await POST(request({ challengeToken: token, code: "ABCD12-EF34" }));
    expect(res.status).toBe(200);
    expect(m.verifyTotp).not.toHaveBeenCalled();
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "TWO_FACTOR_RECOVERY_USED" }));
    expect(m.sendMail).toHaveBeenCalledWith(expect.objectContaining({ subject: "Kode pemulihan Finwise dipakai" }));
  });

  it("menghormati pembatasan laju", async () => {
    const token = await challenge();
    m.rateLimit.mockReturnValueOnce({ allowed: false, retryAfter: 23 });
    const res = await POST(request({ challengeToken: token, code: "123456" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("23");
    expect(m.completeLogin).not.toHaveBeenCalled();
  });
});
