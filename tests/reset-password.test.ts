import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const APP = "https://mywallet-virid-eight.vercel.app";
const TOKEN = "a".repeat(64);

const m = vi.hoisted(() => ({
  db: {
    user: { findFirst: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
    session: { updateMany: vi.fn(async () => ({ count: 2 })) },
  },
  protectArcjet: vi.fn(async (): Promise<{ denied: boolean }> => ({ denied: false })),
  audit: vi.fn(async () => {}),
  sendMail: vi.fn(async () => {}),
  passwordChangedEmail: vi.fn(() => "<p>password diubah</p>"),
  consumeRecoveryCode: vi.fn(async (): Promise<boolean> => false),
  decryptTotpSecret: vi.fn(() => "plain-secret"),
  verifyTotp: vi.fn((): boolean => true),
  clientIp: vi.fn((): string | null => "203.0.113.7"),
  deviceLabel: vi.fn(() => "Safari"),
}));

vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/arcjet", () => ({ protectArcjet: m.protectArcjet }));
vi.mock("@/lib/audit", () => ({ audit: m.audit }));
vi.mock("@/lib/email", () => ({
  sendMail: m.sendMail,
  passwordChangedEmail: m.passwordChangedEmail,
}));
vi.mock("@/lib/two-factor-recovery", () => ({ consumeRecoveryCode: m.consumeRecoveryCode }));
vi.mock("@/lib/two-factor", async () => {
  const actual = await vi.importActual<typeof import("@/lib/two-factor")>("@/lib/two-factor");
  return { ...actual, decryptTotpSecret: m.decryptTotpSecret, verifyTotp: m.verifyTotp };
});
vi.mock("@/lib/security", async () => {
  const actual = await vi.importActual<typeof import("@/lib/security")>("@/lib/security");
  return { ...actual, clientIp: m.clientIp };
});
vi.mock("@/lib/device", () => ({ deviceLabel: m.deviceLabel }));
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn(async () => "new-hash") } }));

import { POST } from "@/app/api/auth/reset-password/route";

const user = {
  id: 4,
  email: "ken@example.com",
  twoFactorEnabled: true,
  twoFactorSecret: "encrypted-secret",
};

const request = (body: unknown) =>
  new NextRequest(`${APP}/api/auth/reset-password`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: APP },
    body: JSON.stringify(body),
  });

describe("POST /api/auth/reset-password", () => {
  beforeEach(() => {
    process.env.APP_URL = APP;
    vi.clearAllMocks();
    m.db.user.findFirst.mockResolvedValue(user);
    m.db.user.updateMany.mockResolvedValue({ count: 1 });
    m.protectArcjet.mockResolvedValue({ denied: false });
    m.consumeRecoveryCode.mockResolvedValue(false);
    m.verifyTotp.mockReturnValue(true);
  });

  it("menolak reset tanpa kode 2FA untuk akun yang memakai 2FA", async () => {
    const res = await POST(request({ token: TOKEN, password: "KopiHitam#2026Aman" }));
    expect(res.status).toBe(400);
    expect(m.db.user.updateMany).not.toHaveBeenCalled();
    expect(bcrypt.hash).not.toHaveBeenCalled();
  });

  it("menerima reset dengan kode TOTP yang benar", async () => {
    const res = await POST(request({ token: TOKEN, password: "KopiHitam#2026Aman", code: "123456" }));
    expect(res.status).toBe(200);
    expect(m.verifyTotp).toHaveBeenCalledWith("plain-secret", "123456");
    expect(m.db.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ passwordHash: "new-hash" }) }),
    );
    expect(m.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Password Finwise kamu diubah" }),
    );
  });

  it("menolak kode 2FA yang salah", async () => {
    m.verifyTotp.mockReturnValue(false);
    const res = await POST(request({ token: TOKEN, password: "KopiHitam#2026Aman", code: "000000" }));
    expect(res.status).toBe(400);
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "PASSWORD_RESET_2FA_FAILED" }));
    expect(m.db.user.updateMany).not.toHaveBeenCalled();
  });

  it("menerima kode pemulihan yang belum dipakai", async () => {
    m.consumeRecoveryCode.mockResolvedValue(true);
    const res = await POST(request({ token: TOKEN, password: "KopiHitam#2026Aman", code: "ABCD12-EF34" }));
    expect(res.status).toBe(200);
    expect(m.verifyTotp).not.toHaveBeenCalled();
  });
});
