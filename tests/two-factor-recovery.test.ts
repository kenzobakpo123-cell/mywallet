import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashRecoveryCode } from "@/lib/two-factor";

const m = vi.hoisted(() => ({
  updateMany: vi.fn(async () => ({ count: 0 })),
  findMany: vi.fn(async () => []),
}));

vi.mock("@/lib/db", () => ({
  db: { twoFactorRecovery: { updateMany: m.updateMany, findMany: m.findMany } },
}));

import { consumeRecoveryCode } from "@/lib/two-factor-recovery";

describe("consumeRecoveryCode", () => {
  const code = "ABCD12-EF3456";

  beforeEach(() => {
    vi.clearAllMocks();
    m.updateMany.mockResolvedValue({ count: 1 });
  });

  it("hanya mencocokkan hash kode yang belum dipakai", async () => {
    expect(await consumeRecoveryCode(7, ` ${code.toLowerCase()} `)).toBe(true);
    expect(m.updateMany).toHaveBeenCalledWith({
      where: { userId: 7, codeHash: hashRecoveryCode(code), usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
  });

  it("menolak kode dengan format salah tanpa menyentuh database", async () => {
    expect(await consumeRecoveryCode(7, "bukan-kode")).toBe(false);
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it("menolak kode yang sudah terpakai (updateMany count = 0)", async () => {
    m.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await consumeRecoveryCode(7, code)).toBe(false);
  });
});
