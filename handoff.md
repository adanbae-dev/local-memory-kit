# Handoff: Supermemory 로컬 셋업 프로젝트

**날짜**: 2026-06-12 (최신 자료 재검증 완료)
**작업자**: adanbae
**목표**: Ollama + Supermemory 로컬 서버 구축 후 Claude Code 연결

---

## 현재 상태

- [x] supermemory 서비스/보안 분석 (`docs/01`, `docs/02`)
- [x] 셀프호스팅 절차 최신 자료 재검증 — 2026-06-12, `supermemory-server` 0.0.2 / npm 4.24.12 기준
- [x] 상용 LLM API 데이터 유출 점검 (`docs/04`)
- [x] 로컬 환경 사전 점검 — Node 20.19 / RAM 32GB / macOS 15.2 / 디스크 117GB (모두 충족)
- [x] Ollama 설치 — `brew install ollama` → 0.30.7, `brew services start ollama` (자동 기동)
- [x] 텍스트 모델 다운로드 — `gpt-oss:20b` (13GB) 설치 완료
- [x] Supermemory 로컬 서버 실행 — `supermemory-server` 0.0.2, 포트 6767, 로컬 임베딩 `bge-base-en-v1.5`
- [x] 동작 테스트 — `/v3/documents` 저장 → gpt-oss:20b 추출 → `/v3/search` 검색 (score 0.84) ✅
- [x] 셸 환경변수 — `~/.zshrc`에 `SUPERMEMORY_API_URL`/`SUPERMEMORY_CC_API_KEY` 등록
- [x] Claude Code 공식 플러그인 — **이미 설치 확인됨** (`supermemory@supermemory-plugins` v0.0.7, user 스코프). 새 터미널에서 Claude Code 재시작만 하면 연결 완료

### 실측 셋업 결과 (2026-06-12)

| 항목 | 값 |
|------|-----|
| 서버 바이너리 | `~/.local/bin/supermemory-server` (0.0.2) |
| 데이터 디렉터리 | `~/.supermemory-data` (암호화 로컬 저장) |
| API URL | `http://localhost:6767` |
| org id | `DenXvkJLGpxzsKAbrDMd1g` |
| API 키 | `~/.zshrc`에 저장됨 (localhost 요청엔 자동 적용) |
| 추출 모델 | Ollama `gpt-oss:20b` |
| 임베딩 | 서버 내장 `Xenova/bge-base-en-v1.5` (별도 모델 불필요 — 실증됨) |

> ✅ **서버 영속성 설정 완료 (launchd)**: `~/Library/LaunchAgents/com.adanbae.supermemory.local.plist`
> 로그인 시 자동 기동 + 크래시 시 자동 재시작(KeepAlive). 로그: `~/Library/Logs/supermemory.{out,err}.log`
> - 상태 확인: `launchctl list | grep supermemory` (Status 0 = 정상)
> - 수동 재시작: `launchctl kickstart -k gui/$(id -u)/com.adanbae.supermemory.local`
> - 중지/해제: `launchctl unload ~/Library/LaunchAgents/com.adanbae.supermemory.local.plist`

### 남은 1단계: Claude Code 플러그인 (인터랙티브 세션에서)

```
/plugin marketplace add supermemoryai/claude-supermemory
/plugin install claude-supermemory
```
→ 설치 후 Claude Code 재시작. `~/.zshrc`의 `SUPERMEMORY_API_URL`/`SUPERMEMORY_CC_API_KEY`를
플러그인이 자동으로 읽어 로컬 서버에 연결한다 (새 터미널에서 실행해야 env 반영됨).

---

## 재검증으로 바뀐 것 (2026-06-12)

| 기존 계획 | 수정 | 이유 |
|----------|------|------|
| MCP 래퍼 서버 직접 구현 | **불필요 — 삭제** | 공식 Claude Code 플러그인 `supermemoryai/claude-supermemory`가 `SUPERMEMORY_API_URL`로 셀프호스팅 직접 지원. Pro 플랜은 호스티드 전용 요건 |
| `ollama pull nomic-embed-text` | **불필요 — 삭제** | 임베딩은 서버 내장 로컬(WASM) 엔진이 자체 계산 |
| `llama3.2` (3B) | `gpt-oss:20b` 권장 | 공식 문서 예시 모델. 3B는 메모리 추출 품질 저하 우려, RAM 32GB로 충분 |
| `~/.claude/settings.json`의 `mcpServers` | 플러그인 방식으로 대체 | Claude Code는 settings.json에서 `mcpServers`를 읽지 않음 (`claude mcp add` → `~/.claude.json`) |
| `SUPERMEMORY_DISABLE_TELEMETRY=true` | `=1` | 공식 문서 표기 |
| 래퍼 코드의 `/v1/memories` 경로 | `/v3/documents`, `/v3/search` | 실제 API 경로 (래퍼 자체가 불필요해져 참고용) |

상세 절차는 `docs/03-local-setup.md` (전면 개정판) 참고.

---

## 다음 세션에서 할 일 (순서대로)

### 1. Ollama 설치 및 모델 준비

```bash
# macOS DMG: https://ollama.com/download  또는
curl -fsSL https://ollama.com/install.sh | sh

ollama pull gpt-oss:20b   # 약 14GB. 가볍게 가려면 qwen3:8b
ollama list
```

### 2. Supermemory 로컬 서버 실행

```bash
cd ~/Dev/supermemory

OPENAI_BASE_URL=http://localhost:11434/v1 \
OPENAI_API_KEY=ollama \
OPENAI_MODEL=gpt-oss:20b \
SUPERMEMORY_PORT=6767 \
SUPERMEMORY_DATA_DIR=~/.supermemory-data \
SUPERMEMORY_DISABLE_TELEMETRY=1 \
npx supermemory local --port 6767
```

- ⚠️ **`--port 6767` 명시 필수** — CLI 실측 결과 런처 기본 포트는 8787 (문서 예시 6767과 다름)
- 첫 부팅 시 콘솔에 `sm_...` API 키 출력 → **반드시 저장** (분실 시 `npx supermemory local env` 또는 `~/.supermemory/env` 확인)
- 확인: `curl http://localhost:6767/v3/health` 또는 `npx supermemory local status`

### 3. Claude Code 공식 플러그인 연결

```bash
# Claude Code 안에서:
/plugin marketplace add supermemoryai/claude-supermemory
/plugin install claude-supermemory
```

```bash
# ~/.zshrc 에 추가:
export SUPERMEMORY_API_URL="http://localhost:6767"
export SUPERMEMORY_CC_API_KEY="sm_여기에_로컬_키"
```

### 4. 테스트

- Claude Code 세션 재시작 → 세션 시작 시 메모리 주입 확인
- 작업 후 자동 캡처(Edit/Write/Bash/Task) 동작 확인
- `SUPERMEMORY_DEBUG=1`로 디버그 로그 확인 가능

---

## 참고 문서

| 파일 | 내용 |
|------|------|
| `docs/01-supermemory-overview.md` | supermemory 서비스 개요, 가격, 보안 |
| `docs/02-free-mcp-setup.md` | Free 플랜 MCP 연결 방법 (호스티드) |
| `docs/03-local-setup.md` | Ollama + 셀프호스팅 전체 가이드 (2026-06-12 개정) |
| `docs/04-llm-provider-security.md` | 상용 LLM API 사용 시 데이터 유출 분석 |

## 참고 링크

- 셀프호스팅 문서: https://supermemory.ai/docs/self-hosting/overview
- 설정(환경변수): https://supermemory.ai/docs/self-hosting/configuration
- Claude Code 통합: https://supermemory.ai/docs/integrations/claude-code
- 플러그인 저장소: https://github.com/supermemoryai/claude-supermemory
- 본체 저장소 (MIT): https://github.com/supermemoryai/supermemory

---

## 알려진 이슈 / 주의사항

1. **극초기 버전**: `supermemory-server` 0.0.2 (2026-06-10 릴리스) — breaking change 가능성 높음. 문제 시 GitHub Issues 확인
2. **API 키 저장**: 첫 실행 시 콘솔 출력 키 저장. 분실 시 `~/.supermemory/env` 확인
3. **첫 부팅 느림**: 그래프 엔진 + 임베딩 모델 캐시 초기화에 시간 소요
4. **이미지/영상/고품질 PDF**: Gemini 또는 Vertex AI 키 필요 — Ollama만 쓰면 텍스트 위주
5. **커넥터/호스티드 MCP**: 셀프호스팅 미제공 (Drive/Notion/Gmail 커넥터, mcp.supermemory.ai)
6. **제공자 동시 사용 불가**: 여러 API 키 설정 시 우선순위(OpenAI호환 > Anthropic > Gemini > Groq) 첫 번째만 사용. 전환은 서버 재시작으로 — `docs/04` 참고
7. **포트 기본값 불일치 (CLI 실측)**: `npx supermemory local`의 기본 포트는 8787, 공식 문서 예시는 6767 — 항상 `--port 6767` 명시. `local status`/`local env`/`local upgrade` 보조 명령 활용

---

## 🔬 부팅 행(hang) 근본 원인 판명 (2026-06-13)

**증상**: launchd 기동 시 부팅 184~236초·무응답·크래시 루프처럼 보임. UI 상태등 노란불 고정.

**근본 원인 2가지 (복합)**:
1. **plist `ProcessType=Background`** — macOS가 CPU/IO를 스로틀링해 WASM 임베딩 init·추출이 기어감
   (수동 실행 5.4초 vs launchd 184~236초). → **해당 키 제거로 해결, launchd 부팅 10초.**
2. **health 엔드포인트 오인** — `/health`는 존재하지 않음(404). 진짜는 **`/v3/health`**.
   모니터링·UI가 404를 "비정상"으로 판정해 멀쩡한 서버를 반복 재시작(크래시 루프의 상당 부분은 자초).

**수정 사항**: plist Background 제거 / `web/vite.config.ts`·README·docs/03 health 경로 `/v3/health`로 정정 /
데이터 초기화로 API 키 변경됨(org `KD8L9jMXL1NjJ7RDqmk6jD`, 새 키 `~/.zshrc` 반영 완료).

**최종 상태**: launchd 자동기동 정상(부팅 ~10초), UI(:5173) 목록·검색·추가·삭제·서버제어 모두 동작.
