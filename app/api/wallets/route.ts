import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { forbidden, isSameOrigin } from "@/lib/security";
import { protectArcjet } from "@/lib/arcjet";
import { audit } from "@/lib/audit";

const schema = z.object({ name: z.string().trim().min(1).max(40), initialBalance: z.number().int().min(0).max(2_000_000_000).optional() });

export async function GET(req: NextRequest) {
  const uid = await getUserId(req);
  if (!uid) return NextResponse.json({ error: "Belum login" }, { status: 401 });
  const [wallets, income, expense] = await Promise.all([
    db.wallet.findMany({ where: { userId: uid }, orderBy: { id: "asc" } }),
    db.transaction.groupBy({
      by: ["walletId"],
      where: { userId: uid, type: "INCOME", walletId: { not: null } },
      _sum: { amount: true },
    }),
    db.transaction.groupBy({
      by: ["walletId"],
      where: { userId: uid, type: "EXPENSE", walletId: { not: null } },
      _sum: { amount: true },
    }),
  ]);
  const incomeByWallet = new Map(income.map((r) => [r.walletId, r._sum.amount ?? 0]));
  const expenseByWallet = new Map(expense.map((r) => [r.walletId, r._sum.amount ?? 0]));
  return NextResponse.json({
    items: wallets.map((w) => ({
      ...w,
      balance: w.initialBalance + (incomeByWallet.get(w.id) ?? 0) - (expenseByWallet.get(w.id) ?? 0),
    })),
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

  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Nama dompet tidak valid" }, { status: 400 });
  try {
    const item = await db.wallet.create({ data: { userId: uid, name: p.data.name, initialBalance: p.data.initialBalance ?? 0 } });
    void audit({ action: "WALLET_CREATE", userId: uid, entity: "Wallet", entityId: item.id, req });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Dompet dengan nama tersebut sudah ada" }, { status: 409 });
    }
    console.error("Gagal membuat dompet:", error);
    return NextResponse.json({ error: "Gagal menyimpan dompet" }, { status: 500 });
  }
}
