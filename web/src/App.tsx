import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  extractKeywords,
  resolveProjects,
  type Keywords,
  type ProjectMap,
} from "./insights";
import {
  addMemory,
  bulkDeleteDocuments,
  reprocessDocument,
  deleteDocument,
  deleteMemory,
  deleteTag,
  getChunks,
  getProfile,
  listDocuments,
  listMemories,
  listTags,
  mergeTags,
  renameTag,
  searchMemories,
  serverControl,
  serverStatus,
  updateDocument,
  uploadFile,
  type Chunk,
  type MemoryEntry,
  type Pagination,
  type ProfileData,
  type SearchResult,
  type ServerStatus,
  type SmDocument,
  type TagInfo,
} from "./api";

const DEFAULT_TAG = "sm_project_default";
const CUSTOM = "__custom__";
const PAGE_SIZE = 20;
const PROCESSING_STATES = ["queued", "processing", "extracting", "chunking", "embedding", "indexing"];

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/* ───────────────────────── 서버 제어 패널 ───────────────────────── */
function ServerPanel() {
  const [srv, setSrv] = useState<ServerStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSrv(await serverStatus());
      setErr(null);
    } catch (e) {
      setErr(errMsg(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  async function act(action: "start" | "stop" | "restart") {
    setBusy(action);
    setErr(null);
    try {
      await serverControl(action);
      setTimeout(refresh, 1500);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const state = !srv
    ? { cls: "unknown", label: "확인 중…" }
    : srv.healthy
    ? { cls: "ok", label: `실행 중 (PID ${srv.pid ?? "?"})` }
    : srv.loaded
    ? { cls: "warn", label: "등록됨 · 응답 없음(부팅/블로킹)" }
    : { cls: "down", label: "정지됨" };

  return (
    <section className="panel server">
      <div className="server-head">
        <h2>서버 제어</h2>
        <span className={`dot dot-${state.cls}`} /> <span className="muted">{state.label}</span>
      </div>
      <div className="server-actions">
        <button onClick={() => act("start")} disabled={busy !== null}>{busy === "start" ? "시작 중…" : "시작"}</button>
        <button className="warnbtn" onClick={() => act("restart")} disabled={busy !== null}>{busy === "restart" ? "재시작 중…" : "재시작"}</button>
        <button className="del" onClick={() => act("stop")} disabled={busy !== null}>{busy === "stop" ? "정지 중…" : "정지"}</button>
        <button className="ghost" onClick={refresh} disabled={busy !== null}>상태 새로고침</button>
      </div>
      {err && <div className="error small">⚠ {err}</div>}
    </section>
  );
}

/* ───────────────────────── 문서 탭 ───────────────────────── */
function DocsTab({ tag, onTagsChanged }: { tag: string; onTagsChanged: () => void }) {
  const [docs, setDocs] = useState<SmDocument[]>([]);
  const [pg, setPg] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SmDocument | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [newContent, setNewContent] = useState("");
  const [adding, setAdding] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const [chunks, setChunks] = useState<Chunk[] | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editText, setEditText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listDocuments(tag, page, PAGE_SIZE);
      setDocs(data.documents);
      setPg(data.pagination);
      setChecked(new Set());
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [tag, page]);

  useEffect(() => { setPage(1); }, [tag]);
  useEffect(() => { load(); }, [load]);

  // 처리중 문서가 있으면 5초 후 자동 갱신
  const hasProcessing = docs.some((d) => d.status && PROCESSING_STATES.includes(d.status));
  useEffect(() => {
    if (!hasProcessing) return;
    const t = setTimeout(() => { load(); onTagsChanged(); }, 5000);
    return () => clearTimeout(t);
  }, [hasProcessing, docs, load, onTagsChanged]);

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) { setResults(null); return; }
    setSearching(true);
    setError(null);
    try {
      const data = await searchMemories(query.trim(), tag);
      setResults(data.results);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSearching(false);
    }
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newContent.trim()) return;
    setAdding(true);
    setError(null);
    try {
      await addMemory(newContent.trim(), tag);
      setNewContent("");
      setTimeout(() => { load(); onTagsChanged(); }, 1200);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setAdding(false);
    }
  }

  async function onUpload(file: File) {
    setUploading(true);
    setError(null);
    try {
      await uploadFile(file, tag);
      setTimeout(() => { load(); onTagsChanged(); }, 1200);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onReprocess(d: SmDocument) {
    if (!d.content) { setError("본문이 없어 재추출할 수 없습니다."); return; }
    if (!confirm("이 문서를 삭제 후 같은 내용으로 재등록해 재추출합니다.\n(문서 ID가 바뀝니다) 진행할까요?")) return;
    setError(null);
    try {
      await reprocessDocument(d.id, d.content, d.containerTags[0] || tag);
      if (selected?.id === d.id) closeDrawer();
      setTimeout(() => { load(); onTagsChanged(); }, 1200);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function onDelete(id: string) {
    if (!confirm("이 문서를 삭제할까요? 되돌릴 수 없습니다.")) return;
    setError(null);
    try {
      await deleteDocument(id);
      setDocs((d) => d.filter((x) => x.id !== id));
      if (selected?.id === id) closeDrawer();
      onTagsChanged();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function onBulkDelete() {
    const ids = [...checked];
    if (ids.length === 0) return;
    if (!confirm(`선택한 ${ids.length}개 문서를 일괄 삭제할까요? 되돌릴 수 없습니다.`)) return;
    setError(null);
    try {
      await bulkDeleteDocuments(ids);
      load();
      onTagsChanged();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  function toggleAll() {
    setChecked((c) => (c.size === docs.length ? new Set() : new Set(docs.map((d) => d.id))));
  }
  function toggleOne(id: string) {
    setChecked((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(docs, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `supermemory_${tag}_p${page}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function openDrawer(d: SmDocument) {
    setSelected(d);
    setChunks(null);
    setEditMode(false);
    setEditText(d.content || "");
    getChunks(d.id).then((r) => setChunks(r.chunks)).catch(() => setChunks([]));
  }
  function closeDrawer() {
    setSelected(null);
    setChunks(null);
    setEditMode(false);
  }

  async function saveEdit() {
    if (!selected) return;
    setError(null);
    try {
      await updateDocument(selected.id, editText);
      closeDrawer();
      setTimeout(() => { load(); }, 1200);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <>
      {error && <div className="error">⚠ {error}</div>}

      <section className="panel">
        <h2>새 메모리 추가</h2>
        <form onSubmit={onAdd} className="addform">
          <textarea value={newContent} onChange={(e) => setNewContent(e.target.value)} placeholder="기억할 내용을 입력…" rows={3} />
          <div className="toolrow">
            <input ref={fileRef} type="file" style={{ display: "none" }}
              onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
            <button type="button" className="ghost" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? "업로드 중…" : "📄 파일 업로드"}
            </button>
            <span className="filelabel">이미지·고품질 PDF는 Gemini/Vertex 키 필요</span>
            <button type="submit" disabled={adding || !newContent.trim()}>{adding ? "저장 중…" : "추가"}</button>
          </div>
        </form>
      </section>

      <section className="panel">
        <h2>검색</h2>
        <form onSubmit={onSearch} className="searchbar">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="의미 검색…" />
          <button type="submit" disabled={searching}>{searching ? "검색 중…" : "검색"}</button>
          {results !== null && (
            <button type="button" className="ghost" onClick={() => setResults(null)}>검색 해제</button>
          )}
        </form>
        {results !== null && (
          <div className="results">
            <p className="muted">{results.length}건</p>
            {results.map((r) => (
              <div key={r.documentId} className="result">
                <div className="result-head">
                  <strong>{r.title || "(제목 없음)"}</strong>
                  <span className="score">{(r.score ?? 0).toFixed(3)}</span>
                </div>
                {r.chunks?.[0] && <p className="snippet">{r.chunks[0].content}</p>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>
          문서 목록 <span className="muted">({pg?.totalItems ?? docs.length}{hasProcessing ? " · 처리중 자동갱신" : ""})</span>
        </h2>
        <div className="bulkbar">
          <button className="del" onClick={onBulkDelete} disabled={checked.size === 0}>
            선택 삭제 ({checked.size})
          </button>
          <button className="ghost" onClick={exportJson} disabled={docs.length === 0}>JSON 내보내기</button>
          <button className="ghost" onClick={load} disabled={loading}>{loading ? "불러오는 중…" : "새로고침"}</button>
        </div>
        {loading && docs.length === 0 ? (
          <p className="muted">불러오는 중…</p>
        ) : docs.length === 0 ? (
          <p className="muted">이 태그에 저장된 문서가 없습니다.</p>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th className="chk"><input type="checkbox" checked={checked.size === docs.length && docs.length > 0} onChange={toggleAll} /></th>
                  <th>제목</th>
                  <th>타입</th>
                  <th>상태</th>
                  <th>생성일</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} onClick={() => openDrawer(d)} className="row">
                    <td className="chk" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={checked.has(d.id)} onChange={() => toggleOne(d.id)} />
                    </td>
                    <td className="title">{d.title || d.content?.slice(0, 40) || "(제목 없음)"}</td>
                    <td>{d.type}</td>
                    <td><span className={`status status-${d.status}`}>{d.status}</span></td>
                    <td className="muted">{new Date(d.createdAt).toLocaleString("ko-KR")}</td>
                    <td>
                      {(d.status === "failed" || PROCESSING_STATES.includes(d.status || "")) && d.content && (
                        <button className="ghost" title="삭제 후 같은 내용으로 재등록해 재추출" onClick={(e) => { e.stopPropagation(); onReprocess(d); }}>♻ 재추출</button>
                      )}
                      <button className="del" onClick={(e) => { e.stopPropagation(); onDelete(d.id); }}>삭제</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pg && pg.totalPages > 1 && (
              <div className="pager">
                <button className="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← 이전</button>
                <span className="muted">{pg.currentPage} / {pg.totalPages}</span>
                <button className="ghost" disabled={page >= pg.totalPages} onClick={() => setPage((p) => p + 1)}>다음 →</button>
              </div>
            )}
          </>
        )}
      </section>

      {selected && (
        <div className="drawer-backdrop" onClick={closeDrawer}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <h3>{selected.title || "(제목 없음)"}</h3>
              <button className="ghost" onClick={closeDrawer}>✕</button>
            </div>
            <dl>
              <dt>ID</dt>
              <dd className="mono">{selected.id}</dd>
              <dt>상태 / 타입</dt>
              <dd>{selected.status} / {selected.type} ({selected.taskType})</dd>
              <dt>태그</dt>
              <dd>{selected.containerTags.join(", ")}</dd>
              <dt>생성 / 수정</dt>
              <dd className="muted">
                {new Date(selected.createdAt).toLocaleString("ko-KR")} → {new Date(selected.updatedAt).toLocaleString("ko-KR")}
              </dd>
              <dt>토큰</dt>
              <dd>{selected.tokenCount ?? "—"}</dd>
              <dt>본문</dt>
              {editMode ? (
                <dd className="content" style={{ padding: 0 }}>
                  <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={8} style={{ width: "100%" }} />
                </dd>
              ) : (
                <dd className="content">{selected.content || "(없음)"}</dd>
              )}
              {selected.summary && (<><dt>요약</dt><dd>{selected.summary}</dd></>)}
            </dl>
            <div className="toolrow" style={{ marginTop: 12 }}>
              {editMode ? (
                <>
                  <button onClick={saveEdit}>저장 (재처리됨)</button>
                  <button className="ghost" onClick={() => setEditMode(false)}>취소</button>
                </>
              ) : (
                <button className="ghost" onClick={() => setEditMode(true)}>✏️ 본문 편집</button>
              )}
              <button className="del" onClick={() => onDelete(selected.id)}>삭제</button>
            </div>
            <h3 style={{ marginTop: 20 }}>청크 {chunks ? `(${chunks.length})` : ""}</h3>
            {chunks === null ? (
              <p className="spin">청크 불러오는 중…</p>
            ) : chunks.length === 0 ? (
              <p className="muted">청크 없음 (처리 전이거나 실패)</p>
            ) : (
              chunks.map((c, i) => (
                <div key={i} className="chunk">
                  <span className="muted">#{c.position ?? i}</span> {c.content}
                </div>
              ))
            )}
          </aside>
        </div>
      )}
    </>
  );
}

/* ───────────────────────── 메모리 탭 (추출된 기억) ───────────────────────── */
function MemoriesTab({ tag }: { tag: string }) {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [pg, setPg] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listMemories(tag, page, PAGE_SIZE);
      setEntries(data.memoryEntries);
      setPg(data.pagination);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [tag, page]);

  useEffect(() => { setPage(1); }, [tag]);
  useEffect(() => { load(); }, [load]);

  async function onForget(id: string) {
    if (!confirm("이 기억을 삭제(forget)할까요?")) return;
    setError(null);
    try {
      await deleteMemory(id, tag);
      setEntries((l) => l.filter((m) => m.id !== id));
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <section className="panel">
      <h2>추출된 메모리 <span className="muted">({pg?.totalItems ?? entries.length})</span></h2>
      <p className="muted">문서에서 LLM이 추출한 "기억" 항목들 — 세션 시작 시 컨텍스트로 주입되는 실제 단위입니다.</p>
      {error && <div className="error small">⚠ {error}</div>}
      <div className="bulkbar">
        <button className="ghost" onClick={load} disabled={loading}>{loading ? "불러오는 중…" : "새로고침"}</button>
      </div>
      {entries.length === 0 ? (
        <p className="muted">{loading ? "불러오는 중…" : "추출된 메모리가 없습니다. (문서 처리 완료 후 생성됩니다)"}</p>
      ) : (
        <table>
          <thead>
            <tr><th>기억 내용</th><th>버전</th><th>최신</th><th></th></tr>
          </thead>
          <tbody>
            {entries.map((m) => (
              <tr key={m.id}>
                <td>{m.memory}</td>
                <td className="muted">v{m.version}</td>
                <td>{m.isLatest ? "✓" : ""}</td>
                <td><button className="del" onClick={() => onForget(m.id)}>삭제</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pg && pg.totalPages > 1 && (
        <div className="pager">
          <button className="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← 이전</button>
          <span className="muted">{pg.currentPage} / {pg.totalPages}</span>
          <button className="ghost" disabled={page >= pg.totalPages} onClick={() => setPage((p) => p + 1)}>다음 →</button>
        </div>
      )}
    </section>
  );
}

/* ───────────────────────── 프로필 탭 ───────────────────────── */
function ProfileTab({ tag }: { tag: string }) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getProfile(tag);
      setProfile(data.profile);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [tag]);

  useEffect(() => { load(); }, [load]);

  return (
    <section className="panel">
      <h2>사용자 프로필</h2>
      <p className="muted">메모리에서 자동 구축된 사용자 프로필 — static(장기 특성) / dynamic(최근 맥락)</p>
      {error && <div className="error small">⚠ {error}</div>}
      <div className="bulkbar">
        <button className="ghost" onClick={load} disabled={loading}>{loading ? "불러오는 중…" : "새로고침"}</button>
      </div>
      {!profile ? (
        <p className="muted">{loading ? "불러오는 중…" : "프로필 없음"}</p>
      ) : (
        <>
          <h3>Static (장기 특성) — {profile.static.length}</h3>
          {profile.static.length === 0 ? <p className="muted">없음</p> : (
            <ul className="profile-list">{profile.static.map((s, i) => <li key={i}>{s}</li>)}</ul>
          )}
          <h3 style={{ marginTop: 16 }}>Dynamic (최근 맥락) — {profile.dynamic.length}</h3>
          {profile.dynamic.length === 0 ? <p className="muted">없음</p> : (
            <ul className="profile-list">{profile.dynamic.map((s, i) => <li key={i}>{s}</li>)}</ul>
          )}
        </>
      )}
    </section>
  );
}

/* ───────────────────────── 태그 관리 탭 ───────────────────────── */
function TagsTab({ tags, projectMap, onTagsChanged }: { tags: TagInfo[]; projectMap: ProjectMap; onTagsChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [mergeSrc, setMergeSrc] = useState("");
  const [mergeDst, setMergeDst] = useState("");

  async function applyFolder(tag: string, folder: string) {
    setError(null);
    try {
      await renameTag(tag, folder);
      onTagsChanged();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function doRename(tag: string) {
    if (!newName.trim()) return;
    setError(null);
    try {
      await renameTag(tag, newName.trim());
      setRenaming(null);
      setNewName("");
      onTagsChanged();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function doDelete(tag: TagInfo) {
    if (!confirm(`태그 "${tag.name}" (${tag.containerTag}) 와 그 안의 문서 ${tag.documentCount}개가 삭제될 수 있습니다. 진행할까요?`)) return;
    setError(null);
    try {
      await deleteTag(tag.containerTag);
      onTagsChanged();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function doMerge() {
    if (!mergeSrc || !mergeDst || mergeSrc === mergeDst) return;
    if (!confirm(`"${mergeSrc}" 의 모든 문서를 "${mergeDst}" 로 병합할까요?`)) return;
    setError(null);
    try {
      await mergeTags(mergeSrc, mergeDst);
      setMergeSrc("");
      setMergeDst("");
      onTagsChanged();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <section className="panel">
      <h2>컨테이너 태그 관리 <span className="muted">({tags.length})</span></h2>
      {error && <div className="error small">⚠ {error}</div>}
      {tags.map((t) => (
        <div className="tagrow" key={t.id}>
          <strong>{t.name}</strong>
          {projectMap[t.containerTag] && (
            <span className="folder-badge">📁 {projectMap[t.containerTag].folder}</span>
          )}
          <span className="mono muted">{t.containerTag}</span>
          <span className="muted">문서 {t.documentCount} · 메모리 {t.memoryCount}</span>
          {projectMap[t.containerTag] && t.name !== projectMap[t.containerTag].folder && (
            <button className="ghost" onClick={() => applyFolder(t.containerTag, projectMap[t.containerTag].folder)}>
              폴더명 적용
            </button>
          )}
          {renaming === t.containerTag ? (
            <>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="새 이름" />
              <button onClick={() => doRename(t.containerTag)}>저장</button>
              <button className="ghost" onClick={() => setRenaming(null)}>취소</button>
            </>
          ) : (
            <button className="ghost" onClick={() => { setRenaming(t.containerTag); setNewName(t.name); }}>이름 변경</button>
          )}
          <button className="del" onClick={() => doDelete(t)}>삭제</button>
        </div>
      ))}
      <h3 style={{ marginTop: 20 }}>태그 병합</h3>
      <div className="toolrow">
        <select value={mergeSrc} onChange={(e) => setMergeSrc(e.target.value)}>
          <option value="">원본 태그…</option>
          {tags.map((t) => <option key={t.id} value={t.containerTag}>{t.name}</option>)}
        </select>
        <span className="muted">→</span>
        <select value={mergeDst} onChange={(e) => setMergeDst(e.target.value)}>
          <option value="">대상 태그…</option>
          {tags.map((t) => <option key={t.id} value={t.containerTag}>{t.name}</option>)}
        </select>
        <button onClick={doMerge} disabled={!mergeSrc || !mergeDst || mergeSrc === mergeDst}>병합</button>
      </div>
    </section>
  );
}

/* ───────────────────────── 인사이트 탭 (공통 내용) ───────────────────────── */
function InsightsTab({ tag }: { tag: string }) {
  const [docs, setDocs] = useState<SmDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSel(null);
    try {
      const acc: SmDocument[] = [];
      // 공통어 집계를 위해 여러 페이지를 모은다 (최대 300건)
      for (let page = 1; page <= 3; page++) {
        const data = await listDocuments(tag, page, 100);
        acc.push(...data.documents);
        if (page >= data.pagination.totalPages) break;
      }
      setDocs(acc);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [tag]);

  useEffect(() => { load(); }, [load]);

  const kw: Keywords = useMemo(
    () => extractKeywords(docs.map((d) => `${d.title || ""} ${d.content || ""}`)),
    [docs]
  );

  const maxCount = kw.unigrams[0]?.count || 1;
  function sizeFor(count: number): number {
    return Math.round(13 + (count / maxCount) * 17); // 13~30px
  }

  const matches = sel
    ? docs.filter((d) => `${d.title || ""} ${d.content || ""}`.toLowerCase().includes(sel))
    : [];

  return (
    <section className="panel">
      <h2>
        공통 내용 인사이트 <span className="muted">(문서 {kw.docCount}건 분석)</span>
      </h2>
      <p className="muted">
        이 컨테이너 문서 본문에서 자주 함께 등장하는 키워드·구문을 추출했습니다. 칩을 누르면 해당 단어가 포함된 문서를 모아 보여줍니다. (집계는 브라우저에서 수행 — 외부 전송 없음)
      </p>
      {error && <div className="error small">⚠ {error}</div>}
      <div className="bulkbar">
        <button className="ghost" onClick={load} disabled={loading}>{loading ? "분석 중…" : "다시 분석"}</button>
        {sel && <button className="ghost" onClick={() => setSel(null)}>필터 해제</button>}
      </div>

      {loading && docs.length === 0 ? (
        <p className="muted">불러오는 중…</p>
      ) : kw.unigrams.length === 0 ? (
        <p className="muted">분석할 문서가 없습니다.</p>
      ) : (
        <>
          <h3>공통 키워드</h3>
          <div className="cloud">
            {kw.unigrams.map((t) => (
              <button
                key={t.term}
                className={`chip${sel === t.term ? " chip-on" : ""}`}
                style={{ fontSize: sizeFor(t.count) }}
                title={`${t.count}개 문서`}
                onClick={() => setSel(sel === t.term ? null : t.term)}
              >
                {t.term} <span className="chip-n">{t.count}</span>
              </button>
            ))}
          </div>

          {kw.bigrams.length > 0 && (
            <>
              <h3 style={{ marginTop: 18 }}>공통 구문</h3>
              <div className="cloud">
                {kw.bigrams.map((t) => (
                  <button
                    key={t.term}
                    className={`chip phrase${sel === t.term ? " chip-on" : ""}`}
                    title={`${t.count}개 문서`}
                    onClick={() => setSel(sel === t.term ? null : t.term)}
                  >
                    {t.term} <span className="chip-n">{t.count}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {sel && (
            <>
              <h3 style={{ marginTop: 18 }}>
                "{sel}" 포함 문서 <span className="muted">({matches.length})</span>
              </h3>
              {matches.length === 0 ? (
                <p className="muted">없음</p>
              ) : (
                <ul className="profile-list">
                  {matches.map((d) => (
                    <li key={d.id}>{d.title || d.content?.slice(0, 80) || "(제목 없음)"}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

/* ───────────────────────── 루트 ───────────────────────── */
type Tab = "docs" | "memories" | "profile" | "tags" | "insights";

export function App() {
  const [tab, setTab] = useState<Tab>("docs");
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [tag, setTag] = useState(DEFAULT_TAG);
  const [customMode, setCustomMode] = useState(false);
  const [projectMap, setProjectMap] = useState<ProjectMap>({});

  const loadTags = useCallback(async () => {
    const list = await listTags();
    setTags(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    listTags().then((list) => {
      setTags(list);
      if (list.length > 0 && !list.some((t) => t.containerTag === DEFAULT_TAG)) {
        setTag(list[0].containerTag);
      }
    });
    resolveProjects().then(setProjectMap);
  }, []);

  // 태그 표시 이름: 매칭된 프로젝트 폴더 > 서버에 저장된 친근한 이름 > 원본 태그
  const displayName = useCallback(
    (t: string): string => {
      const p = projectMap[t];
      if (p) return `📁 ${p.folder}`;
      const info = tags.find((x) => x.containerTag === t);
      if (info && info.name && info.name !== t) return info.name;
      return t;
    },
    [projectMap, tags]
  );

  // 현재 태그가 폴더로 매칭됐고 아직 서버에 그 이름이 저장되지 않았으면 영구저장 가능
  const folderMatch = projectMap[tag];
  const currentInfo = tags.find((x) => x.containerTag === tag);
  const canPersist = !!folderMatch && currentInfo?.name !== folderMatch.folder;

  async function persistFolderName() {
    if (!folderMatch) return;
    try {
      await renameTag(tag, folderMatch.folder);
      loadTags();
    } catch {
      /* 표시는 이미 폴더명이라 실패해도 치명적 아님 */
    }
  }

  function onSelectTag(v: string) {
    if (v === CUSTOM) {
      setCustomMode(true);
    } else {
      setCustomMode(false);
      setTag(v);
    }
  }

  const tagInList = tags.some((t) => t.containerTag === tag);

  return (
    <div className="app">
      <header>
        <h1>🧠 Supermemory 관리</h1>
        <div className="tagbox">
          <label>컨테이너</label>
          {tags.length > 0 ? (
            <>
              <select value={customMode ? CUSTOM : tagInList ? tag : CUSTOM} onChange={(e) => onSelectTag(e.target.value)}>
                {tags.map((t) => (
                  <option key={t.id} value={t.containerTag}>{displayName(t.containerTag)} · 문서 {t.documentCount}</option>
                ))}
                <option value={CUSTOM}>직접 입력…</option>
              </select>
              {(customMode || !tagInList) && (
                <input value={tag} onChange={(e) => setTag(e.target.value)} spellCheck={false} placeholder="태그 직접 입력" />
              )}
            </>
          ) : (
            <input value={tag} onChange={(e) => setTag(e.target.value)} spellCheck={false} />
          )}
          {canPersist && (
            <button className="ghost" title="이 폴더명을 서버 태그 이름으로 영구 저장" onClick={persistFolderName}>
              📁 {folderMatch!.folder} 이름 저장
            </button>
          )}
          <button className="ghost" onClick={loadTags}>태그 갱신</button>
        </div>
      </header>

      <ServerPanel />

      <nav className="tabs">
        <button className={tab === "docs" ? "active" : ""} onClick={() => setTab("docs")}>문서</button>
        <button className={tab === "memories" ? "active" : ""} onClick={() => setTab("memories")}>메모리</button>
        <button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}>프로필</button>
        <button className={tab === "insights" ? "active" : ""} onClick={() => setTab("insights")}>인사이트</button>
        <button className={tab === "tags" ? "active" : ""} onClick={() => setTab("tags")}>태그</button>
      </nav>

      {tab === "docs" && <DocsTab tag={tag} onTagsChanged={loadTags} />}
      {tab === "memories" && <MemoriesTab tag={tag} />}
      {tab === "profile" && <ProfileTab tag={tag} />}
      {tab === "insights" && <InsightsTab tag={tag} />}
      {tab === "tags" && <TagsTab tags={tags} projectMap={projectMap} onTagsChanged={loadTags} />}
    </div>
  );
}
