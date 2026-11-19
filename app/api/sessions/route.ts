import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getViewer } from "@/lib/auth";
import { forbidden, isSameOrigin } from "@/lib/security";
import { protectArcjet } from "@/lib/arcjet";
import { audit } from "@/lib/audit";

const unauthorized = () => NextResponse.json({ error: "Belum login" }, { status: 401 });

export async function GET(req: NextRequest) {
  const viewer = await getViewer(req);
  if (!viewer) return unauthorized();

  const now = new Date();
  const rows = await db.session.findMany({
    where: { userId: viewer.uid, revokedAt: null, expiresAt: { gt: now } },
    orderBy: [{ lastUsedAt: "desc" }, { id: "desc" }],
    select: { id: true, label: true, ip: true, createdAt: true, lastUsedAt: true, expiresAt: true },
  });
  return NextResponse.json({
    items: rows.map((row) => ({ ...row, current: row.id === viewer.sid })),
    currentId: viewer.sid,
  });
}

/** Cabut semua sesi lain; perangkat yang sedang dipakai tetap aktif. */
export async function DELETE(req: NextRequest) {
  const viewer = await getViewer(req);
  if (!viewer) return unauthorized();
  if (!isSameOrigin(req)) return forbidden();

  const guard = await protectArcjet(req, "write");
  if (guard.denied) {
    return NextResponse.json(
      { error: guard.error },
      { status: guard.status, headers: guard.retryAfter ? { "Retry-After": String(guard.retryAfter) } : undefined },
    );
  }

  const result = await db.session.updateMany({
    where: { userId: viewer.uid, revokedAt: null, ...(viewer.sid ? { id: { not: viewer.sid } } : {}) },
    data: { revokedAt: new Date() },
  });
  if (result.count) {
    void audit({ action: "SESSIONS_REVOKE_OTHERS", userId: viewer.uid, entity: "Session", req });
  }
  return NextResponse.json({ ok: true, revoked: result.count });
}
