import { useEffect, useState } from "react";
import type { ResourceDetail } from "../types";
import { assetUrl, formatSize } from "../api";
import { openPdf, renderPage } from "../pdf";
import { IconRead } from "./Icons";

const thumbCache = new Map<string, { url: string; pages: number }>();

async function pdfCover(path: string): Promise<{ url: string; pages: number }> {
  const cached = thumbCache.get(path);
  if (cached) return cached;
  const doc = await openPdf(path);
  try {
    const canvas = document.createElement("canvas");
    await renderPage(doc, 1, canvas, 0.55);
    const url = canvas.toDataURL("image/jpeg", 0.8);
    const value = { url, pages: doc.numPages };
    thumbCache.set(path, value);
    return value;
  } finally {
    void doc.destroy();
  }
}

export function PdfThumb({ path, alt }: { path: string | null; alt: string }) {
  const [url, setUrl] = useState<string | null>(() => (path ? thumbCache.get(path)?.url ?? null : null));

  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }
    const cached = thumbCache.get(path);
    if (cached) {
      setUrl(cached.url);
      return;
    }
    let alive = true;
    void pdfCover(path)
      .then((value) => {
        if (alive) setUrl(value.url);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [path]);

  return url ? <img src={url} alt={alt} /> : null;
}

export function Preview({ detail, onRead }: { detail: ResourceDetail; onRead: () => void }) {
  const path = detail.files[0]?.path ?? null;
  const [cover, setCover] = useState<{ url: string; pages: number } | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCover(null);
    setText(null);
    setError(null);
    if (!path || !window.desk) return;
    let alive = true;

    if (detail.kind === "pdf") {
      void pdfCover(path)
        .then((value) => {
          if (alive) setCover(value);
        })
        .catch((reason: unknown) => {
          if (alive) setError(reason instanceof Error ? reason.message : String(reason));
        });
    } else if (detail.kind === "text") {
      void window.desk
        .readFile(path)
        .then((bytes) => {
          if (!alive || !bytes) return;
          const content = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
          setText(content.slice(0, 1400));
        })
        .catch((reason: unknown) => {
          if (alive) setError(reason instanceof Error ? reason.message : String(reason));
        });
    }

    return () => {
      alive = false;
    };
  }, [path, detail.kind, detail.id]);

  if (detail.kind === "image") {
    return (
      <button type="button" className="preview preview-image" onClick={onRead}>
        <img src={assetUrl(path) ?? undefined} alt={detail.title} />
      </button>
    );
  }

  if (detail.kind === "pdf") {
    return (
      <button type="button" className="preview preview-pdf" onClick={onRead}>
        {cover ? (
          <>
            <img src={cover.url} alt="" />
            <span className="preview-pages">{cover.pages} 页</span>
          </>
        ) : (
          <span className="preview-placeholder">{error ? "封面生成失败" : "正在生成封面…"}</span>
        )}
      </button>
    );
  }

  if (detail.kind === "text") {
    return (
      <button type="button" className="preview preview-text" onClick={onRead}>
        <pre>{text ?? (error ? "无法读取正文" : "正在读取…")}</pre>
        <span className="preview-read">
          <IconRead size={14} /> 打开阅读
        </span>
      </button>
    );
  }

  return (
    <div className="preview preview-file">
      <span className={`type type-${detail.kind}`}>{formatSize(detail.size)}</span>
      <p>{(detail.ext ?? "文件").replace(".", "").toUpperCase()} 格式</p>
      <p className="preview-note">该格式暂不支持内嵌预览，可在系统中打开原件。</p>
    </div>
  );
}
