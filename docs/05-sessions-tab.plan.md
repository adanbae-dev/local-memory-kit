# 구현 계획: "이전 세션" 탭 (과거 세션 탐색 + 선택 백필)

> 승인됨(기본: 가져오기=정제+로컬 Ollama 요약 토글, 목록=전체 프로젝트+필터). 새 세션에서 이 파일을 구현하면 됨.
> 핵심 교훈: **원시 트랜스크립트는 직렬화 크래시(failed) 유발** → 반드시 정제(+요약) 후 적재.

## 사실 (실측)
- 과거 세션: `~/.claude/projects/<encoded>/*.jsonl` — 40 프로젝트 / 68 세션 / 1.1GB.
- jsonl 각 줄 = 이벤트(`type`: user/assistant/system/attachment/ai-title/…). user/assistant만 사용.
- 각 줄에 **`cwd` 필드 존재**(예: `/Users/adanbae/Dev/php/mobile-web`) → 디렉터리명 디코드(대시 모호) 대신 **cwd로 컨테이너 매핑**.
- user 라인: `.message.content`가 string(또는 block 배열).

## 패턴 (기존 코드, 그대로 미러)
- 미들웨어: `web/vite.config.ts`의 `serverControl()`·`projectsScan()` (`/admin/*` 라우트, `configureServer`).
- 컨테이너 해시: `vite.config.ts` `projectTagFor(absPath)` = `claudecode_project_<sha256(path)[:16]>`.
- API 클라이언트: `web/src/api.ts` `serverStatus`/`resolveProjects` (`/admin/*` fetch + 타입).
- 탭/표/드로어/체크박스: `web/src/App.tsx` `DocsTab`·`InsightsTab`.

## 정확한 앵커 (구현 시점에 재확인)
- `vite.config.ts:8` import 줄: `node:fs`에 `readFileSync, writeFileSync, statSync` 추가(현재 `existsSync, readdirSync`만). `node:path`에 `resolve` 추가.
- `vite.config.ts:201` `plugins: [react(), serverControl(), projectsScan()],` → `sessionsApi()` 추가.
- `App.tsx:790` `type Tab = "...| "insights";` → `| "sessions"` 추가.
- `App.tsx:897-901` 탭 nav 버튼들 → "이전 세션" 버튼 추가.
- `App.tsx:907-908` 탭 렌더 → `{tab === "sessions" && <SessionsTab projectMap={projectMap} />}` 추가.

## Files to Change
| 파일 | 작업 |
|---|---|
| `web/vite.config.ts` | UPDATE — fs import 보강 + `sessionsApi()` 플러그인 + 등록 |
| `web/src/api.ts` | UPDATE — `listSessions`/`getSession`/`importSessions` + 타입 |
| `web/src/App.tsx` | UPDATE — `SessionsTab` + 탭 추가 |
| `web/src/styles.css` | UPDATE(선택) — 기존 클래스 재사용 위주 |
| `README.md` | UPDATE — 기능 문서화 |

## 미들웨어 설계 (`sessionsApi()` in vite.config.ts)

상수/헬퍼:
```
const PROJECTS_DIR = join(homedir(), ".claude", "projects");
const IMPORT_MARKER = join(process.env.SUPERMEMORY_DATA_DIR || join(homedir(), ".supermemory-data"), "imported-sessions.json");
readImported(): Set<string>   // JSON 배열 파일 → Set, 없으면 빈 Set
markImported(ids: string[])   // 합쳐서 저장
sanitize(t): <|...|> 토큰 제거 + 제어문자(개행/탭 제외) 제거 + 다중공백/개행 정리 + trim
extractText(o): o.message?.content (string) | 배열이면 block.text join
parseSession(file, full): readFileSync→split("\n")→각 줄 JSON.parse(에러 줄 skip).
  cwd(첫 발견), title(ai-title 또는 첫 user 80자), userCount, assistantCount,
  full이면 "[사용자]/[어시스턴트] " prefix로 parts 수집 후 sanitize(join("\n\n")).
```

엔드포인트:
- `GET /admin/sessions/list` → 각 프로젝트 dir의 `*.jsonl`마다 `parseSession(file,false)` + `statSync` mtime + imported 여부 → `[{file, sessionId, cwd, project, title, userCount, assistantCount, mtime, imported}]`. **60초 캐시**. 본문 미로드.
- `GET /admin/sessions/get?file=<abs>` → **경로 검증**(`resolve(file).startsWith(PROJECTS_DIR)` 아니면 403) → `parseSession(file,true)`.
- `POST /admin/sessions/import` body `{files:string[], summarize:boolean, containerTag?:string}` → 각 file:
  1. `parseSession(file,true)` → text (비면 skip).
  2. `summarize`면 Ollama: `POST http://localhost:11434/v1/chat/completions` {model: OPENAI_MODEL||"gemma4:e4b", messages:[{role:"system",content:"세션 로그에서 기억할 사실/결정/선호를 간결한 한국어 불릿으로 추출"},{role:"user",content:text.slice(0,20000)}]} → content. 실패 시 정제본 fallback.
  3. 컨테이너: containerTag 우선, 없으면 `git -C <cwd> rev-parse --show-toplevel`→`projectTagFor`. git 아니면 needTag로 skip.
  4. `POST {SUPERMEMORY_URL}/v3/documents` {content, containerTags:[tag], metadata:{source:"session-backfill", sessionId}}.
  5. 성공 시 `markImported([sessionId])`.
  - 건별 `{sessionId, ok, status|error, containerTag}` 반환. 순차(gemma4 ~99s/건).

## api.ts
```
interface SessionMeta { file; sessionId; cwd; project; title; userCount; assistantCount; mtime; imported }
interface SessionDetail { cwd; title; text; userCount; assistantCount }
listSessions(): GET /admin/sessions/list
getSession(file): GET /admin/sessions/get?file=encodeURIComponent(file)
importSessions(files, summarize, containerTag?): POST /admin/sessions/import
```

## App.tsx — SessionsTab({projectMap})
- 마운트 시 `listSessions()` → 표: [체크박스, 프로젝트(📁 projectMap[해시]?.folder 우선), 제목, #user/#assistant, 날짜, 가져옴✓].
- **프로젝트 필터** select + "가져온 항목 숨기기" 토글.
- 행 클릭 → 미리보기 드로어(`getSession` → 정제 텍스트 + 컨테이너 표시).
- 다중선택 + **"선택 가져오기"** + **요약 토글(기본 on)** + (선택)컨테이너 수동 지정.
- 가져오기 → `importSessions(...)` → 결과 표시 + 목록 새로고침. errMsg/setError 패턴.

## Validation
```
npm --prefix web run typecheck
npm run dev → "이전 세션" 탭: 목록·필터·미리보기·선택 가져오기 → 메모리 탭 생성 확인
```

## Risks / 완화
- 1.1GB 목록 느림 → 메타만 + 60s 캐시.
- 트랜스크립트 크래시 → sanitize + 요약. 실패분은 문서탭 ♻재추출.
- 중복 → sessionId 멱등 마커 + "가져옴" 표시.
- 컨테이너 매핑 → cwd의 git rev-parse(디렉터리명 디코드 안 함). 비-git 수동 지정.
- 경로 traversal → /get·/import에서 PROJECTS_DIR 하위 검증.
- 프라이버시 → 전부 로컬(외부 전송 0).

## 복잡도: Medium
구현 순서: vite.config(미들웨어) → api.ts → App.tsx(SessionsTab+탭) → typecheck → README → 커밋/푸시
