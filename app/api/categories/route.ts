import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { forbidden, isSameOrigin } from "@/lib/security";
import { protectArcjet } from "@/lib/arcjet";
import { audit } from "@/lib/audit";

const schema = z.object({ name: z.string().trim().min(1).max(40), type: z.enum(["INCOME", "EXPENSE"]) });

export async function GET(req: NextRequest) {
  const uid = await getUserId(req);
  if (!uid) return NextResponse.json({ error: "Belum login" }, { status: 401 });
  return NextResponse.json({ items: await db.category.findMany({ where: { userId: uid }, orderBy: { name: "asc" } }) });
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

  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Data kategori tidak valid" }, { status: 400 });
  try {
    const item = await db.category.create({ data: { userId: uid, name: p.data.name, type: p.data.type } });
    void audit({ action: "CATEGORY_CREATE", userId: uid, entity: "Category", entityId: item.id, req });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Kategori tersebut sudah ada" }, { status: 409 });
    }
    console.error("Gagal membuat kategori:", error);
    return NextResponse.json({ error: "Gagal menyimpan kategori" }, { status: 500 });
  }
}
