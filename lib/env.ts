import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url().startsWith("mysql://"),
  JWT_SECRET: z.string().min(32),
  ARCJET_KEY: z.string().startsWith("ajkey_"),
  RESEND_API_KEY: z.string().startsWith("re_"),
  EMAIL_FROM: z.string().min(3),
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
