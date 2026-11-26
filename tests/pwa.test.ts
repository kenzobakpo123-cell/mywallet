import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

describe("PWA manifest", () => {
  it("memakai nama pendek dan mode aplikasi mandiri", () => {
    const value = manifest();
    expect(value.short_name).toBe("Finwise");
    expect(value.display).toBe("standalone");
    expect(value.start_url).toBe("/");
    expect(value.scope).toBe("/");
    expect(value.lang).toBe("id");
  });

  it("menyediakan ikon 192, 512, dan maskable", () => {
    const icons = manifest().icons ?? [];
    const sizes = icons.map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(icons.some((icon) => icon.purpose === "maskable")).toBe(true);
    for (const icon of icons) {
      expect(fs.existsSync(path.join(process.cwd(), "public", icon.src.replace(/^\//, "")))).toBe(true);
    }
  });
});

describe("service worker", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");

  it("tidak menyimpan respons API", () => {
    expect(source).toContain('url.pathname.startsWith("/api/")');
    expect(source).toContain("if (url.pathname.startsWith(\"/api/\")) return;");
  });

  it("punya halaman cadangan offline", () => {
    expect(source).toContain("/offline.html");
    expect(fs.existsSync(path.join(process.cwd(), "public", "offline.html"))).toBe(true);
  });
});
