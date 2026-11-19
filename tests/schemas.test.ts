import { describe, expect, it } from "vitest";
import { authSchema, txSchema } from "@/lib/schemas";

describe("txSchema", () => {
  const valid = {
    type: "EXPENSE" as const,
    amount: 25_000,
    category: "Makanan",
    date: "2026-11-19",
  };

  it("menerima transaksi yang valid", () => {
    expect(txSchema.safeParse(valid).success).toBe(true);
  });

  it("menolak tanggal tidak valid", () => {
    expect(txSchema.safeParse({ ...valid, date: "2026-02-31" }).success).toBe(false);
  });
});

describe("authSchema", () => {
  const base = { email: "user@example.com", password: "password123" };

  it("menerima password ASCII", () => {
    expect(authSchema.safeParse(base).success).toBe(true);
  });

  it("menolak password lebih dari 72 byte", () => {
    expect(authSchema.safeParse({ ...base, password: "é".repeat(40) }).success).toBe(false);
  });
});
