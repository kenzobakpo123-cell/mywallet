import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getViewer } from "@/lib/auth";
import { currentMonthInZone, nextMonthKey, parseMonth } from "@/lib/dates";

export async function GET(req: NextRequest) {
  const viewer = await getViewer(req);
  if (!viewer) return NextResponse.json({ error: "Belum login" }, { status: 401 });

  const rawMonth = req.nextUrl.searchParams.get("month");
  const month = rawMonth ?? currentMonthInZone(viewer.timezone);
  if (!parseMonth(month)) return NextResponse.json({ error: "Bulan tidak valid" }, { status: 400 });
  const dateKey = { gte: `${month}-01`, lt: nextMonthKey(month) };

  const [monthly, allTime, wallets, categories] = await Promise.all([
    db.transaction.groupBy({
      by: ["type", "category"],
      where: { userId: viewer.uid, dateKey },
      _sum: { amount: true },
    }),
    db.transaction.groupBy({ by: ["type"], where: { userId: viewer.uid }, _sum: { amount: true } }),
    db.wallet.aggregate({ where: { userId: viewer.uid }, _sum: { initialBalance: true } }),
    db.category.findMany({ where: { userId: viewer.uid }, select: { id: true, name: true } }),
  ]);

  type SumRow = { type: "INCOME" | "EXPENSE"; _sum: { amount: number | null } };
  const sumByType = (rows: readonly SumRow[], type: "INCOME" | "EXPENSE") =>
    rows.filter((r) => r.type === type).reduce((acc, r) => acc + (r._sum.amount ?? 0), 0);

  const income = sumByType(monthly, "INCOME");
  const expense = sumByType(monthly, "EXPENSE");
  const allIncome = sumByType(allTime, "INCOME");
  const allExpense = sumByType(allTime, "EXPENSE");

  // Saldo "saat ini" = saldo awal semua dompet + seluruh pemasukan - pengeluaran.
  const balance = (wallets._sum.initialBalance ?? 0) + allIncome - allExpense;

  const categoryIdByName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const byCategory = monthly
    .filter((r) => r.type === "EXPENSE")
    .map((r) => ({
      category: r.category,
      categoryId: categoryIdByName.get(r.category.trim().toLowerCase()) ?? null,
      total: r._sum.amount ?? 0,
    }))
    .sort((a, b) => b.total - a.total);

  return NextResponse.json({
    month,
    income,
    expense,
    monthNet: income - expense,
    balance,
    byCategory,
  });
}
