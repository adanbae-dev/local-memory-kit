# Third-Party Notices

이 저장소의 **자체 코드(설치 스크립트·관리 UI·문서)는 MIT License**로 배포됩니다([`LICENSE`](./LICENSE)).
아래 구성요소는 **이 저장소에 포함(번들)되어 있지 않으며**, 사용자가 직접 설치/다운로드합니다.
각 구성요소는 고유 라이선스를 가지므로, 특히 상용/회사 환경에서는 직접 확인하시기 바랍니다.

> 본 프로젝트는 Supermemory 및 Ollama와 **제휴/공식 관계가 없는 비공식(unofficial) "호환" 도구**입니다.

## ⚠️ 재배포(Redistribution) 주의 — 중요
- **공개 레포 `supermemoryai/supermemory`는 MIT**이지만, 여기엔 **핵심 백엔드(메모리 엔진)가 포함돼 있지 않습니다**(프론트엔드/클라이언트 SDK 중심). 공식 self-hosted 배포는 상위 플랜(엔터프라이즈) 영역입니다.
- `npx supermemory local install`(= `supermemory.ai/install`)로 받는 **self-hosted 서버 바이너리**는 *배포된 바이너리*로, MIT 레포 코드와 별개이며 **재배포 권리가 보장되지 않습니다**.
- 따라서 **본 저장소는 그 바이너리를 번들/재배포하지 않고**, `scripts/setup.mjs`가 **공식 설치 경로만 호출**합니다(사용자 머신에서 직접 설치). 저장소에 커밋된 바이너리는 없습니다.
- 안전한 사용 형태: ① MIT 레포 코드 사용/포크(저작권·라이선스 고지 유지) ② API 호환 백엔드 자체 구현 ③ 공식 바이너리는 *각자 공식 경로로 설치*.

## ™ 상표(Trademark)
MIT는 **코드 사용 권리만** 부여하고 **브랜드명 권리는 주지 않습니다**. "Supermemory"는 해당 소유자의 상표이므로, 본 프로젝트는 이를 제품명/브랜드로 사용하지 않고 **"Supermemory 호환(compatible)"** 으로만 표기합니다. 포크/재사용 시에도 동일 원칙을 권장합니다.

## 런타임 의존성 (관리 UI, `web/` — `node_modules` 미커밋)
| 구성요소 | 라이선스 | 비고 |
|---|---|---|
| React, React-DOM | MIT | Meta |
| Vite, @vitejs/plugin-react | MIT | |
| TypeScript | Apache-2.0 | Microsoft |
| @types/* (DefinitelyTyped) | MIT | |

> `node_modules`는 저장소에 포함되지 않습니다(`npm install` 시 각자 설치). 본 저장소는 위 패키지를 재배포하지 않습니다.

## 참조하는 외부 소프트웨어 (사용자가 공식 경로로 설치)
| 구성요소 | 라이선스 | 출처 |
|---|---|---|
| supermemory (공개 레포: FE/SDK) | MIT | https://github.com/supermemoryai/supermemory |
| supermemory self-hosted 바이너리 | **배포 바이너리 — 재배포 권리 불명확** | https://supermemory.ai (공식 설치) |
| claude-supermemory (플러그인) | MIT | https://github.com/supermemoryai/claude-supermemory |
| Ollama | MIT | https://github.com/ollama/ollama |

## 추출 모델 (Ollama로 사용자가 받음 — 라이선스 상이, 직접 확인 필요)
| 모델 | 라이선스 | 출처 | 상용 사용 주의 |
|---|---|---|---|
| Gemma 3 | **Google Gemma Terms of Use** (OSI 아님) | Google | 사용 제한 조항 확인 필요 |
| Llama 3.1 / 3.2 | **Llama Community License** | Meta | MAU 700M 초과 시 별도 |
| Mistral-Nemo | Apache-2.0 | Mistral AI | 자유 |
| IBM Granite 3.x | Apache-2.0 | IBM | 자유 |
| Phi-4 | MIT | Microsoft | 자유 |
| gpt-oss | Apache-2.0 | OpenAI | 자유 |

모델 라이선스는 변경될 수 있으니, 사용 전 각 모델의 Ollama 페이지/원본 라이선스를 확인하세요.

> 면책: 본 문서는 법률 자문이 아닙니다. 상용/배포 시 각 라이선스 원문과 상표 정책을 직접 확인하세요.
