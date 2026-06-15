#!/usr/bin/env node
/**
 * supermemory-local-kit 원스톱 설치 (macOS)
 * Ollama → 모델 → supermemory-server → launchd → API키 → Claude Code 플러그인 → 관리 UI
 * 멱등(idempotent): 이미 된 단계는 건너뜀.  모델 변경: SM_MODEL=llama3.1:8b npm run setup
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();
// 추출 모델 요건: tool(함수) 호출 지원 + 구조화 JSON 무결성(reasoning 누출 없음).
// gemma4:e4b 검증됨(tool✅, JSON✅). 대안: llama3.1:8b, mistral-nemo:12b. (Gemma 3·순수 reasoning 모델은 부적합)
const MODEL = process.env.SM_MODEL || "gemma4:e4b";
const PORT = process.env.SM_PORT || "6767";
const LABEL = "com.supermemory.local";
const PLIST = join(HOME, "Library/LaunchAgents", `${LABEL}.plist`);
const DATA_DIR = join(HOME, ".supermemory-data");
const OUT_LOG = join(HOME, "Library/Logs/supermemory.out.log");
const BASE = `http://localhost:${PORT}`;

const log = (s) => console.log(`\x1b[36m▸\x1b[0m ${s}`);
const ok = (s) => console.log(`\x1b[32m✓\x1b[0m ${s}`);
const warn = (s) => console.log(`\x1b[33m⚠\x1b[0m ${s}`);
const die = (s) => { console.error(`\x1b[31m✗ ${s}\x1b[0m`); process.exit(1); };

const sh = (cmd, opts = {}) => execSync(cmd, { stdio: "pipe", encoding: "utf8", ...opts });
const shLive = (cmd) => execSync(cmd, { stdio: "inherit" });
const has = (cmd) => spawnSync("which", [cmd], { stdio: "pipe" }).status === 0;

async function health(timeoutMs = 4000) {
  try {
    const r = await fetch(`${BASE}/v3/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok;
  } catch { return false; }
}

async function waitHealth(totalSec, note) {
  process.stdout.write(`  ${note} (최대 ${totalSec}s) `);
  for (let i = 0; i < totalSec / 5; i++) {
    if (await health()) { console.log(""); return true; }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log("");
  return false;
}

// ── 0. 사전 점검 ─────────────────────────────────────────
if (process.platform !== "darwin") die("macOS 전용 스크립트입니다 (launchd 사용)");
if (!has("brew")) die("Homebrew가 필요합니다 → https://brew.sh");
ok(`사전 점검: macOS / Homebrew / Node ${process.version}`);

// ── 1. Ollama ────────────────────────────────────────────
if (!has("ollama")) {
  log("Ollama 설치 (brew)…");
  shLive("brew install ollama");
} else ok("Ollama 설치됨");
try { sh("curl -s --max-time 3 http://localhost:11434"); ok("Ollama 서버 응답"); }
catch {
  log("Ollama 서비스 시작…");
  shLive("brew services start ollama");
  execSync("sleep 5");
}

// ── 2. 모델 ──────────────────────────────────────────────
const models = sh("ollama list").toString();
if (models.includes(MODEL.split(":")[0])) ok(`모델 준비됨: ${MODEL}`);
else { log(`모델 다운로드: ${MODEL} (수 GB, 시간 소요)…`); shLive(`ollama pull ${MODEL}`); }

// ── 3~5. supermemory 서버 (이미 healthy면 통째로 스킵) ────
if (await health()) {
  ok(`supermemory 서버 이미 실행 중 (${BASE})`);
} else {
  // 3. 바이너리
  if (!existsSync(join(HOME, ".local/bin/supermemory-server"))) {
    log("supermemory-server 설치…");
    shLive("npx -y supermemory@latest local install");
  } else ok("supermemory-server 바이너리 있음");

  // 4. launchd plist (ProcessType=Background 금지 — QoS 스로틀링으로 부팅 40배 느려짐)
  log("launchd 에이전트 구성…");
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${HOME}/.local/bin/supermemory-server</string>
    <string>--port</string><string>${PORT}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>OPENAI_BASE_URL</key><string>http://localhost:11434/v1</string>
    <key>OPENAI_API_KEY</key><string>ollama</string>
    <key>OPENAI_MODEL</key><string>${MODEL}</string>
    <key>SUPERMEMORY_PORT</key><string>${PORT}</string>
    <key>SUPERMEMORY_DATA_DIR</key><string>${DATA_DIR}</string>
    <key>SUPERMEMORY_DISABLE_TELEMETRY</key><string>1</string>
    <key>SUPERMEMORY_NO_UPDATE_CHECK</key><string>1</string>
    <key>SUPERMEMORY_LOCAL_EMBEDDING_POOL_SIZE</key><string>1</string>
    <key>SUPERMEMORY_LOCAL_EMBEDDING_BATCH_SIZE</key><string>4</string>
    <key>SUPERMEMORY_EMBEDDING_RAM_LIMIT</key><string>2gb</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${OUT_LOG}</string>
  <key>StandardErrorPath</key><string>${HOME}/Library/Logs/supermemory.err.log</string>
</dict>
</plist>`;
  writeFileSync(PLIST, plist);
  const uid = sh("id -u").trim();
  try { sh(`launchctl bootout gui/${uid}/${LABEL}`); } catch {}
  sh(`launchctl bootstrap gui/${uid} ${PLIST}`);
  ok("launchd 등록 (로그인 자동기동 + 크래시 재시작)");

  // 5. health 대기 — 첫 부팅은 임베딩 모델(106MB) 다운로드 포함, 절대 중간에 죽이지 말 것
  if (!(await waitHealth(300, "서버 부팅 대기 — 첫 부팅은 임베딩 다운로드로 수 분 걸림")))
    die(`서버가 300초 내 부팅하지 않음. 로그 확인: tail -f ${OUT_LOG}`);
  ok(`서버 정상 (${BASE}/v3/health)`);
}

// ── 6. API 키 추출 → 플러그인 설정 ───────────────────────
let apiKey = null;
try {
  const m = [...readFileSync(OUT_LOG, "utf8").matchAll(/api key\s+(sm_[A-Za-z0-9_]+)/g)];
  if (m.length) apiKey = m[m.length - 1][1];
} catch {}
if (apiKey) {
  const cfgDir = join(process.cwd(), ".claude", ".supermemory-claude");
  mkdirSync(cfgDir, { recursive: true });
  writeFileSync(join(cfgDir, "config.json"),
    JSON.stringify({ apiKey, baseUrl: BASE }, null, 2));
  ok("플러그인 프로젝트 설정 작성 (.claude/.supermemory-claude/config.json — gitignore됨)");

  const zshrc = join(HOME, ".zshrc");
  const marker = "# supermemory-local-kit";
  const cur = existsSync(zshrc) ? readFileSync(zshrc, "utf8") : "";
  if (!cur.includes(marker)) {
    appendFileSync(zshrc, `\n${marker}\nexport SUPERMEMORY_API_URL="${BASE}"\nexport SUPERMEMORY_CC_API_KEY="${apiKey}"\nexport SUPERMEMORY_SKIP_TOOLS="Bash"\n`);
    ok("~/.zshrc 에 env 추가 (새 터미널부터 적용)");
  } else ok("~/.zshrc env 이미 설정됨");
} else warn(`API 키를 로그에서 못 찾음 — 직접 확인: grep "api key" ${OUT_LOG}`);

// ── 7. Claude Code 플러그인 ─────────────────────────────
if (has("claude")) {
  log("Claude Code 플러그인 설치…");
  try { sh("claude plugin marketplace add supermemoryai/claude-supermemory"); } catch {}
  let installed = false;
  for (const name of ["supermemory@supermemory-plugins", "claude-supermemory", "supermemory"]) {
    try { sh(`claude plugin install ${name}`); installed = true; break; } catch {}
  }
  if (installed || sh("claude plugin list").includes("supermemory")) ok("플러그인 설치됨 (Claude Code 재시작 필요)");
  else warn("플러그인 자동 설치 실패 — Claude Code에서 직접: /plugin marketplace add supermemoryai/claude-supermemory → /plugin install claude-supermemory");
} else warn("claude CLI 없음 — Claude Code 설치 후 /plugin 명령으로 플러그인 설치");

// ── 8. 관리 UI 의존성 ────────────────────────────────────
log("관리 UI 의존성 설치…");
shLive("npm --prefix web install");

console.log(`
\x1b[32m━━━ 설치 완료 ━━━\x1b[0m
  관리 UI:    npm run dev   →  http://localhost:5173
  서버 상태:  npm run server:status
  플러그인:   새 터미널에서 Claude Code 재시작 → /supermemory:status 로 확인
  모델 변경:  SM_MODEL=llama3.1:8b npm run setup (plist 재생성)
`);
