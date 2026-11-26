import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const APP = "https://mywallet-virid-eight.vercel.app";
const viewer = {
  uid: 5,
  name: "Ken",
  email: "ken@example.com",
  timezone: "Asia/Jakarta",
  currency: "IDR",
  sid: 11,
};

const m = vi.hoisted(() => {
  const db = {
    budget: { deleteMany: vi.fn(async () => ({ count: 2 })) },
    transaction: { deleteMany: vi.fn(async () => ({ count: 9 })) },
    wallet: { deleteMany: vi.fn(async () => ({ count: 3 })) },
    category: { deleteMany: vi.fn(async () => ({ count: 4 })) },
    session: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    user: { update: vi.fn(async () => ({ id: 5 })) },
    auditLog: { create: vi.fn(async () => ({ id: 1 })) },
  };
  const transaction = vi.fn(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
  Object.assign(db, { $transaction: transaction });

  return {
    db,
    transaction,
    getViewer: vi.fn(),
    protectArcjet: vi.fn(
      async (): Promise<{ denied: boolean; error?: string; status?: number; retryAfter?: number }> => ({
        denied: false,
      }),
    ),
    clearAuthCookies: vi.fn(),
    clientIp: vi.fn((): string | null => "203.0.113.7"),
    clientKey: vi.fn(() => "audit:203.0.113.7"),
    rateLimit: vi.fn((): { allowed: boolean; retryAfter: number } => ({ allowed: true, retryAfter: 0 })),
  };
});

vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/auth", () => ({ getViewer: m.getViewer }));
vi.mock("@/lib/arcjet", () => ({ protectArcjet: m.protectArcjet }));
vi.mock("@/lib/cookies", () => ({ clearAuthCookies: m.clearAuthCookies }));
vi.mock("@/lib/security", async () => {
  const actual = await vi.importActual<typeof import("@/lib/security")>("@/lib/security");
  return {
    ...actual,
    clientIp: m.clientIp,
    clientKey: m.clientKey,
    rateLimit: m.rateLimit,
  };
});

import { POST } from "@/app/api/data/reset/route";

const request = (body: unknown = { confirm: "RESET" }, origin: string | null = APP) =>
  new NextRequest(`${APP}/api/data/reset`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify(body),
  });

describe("POST /api/data/reset", () => {
  beforeEach(() => {
    process.env.APP_URL = APP;
    vi.clearAllMocks();
    m.getViewer.mockResolvedValue(viewer);
    m.protectArcjet.mockResolvedValue({ denied: false });
    m.rateLimit.mockReturnValue({ allowed: true, retryAfter: 0 });
  });

  it("menolak request tanpa Origin yang sah", async () => {
    const res = await POST(request({ confirm: "RESET" }, "https://attacker.tld"));
    expect(res.status).toBe(403);
    expect(m.getViewer).not.toHaveBeenCalled();
    expect(m.db.transaction.deleteMany).not.toHaveBeenCalled();
  });

  it("menolak pengguna yang belum login", async () => {
    m.getViewer.mockResolvedValueOnce(null);
    const res = await POST(request());
    expect(res.status).toBe(401);
    expect(m.db.transaction.deleteMany).not.toHaveBeenCalled();
  });

  it("mewajibkan konfirmasi RESET huruf kapital", async () => {
    const res = await POST(request({ confirm: "reset" }));
    expect(res.status).toBe(400);
    expect(m.db.transaction.deleteMany).not.toHaveBeenCalled();
  });

  it("menghapus seluruh data keuangan dan sesi secara atomik", async () => {
    const res = await POST(request());
    expect(res.status).toBe(200);

    const data = (await res.json()) as { ok: boolean; deleted: Record<string, number> };
    expect(data.ok).toBe(true);
    expect(data.deleted).toEqual({ transactions: 9, wallets: 3, categories: 4, budgets: 2, sessions: 1 });

    expect(m.transaction).toHaveBeenCalledTimes(1);
    expect(m.db.budget.deleteMany).toHaveBeenCalledWith({ where: { userId: 5 } });
    expect(m.db.transaction.deleteMany).toHaveBeenCalledWith({ where: { userId: 5 } });
    expect(m.db.wallet.deleteMany).toHaveBeenCalledWith({ where: { userId: 5 } });
    expect(m.db.category.deleteMany).toHaveBeenCalledWith({ where: { userId: 5 } });
    expect(m.db.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 5 } });
    expect(m.db.user.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { tokenVersion: { increment: 1 } } });
    expect(m.db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "DATA_RESET", userId: 5, entity: "User" }),
      }),
    );
    expect(m.clearAuthCookies).toHaveBeenCalledTimes(1);
  });

  it("menghormati pembatasan laju sebelum menghapus", async () => {
    m.rateLimit.mockReturnValueOnce({ allowed: false, retryAfter: 17 });
    const res = await POST(request());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("17");
    expect(m.db.transaction.deleteMany).not.toHaveBeenCalled();
  });

  it("meneruskan keputusan Arcjet", async () => {
    m.protectArcjet.mockResolvedValueOnce({ denied: true, error: "Terlalu banyak permintaan", status: 429, retryAfter: 6 });
    const res = await POST(request());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("6");
    expect(m.db.transaction.deleteMany).not.toHaveBeenCalled();
  });
});
