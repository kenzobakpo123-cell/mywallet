import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getViewer } from "@/lib/auth";
import { buildExportWhere, toCsv, type ExportRow } from "@/lib/export-data";
import { buildTransactionPdf } from "@/lib/pdf";

/** Batas aman untuk PDF/CSV sekali unduh. */
const MAX_ROWS = 20_000;

const downloadHeaders = (filename: string, contentType: string): HeadersInit => ({
  "Content-Type": contentType,
  "Content-Disposition": `attachment; filename="${filename}"`,
  "Cache-Control": "no-store, max-age=0",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
});

export async function GET(req: NextRequest) {
  const viewer = await getViewer(req);
  if (!viewer) return NextResponse.json({ error: "Belum login" }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const format = (params.get("format") ?? "csv").toLowerCase();
  if (format !== "csv" && format !== "pdf") {
    return NextResponse.json({ error: "Format harus csv atau pdf" }, { status: 400 });
  }

  const built = buildExportWhere(viewer.uid, {
    month: params.get("month"),
    from: params.get("from"),
    to: params.get("to"),
    q: params.get("q"),
    category: params.get("category"),
  });
  if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 });

  const found = await db.transaction.findMany({
    where: built.value.where,
    orderBy: [{ dateKey: "desc" }, { id: "desc" }],
    take: MAX_ROWS,
    select: {
      id: true,
      dateKey: true,
      type: true,
      category: true,
      note: true,
      amount: true,
      wallet: { select: { name: true } },
    },
  });

  if (found.length === MAX_ROWS) {
    const total = await db.transaction.count({ where: built.value.where });
    if (total > MAX_ROWS) {
      return NextResponse.json(
        {
          error: `Riwayat terlalu besar untuk satu berkas (${total.toLocaleString("id-ID")} transaksi). Persempit rentang tanggal lalu unduh per periode.`,
        },
        { status: 413 },
      );
    }
  }

  const rows: ExportRow[] = found.map((row) => ({
    id: row.id,
    dateKey: row.dateKey,
    type: row.type,
    category: row.category,
    wallet: row.wallet?.name ?? null,
    amount: row.amount,
    note: row.note,
    currency: viewer.currency,
  }));

  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "csv") {
    return new NextResponse(toCsv(rows), {
      headers: downloadHeaders(`riwayat-transaksi-${stamp}.csv`, "text/csv; charset=utf-8"),
    });
  }

  const generatedAt = new Date()
    .toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    })
    .replace(/\./g, ":");

  const pdf = buildTransactionPdf({ rows, periodLabel: built.value.periodLabel, generatedAt });
  const body = new Uint8Array(pdf).buffer as ArrayBuffer;
  return new NextResponse(body, {
    headers: downloadHeaders(`riwayat-transaksi-${stamp}.pdf`, "application/pdf"),
  });
}
