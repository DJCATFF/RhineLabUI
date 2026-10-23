import { useEffect, useState } from "react";
import type { Facets, ResourceDetail } from "../types";
import { archiveLabel, formatDate, formatSize, parentPath } from "../api";
import { KIND_LABEL, isExtractableKind, isReadable } from "../types";
import { Preview } from "./Preview";
import { IconClose, IconCollection, IconFolderOpen, IconRead, IconRestore, IconStar, IconTrash } from "./Icons";

interface DetailPanelProps {
  detail: ResourceDetail | null;
  loading: boolean;
  facets: Facets | undefined;
  onClose: () => void;
  onRead: () => void;
  onOpenOriginal: () => void;
  onReveal: () => void;
  onUpdate: (patch: { title?: string; favorite?: boolean; note?: string; inbox?: boolean }) => void;
  onTags: (names: string[]) => void;
  onCollections: (ids: string[]) => void;
  onCreateCollection: (name: string) => Promise<string | null>;
  onTrash: () => void;
  onRestore: () => void;
  onOpenCollection: (id: string) => void;
  onRetryExtraction: () => void;
}

/**
 * 正文抽取状态的文案：原件仍在，失败时可原地重试。
 * 截断的正文必须显式说明范围，不能当作完整抽取展示。
 */
function extractionState(detail: ResourceDetail): {
  text: string;
  failed: boolean;
  canRetry: boolean;
  truncated: boolean;
} {
  const job = detail.job;
  if (detail.extracted && detail.extracted.trim()) {
    const chars = `共 ${detail.extracted.length.toLocaleString()} 字`;
    if (detail.extractTruncated === "chars") {
      return {
        text: `正文已截断：只保留前面 ${detail.extracted.length.toLocaleString()} 字，超出的部分没有写入，检索范围仅限已抽取内容。`,
        failed: false,
        canRetry: false,
        truncated: true,
      };
    }
    if (detail.extractTruncated === "pages") {
      return {
        text: `正文已截断：只抽取了前 ${detail.extractPages ?? 0} 页，全文共 ${detail.extractPageTotal ?? 0} 页，其余页面不在检索范围内。`,
        failed: false,
        canRetry: false,
        truncated: true,
      };
    }
    const pages = detail.kind === "pdf" && detail.extractPageTotal ? `，共 ${detail.extractPageTotal} 页` : "";
    return { text: `正文已抽取，${chars}${pages}。`, failed: false, canRetry: false, truncated: false };
  }
  if (job?.status === "failed" || detail.status === "failed") {
    return { text: `抽取失败：${job?.error ?? "未知原因"}`, failed: true, canRetry: true, truncated: false };
  }
  if (job?.status === "running" || detail.status === "processing") {
    return { text: "正在后台抽取正文…", failed: false, canRetry: false, truncated: false };
  }
  return { text: "已加入抽取队列，完成后可参与正文检索。", failed: false, canRetry: false, truncated: false };
}

export function DetailPanel(props: DetailPanelProps) {
  const { detail, loading, facets, onClose, onRead, onOpenOriginal, onReveal, onUpdate, onTags, onCollections, onCreateCollection, onTrash, onRestore, onOpenCollection, onRetryExtraction } = props;

  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [pickCollections, setPickCollections] = useState(false);
  const [newCollection, setNewCollection] = useState("");

  useEffect(() => {
    setTitle(detail?.title ?? "");
    setNote(detail?.note ?? "");
    setTagDraft("");
    setPickCollections(false);
    setNewCollection("");
  }, [detail?.id, detail?.title, detail?.note]);

  if (loading && !detail) {
    return (
      <aside className="detail">
        <div className="detail-loading">
          <div className="skeleton-block" />
          <div className="skeleton-line" />
          <div className="skeleton-line short" />
        </div>
      </aside>
    );
  }

  if (!detail) {
    return (
      <aside className="detail detail-idle">
        <p>选择一份资料查看详情</p>
        <span>单击选中并预览，双击进入阅读。</span>
      </aside>
    );
  }

  const extraction = extractionState(detail);

  const commitTitle = () => {
    const next = title.trim();
    if (!next) {
      setTitle(detail.title);
      return;
    }
    if (next !== detail.title) onUpdate({ title: next });
  };

  const addTag = () => {
    const name = tagDraft.trim();
    if (!name) return;
    if (!detail.tags.includes(name)) onTags([...detail.tags, name]);
    setTagDraft("");
  };

  const toggleCollection = (id: string) => {
    const current = detail.collections.map((item) => item.id);
    if (current.includes(id)) onCollections(current.filter((value) => value !== id));
    else onCollections([...current, id]);
  };

  const submitCollection = async () => {
    const name = newCollection.trim();
    if (!name) return;
    const id = await onCreateCollection(name);
    setNewCollection("");
    if (id) onCollections([...detail.collections.map((item) => item.id), id]);
  };

  return (
    <aside className="detail">
      <div className="detail-head">
        <span className="detail-no">{archiveLabel(detail.archiveNo)}</span>
        <span className={`type type-${detail.kind}`}>{KIND_LABEL[detail.kind] ?? "文件"}</span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="收起详情">
          <IconClose size={15} />
        </button>
      </div>

      <div className="detail-scroll">
        <Preview detail={detail} onRead={onRead} />

        <div className="detail-title-block">
          <input
            className="title-input"
            value={title}
            spellCheck={false}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setTitle(detail.title);
                event.currentTarget.blur();
              }
            }}
          />
          <div className="detail-actions">
            <button type="button" className="btn btn-small btn-primary" onClick={onRead} disabled={!isReadable(detail.kind)}>
              <IconRead size={14} />
              阅读
            </button>
            <button type="button" className="btn btn-small" onClick={onOpenOriginal}>
              打开原件
            </button>
            <button type="button" className="btn btn-small" onClick={onReveal}>
              <IconFolderOpen size={14} />
              位置
            </button>
            <button
              type="button"
              className={`icon-btn${detail.favorite ? " is-fav" : ""}`}
              onClick={() => onUpdate({ favorite: !detail.favorite })}
              title={detail.favorite ? "取消收藏" : "收藏"}
            >
              <IconStar size={16} filled={detail.favorite} />
            </button>
          </div>
        </div>

        <dl className="meta">
          <div>
            <dt>大小</dt>
            <dd>{formatSize(detail.size)}</dd>
          </div>
          <div>
            <dt>格式</dt>
            <dd>{(detail.ext ?? "—").replace(".", "").toUpperCase() || "—"}</dd>
          </div>
          <div>
            <dt>添加</dt>
            <dd>{formatDate(detail.createdAt)}</dd>
          </div>
          <div>
            <dt>最近阅读</dt>
            <dd>{detail.reading ? formatDate(detail.reading.updated_at) : "还没有阅读记录"}</dd>
          </div>
        </dl>

        {detail.reading && detail.reading.progress > 0 && (
          <div className="reading-line">
            <span>阅读进度</span>
            <span className="reading-track">
              <span style={{ width: `${Math.round(detail.reading.progress * 100)}%` }} />
            </span>
            <span>{Math.round(detail.reading.progress * 100)}%</span>
          </div>
        )}

        {isExtractableKind(detail.kind) && (
          <section className="block">
            <p className="block-title">
              正文抽取
              {extraction.canRetry && (
                <button type="button" className="block-add" onClick={onRetryExtraction}>
                  重试抽取
                </button>
              )}
            </p>
            <p
              className={`block-placeholder${extraction.failed ? " is-failed" : ""}${
                extraction.truncated ? " is-truncated" : ""
              }`}
            >
              {extraction.text}
            </p>
          </section>
        )}

        <section className="block">
          <p className="block-title">摘要</p>
          <p className="block-placeholder">{detail.summary?.trim() || "尚未生成摘要。保存、检索与阅读不依赖这一步，AI 编目可在之后补齐。"}</p>
        </section>

        <section className="block">
          <p className="block-title">标签</p>
          <div className="chip-list">
            {detail.tagDetails.map((tag) => (
              <span key={tag.id} className={`chip${tag.origin === "ai" ? " is-ai" : ""}`}>
                {tag.name}
                <button
                  type="button"
                  onClick={() => onTags(detail.tags.filter((name) => name !== tag.name))}
                  aria-label={`移除标签 ${tag.name}`}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              className="chip-input"
              value={tagDraft}
              placeholder="添加标签"
              onChange={(event) => setTagDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") addTag();
                if (event.key === "Backspace" && !tagDraft && detail.tags.length) {
                  onTags(detail.tags.slice(0, -1));
                }
              }}
            />
          </div>
          {!!facets?.tags.length && (
            <div className="suggest">
              {facets.tags
                .filter((tag) => !detail.tags.includes(tag.name))
                .slice(0, 4)
                .map((tag) => (
                  <button key={tag.id} type="button" onClick={() => onTags([...detail.tags, tag.name])}>
                    + {tag.name}
                  </button>
                ))}
            </div>
          )}
        </section>

        <section className="block">
          <p className="block-title">
            集合
            <button type="button" className="block-add" onClick={() => setPickCollections((value) => !value)}>
              {pickCollections ? "收起" : "管理"}
            </button>
          </p>
          <div className="chip-list">
            {detail.collections.map((collection) => (
              <span key={collection.id} className="chip is-collection">
                <button type="button" className="chip-open" onClick={() => onOpenCollection(collection.id)}>
                  <IconCollection size={12} />
                  {collection.name}
                </button>
                <button type="button" onClick={() => toggleCollection(collection.id)} aria-label="移出集合">
                  ×
                </button>
              </span>
            ))}
            {!detail.collections.length && <span className="chip-empty">未加入集合</span>}
          </div>
          {pickCollections && (
            <div className="picker">
              {facets?.collections.map((collection) => (
                <label key={collection.id} className="picker-row">
                  <input
                    type="checkbox"
                    checked={detail.collections.some((item) => item.id === collection.id)}
                    onChange={() => toggleCollection(collection.id)}
                  />
                  <span>{collection.name}</span>
                  <span className="picker-count">{collection.n}</span>
                </label>
              ))}
              {!facets?.collections.length && <p className="picker-empty">还没有集合</p>}
              <div className="picker-new">
                <input
                  value={newCollection}
                  placeholder="新建集合并加入"
                  onChange={(event) => setNewCollection(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void submitCollection();
                  }}
                />
                <button type="button" onClick={() => void submitCollection()}>
                  创建
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="block">
          <p className="block-title">来源</p>
          <div className="source-info">
            <p className="source-label">
              <IconFolderOpen size={13} />
              {detail.source?.label ?? "本机文件夹"}
            </p>
            <p className="source-path" title={detail.path ?? undefined}>
              {parentPath(detail.path)}
            </p>
            {detail.files[0] && detail.files[0].storage_kind === "reference" && (
              <p className="source-note">引用来源：原件保留在原文件夹，软件只保存路径与索引。</p>
            )}
            {detail.files[0] && detail.files[0].storage_kind === "managed" && (
              <p className="source-note">托管导入：原件已复制到资料库目录，原文件夹移动或删除后仍可阅读。</p>
            )}
          </div>
        </section>

        <section className="block">
          <p className="block-title">笔记</p>
          <textarea
            className="note-input"
            value={note}
            rows={5}
            placeholder="记录这份资料的用途、结论或待办…"
            onChange={(event) => setNote(event.target.value)}
            onBlur={() => {
              if (note !== (detail.note ?? "")) onUpdate({ note });
            }}
          />
        </section>

        <div className="detail-footer">
          {detail.deletedAt ? (
            <button type="button" className="btn btn-small" onClick={onRestore}>
              <IconRestore size={14} />
              从回收站恢复
            </button>
          ) : (
            <button type="button" className="btn btn-small btn-danger" onClick={onTrash}>
              <IconTrash size={14} />
              移入回收站
            </button>
          )}
          {detail.inbox && !detail.deletedAt && (
            <button type="button" className="btn btn-small btn-ghost" onClick={() => onUpdate({ inbox: false })}>
              移出收件箱
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
