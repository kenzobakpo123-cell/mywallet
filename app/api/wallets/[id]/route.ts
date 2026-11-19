import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { forbidden, isSameOrigin } from "@/lib/security";
import { protectArcjet } from "@/lib/arcjet";
import { audit } from "@/lib/audit";

const schema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  initialBalance: z.number().int().min(0).max(2_000_000_000).optional(),
});

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
    return { error: NextResponse.json({ error: "ID dompet tidak valid" }, { status: 400 }) };
  }
  return { uid, id };
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const t = await target(req, ctx);
  if ("error" in t) return t.error;

  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success || (!p.data.name && p.data.initialBalance === undefined)) {
    return NextResponse.json({ error: "Data dompet tidak valid" }, { status: 400 });
  }
  try {
    const r = await db.wallet.updateMany({ where: { id: t.id, userId: t.uid }, data: p.data });
    if (r.count) void audit({ action: "WALLET_UPDATE", userId: t.uid, entity: "Wallet", entityId: t.id, req });
    return r.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Dompet dengan nama tersebut sudah ada" }, { status: 409 });
    }
    console.error("Gagal memperbarui dompet:", error);
    return NextResponse.json({ error: "Gagal memperbarui dompet" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const t = await target(req, ctx);
  if ("error" in t) return t.error;

  // Transaksi yang memakai dompet ini akan kehilangan referensi (walletId -> NULL).
  const r = await db.wallet.deleteMany({ where: { id: t.id, userId: t.uid } });
  if (r.count) void audit({ action: "WALLET_DELETE", userId: t.uid, entity: "Wallet", entityId: t.id, req });
  return r.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });
}
