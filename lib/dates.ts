/** Helper tanggal/bulan bersama supaya semua endpoint memakai aturan yang sama. */

export type MonthRange = { month: string; start: Date; end: Date };

/** Mengubah "YYYY-MM" menjadi rentang UTC. Mengembalikan null jika tidak valid. */
export function parseMonth(value: string | null | undefined): MonthRange | null {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const monthNumber = Number(value.slice(5, 7));
  if (year < 1970 || year > 2100 || monthNumber < 1 || monthNumber > 12) return null;
  return {
    month: value,
    start: new Date(Date.UTC(year, monthNumber - 1, 1)),
    end: new Date(Date.UTC(year, monthNumber, 1)),
  };
}

/** Bulan berjalan ( UTC ), dijamin valid. */
export function currentMonth(): MonthRange {
  return parseMonth(new Date().toISOString().slice(0, 7))!;
}

/** Cek tanggal "YYYY-MM-DD" benar-benar ada (menolak mis. 2026-02-31). */
export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1970 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** Tanggal "hari ini" menurut zona waktu perangkat (bukan UTC). */
export function localDateInputValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Cek nama zona waktu IANA (mis. Asia/Jakarta) dikenal oleh runtime. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

/** Tanggal kalender (YYYY-MM-DD) menurut zona waktu tertentu. */
export function dateKeyInZone(date = new Date(), timeZone = "UTC"): string {
  let formatter = zoneFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    zoneFormatters.set(timeZone, formatter);
  }
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Bulan berjalan menurut zona waktu pengguna. */
export function currentMonthInZone(timeZone = "UTC"): string {
  return dateKeyInZone(new Date(), timeZone).slice(0, 7);
}

/** Bulan berikutnya dari "YYYY-MM", dipakai untuk filter rentang inklusif. */
export function nextMonthKey(month: string): string {
  const year = Number(month.slice(0, 4));
  const number = Number(month.slice(5, 7));
  return number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, "0")}`;
}
