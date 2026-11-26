import { formatMoney } from "@/lib/preferences";
import type { ExportRow } from "@/lib/export-data";

/**
 * PDF dibuat langsung tanpa dependency: satu halaman = satu objek konten
 * Helvetica standar. Ini menjaga bundle serverless kecil dan keluaran bisa
 * dibaca pembaca PDF mana pun.
 */

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 42;
const LINE_H = 10.5;
const BODY_TOP = 726;
const BODY_BOTTOM = 60;

type Column = { key: keyof ExportRow | "amount"; label: string; width: number };

const COLUMN_WIDTHS = [66, 58, 104, 88, 82];
const COLUMNS: Column[] = [
  { key: "dateKey", label: "Tanggal", width: COLUMN_WIDTHS[0] },
  { key: "type", label: "Tipe", width: COLUMN_WIDTHS[1] },
  { key: "category", label: "Kategori", width: COLUMN_WIDTHS[2] },
  { key: "wallet", label: "Dompet", width: COLUMN_WIDTHS[3] },
  { key: "amount", label: "Jumlah", width: COLUMN_WIDTHS[4] },
  { key: "note", label: "Catatan", width: PAGE_W - MARGIN * 2 - COLUMN_WIDTHS.reduce((a, b) => a + b, 0) },
];

const REPLACEMENTS: Record<string, string> = {
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "’": "'",
  "‘": "'",
  "“": '"',
  "”": '"',
  "–": "-",
  "—": "-",
  "…": "...",
  "\u00A0": " ",
};

function pdfText(value: string): string {
  let out = "";
  for (const char of value.normalize("NFKC")) {
    const mapped = REPLACEMENTS[char] ?? char;
    const point = mapped.codePointAt(0) ?? 32;
    let safe = mapped;

    if (point === 9 || point === 10 || point === 13) safe = " ";
    else if (point > 255) {
      const base = mapped.normalize("NFD").replace(/\p{M}/gu, "");
      safe = base && [...base].every((part) => (part.codePointAt(0) ?? 0) <= 255) ? base : "?";
    }
    if ((safe.codePointAt(0) ?? 32) < 32) safe = " ";

    out += safe.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  }
  return out;
}

function charWidth(char: string, size: number): number {
  if (/\s/.test(char)) return 0.28 * size;
  if (/[ilItf.,:;'!|]/.test(char)) return 0.26 * size;
  if (/[MW@#%]/.test(char)) return 0.82 * size;
  if (/[A-Z0-9]/.test(char)) return 0.6 * size;
  return 0.53 * size;
}

function textWidth(value: string, size = 8.2): number {
  let width = 0;
  for (const char of value) width += charWidth(char, size);
  return width;
}

function wrap(value: string, maxWidth: number, size = 8.2): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (textWidth(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
      current = "";
    }
    if (textWidth(word, size) <= maxWidth) {
      current = word;
      continue;
    }
    let chunk = "";
    for (const char of word) {
      if (chunk && textWidth(chunk + char, size) > maxWidth) {
        lines.push(chunk);
        chunk = char;
      } else {
        chunk += char;
      }
    }
    current = chunk;
  }
  if (current) lines.push(current);
  return lines;
}

function cellText(column: Column, row: ExportRow): string {
  switch (column.key) {
    case "dateKey":
      return row.dateKey;
    case "type":
      return row.type === "INCOME" ? "Pemasukan" : "Pengeluaran";
    case "category":
      return row.category;
    case "wallet":
      return row.wallet ?? "-";
    case "amount":
      return formatMoney(row.amount, row.currency);
    case "note":
      return row.note ?? "";
    default:
      return "";
  }
}

type LaidRow = {
  index: number;
  top: number;
  bottom: number;
  lines: string[][];
};

function layout(rows: readonly ExportRow[]): LaidRow[][] {
  const pages: LaidRow[][] = [[]];
  let y = BODY_TOP;

  rows.forEach((row, index) => {
    const lines = COLUMNS.map((column) => wrap(cellText(column, row), column.width - 8));
    const rowsNeeded = Math.max(1, ...lines.map((line) => line.length));
    const height = Math.max(16, rowsNeeded * LINE_H + 7);

    if (y - height < BODY_BOTTOM && pages[pages.length - 1].length > 0) {
      pages.push([]);
      y = BODY_TOP;
    }
    pages[pages.length - 1].push({ index, top: y, bottom: y - height, lines });
    y -= height;
  });

  return pages;
}

function text(x: number, y: number, value: string, font: "F1" | "F2", size: number, color: string): string {
  if (!value) return "";
  return `BT ${color} /${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${pdfText(value)}) Tj ET\n`;
}

function line(x1: number, y1: number, x2: number, y2: number): string {
  return `0.84 0.82 0.76 RG 0.6 w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S\n`;
}

function renderPage(
  pageRows: readonly LaidRow[],
  meta: { periodLabel: string; generatedAt: string; totalRows: number; pageNo: number; totalPages: number },
): string {
  let stream = "";
  const right = PAGE_W - MARGIN;

  stream += text(MARGIN, 800, "FINWISE", "F2", 8, "0.157 0.361 0.286 rg");
  stream += text(MARGIN, 776, "Riwayat transaksi", "F2", 18, "0.12 0.16 0.14 rg");
  stream += text(
    MARGIN,
    758,
    `${meta.periodLabel} · ${meta.totalRows} transaksi · diunduh ${meta.generatedAt}`,
    "F1",
    8,
    "0.42 0.47 0.43 rg",
  );
  stream += line(MARGIN, 748, right, 748);

  // Kepala tabel.
  stream += `0.157 0.361 0.286 rg ${MARGIN} 726 ${right - MARGIN} 22 re f\n`;
  let x = MARGIN;
  for (const column of COLUMNS) {
    stream += text(x + 4, 733, column.label, "F2", 8, "1 1 1 rg");
    x += column.width;
  }

  for (const item of pageRows) {
    if (item.index % 2 === 1) {
      stream += `0.98 0.97 0.94 rg ${MARGIN} ${item.bottom.toFixed(2)} ${right - MARGIN} ${(item.top - item.bottom).toFixed(2)} re f\n`;
    }

    let cellX = MARGIN;
    COLUMNS.forEach((column, columnIndex) => {
      const lines = item.lines[columnIndex] ?? [""];
      lines.forEach((value, lineIndex) => {
        const baseline = item.top - 12 - lineIndex * LINE_H;
        if (baseline < item.bottom + 2) return;
        const drawX = column.key === "amount" ? cellX + column.width - textWidth(value) - 4 : cellX + 4;
        stream += text(drawX, baseline, value, "F1", 8.2, "0.12 0.16 0.14 rg");
      });
      cellX += column.width;
    });
    stream += line(MARGIN, item.bottom, right, item.bottom);
  }

  stream += line(MARGIN, 48, right, 48);
  stream += text(MARGIN, 31, "Finwise · buku kas pribadi", "F1", 8, "0.42 0.47 0.43 rg");
  const pageLabel = `Halaman ${meta.pageNo} dari ${meta.totalPages}`;
  stream += text(right - textWidth(pageLabel, 8), 31, pageLabel, "F1", 8, "0.42 0.47 0.43 rg");
  return stream;
}

export type PdfInput = {
  rows: readonly ExportRow[];
  periodLabel: string;
  generatedAt: string;
};

/** Menghasilkan PDF A4 berisi riwayat transaksi lengkap, satu baris per transaksi. */
export function buildTransactionPdf({ rows, periodLabel, generatedAt }: PdfInput): Uint8Array {
  const pages = layout(rows);
  if (pages.length === 0) pages.push([]);

  const objects: string[] = [""];
  const add = (body: string): number => {
    objects.push(body);
    return objects.length - 1;
  };

  const catalogId = add("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = add("<< /Type /Pages >>");
  const regularId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const boldId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

  const pageRefs: { pageId: number; contentId: number }[] = [];

  pages.forEach((pageRows, index) => {
    const pageId = add("<< /Type /Page >>");
    const contentId = add("<< /Length 0 >>\nstream\nendstream");
    pageRefs.push({ pageId, contentId });
    const body = renderPage(pageRows, {
      periodLabel,
      generatedAt,
      totalRows: rows.length,
      pageNo: index + 1,
      totalPages: pages.length,
    });
    objects[contentId] = `<< /Length ${Buffer.byteLength(body, "latin1")} >>\nstream\n${body}endstream`;
  });

  objects[pagesId] = `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref.pageId} 0 R`).join(" ")}] /Count ${pageRefs.length} >>`;
  pageRefs.forEach((ref) => {
    objects[ref.pageId] =
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 ${regularId} 0 R /F2 ${boldId} 0 R >> >> /Contents ${ref.contentId} 0 R >>`;
  });

  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(pdf, "latin1");
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const startXref = Buffer.byteLength(pdf, "latin1");
  const size = objects.length;
  pdf += `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let id = 1; id < size; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${size} /Root ${catalogId} 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}
