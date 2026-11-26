import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/auth";
import { protectArcjet } from "@/lib/arcjet";
import { db } from "@/lib/db";

const unauthorized = () => NextResponse.json({ error: "Belum login" }, { status: 401 });

export async function GET(req: NextRequest) {
  const viewer = await getViewer(req);
  if (!viewer) return unauthorized();

  // GET bersifat read-only dan datanya selalu difilter userId dari token.
  const guard = await protectArcjet(req, "write");
  if (guard.denied) {
    return NextResponse.json(
      { error: guard.error },
      { status: guard.status, headers: guard.retryAfter ? { "Retry-After": String(guard.retryAfter) } : undefined },
    );
  }

  const params = req.nextUrl.searchParams;
  const requested = Number(params.get("limit") ?? 25);
  const limit = Number.isFinite(requested) ? Math.min(100, Math.max(1, Math.trunc(requested))) : 25;
  const rawCursor = Number(params.get("cursor") ?? 0);
  const cursor = Number.isSafeInteger(rawCursor) && rawCursor > 0 ? rawCursor : null;
  const action = params.get("action")?.trim().slice(0, 60) || null;

  const rows = await db.auditLog.findMany({
    where: {
      userId: viewer.uid,
      ...(action ? { action } : {}),
      ...(cursor ? { id: { lt: cursor } } : {}),
    },
    orderBy: { id: "desc" },
    take: limit + 1,
    select: { id: true, action: true, entity: true, entityId: true, ip: true, createdAt: true },
  });

  const items = rows.slice(0, limit);
  return NextResponse.json({
    items,
    nextCursor: rows.length > limit ? String(items[items.length - 1].id) : null,
  });
}
