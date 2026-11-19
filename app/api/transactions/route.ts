import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getViewer } from "@/lib/auth";
import { txSchema } from "@/lib/schemas";
import { currentMonthInZone, isValidDateString, nextMonthKey, parseMonth } from "@/lib/dates";
import { forbidden, isSameOrigin } from "@/lib/security";
import { protectArcjet } from "@/lib/arcjet";
import { audit } from "@/lib/audit";

const unauthorized = () => NextResponse.json({ error: "Belum login" }, { status: 401 });

export async function GET(req: NextRequest) {
  const viewer = await getViewer(req);
  if (!viewer) return unauthorized();

  const params = req.nextUrl.searchParams;
  const from = params.get("from");
  const to = params.get("to");
  let dateFilter: { gte: string; lt?: string; lte?: string };

  if (from || to) {
    // Filter rentang tanggal bebas mengambil precedence atas filter bulan.
    if (from && !isValidDateString(from)) return NextResponse.json({ error: "Tanggal awal tidak valid" }, { status: 400 });
    if (to && !isValidDateString(to)) return NextResponse.json({ error: "Tanggal akhir tidak valid" }, { status: 400 });
    dateFilter = to
      ? { gte: from ?? "1970-01-01", lte: to }
      : { gte: from ?? "1970-01-01", lt: "2101-01-01" };
    if (from && to && to < from) return NextResponse.json({ error: "Rentang tanggal tidak valid" }, { status: 400 });
  } else {
    const month = params.get("month") ?? currentMonthInZone(viewer.timezone);
    if (!parseMonth(month)) return NextResponse.json({ error: "Bulan tidak valid" }, { status: 400 });
    dateFilter = { gte: `${month}-01`, lt: nextMonthKey(month) };
  }

  const limitParam = Number(params.get("limit") ?? 200);
  const offsetParam = Number(params.get("offset") ?? 0);
  const limit = Number.isFinite(limitParam) ? Math.min(200, Math.max(1, Math.floor(limitParam))) : 200;
  const offset = Number.isFinite(offsetParam) ? Math.min(100_000, Math.max(0, Math.floor(offsetParam))) : 0;

  const q = params.get("q")?.trim().slice(0, 100) || undefined;
  const category = params.get("category")?.trim().slice(0, 40) || undefined;
  const where = {
    userId: viewer.uid,
    dateKey: dateFilter,
    ...(category ? { category } : {}),
    ...(q ? { OR: [{ category: { contains: q } }, { note: { contains: q } }] } : {}),
  };
  const [items, total] = await Promise.all([
    db.transaction.findMany({ where, orderBy: [{ dateKey: "desc" }, { id: "desc" }], take: limit, skip: offset }),
    db.transaction.count({ where }),
  ]);
  return NextResponse.json({ items, total, limit, offset, hasMore: offset + items.length < total });
}

export async function POST(req: NextRequest) {
  const viewer = await getViewer(req);
  if (!viewer) return unauthorized();
  const uid = viewer.uid;
  if (!isSameOrigin(req)) return forbidden();

  const guard = await protectArcjet(req, "write");
  if (guard.denied) {
    return NextResponse.json(
      { error: guard.error },
      { status: guard.status, headers: guard.retryAfter ? { "Retry-After": String(guard.retryAfter) } : undefined },
    );
  }

  const p = txSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Data transaksi tidak valid" }, { status: 400 });
  if (p.data.walletId) {
    const wallet = await db.wallet.findFirst({ where: { id: p.data.walletId, userId: uid } });
    if (!wallet) return NextResponse.json({ error: "Dompet tidak ditemukan" }, { status: 404 });
  }
  const item = await db.transaction.create({
    data: { ...p.data, dateKey: p.data.date, date: new Date(`${p.data.date}T00:00:00Z`), userId: uid },
  });
  void audit({ action: "TRANSACTION_CREATE", userId: uid, entity: "Transaction", entityId: item.id, req });
  return NextResponse.json({ item }, { status: 201 });
}
