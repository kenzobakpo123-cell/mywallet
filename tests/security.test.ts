import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { clientIp, isSameOrigin } from "@/lib/security";
import { publicOrigin } from "@/lib/origin";
import { escapeHtml } from "@/lib/html";

const APP = "https://mywallet-virid-eight.vercel.app";
const request = (headers: Record<string, string> = {}) =>
  new NextRequest(`${APP}/api/auth/login`, { method: "POST", headers });

describe("origin publik", () => {
  beforeEach(() => {
    process.env.APP_URL = APP;
  });

  it("tidak pernah mengambil origin dari header Host", () => {
    const req = request({ host: "attacker.tld" });
    expect(publicOrigin()).toBe(APP);
    expect(publicOrigin()).not.toContain(req.headers.get("host") ?? "");
  });

  it("menolak APP_URL http saat production", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.APP_URL = "http://attacker.tld";
    expect(() => publicOrigin()).toThrow();
    vi.unstubAllEnvs();
    process.env.APP_URL = APP;
  });
});

describe("CSRF", () => {
  beforeEach(() => {
    process.env.APP_URL = APP;
  });

  it("menerima Origin web yang sama", () => {
    expect(isSameOrigin(request({ origin: APP, "sec-fetch-site": "same-origin" }))).toBe(true);
  });

  it("menolak Origin asing", () => {
    expect(isSameOrigin(request({ origin: "https://attacker.tld", "sec-fetch-site": "cross-site" }))).toBe(false);
  });

  it("menolak request tanpa Origin yang tidak ditandai same-origin", () => {
    expect(isSameOrigin(request())).toBe(false);
  });

  it("menerima klien native lewat header khusus", () => {
    expect(isSameOrigin(request({ "x-finwise-client": "native" }))).toBe(true);
  });

  it("menerima Bearer tanpa Origin", () => {
    expect(isSameOrigin(request({ authorization: "Bearer abc" }))).toBe(true);
  });
});

describe("IP klien", () => {
  it("memakai header Vercel bila tersedia", () => {
    const req = request({
      "x-vercel-forwarded-for": "203.0.113.9",
      "x-forwarded-for": "1.1.1.1, 2.2.2.2",
    });
    expect(clientIp(req)).toBe("203.0.113.9");
  });

  it("memakai hop terakhir X-Forwarded-For, bukan yang bisa dipalsukan", () => {
    const req = request({ "x-forwarded-for": "1.1.1.1, 203.0.113.7" });
    expect(clientIp(req)).toBe("203.0.113.7");
  });
});

describe("HTML email", () => {
  it("meng-escape karakter berbahaya", () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
  });
});
