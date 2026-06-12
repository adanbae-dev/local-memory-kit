# Supermemory 개요

## 한 줄 정의

AI 에이전트를 위한 메모리 인프라 플랫폼.  
LLM(Claude, ChatGPT 등)이 대화와 문서를 "기억"하도록 메모리 계층을 제공하는 미들웨어.

> "The memory layer for AI agents. Context engineering platform powering enterprise APIs, developer plugins, and a personal app."

---

## 핵심 기능

| 기능 | 설명 |
|------|------|
| 사용자 프로필 | 행동 데이터로 의도·선호도·컨텍스트 자동 구성 |
| 메모리 그래프 | 온톨로지 인식 엣지를 가진 커스텀 벡터 그래프 엔진 |
| 하이브리드 검색 | 벡터+키워드 검색, 응답 300ms 이하 |
| 추출기 | PDF, 웹페이지, 이미지, 오디오 등 다양한 포맷 처리 |
| 커넥터 | Notion, Google Drive, Gmail, S3 등 외부 소스 연동 |

---

## 사용 방법 (3가지)

### 1. 개인 앱
- supermemory.ai 직접 접속
- 브라우저 익스텐션 **Hermes Plugin** 설치 → 웹 서핑 중 자동 저장
- **Supermemory MCP** → Claude, Cursor 등에 메모리 연결

### 2. 개발자 SDK/API
```typescript
await supermemory.add({ content: "..." })
const results = await supermemory.search({ query: "..." })
```
- TypeScript / Python SDK 제공
- REST API, OpenAPI 스펙 지원

### 3. 엔터프라이즈 API
- AI 제품에 메모리 기능을 내장하는 B2B 솔루션

---

## 가격 정책

| 등급 | 월 요금 | 포함 사용량 | 주요 기능 |
|------|---------|------------|----------|
| Free | $0 | $5/월 상당 | Hermes Plugin, MCP, 커뮤니티 지원 |
| Pro | $19 | $20/월 상당 | 무제한 저장, Google Drive/Notion/OneDrive 커넥터, 팀원 2명 |
| Max | $100 | $130/월 상당 | Pro 전체 + Gmail/Granola 커넥터, 우선 지원 |
| Scale | $399 | $600/월 상당 | 팀원 10명, SOC 2 + HIPAA BAA, 셀프호스팅 옵션 |
| Enterprise | 협의 | 맞춤형 | 전담 계정 담당자, SLA 보장 |

> **참고 (2026-06-12)**: 로컬 셀프호스팅(`supermemory-server`)은 플랜과 무관하게 **무료·오픈소스(MIT)**.
> Scale 플랜의 "셀프호스팅 옵션"은 엔터프라이즈 배포 지원을 의미한다. → `docs/03` 참고

### API 종량제 요금

| 항목 | 일반 | 리치 콘텐츠 |
|------|------|------------|
| Memory (1K SM 토큰) | $0.005 | $0.010 |
| SuperRAG (1K 토큰) | $0.001 | $0.002 |
| 검색 (1K 쿼리) | $0.005 | - |
| 운영 (1K 작업) | $0.10 | - |

---

## 보안 고려사항

- 프리~Max 플랜: SOC 2 / HIPAA 미적용 → 회사 민감 데이터 사용 금지
- 데이터가 미국 외부 서버로 전송됨
- **회사 코드, DB 스키마, 미출시 기획 등은 반드시 셀프호스팅으로**

| 사용 목적 | 권고 |
|----------|------|
| 개인 학습, 사이드 프로젝트 | 사용 가능 |
| 회사 일반 업무 | 주의하며 사용 |
| 회사 코드 / DB / 미출시 기획 | 사용 금지 |
| 고객 개인정보 포함 작업 | 절대 사용 금지 |
