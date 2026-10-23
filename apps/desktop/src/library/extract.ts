import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

/** 单份原件的抽取上限：超出后拒绝或截断，避免一个超大文件拖住整个队列。 */
export const EXTRACT_LIMITS = {
  maxBytes: 100 * 1024 * 1024,
  maxPages: 2000,
  maxChars: 2_000_000,
};

export interface ExtractLimits {
  maxBytes: number;
  maxPages: number;
  maxChars: number;
}

/** 托管原件：抽取前按登记信息核对存在性、大小与摘要。 */
export interface ExtractTarget {
  kind: string;
  path: string;
  size: number;
  sha256: string;
}

export interface ExtractProgress {
  pages: number;
  pageTotal: number;
  chars: number;
}

export interface ExtractResult {
  text: string;
  /** chars：达到字数上限；pages：达到页数上限；null：完整抽取。 */
  truncated: "chars" | "pages" | null;
  pages: number;
  pageTotal: number;
  /** 每页正文在 text 中的起始字符偏移（按码点计，与 SQLite length/instr 一致）。 */
  pageOffsets: number[];
  bytes: number;
  sha256: string;
}

export interface ExtractOptions {
  limits?: Partial<ExtractLimits>;
  onProgress?: (progress: ExtractProgress) => void;
}

const EXTRACTABLE = new Set(["text", "pdf"]);

/** 当前只抽取纯文本与文本型 PDF，扫描版 PDF 会以「没有可抽取的文本」失败。 */
export function isExtractable(kind: string): boolean {
  return EXTRACTABLE.has(kind);
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function pdfEntry(): string {
  const unpacked = path.join(
    process.resourcesPath,
    "app.asar.unpacked",
    "node_modules",
    "pdfjs-dist",
    "legacy",
    "build",
    "pdf.mjs",
  );
  if (existsSync(unpacked)) return unpacked;
  return require.resolve("pdfjs-dist/legacy/build/pdf.mjs");
}

interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
}

interface PdfPage {
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
  cleanup?(): void;
}

interface PdfDocument {
  numPages: number;
  getPage(page: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

interface PdfModule {
  getDocument(params: Record<string, unknown>): { promise: Promise<PdfDocument> };
}

let pdfModule: Promise<PdfModule> | null = null;

/**
 * pdfjs 用 `process.type !== "browser"` 判断自己不在 Node 里，Electron 的 utilityProcess
 * 恰好是 "utility"，于是它会跳过自带的 Node 补偿，而 legacy 构建在导入阶段就需要
 * DOMMatrix。这里在导入前补齐同样的全局，避免抽取进程直接抛错。
 */
function ensurePdfGlobals(): void {
  if (typeof globalThis.DOMMatrix === "function" && typeof globalThis.Path2D === "function") return;
  const nodeRequire = createRequire(__filename);
  const canvas = nodeRequire("@napi-rs/canvas") as {
    DOMMatrix?: typeof DOMMatrix;
    Path2D?: typeof Path2D;
    ImageData?: typeof ImageData;
  };
  globalThis.DOMMatrix ??= canvas.DOMMatrix as typeof DOMMatrix;
  globalThis.Path2D ??= canvas.Path2D as typeof Path2D;
  globalThis.ImageData ??= canvas.ImageData as typeof ImageData;
}

/** pdfjs 是 ESM：CommonJS 构建里只能用动态 import 加载绝对 URL。 */
function loadPdfjs(): Promise<PdfModule> {
  if (!pdfModule) pdfModule = preparePdfjs();
  return pdfModule;
}

async function preparePdfjs(): Promise<PdfModule> {
  ensurePdfGlobals();
  const importer = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<unknown>;
  const workerEntry = path.join(path.dirname(pdfEntry()), "pdf.worker.mjs");
  // 直接在工作进程内加载 worker 模块，pdfjs 会走「同线程假 worker」而不是创建 Web Worker。
  const worker = (await importer(pathToFileURL(workerEntry).href)) as {
    WorkerMessageHandler: unknown;
  };
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
  return (await importer(pathToFileURL(pdfEntry()).href)) as PdfModule;
}

/** SQLite 的 length/instr 按 Unicode 码点计数，JS 的 length 按 UTF-16 单元；偏移统一用码点。 */
function codePointLength(text: string): number {
  let count = 0;
  for (const _char of text) count += 1;
  return count;
}

function readPlainText(buffer: Buffer, limits: ExtractLimits): ExtractResult {
  const raw = buffer.toString("utf8").replace(/^\uFEFF/, "").trim();
  if (!raw) throw new Error("文件里没有可抽取的文本");
  const truncated = raw.length > limits.maxChars;
  return {
    text: truncated ? raw.slice(0, limits.maxChars) : raw,
    truncated: truncated ? "chars" : null,
    pages: 1,
    pageTotal: 1,
    pageOffsets: [0],
    bytes: buffer.byteLength,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  };
}

async function readPdfText(
  buffer: Buffer,
  limits: ExtractLimits,
  onProgress?: (progress: ExtractProgress) => void,
): Promise<ExtractResult> {
  const pdfjs = await loadPdfjs();
  const root = path.join(path.dirname(pdfEntry()), "..", "..");
  // pdfjs 要求资源地址以斜杠结尾，Node 侧按路径直接读取，统一改成正斜杠。
  const asset = (name: string) => `${path.join(root, name).replace(/\\/g, "/")}/`;
  const data = new Uint8Array(buffer);
  const task = pdfjs.getDocument({
    data,
    standardFontDataUrl: asset("standard_fonts"),
    cMapUrl: asset("cmaps"),
    cMapPacked: true,
    isEvalSupported: false,
    verbosity: 0,
  });
  const doc = await task.promise;
  const pageTotal = doc.numPages;
  const parts: string[] = [];
  const pageLimit = Math.min(pageTotal, limits.maxPages);
  let chars = 0;
  let processed = 0;
  let truncated: "chars" | "pages" | null = null;
  try {
    for (let index = 1; index <= pageLimit; index += 1) {
      const page = await doc.getPage(index);
      const content = await page.getTextContent();
      let body = "";
      for (const item of content.items) {
        if (typeof item.str !== "string") continue;
        body += item.str;
        if (item.hasEOL) body += "\n";
      }
      page.cleanup?.();
      parts.push(body);
      processed = index;
      chars += body.length;
      onProgress?.({ pages: index, pageTotal, chars });
      if (chars >= limits.maxChars) {
        truncated = "chars";
        break;
      }
    }
    if (!truncated && processed < pageTotal) truncated = "pages";
  } finally {
    await doc.destroy();
  }
  const raw = parts.join("\n");
  const joined = raw.trim();
  if (!joined) throw new Error("PDF 里没有可抽取的文本，可能是扫描件");
  const clipped = truncated === "chars" ? joined.slice(0, limits.maxChars) : joined;
  // 页码映射：先按 parts 累加码点（含连接换行），再扣除 trim 掉的头部空白，
  // 得到每页在最终正文里的起始偏移；超出截断长度的尾页不再记录。
  const leading = codePointLength(raw) - codePointLength(raw.trimStart());
  const clippedLength = codePointLength(clipped);
  const pageOffsets: number[] = [];
  let cursor = 0;
  for (const part of parts) {
    const start = cursor - leading;
    if (start >= 0 && start < clippedLength) pageOffsets.push(start);
    cursor += codePointLength(part) + 1;
  }
  return {
    text: clipped,
    truncated,
    pages: processed,
    pageTotal,
    pageOffsets,
    bytes: buffer.byteLength,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  };
}

/**
 * 校验并抽取托管原件。只在工作进程里调用：这里会读入整份原件，
 * 主进程不应直接执行。失败时抛出的原因可以直接展示给用户。
 */
export async function extractOriginal(target: ExtractTarget, options: ExtractOptions = {}): Promise<ExtractResult> {
  const limits: ExtractLimits = { ...EXTRACT_LIMITS, ...options.limits };
  const info = await stat(target.path).catch(() => null);
  if (!info) throw new Error("原件已不在资料库中，无法抽取正文");
  if (info.size > limits.maxBytes) {
    throw new Error(`原件超过 ${megabytes(limits.maxBytes)}，未自动抽取正文`);
  }
  const buffer = await readFile(target.path);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  if (buffer.byteLength !== target.size || sha256 !== target.sha256) {
    throw new Error("原件与登记信息不一致，可能已被修改，未写入正文");
  }
  if (target.kind === "text") return readPlainText(buffer, limits);
  if (target.kind === "pdf") return readPdfText(buffer, limits, options.onProgress);
  throw new Error(`暂不支持抽取「${target.kind}」类型的正文`);
}
