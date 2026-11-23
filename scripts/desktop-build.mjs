import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Builds the static export that Tauri bundles into the desktop app.
// The default `pnpm build` (used by Vercel) stays a normal Next.js server build.
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

process.exit(result.status ?? 1);
