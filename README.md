# Supermemory 로컬 셋업

Ollama + Supermemory 셀프호스팅으로 구축한 **로컬 AI 메모리 서버**.
데이터가 로컬 밖으로 나가지 않으며(외부 전송 0), 비용 $0, 회사 보안 정책에 적합.

> 상태: ✅ 설치·동작 검증 완료 (2026-06-12) · 남은 작업은 Claude Code 플러그인 연결 1단계

> ⚠️ **비공식 · "Supermemory 호환" 도구**: 본 저장소는 Supermemory·Ollama와 **제휴/공식 관계가 없습니다**.
> 자체 코드(설치 스크립트·관리 UI·문서)만 **MIT**로 배포하며, **Supermemory 서버 바이너리·플러그인·Ollama·LLM 모델은 이 저장소에 번들하지 않고** 사용자가 공식 경로에서 직접 설치합니다(각자 라이선스 적용).
> "Supermemory"는 해당 소유자의 상표이며 본 프로젝트는 이를 브랜드로 사용하지 않습니다. 자세한 라이선스·재배포 주의는 [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md) 참고.

---

## 구성

```
[Ollama] gemma4:e4b (메모리 추출용 · tool 지원 필수)
    ↓ localhost:11434/v1
[Supermemory Server]  ← 임베딩은 서버 내장 로컬 엔진(bge-base-en-v1.5)
    ↓ localhost:6767 (REST API, 암호화 로컬 저장)
[claude-supermemory 공식 플러그인]
    ↓
[Claude Code]
```

| 항목 | 값 |
|------|-----|
| 서버 | `~/.local/bin/supermemory-server` 0.0.2 |
| 데이터 | `~/.supermemory-data` (암호화 로컬 저장) |
| API URL | `http://localhost:6767` |
| 추출 모델 | Ollama `gemma4:e4b` (tool 지원 + reasoning 누출 없음 검증) |
| 임베딩 | 서버 내장 `Xenova/bge-base-en-v1.5` (별도 모델 불필요) |
| 자동 기동 | launchd `com.adanbae.supermemory.local` (로그인 시 + 크래시 재시작) |

---

## 빠른 시작

### 서버 (이미 설치·기동됨)

서버는 launchd로 자동 기동되므로 평소엔 별도 실행이 필요 없다.

```bash
# 상태 확인
launchctl list | grep supermemory        # Status 0 = 정상
curl http://localhost:6767/v3/health

# 수동 재시작 / 중지
launchctl kickstart -k gui/$(id -u)/com.adanbae.supermemory.local
launchctl unload ~/Library/LaunchAgents/com.adanbae.supermemory.local.plist

# 로그
tail -f ~/Library/Logs/supermemory.out.log
```

### Claude Code 연결 (남은 1단계)

인터랙티브 Claude Code 세션에서:

```
/plugin marketplace add supermemoryai/claude-supermemory
/plugin install claude-supermemory
```

→ 설치 후 **새 터미널**에서 Claude Code 재시작. `~/.zshrc`의
`SUPERMEMORY_API_URL`(`http://localhost:6767`)과 `SUPERMEMORY_CC_API_KEY`를
플러그인이 자동으로 읽어 로컬 서버에 연결한다.

플러그인 동작: 세션 시작 시 관련 메모리 자동 주입 + Edit/Write/Bash/Task 사용 내역 자동 캡처.

---

## 다른 프로젝트에서 사용 / 동작 방식

`/supermemory:status`는 **연결 확인용 진단 명령**이다 — 적재(캡처)는 이걸 실행하지 않아도 **자동**으로 된다.

- **자동 동작**: 플러그인 훅이 세션 시작 시 관련 메모리를 주입(SessionStart)하고, 세션 종료 시 작업 내역을 캡처·추출(Stop)한다.
- **모든 프로젝트 자동 적용**: 플러그인은 user 스코프라 모든 프로젝트에 적용된다. `~/.zshrc`의 `SUPERMEMORY_API_URL`(`http://localhost:6767`)·`SUPERMEMORY_CC_API_KEY`를 읽어 로컬 서버에 연결하므로, **`~/.zshrc`를 읽는 터미널에서 Claude Code를 켜면** 어느 프로젝트에서나 동작한다.
- **프로젝트별 자동 격리**: 컨테이너 태그가 **git 루트 기준**(`claudecode_project_<sha256(gitroot)[:16]>`)으로 자동 분리되어, 프로젝트 간 메모리가 섞이지 않는다.
- **확인(선택)**: `/supermemory:status`로 연결이 정상인지 볼 수 있다(적재 전제 조건은 아님).

> **"not authenticated"로 뜨면** (예: IDE/GUI로 띄워 `~/.zshrc` 환경변수가 안 잡힌 경우) 해당 프로젝트에 폴백 설정을 둔다:
> ```json
> // .claude/.supermemory-claude/config.json  (키 포함 → 커밋 금지: .gitignore 권장)
> { "apiKey": "sm_로컬_키", "baseUrl": "http://localhost:6767" }
> ```
> `baseUrl`을 반드시 로컬로 지정해야 호스티드(api.supermemory.ai)로 전송되지 않는다.

---

## REST API 직접 사용 (플러그인 없이)

```bash
# 저장
curl -X POST http://localhost:6767/v3/documents \
  -H "Content-Type: application/json" \
  -d '{"content":"기억할 내용"}'

# 검색
curl -X POST http://localhost:6767/v3/search \
  -H "Content-Type: application/json" \
  -d '{"q":"검색어"}'
```

localhost 요청에는 서버 API 키가 자동 적용된다.

---

## 보안

- **모든 데이터가 로컬에 암호화 저장**되며 외부로 전송되지 않는다 (Ollama 추출 사용 시).
- 추출 모델을 상용 LLM API(OpenAI/Anthropic/Gemini/Groq)로 바꾸면 **메모리 원문이 해당 제공자로 전송**된다 → `docs/04-llm-provider-security.md` 참고.
- 여러 제공자를 동시에 설정할 수 없다(우선순위 첫 번째만 사용). 전환은 서버 재시작.

---

## 안정성 / 강건성 튜닝

세션 트랜스크립트 자동 캡처는 특수 토큰·제어문자가 많아, supermemory 0.0.3에서 내부 직렬화가 깨지며 문서가 `failed`로 끝날 수 있다(`C++ panic` / `Malformed JSON`). 임베딩·인덱싱은 되지만(검색 가능) 추출 단계에서 크래시되는 형태다. 실패율을 낮추는 설정:

- **캡처 노이즈 축소(플러그인)**: `~/.zshrc`에 `export SUPERMEMORY_SKIP_TOOLS="Bash"` — 큰 명령출력 캡처 제외. (`npm run setup`이 자동 추가)
- **임베딩 동시성·메모리 완화(서버 plist)**: `SUPERMEMORY_LOCAL_EMBEDDING_POOL_SIZE=1` · `SUPERMEMORY_LOCAL_EMBEDDING_BATCH_SIZE=4` · `SUPERMEMORY_EMBEDDING_RAM_LIMIT=2gb`. (`npm run setup`이 plist에 자동 포함)
- **신뢰 추출은 수동 저장**: 깔끔한 사실 문장은 100% 추출됨 — 중요한 건 수동 저장, 자동 캡처는 보조.
- **정체/실패 문서 정리**: `queued`에 영구 정체(재시도 루프)되면 재시작이 아니라 **bulk delete**(`DELETE /v3/documents/bulk`)로 해당 문서를 제거하면 풀린다.
- **근본 해결**: 서버 강건성은 업스트림 영역 — 주기적으로 `~/.supermemory/bin/supermemory-server upgrade`.

---

## 문서

| 파일 | 내용 |
|------|------|
| [`handoff.md`](./handoff.md) | 셋업 진행상황·실측 결과·운영 명령 |
| [`docs/01-supermemory-overview.md`](./docs/01-supermemory-overview.md) | 서비스 개요·가격·보안 |
| [`docs/02-free-mcp-setup.md`](./docs/02-free-mcp-setup.md) | Free 플랜(호스티드) MCP 연결 |
| [`docs/03-local-setup.md`](./docs/03-local-setup.md) | Ollama + 셀프호스팅 전체 설치 가이드 |
| [`docs/04-llm-provider-security.md`](./docs/04-llm-provider-security.md) | 상용 LLM API 데이터 유출 분석 |

## 참고 링크

- 셀프호스팅 문서: https://supermemory.ai/docs/self-hosting/overview
- 플러그인: https://github.com/supermemoryai/claude-supermemory
- 본체 (MIT): https://github.com/supermemoryai/supermemory

---

## 라이선스

- 본 저장소의 **자체 코드(설치 스크립트·관리 UI·문서)는 [MIT](./LICENSE)** 로 배포됩니다.
- **Supermemory 서버 바이너리·플러그인·Ollama·LLM 모델은 번들하지 않으며** 각자 라이선스를 따릅니다. 공식 self-hosted 바이너리의 재배포 권리는 MIT 공개 레포(`supermemoryai/supermemory`) 범위 밖일 수 있어, 본 저장소는 이를 **포함하지 않고** 공식 설치 경로(`npx supermemory local install`)만 사용합니다.
- "Supermemory"는 해당 소유자의 **상표**이며 본 프로젝트는 이를 브랜드로 사용하지 않습니다(“Supermemory 호환” 표기).
- 상세·모델별 라이선스: [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md)

---

## 🚀 원스톱 설치 (이 저장소를 공유받았다면)

요구사항: macOS 14+, [Homebrew](https://brew.sh), Node 18+, (플러그인은 Claude Code 필요)

```bash
git clone <이_저장소_URL> supermemory && cd supermemory
npm run setup        # Ollama → 모델 → 서버 → launchd → API키 → 플러그인 → UI 의존성까지 전부
npm run dev          # 관리 UI → http://localhost:5173
```

- 가벼운 모델로 설치: `SM_MODEL=qwen3:8b npm run setup`
- 서버 상태/재시작/정지: `npm run server:status` / `server:restart` / `server:stop`
- 멱등 스크립트 — 이미 완료된 단계는 건너뛰므로 재실행 안전

### 관리 UI 기능
- **문서** 탭: 목록·페이지네이션·다중선택 일괄삭제·의미검색·추가·파일 업로드·본문 편집·청크 보기·**♻ 재추출**(실패/정체 문서)·JSON 내보내기·처리중 자동갱신
- **메모리** 탭: LLM이 추출한 기억 항목 열람·삭제
- **프로필** 탭: 메모리에서 자동 구축된 사용자 프로필 — **static(장기 특성: 잘 안 바뀌는 정체성·선호·규칙)** / **dynamic(최근 맥락: 진행 중 작업·최근 결정)**
- **인사이트** 탭: 문서 본문 공통 키워드 태그클라우드(클라이언트 집계)
- **이전 세션** 탭: 과거 Claude Code 세션(`~/.claude/projects`) 탐색·미리보기·**선택 백필**(정제 + 선택적 로컬 Ollama 요약, cwd→git 루트로 컨테이너 자동 매핑, sessionId 멱등)
- **태그** 탭: 폴더명 표기·이름변경·삭제·병합
- **서버 제어**: 시작·정지·재시작 (launchd)

> **프로필 분류 방식**: 각 메모리에 static/dynamic 플래그가 박히는 게 아니라, 서버의 프로필 빌더(LLM)가 메모리들을 읽어 **잘 안 변하는 사실 → static, 시점성 있는 최근 사실 → dynamic** 으로 판단해 `/v4/profile`이 두 목록으로 **파생**한다. 누적·재확인되며 안정화된 맥락은 dynamic→static으로 굳어진다.
