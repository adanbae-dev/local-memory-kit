// Vite devServer 프록시(/api → http://localhost:6767)를 통해 호출.
// 모든 경로는 supermemory 로컬 서버 REST API (v3) 기준 — 실측 확인된 엔드포인트만 사용.
const BASE = "/api";

export interface SmDocument {
  id: string;
  title: string | null;
  content: string | null;
  type: string;
  source: string | null;
  taskType: string | null;
  status: string | null;
  createdAt: string;
  updatedAt: string;
  containerTags: string[];
  metadata: Record<string, unknown>;
  tokenCount: number | null;
  summary: string | null;
}

export interface Pagination {
  currentPage: number;
  limit: number;
  totalItems: number;
  totalPages: number;
}

export interface SearchChunk {
  content: string;
  score: number;
  isRelevant: boolean;
}

export interface SearchResult {
  documentId: string;
  title: string;
  score: number;
  chunks: SearchChunk[];
  createdAt: string;
  updatedAt: string;
  type: string;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return undefined as T;
  return res.json() as Promise<T>;
}

// 문서 목록 — 실측: POST /v3/documents/documents { containerTags, limit, page }
export function listDocuments(
  containerTag: string,
  page = 1,
  limit = 50
): Promise<{ documents: SmDocument[]; pagination: Pagination }> {
  return req("/v3/documents/documents", {
    method: "POST",
    body: JSON.stringify({ containerTags: [containerTag], page, limit }),
  });
}

// 검색 — 실측: POST /v3/search { q }
export function searchMemories(
  q: string,
  containerTag?: string
): Promise<{ results: SearchResult[]; total: number; timing: number }> {
  const body: Record<string, unknown> = { q };
  if (containerTag) body.containerTags = [containerTag];
  return req("/v3/search", { method: "POST", body: JSON.stringify(body) });
}

// 추가 — 실측: POST /v3/documents { content, containerTags }
export function addMemory(
  content: string,
  containerTag: string
): Promise<{ id: string; status: string }> {
  return req("/v3/documents", {
    method: "POST",
    body: JSON.stringify({ content, containerTags: [containerTag] }),
  });
}

// 삭제 — CLI `docs delete <id>` 대응: DELETE /v3/documents/{id}
export function deleteDocument(id: string): Promise<void> {
  return req(`/v3/documents/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ── 서버 제어 (Vite 미들웨어 /admin/server/* → launchctl) ──
export interface ServerStatus {
  loaded: boolean;
  pid: number | null;
  healthy: boolean;
}

export async function serverStatus(): Promise<ServerStatus> {
  const res = await fetch("/admin/server/status");
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

export async function serverControl(
  action: "start" | "stop" | "restart"
): Promise<{ ok: boolean }> {
  const res = await fetch(`/admin/server/${action}`, { method: "POST" });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(t || `${action} 실패 (${res.status})`);
  }
  return res.json();
}

// ── 컨테이너 태그 목록 — 실측: GET /v3/container-tags/list ──
export interface TagInfo {
  id: string;
  name: string;
  containerTag: string;
  documentCount: number;
  memoryCount: number;
  lastActivityAt: string | null;
}

export function listTags(): Promise<TagInfo[]> {
  return req<TagInfo[]>("/v3/container-tags/list").catch(() => []);
}

// ════════ v4 추출 메모리 / 프로필 / 문서 고급 기능 (openapi 실측 기반) ════════

export interface MemoryEntry {
  id: string;
  memory: string;
  version: number;
  isLatest: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Chunk {
  content?: string;
  position?: number;
}

export interface ProfileData {
  static: string[];
  dynamic: string[];
}

// 추출 메모리 목록 — POST /v4/memories/list
export function listMemories(
  containerTag: string,
  page = 1,
  limit = 50
): Promise<{ memoryEntries: MemoryEntry[]; pagination: Pagination }> {
  return req("/v4/memories/list", {
    method: "POST",
    body: JSON.stringify({ containerTags: [containerTag], page, limit }),
  });
}

// 메모리 삭제(forget) — DELETE /v4/memories
export function deleteMemory(id: string, containerTag: string): Promise<{ forgotten: boolean }> {
  return req("/v4/memories", {
    method: "DELETE",
    body: JSON.stringify({ id, containerTag }),
  });
}

// 사용자 프로필 — POST /v4/profile
export function getProfile(containerTag: string): Promise<{ profile: ProfileData }> {
  return req("/v4/profile", {
    method: "POST",
    body: JSON.stringify({ containerTag }),
  });
}

// 일괄 삭제 — DELETE /v3/documents/bulk (최대 100개)
export function bulkDeleteDocuments(ids: string[]): Promise<unknown> {
  return req("/v3/documents/bulk", {
    method: "DELETE",
    body: JSON.stringify({ ids }),
  });
}

// 재추출 — 동일 content PATCH는 no-op이라, 삭제 후 같은 내용으로 재등록해 파이프라인 재실행.
// 단일 DELETE는 잠김 시 409가 나므로 bulk 삭제 사용.
export async function reprocessDocument(
  id: string,
  content: string,
  containerTag: string
): Promise<{ id: string; status: string }> {
  await bulkDeleteDocuments([id]);
  return addMemory(content, containerTag);
}

// 처리중 문서 — GET /v3/documents/processing
export function getProcessing(): Promise<{ documents: { id: string; status?: string }[]; totalCount: number }> {
  return req("/v3/documents/processing");
}

// 문서 청크 — GET /v3/documents/{id}/chunks
export function getChunks(id: string): Promise<{ chunks: Chunk[]; total: number }> {
  return req(`/v3/documents/${encodeURIComponent(id)}/chunks`);
}

// 문서 수정 — PATCH /v3/documents/{id}
export function updateDocument(id: string, content: string): Promise<{ id: string; status: string }> {
  return req(`/v3/documents/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ content }),
  });
}

// 파일 업로드 — POST /v3/documents/file (multipart)
export async function uploadFile(file: File, containerTag: string): Promise<{ id: string; status: string }> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("containerTag", containerTag);
  const res = await fetch(`${BASE}/v3/documents/file`, { method: "POST", body: fd });
  if (!res.ok) throw new Error(`업로드 실패 ${res.status}: ${await res.text().catch(() => "")}`);
  return res.json();
}

// 태그 이름 변경 — PATCH /v3/container-tags/{tag}
export function renameTag(containerTag: string, name: string): Promise<unknown> {
  return req(`/v3/container-tags/${encodeURIComponent(containerTag)}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

// 태그 삭제 — DELETE /v3/container-tags/{tag}
export function deleteTag(containerTag: string): Promise<unknown> {
  return req(`/v3/container-tags/${encodeURIComponent(containerTag)}`, { method: "DELETE" });
}

// 태그 병합 — POST /v3/container-tags/merge (source+target 2개 → target으로)
export function mergeTags(sourceTag: string, targetTag: string): Promise<{ success: boolean; mergedCount: number }> {
  return req("/v3/container-tags/merge", {
    method: "POST",
    body: JSON.stringify({ containerTags: [sourceTag, targetTag], targetContainerTag: targetTag }),
  });
}

// ════════ 이전 세션 백필 (Vite 미들웨어 /admin/sessions/*) ════════
export interface SessionMeta {
  file: string;
  sessionId: string;
  cwd: string;
  project: string;
  title: string;
  userCount: number;
  assistantCount: number;
  mtime: number;
  imported: boolean;
}
export interface SessionDetail {
  cwd: string;
  title: string;
  text: string;
  userCount: number;
  assistantCount: number;
}
export interface ImportResult {
  sessionId: string;
  ok: boolean;
  containerTag?: string;
  folder?: string;
  error?: string;
}

export async function listSessions(): Promise<SessionMeta[]> {
  const r = await fetch("/admin/sessions/list");
  if (!r.ok) throw new Error(`세션 목록 실패 ${r.status}`);
  return r.json();
}
export async function getSession(file: string): Promise<SessionDetail> {
  const r = await fetch(`/admin/sessions/get?file=${encodeURIComponent(file)}`);
  if (!r.ok) throw new Error(`세션 로드 실패 ${r.status}`);
  return r.json();
}
export async function importSessions(
  files: string[],
  summarize: boolean,
  containerTag?: string
): Promise<{ results: ImportResult[] }> {
  const r = await fetch("/admin/sessions/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files, summarize, containerTag }),
  });
  if (!r.ok) throw new Error(`가져오기 실패 ${r.status}`);
  return r.json();
}

// 화면 표시용 번역 (영→한, 로컬 Ollama). 저장 데이터는 변경하지 않음 — 표시 전용.
export async function translate(texts: string[]): Promise<string[]> {
  if (texts.length === 0) return [];
  const r = await fetch("/admin/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts }),
  });
  if (!r.ok) throw new Error(`번역 실패 ${r.status}`);
  const j = (await r.json()) as { translations: string[] };
  return j.translations;
}
