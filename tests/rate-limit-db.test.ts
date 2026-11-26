import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  executeRaw: vi.fn(async () => 1),
  queryRaw: vi.fn(async () => [] as Array<{ count: number; resetAt: Date }>),
}));

vi.mock("@/lib/db", () => ({
  db: { $executeRaw: m.executeRaw, $queryRaw: m.queryRaw },
}));

import { dbRateLimit } from "@/lib/rate-limit-db";

describe("dbRateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mengizinkan percobaan sampai batas", async () => {
    m.queryRaw.mockResolvedValue([{ count: 5, resetAt: new Date(Date.now() + 900_000) }]);
    const result = await dbRateLimit("login-email:user@example.com", 5, 900_000);
    expect(result).toMatchObject({ allowed: true, count: 5 });
  });

  it("memblokir percobaan setelah batas dengan Retry-After", async () => {
    m.queryRaw.mockResolvedValue([{ count: 6, resetAt: new Date(Date.now() + 23_000) }]);
    const result = await dbRateLimit("2fa:203.0.113.7", 5, 900_000);
    expect(result.allowed).toBe(false);
    expect(result.count).toBe(6);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it("memakai statement atomik ON DUPLICATE KEY UPDATE", async () => {
    m.queryRaw.mockResolvedValue([{ count: 1, resetAt: new Date(Date.now() + 900_000) }]);
    await dbRateLimit("forgot:user@example.com", 3, 900_000);
    const lastCall = m.executeRaw.mock.calls.at(-1) as unknown[] | undefined;
    const sql = String(lastCall?.[0] ?? "");
    expect(sql).toContain("ON DUPLICATE KEY UPDATE");
  });
});
