import type { NavView, ResourceItem, SortKind, ViewMode } from "../types";
import { KIND_FILTERS, KIND_LABEL, STATUS_LABEL, isExtractableKind, isReadable } from "../types";
import { archiveLabel, assetUrl, formatDate, formatSize } from "../api";
import { SORT_LABEL } from "../workspace";
import { PdfThumb } from "./Preview";
import {
  IconCheck,
  IconGrid,
  IconList,
  IconRestore,
  IconStar,
  IconTrash,
  IconRead,
  IconImport,
} from "./Icons";

export type BatchAction = "tag" | "collection" | "favorite" | "trash" | "restore" | "clear";

interface ResourceViewProps {
  view: NavView;
  items: ResourceItem[];
  total: number;
  loading: boolean;
  error: string | null;
  hasLibrary: boolean;
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
  kinds: string[];
  onKindsChange: (kinds: string[]) => void;
  sort: SortKind;
  onSortChange: (sort: SortKind) => void;
  search: string;
  selectedId: string | null;
  checked: Set<string>;
  onSelect: (id: string) => void;
  onOpen: (item: ResourceItem) => void;
  onToggleCheck: (id: string, additive: boolean) => void;
  onCheckAll: () => void;
  onToggleFavorite: (item: ResourceItem) => void;
  onRestoreOne: (item: ResourceItem) => void;
  onImport: () => void;
  onRetry: () => void;
  onBatch: (action: BatchAction) => void;
}

function statusBadge(item: ResourceItem) {
  if (!isExtractableKind(item.kind)) return null;
  const label = STATUS_LABEL[item.status];
  if (!label || item.status === "ready") return null;
  return <span className={`badge-soft badge-status is-${item.status}`}>{label}</span>;
}

/** 在命中片段里标出关键词；大小写不敏感，找不到时原样返回。 */
function highlight(text: string, keyword: string) {
  const needle = keyword.toLowerCase();
  if (!needle) return text;
  const lower = text.toLowerCase();
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let index = lower.indexOf(needle);
  while (index >= 0) {
    if (index > cursor) nodes.push(text.slice(cursor, index));
    nodes.push(<mark key={index}>{text.slice(index, index + keyword.length)}</mark>);
    cursor = index + keyword.length;
    index = lower.indexOf(needle, cursor);
  }
  if (nodes.length === 0) return text;
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function rowSub(item: ResourceItem) {
  return (
    <div className="row-sub">
      <span className="row-no">{archiveLabel(item.archiveNo)}</span>
      {item.inbox && <span className="badge-soft">收件箱</span>}
      {statusBadge(item)}
      {item.tags.slice(0, 3).map((tag) => (
        <span key={tag} className="tag-chip">
          {tag}
        </span>
      ))}
      {item.tags.length > 3 && <span className="tag-more">+{item.tags.length - 3}</span>}
      {item.hit && (
        <span className="match-reason" title={item.hit.snippet}>
          <span>{item.hit.label}</span>
          {item.hit.snippet && (
            <em>
              {highlight(item.hit.snippet, item.hit.keyword)}
            </em>
          )}
        </span>
      )}
    </div>
  );
}

function EmptyArt() {
  return (
    <div className="empty-art" aria-hidden>
      <span />
      <span />
      <span />
    </div>
  );
}

export function ResourceView(props: ResourceViewProps) {
  const {
    view,
    items,
    total,
    loading,
    error,
    hasLibrary,
    mode,
    onModeChange,
    kinds,
    onKindsChange,
    sort,
    onSortChange,
    search,
    selectedId,
    checked,
    onSelect,
    onOpen,
    onToggleCheck,
    onCheckAll,
    onToggleFavorite,
    onRestoreOne,
    onImport,
    onRetry,
    onBatch,
  } = props;

  const toggleKind = (kind: string) => {
    onKindsChange(kinds.includes(kind) ? kinds.filter((item) => item !== kind) : [...kinds, kind]);
  };

  const empty = !loading && items.length === 0;

  return (
    <section className="content">
      <div className="content-head">
        <div className="filters">
          {KIND_FILTERS.map((kind) => (
            <button
              key={kind}
              type="button"
              className={`filter-chip${kinds.includes(kind) ? " is-on" : ""}`}
              onClick={() => toggleKind(kind)}
            >
              {KIND_LABEL[kind]}
            </button>
          ))}
          {(kinds.length > 0 || search) && (
            <button type="button" className="filter-reset" onClick={() => onKindsChange([])}>
              清除筛选
            </button>
          )}
        </div>

        <div className="head-right">
          <select className="sort-select" value={sort} onChange={(event) => onSortChange(event.target.value as SortKind)}>
            {(Object.keys(SORT_LABEL) as SortKind[]).map((key) => (
              <option key={key} value={key}>
                {SORT_LABEL[key]}
              </option>
            ))}
          </select>
          <div className="segmented">
            <button
              type="button"
              className={mode === "list" ? "is-on" : ""}
              onClick={() => onModeChange("list")}
              title="列表视图"
            >
              <IconList size={15} />
            </button>
            <button
              type="button"
              className={mode === "cards" ? "is-on" : ""}
              onClick={() => onModeChange("cards")}
              title="卡片视图"
            >
              <IconGrid size={15} />
            </button>
          </div>
        </div>
      </div>

      <div className={`scroll-area ${mode === "cards" ? "is-cards" : ""}`}>
        {!hasLibrary && (
          <div className="empty">
            <EmptyArt />
            <h2>需要在桌面应用中打开</h2>
            <p>资料库依赖本地文件读取与 SQLite 存储，请启动 Rhine Lab Desk。</p>
          </div>
        )}

        {hasLibrary && error && (
          <div className="empty">
            <h2>读取资料库失败</h2>
            <p className="empty-error">{error}</p>
            <button type="button" className="btn" onClick={onRetry}>
              重试
            </button>
          </div>
        )}

        {hasLibrary && !error && loading && items.length === 0 && (
          <div className="skeleton-list">
            {Array.from({ length: 7 }).map((_, index) => (
              <div key={index} className="skeleton-row" />
            ))}
          </div>
        )}

        {hasLibrary && !error && empty && (
          <div className="empty">
            <EmptyArt />
            <h2>
              {search
                ? "没有匹配的资料"
                : view.kind === "inbox"
                  ? "收件箱是空的"
                  : view.kind === "trash"
                    ? "回收站是空的"
                    : view.kind === "favorite"
                      ? "还没有收藏"
                      : "资料库还没有内容"}
            </h2>
            <p>
              {search
                ? "试试更短的关键词，或清除类型筛选。"
                : view.kind === "trash"
                  ? "删除的资料会先留在这里，可以随时恢复。"
                  : "选择一个本地文件夹，把里面的资料登记进来。原件留在原处，软件负责索引与阅读。"}
            </p>
            {!search && view.kind !== "trash" && view.kind !== "favorite" && (
              <button type="button" className="btn btn-primary" onClick={onImport}>
                <IconImport />
                导入文件夹
              </button>
            )}
          </div>
        )}

        {hasLibrary && items.length > 0 && mode === "list" && (
          <div className="list" role="list">
            <div className="list-head">
              <button
                type="button"
                className={`check${checked.size === items.length ? " is-on" : ""}`}
                onClick={onCheckAll}
                aria-label="全选"
              >
                {checked.size === items.length && <IconCheck size={12} />}
              </button>
              <span className="col-type">类型</span>
              <span>名称</span>
              <span className="col-size">大小</span>
              <span className="col-date">添加时间</span>
              <span className="col-act" />
            </div>

            {items.map((item) => (
              <div
                key={item.id}
                role="listitem"
                tabIndex={0}
                className={`row${selectedId === item.id ? " is-selected" : ""}${checked.has(item.id) ? " is-checked" : ""}`}
                onClick={(event) => {
                  if (event.shiftKey || event.metaKey || event.ctrlKey) {
                    onToggleCheck(item.id, true);
                    return;
                  }
                  onSelect(item.id);
                }}
                onDoubleClick={() => onOpen(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onOpen(item);
                }}
              >
                <button
                  type="button"
                  className={`check${checked.has(item.id) ? " is-on" : ""}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleCheck(item.id, event.shiftKey);
                  }}
                  aria-label="选择"
                >
                  {checked.has(item.id) && <IconCheck size={12} />}
                </button>

                <span className={`type type-${item.kind}`}>{KIND_LABEL[item.kind] ?? "文件"}</span>

                <div className="row-main">
                  <p className="row-title" title={item.title}>
                    {item.title}
                  </p>
                  {rowSub(item)}
                </div>

                <span className="col-size">{formatSize(item.size)}</span>
                <span className="col-date">{formatDate(item.createdAt).slice(0, 10)}</span>

                <div className="row-act">
                  {isReadable(item.kind) && (
                    <button
                      type="button"
                      className="ghost-btn"
                      title="阅读"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpen(item);
                      }}
                    >
                      <IconRead size={15} />
                    </button>
                  )}
                  {view.kind === "trash" ? (
                    <button
                      type="button"
                      className="ghost-btn"
                      title="恢复"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRestoreOne(item);
                      }}
                    >
                      <IconRestore size={15} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={`ghost-btn${item.favorite ? " is-fav" : ""}`}
                      title={item.favorite ? "取消收藏" : "收藏"}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleFavorite(item);
                      }}
                    >
                      <IconStar size={15} filled={item.favorite} />
                    </button>
                  )}
                </div>

                {item.readingProgress !== null && item.readingProgress > 0 && (
                  <span className="row-progress" style={{ width: `${Math.round(item.readingProgress * 100)}%` }} />
                )}
              </div>
            ))}
          </div>
        )}

        {hasLibrary && items.length > 0 && mode === "cards" && (
          <div className="cards">
            {items.map((item) => {
              const thumb = item.kind === "image" ? assetUrl(item.path) : null;
              return (
                <article
                  key={item.id}
                  className={`card${selectedId === item.id ? " is-selected" : ""}${checked.has(item.id) ? " is-checked" : ""}`}
                  onClick={(event) => {
                    if (event.shiftKey || event.metaKey || event.ctrlKey) {
                      onToggleCheck(item.id, true);
                      return;
                    }
                    onSelect(item.id);
                  }}
                  onDoubleClick={() => onOpen(item)}
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") onOpen(item);
                  }}
                >
                  <div className={`card-thumb kind-${item.kind}`}>
                    <span className="card-ext">{(item.ext ?? "").replace(".", "").toUpperCase() || "FILE"}</span>
                    {thumb ? <img src={thumb} alt="" loading="lazy" /> : item.kind === "pdf" && <PdfThumb path={item.path} alt="" />}
                    <button
                      type="button"
                      className={`check check-card${checked.has(item.id) ? " is-on" : ""}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleCheck(item.id, event.shiftKey);
                      }}
                      aria-label="选择"
                    >
                      {checked.has(item.id) && <IconCheck size={12} />}
                    </button>
                  </div>
                  <div className="card-body">
                    <p className="card-title" title={item.title}>
                      {item.title}
                    </p>
                    <div className="card-meta">
                      <span>{KIND_LABEL[item.kind] ?? "文件"}</span>
                      <span>{formatSize(item.size)}</span>
                      {statusBadge(item)}
                      {item.favorite && <IconStar size={12} filled />}
                    </div>
                    {!!item.tags.length && (
                      <div className="card-tags">
                        {item.tags.slice(0, 2).map((tag) => (
                          <span key={tag} className="tag-chip">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {item.readingProgress !== null && item.readingProgress > 0 && (
                    <span className="row-progress" style={{ width: `${Math.round(item.readingProgress * 100)}%` }} />
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>

      {checked.size > 0 && (
        <div className="batch">
          <span className="batch-count">已选 {checked.size} 项</span>
          <span className="batch-sep" />
          {view.kind === "trash" ? (
            <button type="button" onClick={() => onBatch("restore")}>
              <IconRestore size={14} />
              恢复
            </button>
          ) : (
            <>
              <button type="button" onClick={() => onBatch("tag")}>
                打标签
              </button>
              <button type="button" onClick={() => onBatch("collection")}>
                加入集合
              </button>
              <button type="button" onClick={() => onBatch("favorite")}>
                收藏
              </button>
              <button type="button" className="is-danger" onClick={() => onBatch("trash")}>
                <IconTrash size={14} />
                移入回收站
              </button>
            </>
          )}
          <span className="batch-sep" />
          <button type="button" className="batch-clear" onClick={() => onBatch("clear")}>
            取消选择
          </button>
        </div>
      )}
    </section>
  );
}
