import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

/** 正文长度上限：超出后截断，避免单个超大文件拖慢保存与后续索引。 */
const TEXT_LIMIT = 2_000_000;

const EXTRACTABLE = new Set(["text", "pdf"]);

/** 当前只抽取纯文本与文本型 PDF，扫描版 PDF 会以「没有可抽取的文本」失败。 */
export function isExtractable(kind: string): boolean {
  return EXTRACTABLE.has(kind);
}

function clip(input: string): string {
  return input.length > TEXT_LIMIT ? input.slice(0, TEXT_LIMIT) : input;
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

/** pdfjs 是 ESM：CommonJS 构建里只能用动态 import 加载绝对 URL。 */
function loadPdfjs(): Promise<PdfModule> {
  if (!pdfModule) {
    const importer = new Function("specifier", "return import(specifier)") as (
      specifier: string,
    ) => Promise<PdfModule>;
    pdfModule = importer(pathToFileURL(pdfEntry()).href);
  }
  return pdfModule;
}

async function readPlainText(file: string): Promise<string> {
  const raw = await readFile(file, "utf8");
  return clip(raw.replace(/^\uFEFF/, "")).trim();
}

async function readPdfText(file: string): Promise<string> {
  const pdfjs = await loadPdfjs();
  const root = path.join(path.dirname(pdfEntry()), "..", "..");
  // pdfjs 要求资源地址以斜杠结尾，Node 侧按路径直接读取，统一改成正斜杠。
  const asset = (name: string) => `${path.join(root, name).replace(/\\/g, "/")}/`;
  const data = new Uint8Array(await readFile(file));
  const task = pdfjs.getDocument({
    data,
    standardFontDataUrl: asset("standard_fonts"),
    cMapUrl: asset("cmaps"),
    cMapPacked: true,
    isEvalSupported: false,
    verbosity: 0,
  });
  const doc = await task.promise;
  const pages: string[] = [];
  try {
    for (let index = 1; index <= doc.numPages; index += 1) {
      const page = await doc.getPage(index);
      const content = await page.getTextContent();
      let body = "";
      for (const item of content.items) {
        if (typeof item.str !== "string") continue;
        body += item.str;
        if (item.hasEOL) body += "\n";
      }
      pages.push(body);
      page.cleanup?.();
    }
  } finally {
    await doc.destroy();
  }
  return clip(pages.join("\n")).trim();
}

/** 抽取托管原件的正文；失败时抛出可直接展示给用户的原因。 */
export async function extractText(kind: string, file: string): Promise<string> {
  if (kind === "text") {
    const body = await readPlainText(file);
    if (!body) throw new Error("文件里没有可抽取的文本");
    return body;
  }
  if (kind === "pdf") {
    const body = await readPdfText(file);
    if (!body) throw new Error("PDF 里没有可抽取的文本，可能是扫描件");
    return body;
  }
  throw new Error(`暂不支持抽取「${kind}」类型的正文`);
}
