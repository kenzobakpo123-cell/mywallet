import { db } from "@/lib/db";

export type DbRateLimitResult = {
  allowed: boolean;
  retryAfter: number;
  count: number;
};

let lastCleanup = 0;

/**
 * Rate limit yang tersimpan di database, jadi dipakai bersama oleh semua
 * instance serverless. Dipakai untuk endpoint autentikasi yang paling kritis.
 */
export async function dbRateLimit(key: string, limit: number, windowMs: number): Promise<DbRateLimitResult> {
  const nowMs = Date.now();
  const now = new Date(nowMs);
  const resetAt = new Date(nowMs + windowMs);
  const safeKey = key.slice(0, 191);

  if (nowMs - lastCleanup > 60_000) {
    lastCleanup = nowMs;
    await db.$executeRaw`DELETE FROM \`RateLimit\` WHERE \`resetAt\` < ${new Date(nowMs - 86_400_000)}`;
  }

  // Satu statement atomik: reset kalau jendela sudah lewat, else increment.
  await db.$executeRaw`
    INSERT INTO \`RateLimit\` (\`key\`, \`count\`, \`resetAt\`, \`createdAt\`, \`updatedAt\`)
    VALUES (${safeKey}, 1, ${resetAt}, ${now}, ${now})
    ON DUPLICATE KEY UPDATE
      \`count\` = IF(\`resetAt\` <= ${now}, 1, \`count\` + 1),
      \`resetAt\` = IF(\`resetAt\` <= ${now}, ${resetAt}, \`resetAt\`),
      \`updatedAt\` = ${now}
  `;

  const rows = await db.$queryRaw<Array<{ count: number; resetAt: Date }>>`
    SELECT \`count\`, \`resetAt\` FROM \`RateLimit\` WHERE \`key\` = ${safeKey} LIMIT 1
  `;
  const row = rows[0];
  if (!row) return { allowed: true, retryAfter: 0, count: 1 };

  const count = Number(row.count);
  const until = new Date(row.resetAt).getTime();
  if (count > limit) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((until - nowMs) / 1000)),
      count,
    };
  }
  return { allowed: true, retryAfter: 0, count };
}
