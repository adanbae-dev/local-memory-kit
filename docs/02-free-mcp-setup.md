# Supermemory Free 플랜 MCP 연결 가이드

> 외부 서버 사용 (데이터가 supermemory.ai 서버에 저장됨)
> 개인 학습, 사이드 프로젝트 용도 권장

---

## Step 1. 계정 생성

https://console.supermemory.ai 에서 무료 가입

---

## Step 2. MCP 자동 설치

```bash
npx -y install-mcp@latest https://mcp.supermemory.ai/mcp --client claude --oauth=yes
```

실행하면 브라우저 OAuth 로그인 → `~/.claude/settings.json` 자동 설정

---

## Step 3. 수동 설정 (선택)

> **2026-06-12 정정**: Claude Code는 `~/.claude/settings.json`에서 `mcpServers`를 읽지 않는다.
> `claude mcp add` 명령(유저 스코프 → `~/.claude.json`에 기록) 또는 프로젝트 `.mcp.json`을 사용할 것.

### OAuth 방식

```bash
claude mcp add --transport http supermemory https://mcp.supermemory.ai/mcp
# 이후 Claude Code 안에서 /mcp 실행 → 브라우저 OAuth 인증
```

### API 키 방식

1. console.supermemory.ai → API Keys → Create API Key
2. 헤더와 함께 등록:

```bash
claude mcp add --transport http supermemory https://mcp.supermemory.ai/mcp \
  --header "Authorization: Bearer sm_여기에_API키"
```

---

## Claude에서 사용

| 명령 | 동작 |
|------|------|
| "이거 기억해줘" | 메모리에 저장 |
| "내가 전에 말한 XX 기억해?" | 메모리 검색 후 답변 |
| `/context` (Claude Code) | 저장된 프로필 전체 주입 |

내부 도구:
- `memory` — 저장/삭제
- `recall` — 검색
- `context` — 전체 프로필 주입

---

## 프리 플랜 제한

- 월 $5 상당 사용량 포함
- SOC 2 / HIPAA 미적용
- 셀프호스팅 불가
