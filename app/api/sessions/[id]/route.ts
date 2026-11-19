import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getViewer } from "@/lib/auth";
import { forbidden, isSameOrigin } from "@/lib/security";
import { protectArcjet } from "@/lib/arcjet";
import { audit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const viewer = await getViewer(req);
  if (!viewer) return NextResponse.json({ error: "Belum login" }, { status: 401 });
  if (!isSameOrigin(req)) return forbidden();

  const guard = await protectArcjet(req, "write");
  if (guard.denied) {
    return NextResponse.json(
      { error: guard.error },
      { status: guard.status, headers: guard.retryAfter ? { "Retry-After": String(guard.retryAfter) } : undefined },
    );
  }

  const id = Number((await ctx.params).id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "ID sesi tidak valid" }, { status: 400 });
  }

  const result = await db.session.updateMany({
    where: { id, userId: viewer.uid, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (!result.count) return NextResponse.json({ error: "Sesi tidak ditemukan" }, { status: 404 });

  void audit({ action: "SESSION_REVOKE", userId: viewer.uid, entity: "Session", entityId: id, req });
  return NextResponse.json({ ok: true, id, current: id === viewer.sid });
}
