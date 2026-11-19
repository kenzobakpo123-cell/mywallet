import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { txSchema } from "@/lib/schemas";
import { forbidden, isSameOrigin } from "@/lib/security";
import { protectArcjet } from "@/lib/arcjet";
import { audit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };
type Target = { uid: number; id: number } | { error: Response };

async function target(req: NextRequest, ctx: Ctx): Promise<Target> {
  const uid = await getUserId(req);
  if (!uid) return { error: NextResponse.json({ error: "Belum login" }, { status: 401 }) };
  if (!isSameOrigin(req)) return { error: forbidden() };

  const guard = await protectArcjet(req, "write");
  if (guard.denied) {
    return {
      error: NextResponse.json(
        { error: guard.error },
        { status: guard.status, headers: guard.retryAfter ? { "Retry-After": String(guard.retryAfter) } : undefined },
      ),
    };
  }

  const id = Number((await ctx.params).id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return { error: NextResponse.json({ error: "ID transaksi tidak valid" }, { status: 400 }) };
  }
  return { uid, id };
}

/** Update penuh: semua field transaksi dikirim ulang dari klien. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const t = await target(req, ctx);
  if ("error" in t) return t.error;

  const p = txSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Data transaksi tidak valid" }, { status: 400 });
  if (p.data.walletId) {
    const wallet = await db.wallet.findFirst({ where: { id: p.data.walletId, userId: t.uid } });
    if (!wallet) return NextResponse.json({ error: "Dompet tidak ditemukan" }, { status: 404 });
  }

  // userId ikut di where: user lain tidak bisa mengubah data milik akun ini.
  const r = await db.transaction.updateMany({
    where: { id: t.id, userId: t.uid },
    data: { ...p.data, dateKey: p.data.date, date: new Date(`${p.data.date}T00:00:00Z`) },
  });
  if (r.count) void audit({ action: "TRANSACTION_UPDATE", userId: t.uid, entity: "Transaction", entityId: t.id, req });
  return r.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const t = await target(req, ctx);
  if ("error" in t) return t.error;

  // userId ikut di where: user lain tidak bisa menghapus data milik akun ini
  const r = await db.transaction.deleteMany({ where: { id: t.id, userId: t.uid } });
  if (r.count) void audit({ action: "TRANSACTION_DELETE", userId: t.uid, entity: "Transaction", entityId: t.id, req });
  return r.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });
}
