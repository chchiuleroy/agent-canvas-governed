#!/usr/bin/env node
/**
 * Copy central-governance-api into resources/, so electron-builder can
 * bundle it as an extraResource (see electron-builder.config.mjs:
 * { from: "resources/central-governance-api/", to: "central-governance-api/" }).
 *
 * resources/central-governance-api/ is gitignored — it's a build INPUT, not
 * a source file, so a fresh clone of this repo has no such directory and
 * `npm run build:desktop` would ship an app with no central governance
 * service at all (main.mjs falls back to the packaged Resources path, finds
 * nothing there). This script recreates it before every desktop build.
 *
 * Source location: a sibling checkout of central-governance-api next to
 * this repo (../central-governance-api relative to the project root) — the
 * same sibling-directory assumption main.mjs already makes for the governed
 * SDK in dev mode, and the same one this script's own dev-mode fallback
 * path in main.mjs uses for central-governance-api.
 *
 * Copies `git ls-files` output filtered down to an ALLOWLIST of top-level
 * paths actually needed at runtime (pyproject.toml/uv.lock/.python-version
 * for `uv run` to resolve the environment, alembic.ini/alembic/ for
 * migrations, src/ for the app itself) — not "everything tracked minus a
 * denylist" the way prepackage-governed-sdk.mjs works for the SDK fork.
 * central-governance-api's own .gitignore (.env, /ops/, .venv/, __pycache__/,
 * .pytest_cache/, .ruff_cache/) already keeps real secrets out of `git
 * ls-files`, but a "tracked = shippable" denylist approach still let
 * `docs/track1-delegated-identity-v1.md` / `docs/track2-slack-design-v1.md`
 * (unimplemented security-architecture detail), `.recall/context.md`
 * (local paths + in-progress work state), README.md and .env.example ride
 * along into the installer (code-review finding, 2026-09-24) — none of
 * those are secrets, but they're not meant to be redistributed either, and
 * "tracked" and "safe to publish" are different questions. The allowlist
 * makes that an explicit, reviewable decision instead of an accident of
 * whatever the source repo happens to track next.
 *
 * Usage:
 *   node scripts/prepackage-central-governance-api.mjs
 *   CENTRAL_GOVERNANCE_API_PATH=/path/to/central-governance-api node scripts/prepackage-central-governance-api.mjs
 */

import { mkdir, copyFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const defaultSourceDir = join(projectRoot, "..", "central-governance-api");
const sourceDir = process.env.CENTRAL_GOVERNANCE_API_PATH
  ? join(process.env.CENTRAL_GOVERNANCE_API_PATH)
  : defaultSourceDir;
const destDir = join(projectRoot, "resources", "central-governance-api");

// Top-level tracked entries actually needed to `uv run` this project and
// execute its Alembic migrations at runtime. Anything else tracked in the
// source repo (docs/, README.md, .env.example, .recall/, tests/, ...) is
// deliberately left out of the bundle — see the module docstring.
const ALLOWED_TOP_LEVEL = new Set([
  "pyproject.toml",
  "uv.lock",
  ".python-version",
  "alembic.ini",
  "alembic",
  "src",
]);

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

function isAllowed(relPath) {
  const topLevel = relPath.split(/[/\\]/)[0];
  return ALLOWED_TOP_LEVEL.has(topLevel);
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
      `central-governance-api source not found at ${sourceDir}. Clone ` +
        `central-governance-api as a sibling of this repo, or set ` +
        `CENTRAL_GOVERNANCE_API_PATH to point at it.`,
    );
  }
  if (!existsSync(join(sourceDir, ".git"))) {
    throw new Error(
      `${sourceDir} is not a git checkout — this script relies on ` +
        `\`git ls-files\` to know which files belong in the bundle.`,
    );
  }

  console.log(`[prepackage-central-governance-api] Source: ${sourceDir}`);
  console.log(`[prepackage-central-governance-api] Dest:   ${destDir}`);

  const tracked = listTrackedFiles(sourceDir);
  const toCopy = tracked.filter(isAllowed);

  // Clear any previous copy so stale files from an older checkout don't
  // linger in the bundle (mirrors prepackage-governed-sdk.mjs's approach).
  if (existsSync(destDir)) await rm(destDir, { recursive: true, force: true });

  for (const rel of toCopy) {
    const src = join(sourceDir, rel);
    const dest = join(destDir, rel);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(src, dest);
  }

  const mb = (await dirSizeBytes(toCopy, sourceDir)) / (1024 * 1024);
  console.log(
    `[prepackage-central-governance-api] Done: ${toCopy.length} files (of ${tracked.length} tracked, ` +
      `allowlisted to ${[...ALLOWED_TOP_LEVEL].join(", ")}), ~${mb.toFixed(1)} MB`,
  );
}

main().catch((err) => {
  console.error("[prepackage-central-governance-api] Error:", err.message);
  process.exit(1);
});
