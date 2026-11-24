// Rasterizes the icon.svg design (rounded rects) into PNG icons for iOS/Android
// home screens. Pure Node (zlib), no dependencies. Run: node scripts/make-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ table[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// SDF rounded rect: negative inside
function roundRectSdf(x, y, cx, cy, w, h, r) {
  const qx = Math.abs(x - cx) - (w / 2 - r);
  const qy = Math.abs(y - cy) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function renderIcon(size) {
  const s = size / 1024; // design space is 1024
  const rgba = Buffer.alloc(size * size * 4);
  const put = (x, y, r, g, b, a) => {
    const i = (y * size + x) * 4;
    const na = a / 255;
    rgba[i] = Math.round(r * na + rgba[i] * (1 - na));
    rgba[i + 1] = Math.round(g * na + rgba[i + 1] * (1 - na));
    rgba[i + 2] = Math.round(b * na + rgba[i + 2] * (1 - na));
    rgba[i + 3] = Math.max(rgba[i + 3], a);
  };

  const lines = [
    [446, 436, 228, 26, 13],
    [446, 500, 228, 26, 13],
    [446, 564, 228, 26, 13],
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x / s, py = y / s;
      // background
      put(x, y, 15, 118, 110, 255);
      if (roundRectSdf(px, py, 464, 466, 356, 428, 70) < 0) put(x, y, 143, 224, 216, 255);
      if (roundRectSdf(px, py, 568, 564, 356, 428, 70) < 0) put(x, y, 255, 255, 255, 255);
      for (const [lx, ly, lw, lh, lr] of lines) {
        if (roundRectSdf(px, py, lx + lw / 2, ly + lh / 2, lw, lh, lr) < 0) put(x, y, 15, 118, 110, 61);
      }
      if (roundRectSdf(px, py, 446 + 56, 628 + 13, 112, 26, 13) < 0) put(x, y, 15, 118, 110, 255);
    }
  }
  return encodePng(size, size, rgba);
}

import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
mkdirSync(outDir, { recursive: true });
for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
  writeFileSync(join(outDir, name), renderIcon(size));
  console.log("wrote", name, size);
}
