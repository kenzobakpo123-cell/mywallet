import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getViewer } from "@/lib/auth";
import { currentMonthInZone, nextMonthKey, parseMonth } from "@/lib/dates";

const MAX_ROWS = 10_000;

// Awali dengan apostrof untuk nilai yang bisa dibaca Excel/LibreOffice sebagai
// rumus (=, +, -, @, tab, CR) -> mencegah CSV formula injection.
const csvCell = (value: string | number) => {
  const text = String(value).replace(/"/g, '""');
  return `"${/^[=+\-@\t\r]/.test(text) ? "'" + text : text}"`;
};

export async function GET(req: NextRequest) {
  const viewer = await getViewer(req);
  if (!viewer) return NextResponse.json({ error: "Belum login" }, { status: 401 });

  const rawMonth = req.nextUrl.searchParams.get("month");
  const month = rawMonth ?? currentMonthInZone(viewer.timezone);
  if (!parseMonth(month)) return NextResponse.json({ error: "Bulan tidak valid" }, { status: 400 });

  const rows = await db.transaction.findMany({
    where: { userId: viewer.uid, dateKey: { gte: `${month}-01`, lt: nextMonthKey(month) } },
    orderBy: [{ dateKey: "desc" }, { id: "desc" }],
    take: MAX_ROWS,
  });
  const lines = [
    ["Tanggal", "Tipe", "Kategori", "Jumlah", "Catatan"].map(csvCell).join(","),
    ...rows.map((row) =>
      [row.dateKey, row.type === "INCOME" ? "Pemasukan" : "Pengeluaran", row.category, row.amount, row.note ?? ""]
        .map(csvCell)
        .join(",")
    ),
  ];
  return new NextResponse("\uFEFF" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="transaksi-${month}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
