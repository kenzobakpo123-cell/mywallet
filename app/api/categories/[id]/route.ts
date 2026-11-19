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
  type: z.enum(["INCOME", "EXPENSE"]).optional(),
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
    return { error: NextResponse.json({ error: "ID kategori tidak valid" }, { status: 400 }) };
  }
  return { uid, id };
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const t = await target(req, ctx);
  if ("error" in t) return t.error;

  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success || (!p.data.name && !p.data.type)) {
    return NextResponse.json({ error: "Data kategori tidak valid" }, { status: 400 });
  }
  try {
    const r = await db.category.updateMany({ where: { id: t.id, userId: t.uid }, data: p.data });
    if (r.count) void audit({ action: "CATEGORY_UPDATE", userId: t.uid, entity: "Category", entityId: t.id, req });
    return r.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Kategori tersebut sudah ada" }, { status: 409 });
    }
    console.error("Gagal memperbarui kategori:", error);
    return NextResponse.json({ error: "Gagal memperbarui kategori" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const t = await target(req, ctx);
  if ("error" in t) return t.error;

  // Anggaran terkait ikut terhapus (onDelete: Cascade). Transaksi lama tetap
  // menyimpan teks kategori sehingga riwayat tidak berubah.
  const r = await db.category.deleteMany({ where: { id: t.id, userId: t.uid } });
  if (r.count) void audit({ action: "CATEGORY_DELETE", userId: t.uid, entity: "Category", entityId: t.id, req });
  return r.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });
}
