import { describe, expect, it } from "vitest";
import { buildExportWhere, csvCell, toCsv, type ExportRow } from "@/lib/export-data";
import { buildTransactionPdf } from "@/lib/pdf";

const row: ExportRow = {
  id: 12,
  dateKey: "2026-11-26",
  type: "EXPENSE",
  category: "Makanan & Minuman",
  wallet: "Dompet harian",
  amount: 27_500,
  note: 'Beli "kopi", susu',
  currency: "IDR",
};

describe("ekspor CSV", () => {
  it("mengutip sel dan menetralkan rumus spreadsheet", () => {
    expect(csvCell("=SUM(A1:A2)")).toBe('"\'=SUM(A1:A2)"');
    expect(csvCell("＝SUM(A1:A2)")).toBe('"\'＝SUM(A1:A2)"');
    expect(csvCell('Beli "kopi"')).toBe('"Beli ""kopi"""');
    expect(csvCell(12)).toBe('"12"');
  });

  it("menulis header lengkap dan satu baris per transaksi", () => {
    const csv = toCsv([row]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"ID","Tanggal","Tipe","Kategori","Dompet","Jumlah","Mata uang","Catatan"');
    expect(csv).toContain('"12","2026-11-26","Pengeluaran","Makanan & Minuman"');
    expect(csv).toContain('"Beli ""kopi"", susu"');
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});

describe("filter ekspor", () => {
  it("tanpa filter berarti seluruh riwayat", () => {
    const result = buildExportWhere(7, {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.where).toEqual({ userId: 7 });
      expect(result.value.periodLabel).toBe("Seluruh riwayat transaksi");
    }
  });

  it("rentang tanggal menang atas bulan", () => {
    const result = buildExportWhere(7, { month: "2026-01", from: "2026-11-01", to: "2026-11-30" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.where.dateKey).toEqual({ gte: "2026-11-01", lte: "2026-11-30" });
    }
  });

  it("menolak tanggal dan bulan yang tidak valid", () => {
    expect(buildExportWhere(7, { from: "2026-13-01" }).ok).toBe(false);
    expect(buildExportWhere(7, { from: "2026-11-30", to: "2026-11-01" }).ok).toBe(false);
    expect(buildExportWhere(7, { month: "2026-99" }).ok).toBe(false);
  });
});

describe("PDF", () => {
  it("menghasilkan PDF dengan xref yang menunjuk ke tabel", () => {
    const bytes = buildTransactionPdf({
      rows: [row],
      periodLabel: "Seluruh riwayat transaksi",
      generatedAt: "26 Nov 2026, 21.30",
    });
    const raw = Buffer.from(bytes).toString("latin1");

    expect(raw.startsWith("%PDF-1.4")).toBe(true);
    expect(raw).toContain("/Type /Catalog");
    expect(raw).toContain("/Count 1");
    expect(raw).toContain("Riwayat transaksi");
    expect(raw).toContain("Makanan & Minuman");
    expect(raw).toContain("Halaman 1 dari 1");
    expect(raw.trimEnd().endsWith("%%EOF")).toBe(true);

    const startXref = Number(raw.match(/startxref\n(\d+)/)?.[1]);
    expect(raw.slice(startXref, startXref + 4)).toBe("xref");

    const offsets = [...raw.matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
    expect(offsets.length).toBeGreaterThan(4);
    for (const offset of offsets) expect(raw.slice(offset, offset + 3)).toMatch(/^\d+ 0/);

    const streams = [...raw.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)endstream/g)];
    expect(streams.length).toBe(1);
    for (const stream of streams) expect(Buffer.byteLength(stream[2], "latin1")).toBe(Number(stream[1]));
  });

  it("membuat halaman baru untuk riwayat panjang", () => {
    const rows = Array.from({ length: 60 }, (_, index) => ({ ...row, id: index + 1 }));
    const raw = Buffer.from(
      buildTransactionPdf({ rows, periodLabel: "Seluruh riwayat transaksi", generatedAt: "26 Nov 2026" }),
    ).toString("latin1");
    expect(raw).toContain("/Count 2");
    expect(raw).toContain("Halaman 2 dari 2");
  });
});
