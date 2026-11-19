import { describe, expect, it } from "vitest";
import { deviceLabel } from "@/lib/device";

describe("deviceLabel", () => {
  it("mengenali aplikasi HP", () => {
    expect(deviceLabel("okhttp/4.9.0")).toBe("Aplikasi HP");
  });

  it("mengenali browser dan sistem operasi", () => {
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36")).toBe(
      "Chrome di Windows",
    );
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605.1.15")).toBe(
      "Safari di iOS",
    );
  });

  it("membatasi panjang label dan menangani user-agent kosong", () => {
    expect(deviceLabel(null)).toBe("Perangkat tidak dikenal");
    expect(deviceLabel("x".repeat(500)).length).toBeLessThanOrEqual(191);
  });
});
