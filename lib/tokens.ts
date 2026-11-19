import { createHash, randomBytes } from "crypto";

/** Token mentah dikirim lewat email; yang disimpan di DB hanya hash-nya. */
export function newToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
