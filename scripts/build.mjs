// Builds the Candex static site.
// 1. Checks every top-level JavaScript file for syntax errors.
// 2. Copies the site files into dist/, ready for any static host.
// Run with --check-only to do step 1 without copying.

import { execFileSync } from "node:child_process";
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const checkOnly = process.argv.includes("--check-only");

const SITE_EXTENSIONS = new Set([
  ".html", ".css", ".js", ".mjs", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico",
  ".woff", ".woff2", ".txt", ".webmanifest",
]);
const SITE_FOLDERS = ["assets", "images", "img", "fonts", "data"];

const entries = await readdir(root, { withFileTypes: true });
const files = entries
  .filter((e) => e.isFile() && SITE_EXTENSIONS.has(extname(e.name)))
  .map((e) => e.name);

if (!files.includes("index.html")) {
  console.error("Build failed: index.html is missing from the project folder.");
  process.exit(1);
}

let failed = false;
for (const file of files.filter((f) => [".js", ".mjs"].includes(extname(f)))) {
  try {
    execFileSync(process.execPath, ["--check", join(root, file)], { stdio: "pipe" });
    console.log(`✓ ${file}`);
  } catch (err) {
    failed = true;
    console.error(`✗ ${file}\n${err.stderr?.toString() ?? err.message}`);
  }
}
if (failed) {
  console.error("Build failed: fix the JavaScript errors above.");
  process.exit(1);
}
if (checkOnly) {
  console.log("JavaScript check passed.");
  process.exit(0);
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist);
for (const file of files) {
  await cp(join(root, file), join(dist, file));
}
for (const folder of SITE_FOLDERS) {
  const src = join(root, folder);
  const exists = await stat(src).then((s) => s.isDirectory(), () => false);
  if (exists) await cp(src, join(dist, folder), { recursive: true });
}

console.log(`Built ${files.length} files into dist/. Run "npm start" to preview the build.`);
