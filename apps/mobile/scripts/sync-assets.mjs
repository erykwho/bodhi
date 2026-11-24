import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(mobileRoot, "../..");

function copyDirRecursive(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyDirRecursive(
  path.join(repoRoot, "public", "audio"),
  path.join(mobileRoot, "assets", "audio")
);

const iconFiles = ["icon-512.png", "icon-maskable-512.png", "favicon.png"];
fs.mkdirSync(path.join(mobileRoot, "assets", "icons"), { recursive: true });
for (const icon of iconFiles) {
  const src = path.join(repoRoot, "public", "icons", icon);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(mobileRoot, "assets", "icons", icon));
  }
}

console.log("[mobile] Synced CC0 audio assets and Bodhi icons from public/");
