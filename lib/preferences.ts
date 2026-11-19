/** Daftar zona waktu & mata uang yang didukung UI. Nilainya memakai identifier standar. */
export const TIMEZONES = [
  { value: "UTC", label: "UTC" },
  { value: "Asia/Jakarta", label: "Jakarta (WIB)" },
  { value: "Asia/Makassar", label: "Makassar (WITA)" },
  { value: "Asia/Jayapura", label: "Jayapura (WIT)" },
  { value: "Asia/Singapore", label: "Singapura" },
  { value: "Asia/Bangkok", label: "Bangkok" },
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "Asia/Shanghai", label: "Shanghai" },
  { value: "Asia/Dubai", label: "Dubai" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Paris", label: "Paris" },
  { value: "America/New_York", label: "New York" },
  { value: "America/Chicago", label: "Chicago" },
  { value: "America/Denver", label: "Denver" },
  { value: "America/Los_Angeles", label: "Los Angeles" },
  { value: "Australia/Sydney", label: "Sydney" },
] as const;

export const CURRENCIES = ["IDR", "USD", "SGD", "EUR", "JPY", "AUD", "GBP", "MYR"] as const;
export type Currency = (typeof CURRENCIES)[number];

export function formatMoney(amount: number, currency = "IDR"): string {
  try {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return new Intl.NumberFormat("id-ID").format(amount);
  }
}

/** Tampilkan tanggal kalender yang sudah disimpan (YYYY-MM-DD) tanpa konversi UTC. */
export function displayDate(dateKey: string): string {
  const [year, month, day] = dateKey.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return dateKey;
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}
