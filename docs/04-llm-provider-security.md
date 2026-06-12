# 상용 LLM API 사용 시 데이터 유출 점검

> **작성**: 2026-06-12. Supermemory 셀프호스팅에서 추출 모델을 Ollama 대신
> 상용 LLM API로 지정할 경우의 데이터 흐름·보존·학습 정책 분석.

---

## 1. 데이터 흐름: 무엇이 밖으로 나가나

셀프호스팅이어도 추출 모델을 상용 API로 지정하면:

| 구분 | 내용 |
|------|------|
| **외부로 나감** | 저장하는 **모든 메모리·문서의 원문** (메모리 추출 프롬프트로 전송), 프로필 생성·재처리 프롬프트 |
| **로컬에 남음** | 임베딩 계산(서버 내장 로컬 엔진), 벡터 그래프 DB, 원본 데이터 저장소 |

즉 "저장소는 로컬"이지만 **콘텐츠 전문이 최소 1회 제3자 서버를 통과**한다.
보안 평가는 해당 제공자의 보존·학습 정책 + 회사 승인 여부의 문제가 된다.

---

## 2. 제공자별 정책 비교 (2026-06 기준)

| 제공자 | 학습 사용 | 기본 보존 | ZDR(무보존) | 비고 |
|--------|----------|----------|-------------|------|
| **Anthropic API** | 기본 미사용 | **7일** (2025-09부터 30일→7일 단축) | 적격 기업 가능 (안전 분류기 결과는 유지) | 2025-09 약관 변경은 소비자 제품만 해당, API·상용은 무관 |
| **OpenAI API** | 기본 미사용 | 최대 30일 (어뷰즈 모니터링) | 적격 기업 가능 | NYT 소송 보존명령처럼 법적 사유가 정책을 무력화한 전례 있음 (ZDR은 예외였음) |
| **Gemini API 유료 / Vertex** | 미사용 | 제한적 로깅 (안전·어뷰즈 목적) | Vertex는 리전 제어 가능 | ⚠️ **무료 등급(AI Studio)은 학습에 사용 — 회사 데이터 절대 금지** |
| **Groq** | 기본 미사용 | 최대 30일 | 콘솔 Data Controls에서 옵트인 | |

---

## 3. 핵심 판단

이미 Claude Code로 회사 코드를 Anthropic API(상용 약관)에 전송하고 있다면,
supermemory 추출 모델로 `ANTHROPIC_API_KEY`를 쓰는 것은 **신뢰 경계를 새로 늘리지 않는다**
(동일 제공자·동일 약관·4사 중 최단 보존 7일). 반면 OpenAI/Gemini/Groq를 쓰면
회사 데이터가 통과하는 제3자가 하나 추가된다.

**민감도별 권장 순서:**

```
회사 코드/민감 데이터:  Ollama (완전 로컬)  >  Anthropic API (기존 신뢰 경계 내)  >  나머지
개인 학습/사이드 프로젝트: 아무 제공자나 무방 (단, Gemini 무료 키 제외)
```

### 함정 주의

1. **Gemini 무료 키 사용 금지** — 무료 등급은 프롬프트를 제품 개선(학습)에 사용
2. **`OPENAI_BASE_URL` 없이 `OPENAI_API_KEY`만 설정하면 OpenAI 서버로 전송됨** — Ollama 쓸 때 BASE_URL 누락 주의
3. 어떤 경우든 `SUPERMEMORY_DISABLE_TELEMETRY=1` 설정
4. 회사 보안 정책상 "승인된 LLM 제공자" 목록 확인 후 결정

---

## 4. 제공자 동시 사용 — 불가, 전환은 가능

여러 제공자 키를 동시에 설정해도 **함께 동작하지 않는다.** 공식 문서:
"With multiple providers configured, the first one in the order above is used."

**우선순위 (첫 번째 하나만 사용):**

1. `OPENAI_API_KEY` (Ollama는 `OPENAI_BASE_URL`로 이 자리에 들어감)
2. `ANTHROPIC_API_KEY`
3. `GEMINI_API_KEY`
4. `GROQ_API_KEY`
5. `WORKERS_AI_API_KEY` + `CLOUDFLARE_ACCOUNT_ID`
6. `GOOGLE_VERTEX_PROJECT_ID` + `GOOGLE_VERTEX_LOCATION`

- 작업별 라우팅(가벼운 건 Ollama, 무거운 건 Anthropic)·런타임 폴백 **없음**
- 예외: 이미지/영상/고품질 PDF 처리만 Gemini/Vertex 키가 있으면 별도로 그쪽 사용
- Ollama(`OPENAI_*`)와 `ANTHROPIC_API_KEY`를 둘 다 넣으면 **항상 Ollama가 이기고 Anthropic 키는 무시됨**

### 전환 운영 패턴

데이터는 `SUPERMEMORY_DATA_DIR`에 그대로 유지되므로, 서버를 띄우는 환경변수만 바꾸면
같은 메모리 저장소로 모델만 교체된다:

```bash
# ~/.zshrc — 민감도에 따라 골라서 실행
alias sm-local='OPENAI_BASE_URL=http://localhost:11434/v1 OPENAI_API_KEY=ollama \
  OPENAI_MODEL=gpt-oss:20b SUPERMEMORY_DATA_DIR=~/.supermemory-data \
  SUPERMEMORY_DISABLE_TELEMETRY=1 supermemory-server'

alias sm-claude='ANTHROPIC_API_KEY=sk-ant-여기에_키 \
  SUPERMEMORY_DATA_DIR=~/.supermemory-data \
  SUPERMEMORY_DISABLE_TELEMETRY=1 supermemory-server'
```

**전환 시 주의:**

- Anthropic 모드에서는 `OPENAI_*` 변수를 **반드시 제거** (셸 프로필·launchd plist에 남아 있으면 계속 Ollama로 감)
- Anthropic은 `OPENAI_MODEL` 같은 모델 지정 변수가 문서화되어 있지 않음 — 서버 기본 Claude 모델 사용
- 전환 후 저장하는 메모리부터 새 모델로 추출됨. 기존 메모리는 소급 재처리되지 않음

---

## 출처

- https://supermemory.ai/docs/self-hosting/configuration (제공자 우선순위·환경변수)
- https://privacy.claude.com/en/articles/10023548-how-long-do-you-store-my-data (Anthropic 보존)
- https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training (Anthropic 학습)
- https://openai.com/enterprise-privacy/ / https://platform.openai.com/docs/guides/your-data (OpenAI)
- https://docs.cloud.google.com/gemini/docs/discover/data-governance (Google)
- https://console.groq.com/docs/your-data (Groq)
