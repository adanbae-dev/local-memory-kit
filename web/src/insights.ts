// 프로젝트 폴더 매핑 + 문서 공통 키워드 추출 (모두 로컬, 외부 전송 없음)

export interface ProjectInfo {
  folder: string;
  path: string;
}
export type ProjectMap = Record<string, ProjectInfo>;

// Vite 미들웨어(/admin/projects/scan)가 git 저장소를 스캔해
// claudecode_project_<hash> → {folder, path} 맵을 돌려준다.
export async function resolveProjects(): Promise<ProjectMap> {
  try {
    const res = await fetch("/admin/projects/scan");
    if (!res.ok) return {};
    return (await res.json()) as ProjectMap;
  } catch {
    return {};
  }
}

// ───────────────── 클라이언트 키워드/구문 추출 ─────────────────

export interface Term {
  term: string;
  count: number;
}

// 영어 + 한국어 불용어(조사·접속·일반어) — 완벽하진 않아도 노이즈 대부분 제거
const STOP = new Set([
  // english
  "the", "a", "an", "and", "or", "but", "if", "then", "else", "for", "of", "to", "in", "on",
  "at", "by", "with", "from", "as", "is", "are", "was", "were", "be", "been", "being", "this",
  "that", "these", "those", "it", "its", "i", "you", "he", "she", "we", "they", "them", "his",
  "her", "their", "our", "my", "me", "us", "do", "does", "did", "not", "no", "yes", "can", "will",
  "would", "should", "could", "have", "has", "had", "what", "which", "who", "when", "where", "how",
  "why", "all", "any", "some", "more", "most", "other", "such", "than", "too", "very", "just",
  "also", "into", "over", "out", "up", "down", "about", "after", "before", "use", "using", "used",
  "get", "set", "new", "via", "etc", "http", "https", "www", "com", "org",
  // korean
  "그리고", "그런데", "하지만", "그러나", "또는", "또한", "그래서", "때문", "위해", "통해",
  "대한", "관련", "이것", "저것", "그것", "여기", "거기", "에서", "으로", "하는", "한다",
  "했다", "합니다", "있다", "없다", "같은", "이런", "저런", "그런", "되는", "되어", "된다",
  "이며", "이고", "수가", "것을", "것이", "것은", "들이", "에게", "보다", "처럼", "면서",
  "경우", "내용", "사용", "확인", "진행", "필요", "가능", "다시", "한번", "정도", "관리",
]);

const TOKEN_RE = /[a-z0-9]{2,}|[가-힣]{2,}/g;

function tokenize(text: string): string[] {
  const out: string[] = [];
  const m = text.toLowerCase().match(TOKEN_RE);
  if (!m) return out;
  for (const t of m) {
    if (STOP.has(t)) continue;
    if (/^[0-9]+$/.test(t)) continue; // 순수 숫자 제외
    out.push(t);
  }
  return out;
}

function topN(counts: Map<string, number>, n: number, minCount: number): Term[] {
  return [...counts.entries()]
    .filter(([, c]) => c >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([term, count]) => ({ term, count }));
}

export interface Keywords {
  unigrams: Term[];
  bigrams: Term[];
  docCount: number;
}

// 여러 문서 본문에서 공통 단어/구문 빈도를 집계.
// 한 문서 안의 중복은 1회로 세어(문서 빈도) 특정 문서의 반복어가 과대평가되는 것을 막는다.
export function extractKeywords(texts: string[], topUnigrams = 40, topBigrams = 12): Keywords {
  const uni = new Map<string, number>();
  const bi = new Map<string, number>();
  for (const text of texts) {
    const toks = tokenize(text || "");
    const seenU = new Set<string>();
    const seenB = new Set<string>();
    for (let i = 0; i < toks.length; i++) {
      if (!seenU.has(toks[i])) {
        seenU.add(toks[i]);
        uni.set(toks[i], (uni.get(toks[i]) || 0) + 1);
      }
      if (i + 1 < toks.length) {
        const g = `${toks[i]} ${toks[i + 1]}`;
        if (!seenB.has(g)) {
          seenB.add(g);
          bi.set(g, (bi.get(g) || 0) + 1);
        }
      }
    }
  }
  const minCount = texts.length >= 4 ? 2 : 1;
  return {
    unigrams: topN(uni, topUnigrams, minCount),
    bigrams: topN(bi, topBigrams, minCount),
    docCount: texts.length,
  };
}
