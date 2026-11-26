import { describe, expect, it } from "vitest";
import { authSchema, registrationSchema, strongPasswordSchema, txSchema } from "@/lib/schemas";

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

describe("strongPasswordSchema", () => {
  it("menerima password panjang yang tidak umum", () => {
    expect(strongPasswordSchema.safeParse("Hutan#Kopi77Laut").success).toBe(true);
  });

  it("menolak password kurang dari 12 karakter", () => {
    expect(strongPasswordSchema.safeParse("Pendek1!A").success).toBe(false);
  });

  it("menolak password yang mengandung kata umum", () => {
    expect(strongPasswordSchema.safeParse("Password123456").success).toBe(false);
    expect(strongPasswordSchema.safeParse("FinwiseAman77").success).toBe(false);
  });

  it("menolak password hanya angka dan pengulangan", () => {
    expect(strongPasswordSchema.safeParse("123456789012").success).toBe(false);
    expect(strongPasswordSchema.safeParse("aaaaaaaaaA1!").success).toBe(false);
  });

  it("pendaftaran memakai password kuat", () => {
    const base = { name: "Ken", email: "ken@example.com" };
    expect(registrationSchema.safeParse({ ...base, password: "Hutan#Kopi77Laut" }).success).toBe(true);
    expect(registrationSchema.safeParse({ ...base, password: "password123" }).success).toBe(false);
  });
});
