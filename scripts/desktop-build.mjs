import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Builds the static export that Tauri bundles into the desktop app, then
// computes exact SHA-256 CSP hashes for all Next.js inline hydration scripts
// in out/**/*.html and writes them into src-tauri/tauri.conf.json so script-src
// never needs 'unsafe-inline'.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");

if (!existsSync(nextBin)) {
  console.error("Next.js binary not found. Run `pnpm install` first.");
  process.exit(1);
}

const result = spawnSync(process.execPath, [nextBin, "build"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, TAURI_BUILD: "1" },
});

if ((result.status ?? 1) !== 0) {
  process.exit(result.status ?? 1);
}

function collectHtmlFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectHtmlFiles(full, acc);
    } else if (entry.endsWith(".html")) {
      acc.push(full);
    }
  }
  return acc;
}

const outDir = join(root, "out");
const htmlFiles = collectHtmlFiles(outDir);
const scriptHashes = new Set();
const scriptTagRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

for (const file of htmlFiles) {
  const html = readFileSync(file, "utf8");
  let match;
  while ((match = scriptTagRe.exec(html)) !== null) {
    const attrs = match[1] || "";
    const body = match[2] || "";
    if (/\bsrc\s*=/i.test(attrs) || !body) continue;
    const digest = createHash("sha256").update(body, "utf8").digest("base64");
    scriptHashes.add(`'sha256-${digest}'`);
  }
}

const tauriConfPath = join(root, "src-tauri", "tauri.conf.json");
if (existsSync(tauriConfPath) && scriptHashes.size > 0) {
  const conf = JSON.parse(readFileSync(tauriConfPath, "utf8"));
  const hashList = [...scriptHashes].sort().join(" ");
  conf.app.security.csp = [
    "default-src 'self'",
    `script-src 'self' ${hashList}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.supabase.co",
    "media-src 'self' data: blob: https://*.supabase.co",
    "font-src 'self' data:",
    "connect-src 'self' ipc: http://ipc.localhost https: wss://*.supabase.co",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  writeFileSync(tauriConfPath, `${JSON.stringify(conf, null, 2)}\n`, "utf8");
  console.log(`Updated tauri.conf.json CSP with ${scriptHashes.size} SHA-256 inline script hashes (no 'unsafe-inline' in script-src).`);
}
