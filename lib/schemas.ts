import { z } from "zod";
import { isValidDateString } from "@/lib/dates";

// bcryptjs memotong input setelah 72 byte, bukan 72 karakter.
const withinByteLimit = (value: string) => Buffer.byteLength(value, "utf8") <= 72;

/**
 * Dipakai untuk LOGIN. Minimal 8 tetap diterima supaya akun yang dibuat sebelum
 * kebijakan baru masih bisa masuk; kekuatan password diatur saat daftar/reset.
 */
export const passwordSchema = z
  .string()
  .min(8)
  .max(100)
  .refine(withinByteLimit, { message: "Password maksimal 72 byte" });

const WEAK_PATTERNS = [/password/i, /qwerty/i, /123456/, /finwise/i, /kenzo/i];

/** Dipakai untuk pendaftaran dan reset password. */
export const strongPasswordSchema = z
  .string()
  .min(12, "Password minimal 12 karakter")
  .max(100)
  .refine(withinByteLimit, { message: "Password maksimal 72 byte" })
  .refine((value) => !WEAK_PATTERNS.some((pattern) => pattern.test(value)), {
    message: "Password terlalu umum atau mudah ditebak",
  })
  .refine((value) => !/^\d+$/.test(value), { message: "Password tidak boleh hanya angka" })
  .refine((value) => !/(.)\1{5,}/.test(value), { message: "Password terlalu berulang" });

export const authSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  email: z.string().trim().toLowerCase().email().max(120),
  password: passwordSchema,
});

export const registrationSchema = authSchema.extend({
  name: z.string().trim().min(2).max(60),
  password: strongPasswordSchema,
});

export const txSchema = z.object({
  type: z.enum(["INCOME", "EXPENSE"]),
  amount: z.number().int().positive().max(2_000_000_000),
  category: z.string().trim().min(1).max(40),
  note: z.string().trim().max(200).optional(),
  date: z.string().refine(isValidDateString, { message: "Tanggal tidak valid" }),
  walletId: z.number().int().positive().optional(),
});
