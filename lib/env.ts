import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url().startsWith("mysql://"),
  JWT_SECRET: z.string().min(32),
  ARCJET_KEY: z.string().startsWith("ajkey_"),
  RESEND_API_KEY: z.string().startsWith("re_"),
  EMAIL_FROM: z.string().min(3),
  // Daftar email yang boleh mendaftar, dipisah koma. Boleh berupa @domain.com.
  ALLOWED_EMAILS: z.string().min(3, "ALLOWED_EMAILS wajib diisi"),
  // Email yang wajib memakai 2FA. Daftar ini dipisah koma, sama seperti allowlist.
  REQUIRE_2FA_EMAILS: z.string().min(3, "REQUIRE_2FA_EMAILS wajib diisi"),
  APP_URL: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    }, "APP_URL harus HTTPS dan tanpa kredensial"),
});

let checked = false;

/**
 * Dipanggil lewat proxy di runtime. Tidak dijalankan saat `next build`,
 * jadi build lokal tetap bisa berjalan tanpa secret produksi.
 */
export function assertProdEnv(): void {
  if (checked || process.env.NODE_ENV !== "production") return;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Konfigurasi produksi tidak valid: ${fields}`);
  }
  checked = true;
}
