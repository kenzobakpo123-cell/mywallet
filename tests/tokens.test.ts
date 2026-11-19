import { describe, expect, it } from "vitest";
import { hashToken, newToken } from "@/lib/tokens";

describe("token", () => {
  it("menghasilkan token acak berbeda", () => {
    expect(newToken()).not.toBe(newToken());
  });

  it("hash bersifat deterministik dan tidak mengembalikan token mentah", () => {
    const token = newToken();
    const hash = hashToken(token);
    expect(hash).toBe(hashToken(token));
    expect(hash).not.toBe(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
