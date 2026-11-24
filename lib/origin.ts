/**
 * Origin publik yang dipakai untuk tautan email dan pemeriksaan CSRF.
 *
 * PENTING: nilai ini TIDAK pernah diambil dari header request (Host / Origin /
 * X-Forwarded-Host). Jika diambil dari request, penyerang bisa mengirim
 * forgot-password dengan Host palsu dan korban menerima tautan reset password
 * ke domain penyerang.
 */
const CANONICAL_PRODUCTION = "https://mywallet-virid-eight.vercel.app";
const LOCAL_DEVELOPMENT = "http://localhost:3000";

export function publicOrigin(): string {
  const configured = process.env.APP_URL?.trim();
  const raw = configured || (process.env.NODE_ENV === "production" ? CANONICAL_PRODUCTION : LOCAL_DEVELOPMENT);

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("APP_URL bukan URL yang valid");
  }

  // Hanya development lokal yang boleh http. Test/preview/production wajib https.
  const expectedProtocol = process.env.NODE_ENV === "development" ? "http:" : "https:";
  if (url.protocol !== expectedProtocol || url.username || url.password) {
    throw new Error("APP_URL harus berupa URL tanpa kredensial dan memakai HTTPS di production");
  }

  return url.origin;
}

/** Origin yang diizinkan melakukan mutation dengan cookie (web). */
export function isAllowedWebOrigin(origin: string): boolean {
  try {
    return new URL(origin).origin === publicOrigin();
  } catch {
    return false;
  }
}
