# Ollama + Supermemory 로컬 설치 완전 가이드

> 데이터가 로컬 밖으로 나가지 않음 / 비용 $0 / 회사 보안 적합
> **2026-06-12 개정**: 공식 문서·GitHub(`supermemory-server` 0.0.2, npm 4.24.12) 기준 재검증.
> 주요 변경 — ① MCP 래퍼 자작 → 공식 Claude Code 플러그인, ② 임베딩 모델 다운로드 불필요(서버 내장), ③ API 경로/설정 위치 정정

---

## 시스템 요구사항

| 항목 | 최소 | 권장 | 현재 머신 (2026-06-12 확인) |
|------|------|------|------|
| RAM | 8GB | 16GB+ | 32GB ✅ |
| 디스크 | 5GB | 20GB+ | 117GB 여유 ✅ |
| macOS | 14 Sonoma 이상 | - | 15.2 ✅ |
| Node.js | 18+ | 20+ | 20.19 ✅ |

---

## STEP 1. Ollama 설치

```bash
# macOS DMG (권장): https://ollama.com/download
# 또는
curl -fsSL https://ollama.com/install.sh | sh

# 확인
ollama --version
curl http://localhost:11434   # → "Ollama is running"
```

---

## STEP 2. 텍스트 모델 다운로드

> ⚠️ **임베딩 모델(`nomic-embed-text`)은 불필요** — supermemory 서버가 임베딩을
> 내장 로컬(WASM) 엔진으로 자체 계산한다. Ollama에는 메모리 추출용 텍스트 모델만 있으면 됨.

> ⚠️ **추출 모델 요건**: supermemory 메모리 에이전트는 **tool(함수) 호출**로 구조화 추출을 한다.
> 따라서 ① **tool 호출 지원** ② **구조화 JSON 무결성(reasoning/`<think>` 누출 없음)** 이 필수.
> Gemma 3(tool 미지원)·순수 reasoning 모델(gpt-oss harmony, deepseek-r1 등)은 추출 0개가 될 수 있다.

```bash
# 권장 (2026, 비중국, 검증됨) — tool✅ + JSON✅
ollama pull gemma4:e4b       # ~9.6GB, 한국어·추출 품질 우수 (Apache-2.0)

# 대안 (tool 지원, reasoning 없음)
ollama pull llama3.1:8b      # ~4.9GB, 더 빠름 (Llama Community License)
ollama pull mistral-nemo:12b # ~7GB, 네이티브 function calling (Apache-2.0)

ollama list
```

> 새 추출 모델을 붙이기 전 검증: `curl localhost:11434/v1/chat/completions`에 `tools=[...]`를 넣어
> `tool_calls[].function.arguments`가 valid JSON인지(`jq`) + `<think>` 누출 없는지 먼저 확인할 것.

---

## STEP 3. Supermemory 로컬 서버 실행

```bash
# 방법 A: npx 런처 (CLI 4.24.12에서 `local` 서브커맨드 실측 확인 — 기본 help에는 숨겨져 있음)
npx supermemory local --port 6767

# 방법 B: 설치 스크립트 → 바이너리
curl -fsSL https://supermemory.ai/install | bash
supermemory-server
```

> ⚠️ **포트 주의 (2026-06-12 CLI 실측)**: `npx supermemory local`은 포트 미지정 시
> `PORT` 환경변수 또는 **8787**을 기본값으로 쓴다 — 공식 문서 예시(6767)와 다름.
> 플러그인/SDK 설정과 맞추려면 `--port 6767`을 명시할 것.
> npx 방식도 첫 실행 시 네이티브 서버 바이너리를 supermemory.ai/install 에서 받아 설치한다.
>
> 운영 보조 명령: `npx supermemory local status`(상태 확인) / `local env`(저장된 환경·키 확인) /
> `local upgrade`(서버 업그레이드) / `local path`(바이너리 경로)

### 첫 실행 Wizard

LLM 제공자 선택(OpenAI / Anthropic / Gemini / Groq / OpenAI호환 엔드포인트) → Ollama는
"OpenAI-compatible endpoint" 선택 후 Base URL `http://localhost:11434/v1`, 모델명 입력.
입력한 키는 암호화되어 저장됨.

### 환경변수로 직접 실행 (Wizard 건너뜀)

```bash
OPENAI_BASE_URL=http://localhost:11434/v1 \
OPENAI_API_KEY=ollama \
OPENAI_MODEL=gpt-oss:20b \
SUPERMEMORY_PORT=6767 \
SUPERMEMORY_DATA_DIR=~/.supermemory-data \
SUPERMEMORY_DISABLE_TELEMETRY=1 \
npx supermemory local --port 6767
```

### 첫 부팅 출력 확인

- **API 키 (`sm_...`)가 콘솔에 출력됨 → 반드시 저장.** 이후 `~/.supermemory/env`에서 재확인 가능
- 실행 확인: `curl http://localhost:6767/v3/health`

---

## 주요 환경변수 (공식 Configuration 문서 기준)

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `SUPERMEMORY_PORT` (또는 `PORT`) | 6767 | HTTP 포트 |
| `SUPERMEMORY_DATA_DIR` | `./.supermemory` | 그래프 엔진 데이터·임베딩 모델 캐시 위치 |
| `OPENAI_BASE_URL` | OpenAI 서버 | Ollama: `http://localhost:11434/v1` |
| `OPENAI_API_KEY` | - | Ollama: `ollama` (임의 값) |
| `OPENAI_MODEL` | `gpt-5.1` | 기본 모델명 |
| `OPENAI_FAST_MODEL` | `OPENAI_MODEL` | 가벼운 작업용 오버라이드 |
| `OPENAI_TEXT_MODEL` | `OPENAI_MODEL` | 무거운 텍스트 처리용 오버라이드 |
| `ANTHROPIC_API_KEY` | - | Anthropic 사용 시 (docs/04 참고) |
| `SUPERMEMORY_DISABLE_TELEMETRY` | - | `1`로 설정하면 텔레메트리 비활성화 |
| `SUPERMEMORY_LOCAL_EMBEDDING_POOL_SIZE` | 1 | 내장 임베딩 워커 수 |
| `SUPERMEMORY_LOCAL_EMBEDDING_BATCH_SIZE` | 8 | 임베딩 배치 크기 |

> ⚠️ 여러 제공자 키를 동시에 설정하면 **우선순위 첫 번째 하나만 사용**:
> OpenAI호환(`OPENAI_*`) > Anthropic > Gemini > Groq > Workers AI > Vertex.
> 작업별 분담·폴백 없음. 제공자 전환은 환경변수를 바꿔 서버 재시작 (데이터는 그대로 유지됨).

---

## STEP 4. Claude Code 연결 — 공식 플러그인

> ✅ **자작 MCP 래퍼 불필요** (구버전 가이드 폐기). 공식 플러그인
> [`supermemoryai/claude-supermemory`](https://github.com/supermemoryai/claude-supermemory)가
> 셀프호스팅 서버를 직접 지원한다. Pro 플랜 요구는 호스티드(supermemory.ai) 사용 시에만 해당.

```bash
# Claude Code 안에서:
/plugin marketplace add supermemoryai/claude-supermemory
/plugin install claude-supermemory
```

```bash
# ~/.zshrc 에 추가 후 터미널 재시작:
export SUPERMEMORY_API_URL="http://localhost:6767"
export SUPERMEMORY_CC_API_KEY="sm_여기에_로컬_서버_키"

# 선택:
export SUPERMEMORY_SKIP_TOOLS="Bash"   # 캡처 제외할 도구 (쉼표 구분)
export SUPERMEMORY_DEBUG=1             # 디버그 로그
```

### 플러그인이 하는 일

- **세션 시작 시** 관련 메모리를 가져와 컨텍스트에 자동 주입
- **자동 캡처**: Edit / Write / Bash / Task 사용 내역을 메모리로 저장
- 사용자 선호·프로젝트 지식을 세션 간 유지

### (참고) REST API 직접 호출

플러그인 없이 직접 쓸 경우 — 호스티드와 동일한 API가 로컬에서 동작:

```bash
# 메모리 추가
curl -X POST http://localhost:6767/v3/documents \
  -H "Authorization: Bearer sm_..." -H "Content-Type: application/json" \
  -d '{"content": "기억할 내용"}'

# 검색
curl -X POST http://localhost:6767/v3/search \
  -H "Authorization: Bearer sm_..." -H "Content-Type: application/json" \
  -d '{"q": "검색어"}'
```

> 구버전 가이드의 `/v1/memories` 경로는 잘못된 정보였음. 실제 경로는 `/v3/documents`,
> `/v3/search`, `/v4/profile`. 또한 Claude Code의 MCP 설정은 `~/.claude/settings.json`이
> 아니라 `claude mcp add`(→ `~/.claude.json`) 또는 프로젝트 `.mcp.json`을 쓴다.

---

## STEP 5. 데이터 관리

```bash
# 저장 위치 (SUPERMEMORY_DATA_DIR 지정 시)
ls ~/.supermemory-data/

# 자격증명(API 키) 저장 위치
cat ~/.supermemory/env

# 백업
cp -r ~/.supermemory-data/ ~/backup/supermemory-$(date +%Y%m%d)

# 초기화
rm -rf ~/.supermemory-data/
```

---

## macOS 자동 시작 (launchd)

```bash
cat > ~/Library/LaunchAgents/supermemory.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.supermemory.local</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/supermemory-server</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OPENAI_BASE_URL</key>  <string>http://localhost:11434/v1</string>
    <key>OPENAI_API_KEY</key>   <string>ollama</string>
    <key>OPENAI_MODEL</key>     <string>gpt-oss:20b</string>
    <key>SUPERMEMORY_DATA_DIR</key> <string>/Users/&lt;username&gt;/.supermemory-data</string>
    <key>SUPERMEMORY_DISABLE_TELEMETRY</key> <string>1</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
EOF

# 바이너리 실제 경로 확인 후 (which supermemory-server) 필요 시 plist 수정
launchctl load ~/Library/LaunchAgents/supermemory.plist
```

> launchd는 `~` 확장이 안 되므로 `SUPERMEMORY_DATA_DIR`는 절대경로로 지정.

---

## 셀프호스팅 제약 (호스티드 대비)

| 기능 | 셀프호스팅 | 호스티드 |
|------|-----------|---------|
| Memory API 전체 (documents/search/profile) | ✅ | ✅ |
| 하이브리드 시맨틱 검색 | ✅ | ✅ |
| 임베딩 | 내장 로컬 | 관리형 |
| 파일 인제스트 (PDF/이미지) | ✅ (이미지·영상·고품질 PDF는 Gemini/Vertex 키 필요) | ✅ |
| 커넥터 (Drive/Notion/Gmail) | ❌ | ✅ |
| 호스티드 MCP (`mcp.supermemory.ai`) | ❌ (대신 Claude Code 플러그인 사용) | ✅ |
| 메모리 추출 모델 | 직접 지정 (Ollama 등) | 자체 모델 |

---

## 전체 흐름

```
[Ollama] gpt-oss:20b (텍스트 추출용)
    ↓ localhost:11434/v1
[Supermemory Server]  ← 임베딩은 서버 내장 로컬 엔진
    ↓ localhost:6767 (REST API)
[claude-supermemory 공식 플러그인]
    ↓ SUPERMEMORY_API_URL / SUPERMEMORY_CC_API_KEY
[Claude Code]
```

**비용: $0 / 외부 전송: 없음 / 데이터: 로컬 완전 통제**

상용 LLM API를 추출 모델로 쓸 경우의 보안 분석은 `docs/04-llm-provider-security.md` 참고.
