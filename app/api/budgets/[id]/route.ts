import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { forbidden, isSameOrigin } from "@/lib/security";
import { protectArcjet } from "@/lib/arcjet";
import { audit } from "@/lib/audit";

const schema = z.object({ limit: z.number().int().positive().max(2_000_000_000) });

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
    return { error: NextResponse.json({ error: "ID anggaran tidak valid" }, { status: 400 }) };
  }
  return { uid, id };
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const t = await target(req, ctx);
  if ("error" in t) return t.error;

  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Batas anggaran tidak valid" }, { status: 400 });

  const r = await db.budget.updateMany({ where: { id: t.id, userId: t.uid }, data: { limit: p.data.limit } });
  if (r.count) void audit({ action: "BUDGET_UPDATE", userId: t.uid, entity: "Budget", entityId: t.id, req });
  return r.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const t = await target(req, ctx);
  if ("error" in t) return t.error;

  const r = await db.budget.deleteMany({ where: { id: t.id, userId: t.uid } });
  if (r.count) void audit({ action: "BUDGET_DELETE", userId: t.uid, entity: "Budget", entityId: t.id, req });
  return r.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });
}
