import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Next.js 16 menyediakan konfigurasi flat native; FlatCompat sudah tidak dipakai.
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "node_modules/**", "mobile/**", "next-env.d.ts", "coverage/**"]),
]);
