// Copies .sql migration files from src/db/migrations into
// dist/db/migrations so the compiled runner can find them at
// runtime. Kept in plain node-compatible ESM so it runs without
// any build step.

import { readdirSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const srcDir = join(repoRoot, "src", "db", "migrations");
const destDir = join(repoRoot, "dist", "db", "migrations");

if (!existsSync(srcDir)) {
  console.error(`[copy-migrations] source directory missing: ${srcDir}`);
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });

let copied = 0;
for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".sql")) continue;
  copyFileSync(join(srcDir, entry.name), join(destDir, entry.name));
  copied += 1;
}

console.log(`[copy-migrations] copied ${copied} file(s) to ${destDir}`);
