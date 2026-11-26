import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const APP = "https://mywallet-virid-eight.vercel.app";
const JWT = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH";
const PASSWORD = "hutan-kopi-77";

const m = vi.hoisted(() => ({
  attempts: 1,
  db: {
    user: { findUnique: vi.fn(), update: vi.fn(async () => ({})) },
    session: { updateMany: vi.fn(async () => ({ count: 1 })) },
  },
  protectArcjet: vi.fn(async (): Promise<{ denied: boolean }> => ({ denied: false })),
  audit: vi.fn(async () => {}),
  sendMail: vi.fn(async () => {}),
  deviceLabel: vi.fn(() => "Safari"),
  clientIp: vi.fn((): string | null => "203.0.113.7"),
  dbRateLimit: vi.fn(async (key: string) => ({
    allowed: true,
    retryAfter: 0,
    count: key.startsWith("login-email:") ? m.attempts : 1,
  })),
}));

vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/arcjet", () => ({ protectArcjet: m.protectArcjet }));
vi.mock("@/lib/audit", () => ({ audit: m.audit }));
vi.mock("@/lib/email", async () => {
  const actual = await vi.importActual<typeof import("@/lib/email")>("@/lib/email");
  return { ...actual, sendMail: m.sendMail };
});
vi.mock("@/lib/device", () => ({ deviceLabel: m.deviceLabel }));
vi.mock("@/lib/security", async () => {
  const actual = await vi.importActual<typeof import("@/lib/security")>("@/lib/security");
  return { ...actual, clientIp: m.clientIp };
});
vi.mock("@/lib/rate-limit-db", () => ({ dbRateLimit: m.dbRateLimit }));

import { requiresTwoFactor } from "@/lib/allowlist";
import { handleLogin } from "@/lib/login";
import { twoFactorActor } from "@/lib/two-factor-actor";
import { verifyTwoFactorSetupChallenge } from "@/lib/two-factor";

const request = (email: string, password: string) =>
  new NextRequest(`${APP}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: APP },
    body: JSON.stringify({ email, password }),
  });

const user = {
  id: 9,
  name: "Ken",
  email: "kenzobakpo123@gmail.com",
  passwordHash: bcrypt.hashSync(PASSWORD, 4),
  tokenVersion: 2,
  emailVerified: true,
  twoFactorEnabled: false,
};

describe("daftar email wajib 2FA", () => {
  beforeEach(() => {
    process.env.REQUIRE_2FA_EMAILS = "kenzobakpo123@gmail.com, @staf.example";
  });

  it("mencocokkan email persis dan domain", () => {
    expect(requiresTwoFactor(user.email)).toBe(true);
    expect(requiresTwoFactor("Orang@Staf.Example")).toBe(true);
  });

  it("menolak email di luar daftar", () => {
    expect(requiresTwoFactor("lain@example.com")).toBe(false);
  });

  it("tidak menganggap substring sebagai kecocokan", () => {
    expect(requiresTwoFactor("kenzobakpo123@gmail.com.evil.tld")).toBe(false);
  });
});

describe("login dengan 2FA wajib", () => {
  beforeEach(() => {
    process.env.APP_URL = APP;
    process.env.JWT_SECRET = JWT;
    process.env.REQUIRE_2FA_EMAILS = user.email;
    m.attempts = 1;
    vi.clearAllMocks();
    m.db.user.findUnique.mockResolvedValue(user);
    m.db.user.update.mockResolvedValue({});
    m.db.session.updateMany.mockResolvedValue({ count: 1 });
    m.dbRateLimit.mockImplementation(async (key: string) => ({
      allowed: true,
      retryAfter: 0,
      count: key.startsWith("login-email:") ? m.attempts : 1,
    }));
    m.protectArcjet.mockResolvedValue({ denied: false });
  });

  it("memberi challenge setup, bukan sesi, sebelum 2FA dipasang", async () => {
    const res = await handleLogin(request(user.email, PASSWORD), false);
    const body = await res.json();
    expect(body.twoFactorSetupRequired).toBe(true);
    expect(body.token).toBeUndefined();

    const challenge = await verifyTwoFactorSetupChallenge(body.challengeToken);
    expect(challenge).toMatchObject({ uid: user.id, tv: user.tokenVersion, issueToken: false });
    expect(m.db.session.updateMany).not.toHaveBeenCalled();
  });

  it("challenge setup bisa dipakai actor 2FA tetapi bukan challenge login", async () => {
    const res = await handleLogin(request(user.email, PASSWORD), false);
    const body = await res.json();
    const actor = await twoFactorActor({ headers: new Headers() } as never, {
      challengeToken: body.challengeToken,
    });
    expect(actor).toMatchObject({ uid: user.id, issueToken: false, forced: true });
  });

  it("mencabut sesi dan token setelah tiga password salah", async () => {
    m.attempts = 3;
    const res = await handleLogin(request(user.email, "salah-password"), false);
    expect(res.status).toBe(401);
    expect(m.db.session.updateMany).toHaveBeenCalledWith({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(m.db.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { tokenVersion: { increment: 1 } },
    });
    expect(m.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Aktivitas login mencurigakan di Finwise" }),
    );
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "SUSPICIOUS_LOGIN_LOCKOUT" }));
  });

  it("tidak mencabut sesi pada kegagalan pertama", async () => {
    m.attempts = 1;
    await handleLogin(request(user.email, "salah-password"), false);
    expect(m.db.session.updateMany).not.toHaveBeenCalled();
    expect(m.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Percobaan login gagal di Finwise" }),
    );
  });
});
