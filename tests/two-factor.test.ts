import { afterEach, describe, expect, it, vi } from "vitest";
import {
  base32Decode,
  base32Encode,
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  isValidRecoveryCode,
  newTotpSecret,
  normalizeRecoveryCode,
  otpauthUri,
  signTwoFactorChallenge,
  verifyTotp,
  verifyTwoFactorChallenge,
} from "@/lib/two-factor";
import { isEmailAllowed } from "@/lib/allowlist";

const SEED_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // RFC 6238: "12345678901234567890"
const JWT = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH";

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.JWT_SECRET;
  delete process.env.ALLOWED_EMAILS;
});

describe("TOTP", () => {
  it("meng encodes dan mendecode base32 dengan benar", () => {
    expect(base32Decode(SEED_SECRET).toString("ascii")).toBe("12345678901234567890");
    expect(base32Encode(base32Decode(SEED_SECRET))).toBe(SEED_SECRET.replace(/=+$/, ""));
  });

  it.each([
    [59_000, "287082"],
    [1_111_111_109_000, "081804"],
    [1_111_111_111_000, "050471"],
    [1_234_567_890_000, "005924"],
  ])("menerima kode RFC 6238 (6 digit) pada %i ms", (now, code) => {
    expect(verifyTotp(SEED_SECRET, code, now)).toBe(true);
  });

  it("menolak kode salah, format salah, dan secret rusak", () => {
    expect(verifyTotp(SEED_SECRET, "000000", 59_000)).toBe(false);
    expect(verifyTotp(SEED_SECRET, "12345", 59_000)).toBe(false);
    expect(verifyTotp("!!!", "287082", 59_000)).toBe(false);
  });

  it("menghasilkan secret baru yang bisa dipindai authenticator", () => {
    const secret = newTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(otpauthUri("ken@example.com", secret)).toContain("otpauth://totp/");
    expect(otpauthUri("ken@example.com", secret)).toContain(secret);
  });
});

describe("penyimpanan rahasia 2FA", () => {
  it("terenkripsi AES-GCM dan bisa dibaca kembali", () => {
    process.env.JWT_SECRET = JWT;
    const encrypted = encryptTotpSecret(SEED_SECRET);
    expect(encrypted).not.toContain(SEED_SECRET);
    expect(encrypted.startsWith("v1.")).toBe(true);
    expect(decryptTotpSecret(encrypted)).toBe(SEED_SECRET);
  });

  it("menolak payload yang dimodifikasi", () => {
    process.env.JWT_SECRET = JWT;
    const encrypted = encryptTotpSecret(SEED_SECRET);
    const parts = encrypted.split(".");
    expect(() => decryptTotpSecret(`${parts[0]}.${parts[1]}.${parts[2]}.${parts[3]}x`)).toThrow();
    expect(() => decryptTotpSecret("v2." + parts.slice(1).join("."))).toThrow();
  });

  it("gagal tertutup tanpa JWT_SECRET", () => {
    delete process.env.JWT_SECRET;
    expect(() => encryptTotpSecret(SEED_SECRET)).toThrow(/JWT_SECRET/);
  });
});

describe("kode pemulihan", () => {
  it("ternormalisasi dan di-hash tanpa menyimpan kode mentah", () => {
    const [code] = generateRecoveryCodes(1);
    expect(code).toMatch(/^[A-F0-9]{6}-[A-F0-9]{6}$/);
    expect(isValidRecoveryCode(` ${code.toLowerCase()} `)).toBe(true);
    expect(normalizeRecoveryCode(code)).toBe(code.replace("-", ""));
    expect(hashRecoveryCode(code)).toBe(hashRecoveryCode(code.toLowerCase()));
    expect(hashRecoveryCode(code)).not.toContain("-");
    expect(hashRecoveryCode(code)).toMatch(/^[a-f0-9]{64}$/);
    expect(isValidRecoveryCode("BADCODE")).toBe(false);
  });

  it("menghasilkan kode yang berbeda tiap kali", () => {
    const codes = generateRecoveryCodes(8);
    expect(new Set(codes).size).toBe(8);
  });
});

describe("challenge login 2FA", () => {
  it("hanya diterima untuk issuer/audience dan tipe yang benar", async () => {
    process.env.JWT_SECRET = JWT;
    const token = await signTwoFactorChallenge({ uid: 7, tv: 3, issueToken: true });
    expect(await verifyTwoFactorChallenge(token)).toEqual({ uid: 7, tv: 3, issueToken: true });
    expect(await verifyTwoFactorChallenge("bukan-jwt")).toBeNull();
  });

  it("menolak klaim uid atau tv yang tidak valid", async () => {
    process.env.JWT_SECRET = JWT;
    const { SignJWT } = await import("jose");
    const key = new TextEncoder().encode(JWT);
    const bad = await new SignJWT({ tv: "salah", native: false })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("7")
      .setIssuer("finwise-2fa")
      .setAudience("finwise-2fa-challenge")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(key);
    expect(await verifyTwoFactorChallenge(bad)).toBeNull();
  });
});

describe("allowlist pendaftaran", () => {
  it("menerima email persis dan domain, tanpa peduli huruf", () => {
    process.env.ALLOWED_EMAILS = " KenZoBakPo123@gmail.com , @finwise.id ";
    expect(isEmailAllowed("kenzobakpo123@gmail.com")).toBe(true);
    expect(isEmailAllowed("KENZOBAKPO123@GMAIL.COM")).toBe(true);
    expect(isEmailAllowed("pegawai@finwise.id")).toBe(true);
    expect(isEmailAllowed("lain@gmail.com")).toBe(false);
  });

  it("fail-closed kalau daftar kosong di production", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.ALLOWED_EMAILS = "  ,  ";
    expect(isEmailAllowed("kenzobakpo123@gmail.com")).toBe(false);
  });
});
