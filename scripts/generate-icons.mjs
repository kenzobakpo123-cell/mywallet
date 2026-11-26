/**
 * Generator ikon PWA tanpa dependency tambahan.
 *
 * Menghasilkan PNG RGBA dengan logo "F" khas Finwise. Dijalankan dengan:
 *   node scripts/generate-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Setiap baris PNG diawali 1 byte filter (0 = None).
  const rowBytes = width * 4;
  const raw = Buffer.alloc(height * (rowBytes + 1));
  for (let y = 0; y < height; y += 1) {
    const source = y * rowBytes;
    const target = y * (rowBytes + 1);
    raw[target] = 0;
    rgba.copy(raw, target + 1, source, source + rowBytes);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const FOREST = [47, 93, 78];
const WHITE = [255, 254, 250];
const GOLD = [210, 178, 106];

function inRoundedSquare(x, y, size, radius) {
  if (x < 0 || y < 0 || x >= size || y >= size) return false;
  if (radius <= 0) return true;
  const nearestX = Math.min(Math.max(x, radius), size - radius);
  const nearestY = Math.min(Math.max(y, radius), size - radius);
  const dx = x - nearestX;
  const dy = y - nearestY;
  return dx * dx + dy * dy <= radius * radius;
}

function inRect(x, y, x1, y1, x2, y2) {
  return x >= x1 && x < x2 && y >= y1 && y < y2;
}

function inCircle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/** Warna pada koordinat internal (sudah 2x untuk antialias). */
function pixelAt(px, py, size, mode) {
  const maskable = mode === "maskable";
  const fullBleed = maskable || mode === "apple";

  if (!inRoundedSquare(px, py, size, fullBleed ? 0 : size * 0.22)) {
    return [0, 0, 0, 0];
  }

  // Ruang aman maskable: logo hanya di 78% tengah, latar tetap penuh.
  const scale = (maskable ? size * 0.78 : size) / 512;
  const offset = maskable ? size * 0.11 : 0;
  const x = (px - offset) / scale;
  const y = (py - offset) / scale;

  const isF =
    inRect(x, y, 150, 130, 202, 382) ||
    inRect(x, y, 150, 130, 356, 182) ||
    inRect(x, y, 150, 238, 318, 290);
  if (isF) return [...WHITE, 255];

  // Titik kecil sebagai aksen, masih di dalam safe zone maskable.
  if (inCircle(x, y, 374, 352, 18)) return [...GOLD, 255];

  return [...FOREST, 255];
}

function render(size, mode) {
  const internal = size * 2;
  const output = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const samples = [
        pixelAt(x * 2 + 0.5, y * 2 + 0.5, internal, mode),
        pixelAt(x * 2 + 1.5, y * 2 + 0.5, internal, mode),
        pixelAt(x * 2 + 0.5, y * 2 + 1.5, internal, mode),
        pixelAt(x * 2 + 1.5, y * 2 + 1.5, internal, mode),
      ];
      const out = (y * size + x) * 4;
      for (let c = 0; c < 4; c += 1) {
        output[out + c] = Math.round(samples.reduce((sum, s) => sum + s[c], 0) / samples.length);
      }
    }
  }

  return encodePng(size, size, output);
}

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
fs.mkdirSync(outDir, { recursive: true });

const icons = [
  ["icon-32.png", 32, "normal"],
  ["icon-192.png", 192, "normal"],
  ["icon-512.png", 512, "normal"],
  ["apple-touch-icon.png", 180, "apple"],
  ["icon-maskable-512.png", 512, "maskable"],
];

for (const [name, size, mode] of icons) {
  fs.writeFileSync(path.join(outDir, name), render(size, mode));
  console.log(`${name} (${size}x${size})`);
}
