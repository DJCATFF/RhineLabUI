import { useEffect, useRef, useState } from "react";
import type { PdfDocument } from "../pdf";
import { openPdf, pageBaseWidth, renderPage, renderThumb } from "../pdf";
import type { ResourceDetail } from "../types";
import { KIND_LABEL } from "../types";
import { archiveLabel, assetUrl, formatDate, formatSize, parentPath } from "../api";
import { IconChevron, IconClose, IconFolderOpen } from "./Icons";

interface ReaderProps {
  detail: ResourceDetail;
  onClose: () => void;
  onReading: (locator: string, progress: number) => void;
  onOpenOriginal: () => void;
}

type RailKind = "info" | "pages" | null;

function parsePage(locator: string | undefined): number {
  if (!locator) return 1;
  const match = /^page:(\d+)$/.exec(locator);
  return match ? Math.max(1, Number(match[1])) : 1;
}

function parseScroll(locator: string | undefined): number {
  if (!locator) return 0;
  const match = /^scroll:([\d.]+)$/.exec(locator);
  return match ? Math.min(1, Math.max(0, Number(match[1]))) : 0;
}

export function Reader({ detail, onClose, onReading, onOpenOriginal }: ReaderProps) {
  const [rail, setRail] = useState<RailKind>(null);
  const path = detail.files[0]?.path ?? "";
  const savedText = detail.extracted?.trim() ? detail.extracted : null;
  const canShowSaved = !!savedText && (detail.kind === "text" || detail.kind === "pdf");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="reader" role="dialog" aria-modal="true" aria-label={`阅读 ${detail.title}`}>
      <header className="reader-bar">
        <button type="button" className="reader-back" onClick={onClose}>
          <IconChevron direction="left" size={16} />
          返回
        </button>
        <div className="reader-heading">
          <p className="reader-title" title={detail.title}>
            {detail.title}
          </p>
          <p className="reader-sub">
            {archiveLabel(detail.archiveNo)} · {KIND_LABEL[detail.kind] ?? "文件"} · {formatSize(detail.size)}
          </p>
        </div>
        <div className="reader-actions">
          <button type="button" className="btn btn-small" onClick={onOpenOriginal}>
            打开原件
          </button>
          {detail.kind === "pdf" && (
            <button
              type="button"
              className={`btn btn-small${rail === "pages" ? " is-on" : ""}`}
              onClick={() => setRail(rail === "pages" ? null : "pages")}
            >
              页面
            </button>
          )}
          <button
            type="button"
            className={`btn btn-small${rail === "info" ? " is-on" : ""}`}
            onClick={() => setRail(rail === "info" ? null : "info")}
          >
            资料信息
          </button>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭阅读">
            <IconClose size={16} />
          </button>
        </div>
      </header>

      <div className="reader-body">
        <main className="reader-main">
          {detail.kind === "pdf" && path && (
            <PdfReader detail={detail} path={path} onReading={onReading} rail={rail} />
          )}
          {detail.kind === "text" && path && <TextReader detail={detail} path={path} onReading={onReading} />}
          {detail.kind === "image" && path && <ImageReader path={path} />}
          {!path && canShowSaved && savedText && <SavedText text={savedText} notice="找不到原件，以下是资料库保存的正文。" />}
          {!path && !canShowSaved && <div className="reader-fallback">找不到原件路径。</div>}
        </main>

        {rail === "pages" && detail.kind === "pdf" && <PdfPagesRail detail={detail} path={path} />}

        {rail === "info" && (
          <aside className="reader-rail">
            <div className="rail-block">
              <p className="rail-title">资料信息</p>
              <dl className="rail-meta">
                <div>
                  <dt>编号</dt>
                  <dd>{archiveLabel(detail.archiveNo)}</dd>
                </div>
                <div>
                  <dt>类型</dt>
                  <dd>{KIND_LABEL[detail.kind] ?? "文件"}</dd>
                </div>
                <div>
                  <dt>大小</dt>
                  <dd>{formatSize(detail.size)}</dd>
                </div>
                <div>
                  <dt>添加</dt>
                  <dd>{formatDate(detail.createdAt)}</dd>
                </div>
              </dl>
            </div>

            {!!detail.tags.length && (
              <div className="rail-block">
                <p className="rail-title">标签</p>
                <div className="chip-list">
                  {detail.tags.map((tag) => (
                    <span key={tag} className="chip is-static">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="rail-block">
              <p className="rail-title">来源</p>
              <p className="source-path">{parentPath(detail.path)}</p>
              <p className="rail-note">
                {detail.files[0]?.storage_kind === "reference"
                  ? "引用来源：原件保留在原文件夹。断开时仍可查看已保存的元数据。"
                  : detail.files[0]?.storage_kind === "legacy"
                    ? "旧版上传：原件仍在旧存储中，尚未搬到本机。已保存的正文仍可阅读。"
                    : "托管导入：原件由资料库保存。"}
              </p>
            </div>

            {detail.note && (
              <div className="rail-block">
                <p className="rail-title">笔记</p>
                <p className="rail-note is-note">{detail.note}</p>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function PdfReader({
  detail,
  path,
  onReading,
  rail,
}: {
  detail: ResourceDetail;
  path: string;
  onReading: (locator: string, progress: number) => void;
  rail: RailKind;
}) {
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [page, setPage] = useState(() => parsePage(detail.reading?.locator));
  const [pages, setPages] = useState(0);
  const [fit, setFit] = useState(true);
  const [zoom, setZoom] = useState(1.3);
  const [width, setWidth] = useState(900);
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const renderId = useRef(0);

  useEffect(() => {
    let alive = true;
    setDoc(null);
    setError(null);
    openPdf(path)
      .then((document) => {
        if (!alive) {
          void document.destroy();
          return;
        }
        setDoc(document);
        setPages(document.numPages);
        setPage((current) => Math.min(Math.max(1, current), document.numPages));
      })
      .catch((reason: unknown) => {
        if (alive) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      alive = false;
    };
  }, [path]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!doc || !canvasRef.current) return;
    let cancelled = false;
    const id = ++renderId.current;
    setRendering(true);

    void (async () => {
      const base = await pageBaseWidth(doc, page);
      if (cancelled || id !== renderId.current) return;
      const scale = fit ? Math.max(0.3, (width - 80) / base) : zoom;
      const offscreen = document.createElement("canvas");
      const result = await renderPage(doc, page, offscreen, scale);
      if (cancelled || id !== renderId.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = offscreen.width;
      canvas.height = offscreen.height;
      canvas.style.width = `${result.width}px`;
      canvas.style.height = `${result.height}px`;
      const context = canvas.getContext("2d");
      context?.drawImage(offscreen, 0, 0);
      setRendering(false);
    })().catch((reason: unknown) => {
      if (!cancelled && id === renderId.current) {
        setError(reason instanceof Error ? reason.message : String(reason));
        setRendering(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [doc, page, fit, zoom, width]);

  useEffect(() => {
    if (!pages) return;
    const timer = setTimeout(() => onReading(`page:${page}`, page / pages), 400);
    return () => clearTimeout(timer);
  }, [page, pages, onReading]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (event.key === "ArrowRight" || event.key === "PageDown") {
        setPage((current) => Math.min(pages || 1, current + 1));
      }
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        setPage((current) => Math.max(1, current - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pages]);

  useEffect(() => {
    if (rail === "pages") scrollRef.current?.scrollTo({ top: 0 });
  }, [rail]);

  if (error && detail.extracted?.trim()) {
    return <SavedText text={detail.extracted} notice="原件暂不可访问，以下是资料库保存的正文。" />;
  }

  return (
    <div className="pdf-reader">
      <div className="pdf-scroll" ref={scrollRef}>
        {error && <div className="reader-fallback">原件暂不可访问，也没有可用的正文。</div>}
        {!error && (
          <div className="pdf-stage">
            <canvas ref={canvasRef} className={rendering ? "is-rendering" : ""} />
            {!doc && <p className="pdf-loading">正在打开 PDF…</p>}
          </div>
        )}
      </div>

      <div className="pdf-bar">
        <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>
          上一页
        </button>
        <input
          className="page-input"
          value={page}
          onChange={(event) => {
            const next = Number(event.target.value.replace(/\D/g, ""));
            if (next) setPage(Math.min(pages || 1, next));
          }}
          aria-label="页码"
        />
        <span className="page-total">/ {pages || "—"}</span>
        <button
          type="button"
          onClick={() => setPage((current) => Math.min(pages || 1, current + 1))}
          disabled={page >= pages}
        >
          下一页
        </button>
        <span className="pdf-bar-sep" />
        <button
          type="button"
          className={fit ? "is-on" : ""}
          onClick={() => {
            setFit(true);
            setZoom(1.3);
          }}
        >
          适应宽度
        </button>
        <button
          type="button"
          onClick={() => {
            setFit(false);
            setZoom((value) => Math.max(0.4, value - 0.2));
          }}
        >
          −
        </button>
        <span className="zoom-value">{fit ? "自动" : `${Math.round(zoom * 100)}%`}</span>
        <button
          type="button"
          onClick={() => {
            setFit(false);
            setZoom((value) => Math.min(4, value + 0.2));
          }}
        >
          +
        </button>
      </div>
    </div>
  );
}

function PdfPagesRail({ detail, path }: { detail: ResourceDetail; path: string }) {
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [page, setPage] = useState(() => parsePage(detail.reading?.locator));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    openPdf(path)
      .then((document) => {
        if (!alive) {
          void document.destroy();
          return;
        }
        setDoc(document);
      })
      .catch((reason: unknown) => {
        if (alive) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      alive = false;
    };
  }, [path]);

  return (
    <aside className="reader-rail rail-pages">
      <p className="rail-title">页面</p>
      {error && <p className="rail-note">原件暂不可访问。</p>}
      {doc && (
        <div className="thumbs">
          {Array.from({ length: doc.numPages }).map((_, index) => (
            <Thumb key={index} doc={doc} no={index + 1} active={page === index + 1} onPick={setPage} />
          ))}
        </div>
      )}
      {!doc && !error && <p className="rail-note">正在读取页数…</p>}
    </aside>
  );
}

function Thumb({
  doc,
  no,
  active,
  onPick,
}: {
  doc: PdfDocument;
  no: number;
  active: boolean;
  onPick: (page: number) => void;
}) {
  const holder = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          observer.disconnect();
          void renderThumb(doc, no, 132)
            .then(setUrl)
            .catch(() => setUrl(null));
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [doc, no]);

  return (
    <button
      ref={holder}
      type="button"
      className={`thumb${active ? " is-active" : ""}`}
      onClick={() => onPick(no)}
      aria-label={`第 ${no} 页`}
    >
      {url ? <img src={url} alt="" /> : <span className="thumb-ghost" />}
      <span className="thumb-no">{no}</span>
    </button>
  );
}

function TextReader({
  detail,
  path,
  onReading,
}: {
  detail: ResourceDetail;
  path: string;
  onReading: (locator: string, progress: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(parseScroll(detail.reading?.locator));
  const scrollRef = useRef<HTMLDivElement>(null);
  const restored = useRef(false);

  useEffect(() => {
    let alive = true;
    const saved = detail.extracted?.trim() ? detail.extracted : null;
    const fallback = () => {
      if (!alive) return;
      if (saved) {
        setText(saved);
        setNotice("原件暂不可访问，以下是资料库保存的正文。");
      } else {
        setError("原件暂不可访问，也没有可用的正文。");
      }
    };
    if (!window.desk) {
      fallback();
      return;
    }
    window.desk
      .readFile(path)
      .then((bytes) => {
        if (!alive) return;
        if (bytes) setText(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
        else fallback();
      })
      .catch(fallback);
    return () => {
      alive = false;
    };
  }, [path, detail.extracted]);

  useEffect(() => {
    if (text === null || restored.current) return;
    const element = scrollRef.current;
    if (!element) return;
    restored.current = true;
    const start = parseScroll(detail.reading?.locator);
    element.scrollTop = start * Math.max(0, element.scrollHeight - element.clientHeight);
  }, [text, detail.reading?.locator]);

  useEffect(() => {
    const timer = setTimeout(() => onReading(`scroll:${progress.toFixed(4)}`, progress), 500);
    return () => clearTimeout(timer);
  }, [progress, onReading]);

  return (
    <div className="text-reader">
      <div
        className="text-scroll"
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          const max = element.scrollHeight - element.clientHeight;
          setProgress(max > 0 ? Math.min(1, element.scrollTop / max) : 0);
        }}
      >
        <article className="text-paper">
          {notice && <p className="reader-fallback">{notice}</p>}
          {error && <p className="reader-fallback">{error}</p>}
          {text === null && !error && <p className="reader-fallback">正在读取正文…</p>}
          {text !== null && <pre>{text}</pre>}
        </article>
      </div>
      <div className="reader-progress">
        <span style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
    </div>
  );
}

function SavedText({ text, notice }: { text: string; notice: string }) {
  return (
    <div className="text-reader">
      <div className="text-scroll">
        <article className="text-paper">
          <p className="reader-fallback">{notice}</p>
          <pre>{text}</pre>
        </article>
      </div>
    </div>
  );
}

function ImageReader({ path }: { path: string }) {
  const [scale, setScale] = useState(1);
  const [fit, setFit] = useState(true);
  return (
    <div className="image-reader">
      <div className="image-stage">
        <img
          src={assetUrl(path) ?? undefined}
          alt=""
          style={fit ? { maxWidth: "92%", maxHeight: "92%" } : { width: `${scale * 100}%`, maxWidth: "none" }}
        />
      </div>
      <div className="pdf-bar">
        <button type="button" className={fit ? "is-on" : ""} onClick={() => setFit(true)}>
          适应窗口
        </button>
        <button
          type="button"
          onClick={() => {
            setFit(false);
            setScale((value) => Math.max(0.2, value - 0.2));
          }}
        >
          −
        </button>
        <span className="zoom-value">{fit ? "自动" : `${Math.round(scale * 100)}%`}</span>
        <button
          type="button"
          onClick={() => {
            setFit(false);
            setScale((value) => Math.min(4, value + 0.2));
          }}
        >
          +
        </button>
        <span className="pdf-bar-sep" />
        <button type="button" onClick={() => void window.desk?.reveal(path)}>
          <IconFolderOpen size={14} /> 在文件夹中显示
        </button>
      </div>
    </div>
  );
}
