// Backup MySQL terenkripsi. Tidak mencetak DATABASE_URL maupun password.
// Pemakaian: DATABASE_URL=... BACKUP_PASSPHRASE=... npm run db:backup:secure
import { execFile } from "node:child_process";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";

const run = promisify(execFile);
const VERSION = "v1";

function required(name, value) {
  if (!value) throw new Error(`${name} wajib diisi untuk backup.`);
  return value;
}

const rawUrl = required("DATABASE_URL", process.env.DATABASE_URL);
const passphrase = required("BACKUP_PASSPHRASE", process.env.BACKUP_PASSPHRASE);
if (passphrase.length < 16) throw new Error("BACKUP_PASSPHRASE minimal 16 karakter.");

const url = new URL(rawUrl);
if (url.protocol !== "mysql:") throw new Error("DATABASE_URL harus memakai skema mysql://.");

const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
required("nama database", database);

const user = decodeURIComponent(url.username);
const password = decodeURIComponent(url.password);
required("user database", user);

const args = [
  `--host=${url.hostname}`,
  `--port=${url.port || "3306"}`,
  `--user=${user}`,
  "--single-transaction",
  "--routines",
  "--triggers",
  "--no-tablespaces",
  database,
];

const { stdout } = await run("mysqldump", args, {
  env: { ...process.env, MYSQL_PWD: password },
  encoding: "buffer",
  maxBuffer: 512 * 1024 * 1024,
});

const key = createHash("sha256").update(`finwise-backup:${VERSION}:`).update(passphrase).digest();
const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", key, iv);
const encrypted = Buffer.concat([cipher.update(gzipSync(stdout)), cipher.final()]);
const header = Buffer.from(`${VERSION}.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}\n`);

mkdirSync("backups", { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const target = path.join("backups", `finwise-${stamp}.sql.gz.enc`);
writeFileSync(target, Buffer.concat([header, encrypted]), { mode: 0o600 });

console.log(`Backup terenkripsi tersimpan di ${target}`);
