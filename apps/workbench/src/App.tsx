import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import { ResourceView } from "./components/ResourceView";
import type { BatchAction } from "./components/ResourceView";
import { DetailPanel } from "./components/DetailPanel";
import { Reader } from "./components/Reader";
import { IconClose } from "./components/Icons";
import { api } from "./api";
import { loadWorkspace, saveWorkspace, viewTitle } from "./workspace";
import type {
  Facets,
  ImportProgress,
  IndexStatus,
  JobsSummary,
  NavView,
  ResourceDetail,
  ResourceItem,
  SortKind,
  ViewMode,
  WorkspaceState,
} from "./types";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const PHASE_LABEL: Record<string, string> = {
  scan: "正在扫描",
  hash: "校验文件",
  save: "登记索引",
  done: "导入完成",
};

export function App() {
  const queryClient = useQueryClient();
  const hasLibrary = Boolean(window.desk?.library);

  const [workspace, setWorkspace] = useState<WorkspaceState>(() => loadWorkspace());
  const [searchInput, setSearchInput] = useState(workspace.search);
  const [search, setSearch] = useState(workspace.search.trim());
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [readerId, setReaderId] = useState<string | null>(null);
  const [readerLocator, setReaderLocator] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [rebuildingIndex, setRebuildingIndex] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [batch, setBatch] = useState<"tag" | "collection" | null>(null);
  const [batchTag, setBatchTag] = useState("");
  const [batchCollections, setBatchCollections] = useState<Set<string>>(() => new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const infoQuery = useQuery({
    queryKey: ["info"],
    queryFn: api.info,
    enabled: hasLibrary,
    staleTime: Infinity,
  });
  const facetsQuery = useQuery({
    queryKey: ["facets"],
    queryFn: api.facets,
    enabled: hasLibrary,
  });
  const listQuery = useQuery({
    queryKey: ["list", workspace.view.kind, workspace.view.id ?? "", search, workspace.kinds.join(","), workspace.sort],
    queryFn: () =>
      api.list({
        view: workspace.view.kind,
        id: workspace.view.id,
        search: search || undefined,
        kinds: workspace.kinds,
        sort: workspace.sort,
        limit: 300,
      }),
    enabled: hasLibrary,
    placeholderData: (previous) => previous,
  });
  const detailQuery = useQuery({
    queryKey: ["resource", workspace.selectedId],
    queryFn: () => api.get(workspace.selectedId as string),
    enabled: hasLibrary && Boolean(workspace.selectedId),
  });
  const readerQuery = useQuery({
    queryKey: ["resource", readerId],
    queryFn: () => api.get(readerId as string),
    enabled: hasLibrary && Boolean(readerId),
  });
  const jobsQuery = useQuery({
    queryKey: ["jobs"],
    queryFn: api.jobs,
    enabled: hasLibrary,
    refetchInterval: (query) => {
      const data = query.state.data as JobsSummary | undefined;
      return data && (data.pending > 0 || data.running > 0) ? 1200 : false;
    },
  });
  const indexQuery = useQuery({
    queryKey: ["index-status"],
    queryFn: api.indexStatus,
    enabled: hasLibrary,
    refetchInterval: (query) => {
      const data = query.state.data as IndexStatus | undefined;
      return data && !data.ready ? 4000 : false;
    },
  });

  const items = useMemo(() => listQuery.data?.items ?? [], [listQuery.data]);
  const facets = facetsQuery.data;
  const title = viewTitle(workspace.view, facets);

  const refreshLibrary = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["list"] }),
        queryClient.invalidateQueries({ queryKey: ["facets"] }),
      ]),
    [queryClient],
  );

  const applyDetail = useCallback(
    (detail: ResourceDetail | null | undefined) => {
      if (!detail) return;
      queryClient.setQueryData(["resource", detail.id], detail);
      void refreshLibrary();
    },
    [queryClient, refreshLibrary],
  );

  useEffect(() => {
    saveWorkspace({ ...workspace, search: searchInput });
  }, [workspace, searchInput]);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 220);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setChecked(new Set());
  }, [workspace.view.kind, workspace.view.id, search, workspace.kinds]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!workspace.selectedId) return;
    const frame = requestAnimationFrame(() => {
      document.querySelector(".row.is-selected, .card.is-selected")?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [workspace.selectedId]);

  useEffect(() => {
    const bridge = window.desk?.library;
    if (!bridge) return;
    return bridge.onImportProgress((next) => setProgress(next));
  }, []);

  useEffect(() => {
    const bridge = window.desk?.library;
    if (!bridge) return;
    return bridge.onJobsChanged(() => {
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["list"] });
      void queryClient.invalidateQueries({ queryKey: ["facets"] });
      if (workspace.selectedId) {
        void queryClient.invalidateQueries({ queryKey: ["resource", workspace.selectedId] });
      }
    });
  }, [queryClient, workspace.selectedId]);

  const selectView = useCallback((view: NavView) => {
    setWorkspace((current) => ({ ...current, view }));
  }, []);

  const openReader = useCallback((item: ResourceItem) => {
    setWorkspace((current) => ({ ...current, selectedId: item.id }));
    setReaderLocator(item.hit?.locator ?? null);
    setReaderId(item.id);
    if (window.desk?.library) void api.touch(item.id).catch(() => undefined);
  }, []);

  const closeReader = useCallback(() => {
    setReaderId(null);
    setReaderLocator(null);
    void refreshLibrary();
  }, [refreshLibrary]);

  const handleReading = useCallback(
    (locator: string, value: number) => {
      const id = readerId;
      if (!id || !window.desk?.library) return;
      void api
        .reading(id, locator, value)
        .then(() => {
          const stamp = new Date().toISOString();
          queryClient.setQueryData<ResourceDetail | null>(["resource", id], (old) =>
            old
              ? {
                  ...old,
                  reading: { locator, progress: value, updated_at: stamp },
                  readingAt: stamp,
                  readingProgress: value,
                }
              : old,
          );
        })
        .catch(() => undefined);
    },
    [queryClient, readerId],
  );

  const runImport = async () => {
    if (!hasLibrary || importing) return;
    setImporting(true);
    setProgress({ phase: "scan", index: 0, total: 0 });
    try {
      const result = await api.importFolder();
      if (result.canceled) {
        setProgress(null);
        return;
      }
      setProgress(result);
      await refreshLibrary();
      if (result.added) {
        const duplicated = result.duplicates ? `，跳过 ${result.duplicates} 个重复文件` : "";
        const fixed = result.repaired ? `，修复 ${result.repaired} 个损坏原件` : "";
        setToast(`新增 ${result.added} 项资料${duplicated}${fixed}`);
      } else if (result.duplicates) {
        const fixed = result.repaired ? `，已修复 ${result.repaired} 个损坏原件` : "";
        setToast(`这些文件已登记过（${result.duplicates} 个重复），没有新增${fixed}`);
      } else {
        setToast("没有找到可导入的文件");
      }
    } catch (error) {
      setToast(`导入失败：${errorText(error)}`);
      setProgress(null);
    } finally {
      setImporting(false);
      setTimeout(() => setProgress(null), 1400);
    }
  };

  const retrySelectedExtraction = async () => {
    const id = workspace.selectedId;
    if (!id) return;
    try {
      const result = await api.retryExtraction(id);
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
      await queryClient.invalidateQueries({ queryKey: ["resource", id] });
      setToast(result.queued ? "已重新排队抽取正文" : "当前没有需要重试的抽取");
    } catch (error) {
      setToast(`重试失败：${errorText(error)}`);
    }
  };

  const retryFailedExtractions = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      const result = await api.retryFailedExtractions();
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
      setToast(result.queued ? `已重新排队 ${result.queued} 项抽取` : "没有可重试的抽取任务");
    } catch (error) {
      setToast(`重试失败：${errorText(error)}`);
    } finally {
      setRetrying(false);
    }
  };

  const rebuildIndex = async () => {
    if (!hasLibrary || rebuildingIndex) return;
    setRebuildingIndex(true);
    try {
      const result = await api.rebuildIndex();
      queryClient.setQueryData(["index-status"], result.status);
      await queryClient.invalidateQueries({ queryKey: ["list"] });
      setToast(`已重建 ${result.indexed} 项资料的搜索索引`);
    } catch (error) {
      setToast(`重建索引失败：${errorText(error)}`);
    } finally {
      setRebuildingIndex(false);
    }
  };

  const updateSelected = async (patch: { title?: string; favorite?: boolean; note?: string; inbox?: boolean }) => {
    const id = workspace.selectedId;
    if (!id) return;
    try {
      applyDetail(await api.update(id, patch));
    } catch (error) {
      setToast(`保存失败：${errorText(error)}`);
    }
  };

  const setTags = async (names: string[]) => {
    const id = workspace.selectedId;
    if (!id) return;
    try {
      applyDetail(await api.setTags(id, names));
    } catch (error) {
      setToast(`更新标签失败：${errorText(error)}`);
    }
  };

  const setCollections = async (ids: string[]) => {
    const id = workspace.selectedId;
    if (!id) return;
    try {
      applyDetail(await api.setCollections(id, ids));
    } catch (error) {
      setToast(`更新集合失败：${errorText(error)}`);
    }
  };

  const createCollection = useCallback(
    async (name: string): Promise<string | null> => {
      try {
        const id = await api.createCollection(name);
        await queryClient.invalidateQueries({ queryKey: ["facets"] });
        return id;
      } catch (error) {
        setToast(`新建集合失败：${errorText(error)}`);
        return null;
      }
    },
    [queryClient],
  );

  const trashedSelected = async () => {
    const id = workspace.selectedId;
    if (!id) return;
    try {
      await api.trash([id]);
      applyDetail(await api.get(id));
      setToast("已移入回收站，可以随时恢复");
    } catch (error) {
      setToast(`操作失败：${errorText(error)}`);
    }
  };

  const restoredSelected = async () => {
    const id = workspace.selectedId;
    if (!id) return;
    try {
      await api.restore([id]);
      applyDetail(await api.get(id));
      setToast("已从回收站恢复");
    } catch (error) {
      setToast(`恢复失败：${errorText(error)}`);
    }
  };

  const toggleFavorite = async (item: ResourceItem) => {
    try {
      applyDetail(await api.update(item.id, { favorite: !item.favorite }));
    } catch (error) {
      setToast(`操作失败：${errorText(error)}`);
    }
  };

  const restoreOne = async (item: ResourceItem) => {
    try {
      await api.restore([item.id]);
      await refreshLibrary();
      setToast("已从回收站恢复");
    } catch (error) {
      setToast(`恢复失败：${errorText(error)}`);
    }
  };

  const toggleCheck = (id: string) => {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const checkAll = () => {
    setChecked((current) => (current.size === items.length ? new Set() : new Set(items.map((item) => item.id))));
  };

  const openOriginal = () => {
    const id = workspace.selectedId;
    if (!id) return;
    void api
      .open(id)
      .then((result) => {
        if (!result.ok) setToast(result.error ?? "无法打开原件");
      })
      .catch((error: unknown) => setToast(`无法打开原件：${errorText(error)}`));
  };

  const revealSelected = () => {
    const id = workspace.selectedId;
    if (!id) return;
    void api.reveal(id).catch((error: unknown) => setToast(`无法定位原件：${errorText(error)}`));
  };

  const runBatch = async (action: BatchAction) => {
    if (action === "clear") {
      setChecked(new Set());
      return;
    }
    if (action === "tag" || action === "collection") {
      setBatchTag("");
      setBatchCollections(new Set());
      setBatch(action);
      return;
    }
    const ids = [...checked];
    if (!ids.length) return;
    try {
      if (action === "favorite") await Promise.all(ids.map((id) => api.update(id, { favorite: true })));
      if (action === "trash") await api.trash(ids);
      if (action === "restore") await api.restore(ids);
      setChecked(new Set());
      await refreshLibrary();
      if (action === "favorite") setToast(`已收藏 ${ids.length} 项`);
      if (action === "trash") setToast(`已将 ${ids.length} 项移入回收站`);
      if (action === "restore") setToast(`已恢复 ${ids.length} 项`);
    } catch (error) {
      setToast(`批量操作失败：${errorText(error)}`);
    }
  };

  const commitBatchTag = async () => {
    const name = batchTag.trim();
    if (!name || batchBusy) return;
    const ids = [...checked];
    setBatchBusy(true);
    try {
      for (const id of ids) {
        const detail = await api.get(id);
        if (!detail || detail.tags.includes(name)) continue;
        await api.setTags(id, [...detail.tags, name]);
      }
      setBatch(null);
      setChecked(new Set());
      await refreshLibrary();
      setToast(`已为 ${ids.length} 项添加标签「${name}」`);
    } catch (error) {
      setToast(`批量打标签失败：${errorText(error)}`);
    } finally {
      setBatchBusy(false);
    }
  };

  const commitBatchCollections = async () => {
    if (!batchCollections.size || batchBusy) return;
    const ids = [...checked];
    const picked = [...batchCollections];
    setBatchBusy(true);
    try {
      for (const id of ids) {
        const detail = await api.get(id);
        if (!detail) continue;
        const current = detail.collections.map((item) => item.id);
        const merged = [...new Set([...current, ...picked])];
        if (merged.length !== current.length) await api.setCollections(id, merged);
      }
      setBatch(null);
      setChecked(new Set());
      await refreshLibrary();
      setToast(`已把 ${ids.length} 项加入 ${picked.length} 个集合`);
    } catch (error) {
      setToast(`加入集合失败：${errorText(error)}`);
    } finally {
      setBatchBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = Boolean(
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable),
      );

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (typing || readerId) return;

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!items.length) return;
        event.preventDefault();
        const index = items.findIndex((item) => item.id === workspace.selectedId);
        const nextIndex =
          event.key === "ArrowDown"
            ? Math.min(items.length - 1, index < 0 ? 0 : index + 1)
            : Math.max(0, index < 0 ? items.length - 1 : index - 1);
        setWorkspace((current) => ({ ...current, selectedId: items[nextIndex].id }));
        return;
      }

      if (event.key === "Enter" && workspace.selectedId) {
        const item = items.find((entry) => entry.id === workspace.selectedId);
        if (item) openReader(item);
        return;
      }

      if (event.key === "Escape") {
        if (batch) setBatch(null);
        else if (checked.size) setChecked(new Set());
        else setWorkspace((current) => ({ ...current, selectedId: null }));
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [batch, checked.size, items, openReader, readerId, workspace.selectedId]);

  const importPercent = progress && progress.total > 0 ? Math.round((progress.index / progress.total) * 100) : 0;
  const readerDetail = readerQuery.data ?? null;
  const jobs = jobsQuery.data;
  const jobsActive = jobs ? jobs.pending + jobs.running : 0;
  const jobsPercent = jobs && jobs.total > 0 ? Math.round((jobs.done / jobs.total) * 100) : 0;
  const jobsLive = jobs?.current
    ? `正在抽取 ${jobs.current.title}${jobs.current.pageTotal > 1 ? ` · 第 ${jobs.current.pages} / ${jobs.current.pageTotal} 页` : ""}`
    : null;
  const showJobs = Boolean(jobs && (jobsActive > 0 || jobs.failed > 0));

  return (
    <div className={`app${workspace.detailOpen ? " with-detail" : ""}`}>
      <Sidebar
        view={workspace.view}
        facets={facets}
        libraryPath={infoQuery.data?.path ?? null}
        indexStatus={indexQuery.data}
        rebuildingIndex={rebuildingIndex}
        onSelect={selectView}
        onCreateCollection={(name) => void createCollection(name)}
        onRebuildIndex={() => void rebuildIndex()}
      />

      <div className="stage">
        <Toolbar
          title={title}
          total={listQuery.data?.total ?? 0}
          search={searchInput}
          searchRef={searchRef}
          onSearch={setSearchInput}
          onImport={() => void runImport()}
          importing={importing}
          detailOpen={workspace.detailOpen}
          onToggleDetail={() => setWorkspace((current) => ({ ...current, detailOpen: !current.detailOpen }))}
          disabled={!hasLibrary}
        />

        <ResourceView
          view={workspace.view}
          items={items}
          total={listQuery.data?.total ?? 0}
          loading={listQuery.isFetching}
          error={listQuery.error ? errorText(listQuery.error) : null}
          hasLibrary={hasLibrary}
          mode={workspace.mode}
          onModeChange={(mode: ViewMode) => setWorkspace((current) => ({ ...current, mode }))}
          kinds={workspace.kinds}
          onKindsChange={(kinds) => setWorkspace((current) => ({ ...current, kinds }))}
          sort={workspace.sort}
          onSortChange={(sort: SortKind) => setWorkspace((current) => ({ ...current, sort }))}
          search={search}
          selectedId={workspace.selectedId}
          checked={checked}
          onSelect={(id) => setWorkspace((current) => ({ ...current, selectedId: id }))}
          onOpen={openReader}
          onToggleCheck={toggleCheck}
          onCheckAll={checkAll}
          onToggleFavorite={(item) => void toggleFavorite(item)}
          onRestoreOne={(item) => void restoreOne(item)}
          onImport={() => void runImport()}
          onRetry={() => void listQuery.refetch()}
          onBatch={(action) => void runBatch(action)}
        />
      </div>

      {workspace.detailOpen && (
        <DetailPanel
          detail={detailQuery.data ?? null}
          loading={detailQuery.isFetching}
          facets={facets}
          onClose={() => setWorkspace((current) => ({ ...current, detailOpen: false }))}
          onRead={() => detailQuery.data && openReader(detailQuery.data)}
          onOpenOriginal={openOriginal}
          onReveal={revealSelected}
          onUpdate={(patch) => void updateSelected(patch)}
          onTags={(names) => void setTags(names)}
          onCollections={(ids) => void setCollections(ids)}
          onCreateCollection={createCollection}
          onTrash={() => void trashedSelected()}
          onRestore={() => void restoredSelected()}
          onOpenCollection={(id) => selectView({ kind: "collection", id })}
          onRetryExtraction={() => void retrySelectedExtraction()}
        />
      )}

      {readerId && readerDetail && (
        <Reader
          detail={readerDetail}
          startLocator={readerLocator}
          onClose={closeReader}
          onReading={handleReading}
          onOpenOriginal={openOriginal}
        />
      )}

      {batch && (
        <div className="sheet" role="dialog" aria-modal="true" aria-label="批量操作">
          <div className="sheet-card">
            <header className="sheet-head">
              <p>{batch === "tag" ? `为 ${checked.size} 项资料添加标签` : `把 ${checked.size} 项资料加入集合`}</p>
              <button type="button" className="icon-btn" onClick={() => setBatch(null)} aria-label="关闭">
                <IconClose size={15} />
              </button>
            </header>

            {batch === "tag" ? (
              <>
                <input
                  className="sheet-input"
                  autoFocus
                  value={batchTag}
                  placeholder="标签名称，回车确认"
                  onChange={(event) => setBatchTag(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void commitBatchTag();
                  }}
                />
                {!!facets?.tags.length && (
                  <div className="sheet-suggest">
                    {facets.tags
                      .filter((tag) => tag.name !== batchTag.trim())
                      .slice(0, 8)
                      .map((tag) => (
                        <button key={tag.id} type="button" onClick={() => setBatchTag(tag.name)}>
                          {tag.name}
                        </button>
                      ))}
                  </div>
                )}
              </>
            ) : (
              <div className="picker is-plain">
                {facets?.collections.map((collection) => (
                  <label key={collection.id} className="picker-row">
                    <input
                      type="checkbox"
                      checked={batchCollections.has(collection.id)}
                      onChange={() =>
                        setBatchCollections((current) => {
                          const next = new Set(current);
                          if (next.has(collection.id)) next.delete(collection.id);
                          else next.add(collection.id);
                          return next;
                        })
                      }
                    />
                    <span>{collection.name}</span>
                    <span className="picker-count">{collection.n}</span>
                  </label>
                ))}
                {!facets?.collections.length && <p className="picker-empty">先在左侧新建一个集合</p>}
              </div>
            )}

            <footer className="sheet-foot">
              <button type="button" className="btn btn-small" onClick={() => setBatch(null)}>
                取消
              </button>
              <button
                type="button"
                className="btn btn-small btn-primary"
                disabled={batchBusy || (batch === "tag" ? !batchTag.trim() : !batchCollections.size)}
                onClick={() => void (batch === "tag" ? commitBatchTag() : commitBatchCollections())}
              >
                {batchBusy ? "处理中…" : "确认"}
              </button>
            </footer>
          </div>
        </div>
      )}

      {progress && (
        <div className="import-strip">
          <span className="import-phase">{PHASE_LABEL[progress.phase] ?? "导入中"}</span>
          <span className="import-detail">
            {progress.current ?? (progress.total ? `${progress.index} / ${progress.total}` : "选择文件夹…")}
          </span>
          <span className="import-bar">
            <span style={{ width: `${progress.phase === "done" ? 100 : importPercent}%` }} />
          </span>
        </div>
      )}

      {showJobs && jobs && (
        <div className={`jobs-strip${progress ? " is-lifted" : ""}`}>
          <span className={`import-phase${jobsActive > 0 ? "" : " is-failed"}`}>
            {jobsActive > 0 ? "后台抽取" : "抽取失败"}
          </span>
          <span className="import-detail">
            {jobsActive > 0
              ? jobsLive ?? `待处理 ${jobs.pending} · 进行中 ${jobs.running} · 已完成 ${jobs.done}`
              : `${jobs.failed} 项没有抽取成功`}
          </span>
          {jobsActive > 0 && (
            <span className="import-bar">
              <span style={{ width: `${jobsPercent}%` }} />
            </span>
          )}
          {jobs.failed > 0 && (
            <button type="button" className="jobs-retry" onClick={() => void retryFailedExtractions()} disabled={retrying}>
              {retrying ? "排队中…" : "重试失败项"}
            </button>
          )}
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export type { Facets };
