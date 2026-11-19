import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getViewer } from "@/lib/auth";
import { clearAuthCookies } from "@/lib/cookies";
import { audit } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const viewer = await getViewer(req);
  const body = await req.json().catch(() => ({}));
  const all = body && typeof body === "object" && body.all === true;

  if (viewer) {
    void audit({ action: all ? "LOGOUT_ALL" : "LOGOUT", userId: viewer.uid, entity: "User", entityId: viewer.uid, req });
    try {
      if (all) {
        // "Keluar dari semua perangkat": cabut seluruh sesi dan token lama.
        await db.session.updateMany({
          where: { userId: viewer.uid, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await db.user.update({ where: { id: viewer.uid }, data: { tokenVersion: { increment: 1 } } });
      } else if (viewer.sid) {
        // Default: hanya perangkat yang sedang dipakai.
        await db.session.updateMany({
          where: { id: viewer.sid, userId: viewer.uid, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      } else {
        // Token lama tanpa sid tidak bisa ditarget -> cabut semuanya.
        await db.user.update({ where: { id: viewer.uid }, data: { tokenVersion: { increment: 1 } } });
      }
    } catch (error) {
      console.error("Gagal mencabut sesi:", error);
    }
  }
  const res = NextResponse.json({ ok: true, all });
  clearAuthCookies(res);
  return res;
}
