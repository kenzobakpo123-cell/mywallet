import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getViewer } from "@/lib/auth";
import { isValidTimeZone } from "@/lib/dates";
import { CURRENCIES } from "@/lib/preferences";
import { protectArcjet } from "@/lib/arcjet";
import { audit } from "@/lib/audit";
import { forbidden, isSameOrigin } from "@/lib/security";

const schema = z.object({
  name: z.string().trim().min(2).max(60),
  timezone: z.string().trim().min(1).max(64).refine(isValidTimeZone, { message: "Zona waktu tidak dikenal" }),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .length(3)
    .refine((value) => (CURRENCIES as readonly string[]).includes(value), { message: "Mata uang tidak didukung" }),
});

const unauthorized = () => NextResponse.json({ error: "Belum login" }, { status: 401 });

export async function GET(req: NextRequest) {
  const viewer = await getViewer(req);
  if (!viewer) return unauthorized();

  // Endpoint hanya membaca data milik viewer; CSRF tidak relevan untuk GET.
  const [user, recoveryCodesRemaining] = await Promise.all([
    db.user.findUnique({ where: { id: viewer.uid }, select: { twoFactorEnabled: true } }),
    db.twoFactorRecovery.count({ where: { userId: viewer.uid, usedAt: null } }),
  ]);
  return NextResponse.json({
    profile: {
      name: viewer.name,
      email: viewer.email,
      timezone: viewer.timezone,
      currency: viewer.currency,
    },
    security: {
      twoFactorEnabled: user?.twoFactorEnabled ?? false,
      recoveryCodesRemaining,
    },
  });
}

export async function PATCH(req: NextRequest) {
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

  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success) {
    return NextResponse.json({ error: p.error.issues[0]?.message ?? "Profil tidak valid" }, { status: 400 });
  }

  await db.user.update({
    where: { id: viewer.uid },
    data: { name: p.data.name, timezone: p.data.timezone, currency: p.data.currency },
  });
  void audit({ action: "PROFILE_UPDATE", userId: viewer.uid, entity: "User", entityId: viewer.uid, req });
  return NextResponse.json({
    ok: true,
    profile: { ...p.data, email: viewer.email },
  });
}
