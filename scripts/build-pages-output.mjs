import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const outDir = path.join(rootDir, "dist");

const rootFileNames = new Set([
  "_redirects",
  "_routes.json",
  "manifest.webmanifest",
  "sw.js",
  "version.json",
]);

const rootFilePatterns = [/\.html$/i, /^workbox-.*\.js$/i];
const directoryNames = new Set(["assets", "movies"]);
const ignoredNames = new Set([".DS_Store"]);

function shouldIncludeSource(source) {
  const relativePath = path.relative(rootDir, source);

  if (!relativePath || relativePath.startsWith("..")) {
    return true;
  }

  const normalizedRelativePath = relativePath.split(path.sep).join("/");
  const baseName = path.basename(source);

  if (ignoredNames.has(baseName)) {
    return false;
  }

  if (
    normalizedRelativePath.startsWith("assets/sitemaps/") &&
    baseName !== "sitemap.xml"
  ) {
    return false;
  }

  if (normalizedRelativePath.startsWith("movies/") && normalizedRelativePath !== "movies/index.html") {
    return false;
  }

  return true;
}

function shouldCopyRootFile(name) {
  return rootFileNames.has(name) || rootFilePatterns.some((pattern) => pattern.test(name));
}

async function copyEntry(srcPath, destPath) {
  await cp(srcPath, destPath, {
    recursive: true,
    force: true,
    filter(source) {
      return shouldIncludeSource(source);
    },
  });
}

async function build() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const entries = await readdir(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    if (ignoredNames.has(entry.name)) {
      continue;
    }

    const srcPath = path.join(rootDir, entry.name);
    const destPath = path.join(outDir, entry.name);

    if (entry.isFile() && shouldCopyRootFile(entry.name)) {
      await copyEntry(srcPath, destPath);
      continue;
    }

    if (entry.isDirectory() && directoryNames.has(entry.name)) {
      await copyEntry(srcPath, destPath);
    }
  }
}

build().catch((error) => {
  console.error("Failed to build Pages output:", error);
  process.exitCode = 1;
});
