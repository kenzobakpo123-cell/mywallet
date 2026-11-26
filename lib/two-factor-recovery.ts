import { db } from "@/lib/db";
import { hashRecoveryCode, isValidRecoveryCode } from "@/lib/two-factor";

/**
 * Kode pemulihan hanya bisa dipakai sekali. `updateMany` bersyarat memastikan
 * dua request parallel tidak bisa memakai kode yang sama.
 */
export async function consumeRecoveryCode(userId: number, input: string): Promise<boolean> {
  if (!isValidRecoveryCode(input)) return false;
  const updated = await db.twoFactorRecovery.updateMany({
    where: { userId, codeHash: hashRecoveryCode(input), usedAt: null },
    data: { usedAt: new Date() },
  });
  return updated.count === 1;
}
