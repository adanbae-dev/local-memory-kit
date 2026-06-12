import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { exec } from "node:child_process";
import { promisify } from "node:util";

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

export default defineConfig({
  plugins: [react(), serverControl()],
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
