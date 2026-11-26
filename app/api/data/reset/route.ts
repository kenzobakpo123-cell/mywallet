import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getViewer } from "@/lib/auth";
import { clearAuthCookies } from "@/lib/cookies";
import { clientIp, clientKey, forbidden, isSameOrigin, rateLimit } from "@/lib/security";
import { protectArcjet } from "@/lib/arcjet";

const schema = z.object({ confirm: z.literal("RESET") });
const unauthorized = () => NextResponse.json({ error: "Belum login" }, { status: 401 });

/**
 * Reset data keuangan. Akun (email/password/preferensi) sengaja dipertahankan.
 * Semua sesi dicabut dan tokenVersion dinaikkan sehingga pengguna diminta
 * masuk lagi sebelum mengisi buku kas yang sudah kosong.
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return forbidden();

  const viewer = await getViewer(req);
  if (!viewer) return unauthorized();

  const guard = await protectArcjet(req, "write");
  if (guard.denied) {
    return NextResponse.json(
      { error: guard.error },
      { status: guard.status, headers: guard.retryAfter ? { "Retry-After": String(guard.retryAfter) } : undefined },
    );
  }

  const scoped = rateLimit(`reset:${clientIp(req) ?? "unknown"}`, 3, 60 * 60_000);
  if (!scoped.allowed) {
    return NextResponse.json(
      { error: `Terlalu banyak permintaan reset. Coba lagi ${scoped.retryAfter} detik.` },
      { status: 429, headers: { "Retry-After": String(scoped.retryAfter) } },
    );
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Konfirmasi harus berisi RESET dengan huruf kapital" }, { status: 400 });
  }

  const now = new Date();
  const deleted = await db.$transaction(async (tx) => {
    const budgets = await tx.budget.deleteMany({ where: { userId: viewer.uid } });
    const transactions = await tx.transaction.deleteMany({ where: { userId: viewer.uid } });
    const wallets = await tx.wallet.deleteMany({ where: { userId: viewer.uid } });
    const categories = await tx.category.deleteMany({ where: { userId: viewer.uid } });
    const sessions = await tx.session.deleteMany({ where: { userId: viewer.uid } });
    await tx.user.update({ where: { id: viewer.uid }, data: { tokenVersion: { increment: 1 } } });
    await tx.auditLog.create({
      data: {
        action: "DATA_RESET",
        userId: viewer.uid,
        entity: "User",
        entityId: viewer.uid,
        ip: clientKey(req, "audit").slice(0, 191),
        createdAt: now,
      },
    });
    return {
      transactions: transactions.count,
      wallets: wallets.count,
      categories: categories.count,
      budgets: budgets.count,
      sessions: sessions.count,
    };
  });

  const res = NextResponse.json({
    ok: true,
    deleted,
    message: "Semua data keuangan dihapus. Akun kamu tetap bisa dipakai.",
  });
  clearAuthCookies(res);
  return res;
}
