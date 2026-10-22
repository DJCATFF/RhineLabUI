import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDocument = pdfjs.PDFDocumentProxy;

const WASM_URL = new URL("pdfjs-wasm/", document.baseURI).href;

export async function openPdf(target: string): Promise<PdfDocument> {
  if (!window.desk) throw new Error("缺少文件读取通道");
  const data = await window.desk.readFile(target);
  if (!data || data.byteLength === 0) throw new Error("无法读取原件");
  return pdfjs.getDocument({ data, wasmUrl: WASM_URL }).promise;
}

export interface RenderedPage {
  width: number;
  height: number;
  renderTask: pdfjs.RenderTask;
}

export async function renderPage(
  doc: PdfDocument,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number,
): Promise<RenderedPage> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas 2d context 不可用");

  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  const renderTask = page.render({
    canvas,
    canvasContext: context,
    viewport,
    transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
  });

  await renderTask.promise;
  return { width: Math.floor(viewport.width), height: Math.floor(viewport.height), renderTask };
}

export async function pageBaseWidth(doc: PdfDocument, pageNumber: number): Promise<number> {
  const page = await doc.getPage(pageNumber);
  return page.getViewport({ scale: 1 }).width;
}

const thumbCache = new WeakMap<PdfDocument, Map<number, string>>();

export async function renderThumb(doc: PdfDocument, pageNumber: number, width: number): Promise<string> {
  let cache = thumbCache.get(doc);
  if (!cache) {
    cache = new Map();
    thumbCache.set(doc, cache);
  }
  const key = Math.round(width);
  const hit = cache.get(pageNumber * 1000 + key);
  if (hit) return hit;

  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = width / base.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas 2d context 不可用");
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  const url = canvas.toDataURL("image/jpeg", 0.72);
  cache.set(pageNumber * 1000 + key, url);
  return url;
}
