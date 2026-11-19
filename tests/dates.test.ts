import { describe, expect, it } from "vitest";
import {
  dateKeyInZone,
  isValidDateString,
  isValidTimeZone,
  localDateInputValue,
  nextMonthKey,
  parseMonth,
} from "@/lib/dates";

describe("parseMonth", () => {
  it("mengubah YYYY-MM menjadi rentang UTC", () => {
    const range = parseMonth("2026-02");
    expect(range?.start.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(range?.end.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("menolak bulan tidak valid", () => {
    expect(parseMonth("2026-13")).toBeNull();
    expect(parseMonth("2026-2")).toBeNull();
    expect(parseMonth(null)).toBeNull();
  });
});

describe("isValidDateString", () => {
  it("menerima tanggal yang benar termasuk tahun kabisat", () => {
    expect(isValidDateString("2024-02-29")).toBe(true);
  });

  it("menolak tanggal yang tidak ada", () => {
    expect(isValidDateString("2026-02-31")).toBe(false);
    expect(isValidDateString("2026-1-01")).toBe(false);
  });
});

describe("localDateInputValue", () => {
  it("memakai zona waktu lokal, bukan UTC", () => {
    expect(localDateInputValue(new Date(2026, 0, 2, 23, 30))).toBe("2026-01-02");
  });
});

describe("dateKeyInZone", () => {
  const instant = new Date("2026-11-20T01:30:00.000Z");

  it("memakai tanggal kalender sesuai zona waktu", () => {
    expect(dateKeyInZone(instant, "UTC")).toBe("2026-11-20");
    expect(dateKeyInZone(instant, "Asia/Jakarta")).toBe("2026-11-20");
    expect(dateKeyInZone(instant, "America/Los_Angeles")).toBe("2026-11-19");
  });
});

describe("isValidTimeZone", () => {
  it("menerima zona IANA yang valid dan menolak yang salah", () => {
    expect(isValidTimeZone("Asia/Jakarta")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Bumi/Flat")).toBe(false);
  });
});

describe("nextMonthKey", () => {
  it("menangani pergantian tahun", () => {
    expect(nextMonthKey("2026-02")).toBe("2026-03");
    expect(nextMonthKey("2026-12")).toBe("2027-01");
  });
});
