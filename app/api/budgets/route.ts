import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getUserId, getViewer } from "@/lib/auth";
import { currentMonthInZone, parseMonth } from "@/lib/dates";
import { forbidden, isSameOrigin } from "@/lib/security";
import { protectArcjet } from "@/lib/arcjet";
import { audit } from "@/lib/audit";

const budgetSchema = z.object({
  categoryId: z.number().int().positive(),
  month: z.string(),
  limit: z.number().int().positive().max(2_000_000_000),
});

export async function GET(req: NextRequest) {
  const viewer = await getViewer(req);
  if (!viewer) return NextResponse.json({ error: "Belum login" }, { status: 401 });
  const rawMonth = req.nextUrl.searchParams.get("month");
  const month = rawMonth ?? currentMonthInZone(viewer.timezone);
  if (!parseMonth(month)) return NextResponse.json({ error: "Bulan tidak valid" }, { status: 400 });
  return NextResponse.json({
    items: await db.budget.findMany({
      where: { userId: viewer.uid, month },
      select: { id: true, categoryId: true, month: true, limit: true, category: { select: { id: true, name: true, type: true } } },
      orderBy: { category: { name: "asc" } },
    }),
  });
}

export async function POST(req: NextRequest) {
  const uid = await getUserId(req);
  if (!uid) return NextResponse.json({ error: "Belum login" }, { status: 401 });
  if (!isSameOrigin(req)) return forbidden();

  const guard = await protectArcjet(req, "write");
  if (guard.denied) {
    return NextResponse.json(
      { error: guard.error },
      { status: guard.status, headers: guard.retryAfter ? { "Retry-After": String(guard.retryAfter) } : undefined },
    );
  }

  const p = budgetSchema.safeParse(await req.json().catch(() => null));
  if (!p.success || !parseMonth(p.data.month)) {
    return NextResponse.json({ error: "Data anggaran tidak valid" }, { status: 400 });
  }
  const category = await db.category.findFirst({ where: { id: p.data.categoryId, userId: uid, type: "EXPENSE" } });
  if (!category) return NextResponse.json({ error: "Kategori tidak ditemukan" }, { status: 404 });

  const item = await db.budget.upsert({
    where: { userId_categoryId_month: { userId: uid, categoryId: p.data.categoryId, month: p.data.month } },
    update: { limit: p.data.limit },
    create: { userId: uid, categoryId: p.data.categoryId, month: p.data.month, limit: p.data.limit },
  });
  void audit({ action: "BUDGET_SET", userId: uid, entity: "Budget", entityId: item.id, req });
  return NextResponse.json({ item });
}
