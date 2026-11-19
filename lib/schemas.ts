import { z } from "zod";
import { isValidDateString } from "@/lib/dates";

// bcryptjs memotong input setelah 72 byte, bukan 72 karakter.
export const passwordSchema = z
  .string()
  .min(8)
  .max(100)
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72, {
    message: "Password maksimal 72 byte",
  });

export const authSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  email: z.string().trim().toLowerCase().email().max(120),
  password: passwordSchema,
});

export const txSchema = z.object({
  type: z.enum(["INCOME", "EXPENSE"]),
  amount: z.number().int().positive().max(2_000_000_000),
  category: z.string().trim().min(1).max(40),
  note: z.string().trim().max(200).optional(),
  date: z.string().refine(isValidDateString, { message: "Tanggal tidak valid" }),
  walletId: z.number().int().positive().optional(),
});
