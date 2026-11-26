import { isValidDateString, nextMonthKey, parseMonth } from "@/lib/dates";
import { displayDate } from "@/lib/preferences";

/** Baris ekspor sudah berbentuk teks yang dibaca pengguna, bukan mentah DB. */
export type ExportRow = {
  id: number;
  dateKey: string;
  type: "INCOME" | "EXPENSE";
  category: string;
  wallet: string | null;
  amount: number;
  note: string | null;
  currency: string;
};

type DateKeyFilter = { gte: string; lt?: string; lte?: string };
type ContainsFilter = { category: { contains: string } } | { note: { contains: string } };

export type ExportWhere = {
  userId: number;
  dateKey?: DateKeyFilter;
  category?: string;
  OR?: ContainsFilter[];
};

export type ExportParams = {
  month?: string | null;
  from?: string | null;
  to?: string | null;
  q?: string | null;
  category?: string | null;
};

export type BuiltExport = {
  where: ExportWhere;
  periodLabel: string;
};

export type BuildResult = { ok: true; value: BuiltExport } | { ok: false; error: string };

/**
 * Filter ekspor mengikuti aturan yang sama dengan /api/transactions:
 * rentang from/to menang atas bulan, lalu pencarian dan kategori.
 * Tanpa filter apa pun = seluruh riwayat (bukan bulan berjalan).
 */
export function buildExportWhere(userId: number, params: ExportParams): BuildResult {
  const where: ExportWhere = { userId };
  const from = params.from?.trim() || null;
  const to = params.to?.trim() || null;

  if (from || to) {
    if (from && !isValidDateString(from)) return { ok: false, error: "Tanggal awal tidak valid" };
    if (to && !isValidDateString(to)) return { ok: false, error: "Tanggal akhir tidak valid" };
    if (from && to && to < from) return { ok: false, error: "Rentang tanggal tidak valid" };
    where.dateKey = to
      ? { gte: from ?? "1970-01-01", lte: to }
      : { gte: from ?? "1970-01-01", lt: "2101-01-01" };
  } else if (params.month) {
    const month = parseMonth(params.month);
    if (!month) return { ok: false, error: "Bulan tidak valid" };
    where.dateKey = { gte: `${month.month}-01`, lt: nextMonthKey(month.month) };
  }

  const category = params.category?.trim().slice(0, 40) || null;
  const q = params.q?.trim().slice(0, 100) || null;
  if (category) where.category = category;
  if (q) where.OR = [{ category: { contains: q } }, { note: { contains: q } }];

  let periodLabel = "Seluruh riwayat transaksi";
  if (from && to) periodLabel = `${displayDate(from)} — ${displayDate(to)}`;
  else if (from) periodLabel = `Sejak ${displayDate(from)}`;
  else if (to) periodLabel = `Sampai ${displayDate(to)}`;
  else if (params.month) {
    const monthLabel = new Intl.DateTimeFormat("id-ID", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${params.month}-01T00:00:00Z`));
    periodLabel = `Bulan ${monthLabel}`;
  }
  if (category) periodLabel += ` · ${category}`;
  if (q) periodLabel += ` · "${q}"`;

  return { ok: true, value: { where, periodLabel } };
}

/**
 * Semua sel dikutip. Nilai yang bisa dibaca spreadsheet sebagai rumus
 * diawali apostrof supaya catatan pengguna tidak dieksekusi.
 */
export function csvCell(value: string | number): string {
  const raw = String(value);
  // Fullwidth "＝" juga dibaca sebagai rumus oleh beberapa spreadsheet.
  const formula = /^[=+\-@\t\r]/.test(raw.normalize("NFKC"));
  const clean = raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/"/g, '""');
  return `"${formula ? "'" + clean : clean}"`;
}

export function toCsv(rows: readonly ExportRow[]): string {
  const header = ["ID", "Tanggal", "Tipe", "Kategori", "Dompet", "Jumlah", "Mata uang", "Catatan"];
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.dateKey,
        row.type === "INCOME" ? "Pemasukan" : "Pengeluaran",
        row.category,
        row.wallet ?? "-",
        row.amount,
        row.currency,
        row.note ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
