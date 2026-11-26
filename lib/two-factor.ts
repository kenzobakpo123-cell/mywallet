import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const ENC_VERSION = "v1";
const STEP_MS = 30_000;
const CHALLENGE_ISSUER = "finwise-2fa";
const CHALLENGE_AUDIENCE = "finwise-2fa-challenge";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.trim().toUpperCase().replace(/=+$/, "").replace(/[\s-]/g, "");
  if (!clean) throw new Error("Secret TOTP kosong");

  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Secret TOTP tidak valid");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secret: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

/** RFC 6238: SHA-1, 6 digit, 30 detik, toleransi ±1 langkah. */
export function verifyTotp(secret: string, token: string, now = Date.now()): boolean {
  const candidate = token.trim();
  if (!/^\d{6}$/.test(candidate)) return false;

  let key: Buffer;
  try {
    key = base32Decode(secret);
  } catch {
    return false;
  }
  const counter = Math.floor(now / STEP_MS);
  const actual = Buffer.from(candidate);
  for (let delta = -1; delta <= 1; delta += 1) {
    const expected = Buffer.from(hotp(key, counter + delta));
    if (actual.length === expected.length && timingSafeEqual(actual, expected)) return true;
  }
  return false;
}

function encryptionKey(): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET wajib diisi dengan string acak minimal 32 karakter.");
  }
  return createHash("sha256").update(`finwise-2fa-secret:${ENC_VERSION}:`).update(secret).digest();
}

/** Rahasia TOTP dienkripsi AES-256-GCM sebelum disimpan di database. */
export function encryptTotpSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    ENC_VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptTotpSecret(value: string): string {
  const [version, ivPart, tagPart, dataPart] = value.split(".");
  if (version !== ENC_VERSION || !ivPart || !tagPart || !dataPart) {
    throw new Error("Format rahasia 2FA tidak dikenal");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function otpauthUri(email: string, secret: string): string {
  const label = encodeURIComponent(`Finwise:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=Finwise&algorithm=SHA1&digits=6&period=30`;
}

export function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () =>
    `${randomBytes(3).toString("hex").toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`,
  );
}

export function normalizeRecoveryCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isValidRecoveryCode(input: string): boolean {
  return /^[A-F0-9]{12}$/.test(normalizeRecoveryCode(input));
}

export function hashRecoveryCode(input: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(input)).digest("hex");
}

function challengeSecret(): Uint8Array {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) {
    throw new Error("JWT_SECRET wajib diisi dengan string acak minimal 32 karakter.");
  }
  return new TextEncoder().encode(value);
}

export type TwoFactorChallenge = { uid: number; tv: number; issueToken: boolean };

/** Token sementara setelah password benar, sebelum kode 2FA diverifikasi. */
export async function signTwoFactorChallenge(data: TwoFactorChallenge): Promise<string> {
  return new SignJWT({ tv: data.tv, native: data.issueToken })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(data.uid))
    .setIssuer(CHALLENGE_ISSUER)
    .setAudience(CHALLENGE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(challengeSecret());
}

export async function verifyTwoFactorChallenge(token: string): Promise<TwoFactorChallenge | null> {
  try {
    const { payload } = await jwtVerify(token, challengeSecret(), {
      algorithms: ["HS256"],
      issuer: CHALLENGE_ISSUER,
      audience: CHALLENGE_AUDIENCE,
    });
    if (typeof payload.sub !== "string" || !/^\d+$/.test(payload.sub)) return null;
    const uid = Number(payload.sub);
    if (!Number.isSafeInteger(uid) || uid <= 0) return null;
    if (typeof payload.tv !== "number" || !Number.isSafeInteger(payload.tv)) return null;
    return { uid, tv: payload.tv, issueToken: payload.native === true };
  } catch {
    return null;
  }
}

const SETUP_ISSUER = "finwise-2fa-setup";
const SETUP_AUDIENCE = "finwise-2fa-setup-challenge";

/**
 * Challenge khusus untuk akun yang diwajibkan memasang 2FA. Diberikan setelah
 * password benar, sebelum ada sesi, supaya setup tetap bisa diselesaikan.
 */
export async function signTwoFactorSetupChallenge(data: TwoFactorChallenge): Promise<string> {
  return new SignJWT({ tv: data.tv, native: data.issueToken })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(data.uid))
    .setIssuer(SETUP_ISSUER)
    .setAudience(SETUP_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(challengeSecret());
}

export async function verifyTwoFactorSetupChallenge(token: string): Promise<TwoFactorChallenge | null> {
  try {
    const { payload } = await jwtVerify(token, challengeSecret(), {
      algorithms: ["HS256"],
      issuer: SETUP_ISSUER,
      audience: SETUP_AUDIENCE,
    });
    if (typeof payload.sub !== "string" || !/^\d+$/.test(payload.sub)) return null;
    const uid = Number(payload.sub);
    if (!Number.isSafeInteger(uid) || uid <= 0) return null;
    if (typeof payload.tv !== "number" || !Number.isSafeInteger(payload.tv)) return null;
    return { uid, tv: payload.tv, issueToken: payload.native === true };
  } catch {
    return null;
  }
}
