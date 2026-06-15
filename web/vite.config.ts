import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

const pexec = promisify(exec);

// 로컬 supermemory 서버(localhost:6767)로 프록시 → CORS 회피.
const SUPERMEMORY_URL = process.env.SUPERMEMORY_API_URL || "http://127.0.0.1:6767";

// launchd 에이전트 제어 (UI 서버 제어 패널용)
const LABEL = "com.adanbae.supermemory.local";
const PLIST = `${process.env.HOME}/Library/LaunchAgents/${LABEL}.plist`;

async function isLoaded(target: string): Promise<boolean> {
  try {
    await pexec(`launchctl print ${target}`);
    return true;
  } catch {
    return false;
  }
}

function serverControl(): Plugin {
  return {
    name: "supermemory-server-control",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith("/admin/server/")) return next();
        const action = req.url.replace("/admin/server/", "").split("?")[0];
        const uid = process.getuid ? process.getuid() : 0;
        const target = `gui/${uid}/${LABEL}`;
        const send = (code: number, body: unknown) => {
          res.statusCode = code;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(body));
        };
        try {
          if (action === "status") {
            const loaded = await isLoaded(target);
            let pid: number | null = null;
            if (loaded) {
              try {
                const { stdout } = await pexec(`launchctl print ${target}`);
                const m = stdout.match(/pid = (\d+)/);
                if (m) pid = Number(m[1]);
              } catch {
                /* ignore */
              }
            }
            let healthy = false;
            try {
              const r = await fetch(`${SUPERMEMORY_URL}/v3/health`, {
                signal: AbortSignal.timeout(3000),
              });
              healthy = r.ok;
            } catch {
              healthy = false;
            }
            return send(200, { loaded, pid, healthy });
          }

          if (action === "stop") {
            // KeepAlive=true 이므로 bootout(에이전트 해제)로 완전 정지
            if (!(await isLoaded(target))) return send(200, { ok: true, action: "stop", note: "이미 정지됨" });
            await pexec(`launchctl bootout ${target}`).catch((e) => {
              if (!/no such process|not find|could not find/i.test(String(e))) throw e;
            });
            return send(200, { ok: true, action: "stop" });
          }

          if (action === "start") {
            // 이미 등록돼 있으면 bootstrap은 EIO 에러 → kickstart로 기동만 보장
            if (await isLoaded(target)) {
              await pexec(`launchctl kickstart ${target}`).catch(() => {});
              return send(200, { ok: true, action: "start", note: "이미 등록됨 · kickstart" });
            }
            await pexec(`launchctl bootstrap gui/${uid} ${PLIST}`);
            return send(200, { ok: true, action: "start" });
          }

          if (action === "restart") {
            if (!(await isLoaded(target))) {
              // 등록 안 됐으면 먼저 bootstrap
              await pexec(`launchctl bootstrap gui/${uid} ${PLIST}`).catch(() => {});
              return send(200, { ok: true, action: "restart", note: "재등록(bootstrap)" });
            }
            await pexec(`launchctl kickstart -k ${target}`);
            return send(200, { ok: true, action: "restart" });
          }

          return send(404, { error: `unknown action: ${action}` });
        } catch (e) {
          return send(500, { error: e instanceof Error ? e.message : String(e) });
        }
      });
    },
  };
}

// ─── 프로젝트 폴더 ↔ 컨테이너 태그 매핑 ───
// 플러그인(claude-supermemory)과 동일한 규칙: claudecode_project_<sha256(gitRoot)[:16]>.
// 해시는 단방향이므로 후보 폴더를 스캔해 정방향으로 해시→폴더 맵을 만든다.
function projectTagFor(absPath: string): string {
  return "claudecode_project_" + createHash("sha256").update(absPath).digest("hex").slice(0, 16);
}

function scanRoots(): string[] {
  const env = process.env.SM_SCAN_ROOTS;
  if (env) return env.split(":").map((s) => s.trim()).filter(Boolean);
  const home = homedir();
  return [join(home, "Dev"), home];
}

interface ProjInfo { folder: string; path: string; }
let projCache: { at: number; map: Record<string, ProjInfo> } | null = null;

async function scanProjects(): Promise<Record<string, ProjInfo>> {
  if (projCache && Date.now() - projCache.at < 60_000) return projCache.map;
  const map: Record<string, ProjInfo> = {};
  const seen = new Set<string>();
  const MAX_DEPTH = 3;
  let budget = 5000; // 방문 디렉터리 상한(폭주 방지)

  // 깊이 제한 재귀로 .git 보유 디렉터리 수집. 저장소 경계에서 하위 탐색 중단.
  function walk(dir: string, depth: number, out: string[]): void {
    if (depth < 0 || budget-- <= 0) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      const sub = join(dir, e.name);
      if (existsSync(join(sub, ".git"))) out.push(sub); // 저장소 발견 → 기록, 하위 미탐색
      else if (depth > 0) walk(sub, depth - 1, out);
    }
  }

  const gitDirs: string[] = [];
  for (const root of scanRoots()) {
    if (existsSync(join(root, ".git"))) gitDirs.push(root);
    walk(root, MAX_DEPTH, gitDirs);
  }

  for (const dir of gitDirs) {
    try {
      const top = (await pexec("git rev-parse --show-toplevel", { cwd: dir })).stdout.trim();
      if (top && !seen.has(top)) {
        seen.add(top);
        map[projectTagFor(top)] = { folder: basename(top), path: top };
      }
      // 워크트리도 포함 — 세션이 워크트리(.claude/worktrees/*)에서 캡처된 경우 대응
      try {
        const wl = (await pexec("git worktree list --porcelain", { cwd: dir })).stdout;
        for (const line of wl.split("\n")) {
          if (!line.startsWith("worktree ")) continue;
          const wt = line.slice(9).trim();
          if (wt && !seen.has(wt)) {
            seen.add(wt);
            map[projectTagFor(wt)] = { folder: basename(wt), path: wt };
          }
        }
      } catch {
        /* worktree 목록 실패 무시 */
      }
    } catch {
      /* 비저장소 — 건너뜀 */
    }
  }
  projCache = { at: Date.now(), map };
  return map;
}

function projectsScan(): Plugin {
  return {
    name: "supermemory-projects-scan",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith("/admin/projects/scan")) return next();
        res.setHeader("Content-Type", "application/json");
        try {
          res.statusCode = 200;
          res.end(JSON.stringify(await scanProjects()));
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
      });
    },
  };
}

// ─── 이전 세션 백필 (~/.claude/projects/*/*.jsonl → supermemory) ───
const PROJECTS_DIR = join(homedir(), ".claude", "projects");
const IMPORT_MARKER = join(
  process.env.SUPERMEMORY_DATA_DIR || join(homedir(), ".supermemory-data"),
  "imported-sessions.json"
);

function readImported(): Set<string> {
  try {
    return new Set(JSON.parse(readFileSync(IMPORT_MARKER, "utf8")) as string[]);
  } catch {
    return new Set();
  }
}
function markImported(ids: string[]): void {
  const s = readImported();
  for (const id of ids) s.add(id);
  try {
    writeFileSync(IMPORT_MARKER, JSON.stringify([...s]));
  } catch {
    /* 마커 저장 실패 무시 */
  }
}

function sanitizeSession(t: string): string {
  return t
    .replace(/<\|[^|]*\|>/g, " ")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function blockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content.map((b) => (typeof b === "string" ? b : (b && (b as { text?: string }).text) || "")).join(" ");
  return "";
}

interface SessParse { cwd: string; title: string; userCount: number; assistantCount: number; text: string; }
function parseSession(file: string, full: boolean): SessParse | null {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let cwd = "";
  let title = "";
  let uc = 0;
  let ac = 0;
  const parts: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (!cwd && typeof o.cwd === "string") cwd = o.cwd;
    const msg = o.message as { role?: string; content?: unknown } | undefined;
    if (!title && o.type === "ai-title") title = String((o.title as string) || (msg?.content as string) || "").slice(0, 120);
    const role = o.type === "user" || o.type === "assistant" ? o.type : msg?.role;
    if (role === "user") {
      uc++;
      if (full) { const tx = blockText(msg?.content ?? o.content); if (tx.trim()) parts.push("[사용자] " + tx); }
    } else if (role === "assistant") {
      ac++;
      if (full) { const tx = blockText(msg?.content ?? o.content); if (tx.trim()) parts.push("[어시스턴트] " + tx); }
    }
  }
  if (!title) title = (full && parts[0] ? parts[0] : basename(file)).slice(0, 120);
  return { cwd, title, userCount: uc, assistantCount: ac, text: full ? sanitizeSession(parts.join("\n\n")) : "" };
}

interface SessRow { file: string; sessionId: string; cwd: string; project: string; title: string; userCount: number; assistantCount: number; mtime: number; imported: boolean; }
let sessCache: { at: number; list: SessRow[] } | null = null;
function listSessionRows(): SessRow[] {
  if (sessCache && Date.now() - sessCache.at < 60_000) return sessCache.list;
  const imported = readImported();
  const out: SessRow[] = [];
  let projects: string[];
  try {
    projects = readdirSync(PROJECTS_DIR);
  } catch {
    return [];
  }
  for (const p of projects) {
    let files: string[];
    try {
      files = readdirSync(join(PROJECTS_DIR, p)).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      const file = join(PROJECTS_DIR, p, f);
      const meta = parseSession(file, false);
      if (!meta) continue;
      const sessionId = f.replace(/\.jsonl$/, "");
      let mtime = 0;
      try { mtime = statSync(file).mtimeMs; } catch { /* */ }
      out.push({
        file, sessionId, cwd: meta.cwd,
        project: meta.cwd ? basename(meta.cwd) : p,
        title: meta.title, userCount: meta.userCount, assistantCount: meta.assistantCount,
        mtime, imported: imported.has(sessionId),
      });
    }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  sessCache = { at: Date.now(), list: out };
  return out;
}

async function ollamaSummarize(text: string): Promise<string> {
  const model = process.env.OPENAI_MODEL || "gemma4:e4b";
  const r = await fetch("http://localhost:11434/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "다음 Claude Code 세션 로그에서 장기적으로 기억할 사실·결정·사용자 선호를 간결한 한국어 불릿으로 추출하라. 잡담/명령출력은 제외." },
        { role: "user", content: text.slice(0, 20000) },
      ],
    }),
    signal: AbortSignal.timeout(180000),
  });
  const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
  const c = j?.choices?.[0]?.message?.content;
  return typeof c === "string" && c.trim() ? c.trim() : text;
}

function sessionsApi(): Plugin {
  return {
    name: "supermemory-sessions-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith("/admin/sessions/")) return next();
        const send = (code: number, body: unknown) => {
          res.statusCode = code;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(body));
        };
        const u = new URL(req.url, "http://localhost");
        const action = u.pathname.replace("/admin/sessions/", "");
        try {
          if (action === "list") return send(200, listSessionRows());
          if (action === "get") {
            const file = u.searchParams.get("file") || "";
            if (!resolve(file).startsWith(PROJECTS_DIR)) return send(403, { error: "범위 밖 경로" });
            const d = parseSession(file, true);
            if (!d) return send(404, { error: "세션 없음" });
            return send(200, d);
          }
          if (action === "import" && req.method === "POST") {
            const body = await new Promise<string>((rs) => {
              let b = "";
              req.on("data", (c) => (b += c));
              req.on("end", () => rs(b));
            });
            const { files = [], summarize = true, containerTag } = JSON.parse(body || "{}") as {
              files?: string[]; summarize?: boolean; containerTag?: string;
            };
            const results: { sessionId: string; ok: boolean; containerTag?: string; folder?: string; error?: string }[] = [];
            for (const file of files) {
              const sessionId = basename(file).replace(/\.jsonl$/, "");
              try {
                if (!resolve(file).startsWith(PROJECTS_DIR)) { results.push({ sessionId, ok: false, error: "범위 밖" }); continue; }
                const d = parseSession(file, true);
                if (!d || !d.text) { results.push({ sessionId, ok: false, error: "내용 없음" }); continue; }
                let tag = containerTag;
                let folder = "";
                if (!tag) {
                  if (!d.cwd) { results.push({ sessionId, ok: false, error: "컨테이너 미지정(cwd 없음)" }); continue; }
                  let base = d.cwd;
                  try {
                    const top = (await pexec("git rev-parse --show-toplevel", { cwd: d.cwd })).stdout.trim();
                    if (top) base = top;
                  } catch { /* 비저장소 — cwd 사용 */ }
                  tag = projectTagFor(base);
                  folder = basename(base);
                }
                let content = `세션 백필: ${d.title}\n\n${d.text}`;
                if (summarize) {
                  try { content = `세션 요약(${d.title}):\n` + (await ollamaSummarize(d.text)); } catch { /* fallback 정제본 */ }
                }
                const pr = await fetch(`${SUPERMEMORY_URL}/v3/documents`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ content, containerTags: [tag], metadata: { source: "session-backfill", sessionId } }),
                });
                if (!pr.ok) { results.push({ sessionId, ok: false, error: `서버 ${pr.status}` }); continue; }
                markImported([sessionId]);
                // 새 컨테이너에 폴더명 부여 → 셀렉트에서 해시 대신 폴더명 표시
                if (folder) {
                  try {
                    await fetch(`${SUPERMEMORY_URL}/v3/container-tags/${encodeURIComponent(tag)}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ name: folder }),
                    });
                  } catch { /* 이름 지정 실패 무시 */ }
                }
                results.push({ sessionId, ok: true, containerTag: tag, folder });
              } catch (e) {
                results.push({ sessionId, ok: false, error: e instanceof Error ? e.message : String(e) });
              }
            }
            sessCache = null;
            return send(200, { results });
          }
          return send(404, { error: `unknown: ${action}` });
        } catch (e) {
          return send(500, { error: e instanceof Error ? e.message : String(e) });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serverControl(), projectsScan(), sessionsApi()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: SUPERMEMORY_URL,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
