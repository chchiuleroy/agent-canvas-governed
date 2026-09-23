#!/usr/bin/env node
/**
 * Copy the governed SDK fork (openhands-sdk-governed) into resources/, so
 * electron-builder can bundle it as an extraResource (see
 * electron-builder.config.mjs: { from: "resources/openhands-sdk-governed/",
 * to: "openhands-sdk-governed/" }).
 *
 * resources/openhands-sdk-governed/ is gitignored — it's a build INPUT, not
 * a source file, so a fresh clone of this repo has no such directory and
 * `npm run build:desktop` would ship an app with no governance layer at all
 * (main.mjs falls back to the packaged Resources path, finds nothing there).
 * This script recreates it before every desktop build.
 *
 * Source location: a sibling checkout of openhands-sdk-governed next to
 * this repo (../openhands-sdk-governed relative to the project root) — the
 * same sibling-directory assumption main.mjs already makes for dev mode
 * (`join(__dirname, "..", "..", "openhands-sdk-governed")`).
 *
 * Copies only `git ls-files` output (i.e. files actually tracked by the
 * source repo) rather than the raw directory tree — a real checkout also
 * has .venv/, .pytest_cache/, .ruff_cache/, __pycache__/, etc. sitting next
 * to the source, none of which belong in a shipped bundle (a first attempt
 * at this script that did a raw recursive copy produced a ~720 MB bundle;
 * .venv/ alone was ~780 MB). Using `git ls-files` means this script doesn't
 * need to hand-maintain a duplicate of the source repo's own .gitignore.
 * `tests/` is additionally dropped even though it's tracked — it isn't
 * needed at runtime (uvx runs the fork's source directly via
 * OH_AGENT_SERVER_LOCAL_PATH) and pulling it out keeps the shipped copy
 * close to the ~6 MB the source actually needs.
 *
 * Usage:
 *   node scripts/prepackage-governed-sdk.mjs
 *   GOVERNED_SDK_PATH=/path/to/openhands-sdk-governed node scripts/prepackage-governed-sdk.mjs
 */

import { mkdir, copyFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const defaultSourceDir = join(projectRoot, "..", "openhands-sdk-governed");
const sourceDir = process.env.GOVERNED_SDK_PATH
  ? join(process.env.GOVERNED_SDK_PATH)
  : defaultSourceDir;
const destDir = join(projectRoot, "resources", "openhands-sdk-governed");

// Dropped even though `git ls-files` returns them tracked — not needed at
// runtime. (.git/, __pycache__/, .venv/, etc. never appear in `git
// ls-files` output in the first place, since they're gitignored.)
const EXCLUDED_DIR_NAMES = new Set(["tests"]);

function listTrackedFiles(repoDir) {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoDir,
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .toString("utf-8")
    .split("\0")
    .filter((p) => p.length > 0);
}

function isExcluded(relPath) {
  const segments = relPath.split(/[/\\]/);
  return segments.some((segment) => EXCLUDED_DIR_NAMES.has(segment));
}

async function dirSizeBytes(paths, baseDir) {
  let total = 0;
  for (const p of paths) {
    try {
      total += (await stat(join(baseDir, p))).size;
    } catch {
      // best-effort
    }
  }
  return total;
}

async function main() {
  if (!existsSync(sourceDir)) {
    throw new Error(
      `Governed SDK source not found at ${sourceDir}. Clone ` +
        `openhands-sdk-governed as a sibling of this repo, or set ` +
        `GOVERNED_SDK_PATH to point at it.`,
    );
  }
  if (!existsSync(join(sourceDir, ".git"))) {
    throw new Error(
      `${sourceDir} is not a git checkout — this script relies on ` +
        `\`git ls-files\` to know which files belong in the bundle.`,
    );
  }

  console.log(`[prepackage-governed-sdk] Source: ${sourceDir}`);
  console.log(`[prepackage-governed-sdk] Dest:   ${destDir}`);

  const tracked = listTrackedFiles(sourceDir);
  const toCopy = tracked.filter((p) => !isExcluded(p));

  // Clear any previous copy so stale files from an older SDK checkout don't
  // linger in the bundle (mirrors download-node.mjs's approach).
  if (existsSync(destDir)) await rm(destDir, { recursive: true, force: true });

  for (const rel of toCopy) {
    const src = join(sourceDir, rel);
    const dest = join(destDir, rel);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(src, dest);
  }

  const mb = (await dirSizeBytes(toCopy, sourceDir)) / (1024 * 1024);
  console.log(
    `[prepackage-governed-sdk] Done: ${toCopy.length} files (of ${tracked.length} tracked, ` +
      `tests/ excluded), ~${mb.toFixed(1)} MB`,
  );
}

main().catch((err) => {
  console.error("[prepackage-governed-sdk] Error:", err.message);
  process.exit(1);
});
