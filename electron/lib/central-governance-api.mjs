/**
 * Roy 的治理層接線(2026-09-24):central-governance-api 子行程管理。
 *
 * OHS Track 1 的中央治理 API(approval/audit,唯一持有 PostgreSQL 憑證的服務)
 * ——跟 vllm-toolcall-proxy.mjs 不同,這不是可以改寫成 Node 的薄轉發層,是一個
 * 真的 FastAPI/uvicorn 服務,必須透過 `uv run` 當成真正的子行程啟動,所以沿用
 * dev-process-utils.mjs 既有的 process-tree spawn/kill 工具(跟 dev-with-
 * automation.mjs 對 agent-server/automation 用的是同一套),而不是重造一遍。
 *
 * 刻意 best-effort、非阻斷式啟動:今天 agent-server 那端還沒有任何程式碼會真的
 * 呼叫 central-governance-api(見 wiki project_openhands_governance_platform.md
 * 「MVP 實作」章節,尚未 commit),此外這支服務需要外部 PostgreSQL/Keycloak 才
 * 能連得上,任一項沒設定好就必然啟動失敗——不能讓一個目前還沒人在用的新服務,
 * 拖垮今天已經在正常運作的 agent-server/automation/ingress 開機流程。每個步驟
 * 都用非同步 spawn(而非 execFileSync)+ 逾時,絕不用同步阻斷呼叫卡住 Electron
 * 單執行緒的 main process。啟動失敗只記 log,呼叫端不需要 await 這支函式、也
 * 不會因它失敗而中斷。
 *
 * 啟動拆成三步(小o 委派審查 2026-09-24 抓到的 Medium 修正——原本把「準備 uv
 * 環境」跟「跑 DB migration」混在同一個 30 秒逾時裡,首次啟動要下載 Python、
 * 建 venv、裝依賴,30 秒對乾淨機器/慢網路必然不夠;拆開後,只有第一次真的慢的
 * `uv sync` 給足夠的時間,之後每次啟動都是已存在的 venv,alembic 那步驟本身
 * 應該很快,30 秒逾時才真正代表「DB 連不上」而不是「環境還沒裝好」):
 *   1. runUvSync   — `uv sync --frozen --no-dev`,只裝 production 依賴,不會
 *                     多裝 pytest/pyright/ruff 這些 dev-only 套件。逾時比照
 *                     main.mjs 對 uvx/agent-server 首次啟動的既有寬限(10 分鐘)。
 *   2. runMigrations — `uv run --frozen --no-dev alembic upgrade head`。
 *                     Idempotent(已是最新版本時 alembic 直接 no-op)——不用
 *                     自己另外追蹤「有沒有 migrate 過」的狀態,每次啟動都跑
 *                     一次即可。30 秒逾時,環境已經備好後這個逾時才有意義。
 *   3. spawn server  — `uv run --frozen --no-dev central-governance-api`。
 *
 * `--frozen` 讓三步都直接用打包進安裝檔的 uv.lock,不會在執行期改寫它、也不
 * 會另外連網解析套件版本。
 *
 * `UV_PROJECT_ENVIRONMENT` 指到 app.getPath("userData") 底下(main.mjs 傳入的
 * `venvDir` 參數),不用 uv 預設的 `<projectPath>/.venv`——後者會在安裝檔的
 * resources 目錄裡建/改 venv(小o 委派審查 2026-09-24 抓到的 Medium):
 * resources 理論上該是唯讀、可重現的安裝內容,重裝/更新時很可能被整個清掉,
 * 逼下次啟動重新下載;某些安裝方式(如 macOS /Applications/*.app)甚至可能
 * 直接不可寫。venv 改放使用者資料目錄,一次裝好之後可以跨版更新續用。
 *
 * 機密資料(CGA_DATABASE_URL 的密碼、CGA_OIDC_* 的 issuer/audience)一律不烤進
 * 安裝檔——這支模組完全不設任何 CGA_* 預設值,只轉發呼叫端傳入的 env(來自
 * process.env)。central_governance_api.config.Settings 本身對 oidc_issuer/
 * oidc_jwks_url/oidc_audience 三個欄位就沒有預設值,沒設定會直接啟動失敗並印出
 * 清楚的 pydantic 驗證錯誤——這是誠實訊號,比在這裡發明一個看起來像真的、其實
 * 連不上任何東西的假網址更好。CGA_DATABASE_URL 有一個無害的通用預設
 * (postgresql+asyncpg://cga:cga@localhost:5432/central_governance,定義在
 * central-governance-api 自己的 config.py,不是任何人的正式密碼)。真正能用的
 * 值由執行這支 exe 的那台機器自己設系統環境變數(跟 VLLM_PROXY_UPSTREAM_URL
 * 同一個既有慣例)——即使這支 repo 是 public 的、即使這支 exe 以後真的要給
 * 同事用,也不會連帶送出 Roy 自己的正式資料庫/Keycloak 憑證。打包範圍本身也已
 * 收斂成 allowlist(見 scripts/prepackage-central-governance-api.mjs),不會
 * 把 docs/ 底下的設計文件或 .recall/ 的工作階段紀錄一起帶進安裝檔。
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// dev-process-utils.mjs's helpers (getProcessTreeSpawnOptions,
// resolveWindowsCommand, signalProcessTree, isProcessRunning) are passed in
// via `procUtils` rather than imported statically here. This file lives at
// electron/lib/ in the source tree; packaged mode flattens electron/ into
// the app root (Resources/app/), collapsing one level of nesting that dev
// mode still has (see main.mjs's projectRoot comment) — so a single
// hardcoded relative path up to scripts/dev-process-utils.mjs can't be
// correct in both modes. main.mjs already resolves that path correctly for
// dev-with-automation.mjs via a dynamic import(); we reuse that same
// resolution instead of duplicating it here.
const isWin = process.platform === "win32";
const SYNC_TIMEOUT_MS = 10 * 60_000;
const MIGRATION_TIMEOUT_MS = 30_000;
const FROZEN_NO_DEV = ["--frozen", "--no-dev"];

function uvCommand(resolveWindowsCommand) {
  return resolveWindowsCommand(isWin ? "uv.exe" : "uv");
}

/**
 * Run a one-shot `uv` subcommand (`sync` or `run ...`) to completion,
 * bounded by `timeoutMs`. Shared by runUvSync and runMigrations — both are
 * "spawn, wait for exit code 0, bail out with a log line otherwise", with
 * the only differences being the subcommand/args and the timeout budget.
 */
function runUvStep({
  label,
  subcommand,
  args = [],
  projectPath,
  env,
  log,
  registerChild,
  procUtils,
  timeoutMs,
}) {
  const {
    getProcessTreeSpawnOptions,
    resolveWindowsCommand,
    signalProcessTree,
    isProcessRunning,
  } = procUtils;

  return new Promise((resolve) => {
    const child = spawn(
      uvCommand(resolveWindowsCommand),
      [subcommand, "--project", projectPath, ...FROZEN_NO_DEV, ...args],
      getProcessTreeSpawnOptions({
        cwd: projectPath,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      }),
    );
    registerChild(child);

    let output = "";
    child.stdout?.on("data", (buf) => (output += buf.toString("utf-8")));
    child.stderr?.on("data", (buf) => (output += buf.toString("utf-8")));

    const timer = setTimeout(() => {
      log(
        "central-governance-api",
        `${label} timed out after ${Math.round(timeoutMs / 1000)}s — skipping startup.`,
        "error",
      );
      if (isProcessRunning(child)) signalProcessTree(child, "SIGTERM");
      resolve(false);
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      log(
        "central-governance-api",
        `${label} failed to spawn: ${err.message}`,
        "error",
      );
      resolve(false);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(true);
      } else {
        log(
          "central-governance-api",
          `${label} failed (exit ${code}) — central-governance-api will not start:\n${output}`,
          "error",
        );
        resolve(false);
      }
    });
  });
}

/**
 * `uv sync --frozen --no-dev`: resolves/installs the production dependency
 * closure from the bundled uv.lock into UV_PROJECT_ENVIRONMENT. A no-op
 * (fast) once that environment already exists from a previous launch —
 * only the very first launch after install actually downloads a Python
 * toolchain and packages, which is what SYNC_TIMEOUT_MS accounts for.
 */
function runUvSync({ projectPath, env, log, registerChild, procUtils }) {
  log(
    "central-governance-api",
    "Preparing Python environment (first launch can take a few minutes)…",
    "info",
  );
  return runUvStep({
    label: "Environment setup",
    subcommand: "sync",
    projectPath,
    env,
    log,
    registerChild,
    procUtils,
    timeoutMs: SYNC_TIMEOUT_MS,
  }).then((ok) => {
    if (ok) log("central-governance-api", "Python environment ready.", "info");
    return ok;
  });
}

/**
 * Run `uv run --frozen --no-dev --project <projectPath> alembic upgrade
 * head`. Idempotent (alembic no-ops when already current) — safe to run on
 * every launch rather than tracking "did we already migrate" state
 * ourselves. Assumes runUvSync already succeeded, so MIGRATION_TIMEOUT_MS
 * only has to account for actual DB round-trips, not environment setup.
 */
function runMigrations({ projectPath, env, log, registerChild, procUtils }) {
  log("central-governance-api", "Running database migrations…", "info");
  return runUvStep({
    label: "Migration",
    subcommand: "run",
    args: ["alembic", "upgrade", "head"],
    projectPath,
    env,
    log,
    registerChild,
    procUtils,
    timeoutMs: MIGRATION_TIMEOUT_MS,
  }).then((ok) => {
    if (ok) log("central-governance-api", "Migrations up to date.", "info");
    return ok;
  });
}

/**
 * Start central-governance-api as a managed child process (detached, so its
 * `uv run` → python/uvicorn wrapper chain can be tree-killed the same way
 * dev-with-automation.mjs's services are — see dev-process-utils.mjs).
 *
 * Async and best-effort: resolves to `{ close() }` on every path, including
 * failure (where `close()` is a no-op) — callers should NOT block app
 * startup on this promise; fire-and-forget it and let it log.
 *
 * `registerChild(child)` fires synchronously the instant ANY of the three
 * steps (sync / migrate / server) spawns its child — before any `await` in
 * this function. This closes a real race: if the caller only tracked the
 * `{ close() }` this function eventually resolves to, a SIGTERM arriving
 * mid-startup (sync alone can take up to SYNC_TIMEOUT_MS on first launch)
 * would have nothing to kill yet, and the detached `uv` → python process
 * tree (detached is required so signalProcessTree can reach the whole
 * tree, not just the direct child — see dev-process-utils.mjs) would
 * outlive the Electron app as an orphan. The caller should signal every
 * child `registerChild` has handed it, not just the one inside the final
 * `{ close() }`.
 *
 * `venvDir`: an absolute path (caller-supplied, typically under
 * app.getPath("userData")) set as UV_PROJECT_ENVIRONMENT for all three uv
 * invocations — keeps the venv out of the installer's resources directory.
 */
export async function startCentralGovernanceApi({
  projectPath,
  host,
  port,
  venvDir,
  env,
  log,
  registerChild,
  procUtils,
}) {
  const {
    getProcessTreeSpawnOptions,
    resolveWindowsCommand,
    signalProcessTree,
    isProcessRunning,
  } = procUtils;

  if (!existsProjectFile(projectPath)) {
    log(
      "central-governance-api",
      `Source not found at ${projectPath} — skipping (no governance API this launch).`,
      "warn",
    );
    return { close() {} };
  }

  const mergedEnv = {
    ...env,
    CGA_HOST: host,
    CGA_PORT: String(port),
    UV_PROJECT_ENVIRONMENT: venvDir,
  };

  const synced = await runUvSync({
    projectPath,
    env: mergedEnv,
    log,
    registerChild,
    procUtils,
  });
  if (!synced) return { close() {} };

  const migrated = await runMigrations({
    projectPath,
    env: mergedEnv,
    log,
    registerChild,
    procUtils,
  });
  if (!migrated) return { close() {} };

  log("central-governance-api", `Starting on ${host}:${port}…`, "info");

  const child = spawn(
    uvCommand(resolveWindowsCommand),
    [
      "run",
      "--project",
      projectPath,
      ...FROZEN_NO_DEV,
      "central-governance-api",
    ],
    getProcessTreeSpawnOptions({
      cwd: projectPath,
      env: mergedEnv,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }),
  );
  registerChild(child);

  child.stdout?.on("data", (buf) =>
    forwardLines(buf, (line) => log("central-governance-api", line, "info")),
  );
  child.stderr?.on("data", (buf) =>
    forwardLines(buf, (line) => log("central-governance-api", line, "error")),
  );
  child.on("exit", (code, signal) => {
    if (code !== 0 && code !== null) {
      log(
        "central-governance-api",
        `Exited unexpectedly (code=${code}, signal=${signal}).`,
        "error",
      );
    }
  });
  child.on("error", (err) => {
    log("central-governance-api", `Failed to start: ${err.message}`, "error");
  });

  return {
    close() {
      if (isProcessRunning(child)) {
        signalProcessTree(child, "SIGTERM");
      }
    },
  };
}

function forwardLines(buf, emit) {
  for (const line of buf.toString("utf-8").split(/\r?\n/)) {
    if (line.trim()) emit(line);
  }
}

function existsProjectFile(projectPath) {
  // pyproject.toml is the one file every valid uv project must have.
  return existsSync(join(projectPath, "pyproject.toml"));
}
