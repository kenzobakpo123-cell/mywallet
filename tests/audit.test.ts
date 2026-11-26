import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const APP = "https://mywallet-virid-eight.vercel.app";

type AuditRow = {
  id: number;
  action: string;
  entity: string | null;
  entityId: number | null;
  ip: string | null;
  createdAt: string;
};

const m = vi.hoisted(() => ({
  db: { auditLog: { findMany: vi.fn(async (): Promise<AuditRow[]> => []) } },
  getViewer: vi.fn(),
  protectArcjet: vi.fn(async (): Promise<{ denied: boolean; status?: number; error?: string }> => ({ denied: false })),
}));

vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/auth", () => ({ getViewer: m.getViewer }));
vi.mock("@/lib/arcjet", () => ({ protectArcjet: m.protectArcjet }));

import { GET } from "@/app/api/audit/route";

const request = (suffix = "", origin: string | null = APP) =>
  new NextRequest(`${APP}/api/audit${suffix}`, { headers: origin ? { origin } : {} });

describe("GET /api/audit", () => {
  beforeEach(() => {
    process.env.APP_URL = APP;
    vi.clearAllMocks();
    m.getViewer.mockResolvedValue({ uid: 5, sid: 9 });
    m.protectArcjet.mockResolvedValue({ denied: false });
    m.db.auditLog.findMany.mockResolvedValue([]);
  });

  it("menolak request tanpa login", async () => {
    m.getViewer.mockResolvedValueOnce(null);
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(m.db.auditLog.findMany).not.toHaveBeenCalled();
  });

  it("tidak memakai CSRF guard untuk GET yang hanya membaca data", async () => {
    const res = await GET(request("", "https://attacker.tld"));
    expect(res.status).toBe(200);
    expect(m.db.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 5 } }));
  });

  it("membatasi limit dan memakai cursor serta filter action", async () => {
    await GET(request("?limit=9999&cursor=42&action=LOGIN_SUCCESS"));
    expect(m.db.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 5, action: "LOGIN_SUCCESS", id: { lt: 42 } },
        take: 101,
      }),
    );
  });

  it("mengabaikan cursor yang tidak valid", async () => {
    await GET(request("?limit=0&cursor=abc"));
    expect(m.db.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 5 }, take: 2 }),
    );
  });

  it("mengembalikan nextCursor hanya bila ada halaman berikutnya", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: 30 - i, action: "LOGIN_SUCCESS", entity: null, entityId: null, ip: null, createdAt: new Date().toISOString(),
    }));
    m.db.auditLog.findMany.mockResolvedValueOnce(rows);
    const res = await GET(request("?limit=2"));
    const data = (await res.json()) as { items: unknown[]; nextCursor: string | null };
    expect(data.items).toHaveLength(2);
    expect(data.nextCursor).toBe("29");
  });

  it("meneruskan keputusan Arcjet", async () => {
    m.protectArcjet.mockResolvedValueOnce({ denied: true, status: 429, error: "Terlalu banyak permintaan" });
    const res = await GET(request());
    expect(res.status).toBe(429);
    expect(m.db.auditLog.findMany).not.toHaveBeenCalled();
  });
});
