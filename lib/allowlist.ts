/**
 * Allowlist pendaftaran. Kosong hanya diizinkan di development supaya alur
 * lokal tetap bisa dicoba. Di production env wajib diisi oleh `lib/env.ts`, dan
 * helper ini tetap fail-closed kalau dipanggil sebelum proxy berjalan.
 */
function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function isEmailAllowed(input: string): boolean {
  const email = normalize(input);
  if (!email || !email.includes("@") || email.length > 254) return false;

  const raw = process.env.ALLOWED_EMAILS?.trim();
  if (!raw) return process.env.NODE_ENV !== "production";

  const entries = raw.split(",").map(normalize).filter(Boolean);
  if (entries.length === 0) return false;

  return entries.some((entry) =>
    entry.startsWith("@") ? email.endsWith(entry) : email === entry,
  );
}

/** Akun-akun yang tidak boleh masuk hanya dengan password. */
export function requiresTwoFactor(input: string): boolean {
  const email = normalize(input);
  if (!email || !email.includes("@")) return false;

  const raw = process.env.REQUIRE_2FA_EMAILS?.trim();
  if (!raw) return false;

  return raw
    .split(",")
    .map(normalize)
    .filter(Boolean)
    .some((entry) => (entry.startsWith("@") ? email.endsWith(entry) : email === entry));
}
