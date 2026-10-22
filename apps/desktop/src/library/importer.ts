import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import * as path from "node:path";
import { registerImport } from "./store";

export interface ImportProgress {
  phase: "scan" | "hash" | "save" | "done";
  index: number;
  total: number;
  current?: string;
  added?: number;
  duplicates?: number;
  skipped?: number;
  elapsedMs?: number;
}

const SKIP_DIRS = new Set([".git", "node_modules", ".svn", "$RECYCLE.BIN", "System Volume Information"]);
const MAX_FILES = 3000;
const MAX_FILE_BYTES = 4 * 1024 * 1024 * 1024;

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip": "application/zip",
  ".rar": "application/vnd.rar",
  ".7z": "application/x-7z-compressed",
};

export function kindOf(ext: string): string {
  if (ext === ".pdf") return "pdf";
  if (ext === ".txt" || ext === ".md" || ext === ".markdown") return "text";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"].includes(ext)) return "image";
  if ([".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"].includes(ext)) return "office";
  if ([".zip", ".rar", ".7z", ".tar", ".gz"].includes(ext)) return "archive";
  return "other";
}

async function collect(root: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 8 || out.length >= MAX_FILES) return;
    let items;
    try {
      items = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      if (out.length >= MAX_FILES) return;
      if (item.name.startsWith(".") && item.isDirectory()) continue;
      if (item.isDirectory() && SKIP_DIRS.has(item.name)) continue;
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        await walk(full, depth + 1);
      } else if (item.isFile() && !item.name.startsWith("~$")) {
        out.push(full);
      }
    }
  }

  await walk(root, 0);
  return out;
}

async function hashFile(file: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file, { highWaterMark: 1024 * 1024 });
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

export async function importFolder(root: string, onProgress: (progress: ImportProgress) => void) {
  const started = Date.now();
  onProgress({ phase: "scan", index: 0, total: 0, current: root });
  const paths = await collect(root);

  const incoming = [];
  let skipped = 0;

  for (let index = 0; index < paths.length; index += 1) {
    const file = paths[index];
    const info = await stat(file).catch(() => null);
    if (!info || info.size === 0 || info.size > MAX_FILE_BYTES) {
      skipped += 1;
      continue;
    }
    const ext = path.extname(file).toLowerCase();
    onProgress({ phase: "hash", index: index + 1, total: paths.length, current: path.basename(file) });
    const sha256 = await hashFile(file).catch(() => null);
    if (!sha256) {
      skipped += 1;
      continue;
    }
    incoming.push({
      path: file,
      ext,
      mimeType: MIME[ext] ?? "application/octet-stream",
      kind: kindOf(ext),
      size: info.size,
      sha256,
      title: path.basename(file, path.extname(file)),
    });
  }

  onProgress({ phase: "save", index: paths.length, total: paths.length });
  const result = registerImport({
    sourceLabel: path.basename(root) || root,
    rootPath: root,
    files: incoming,
  });

  const summary = {
    phase: "done" as const,
    index: paths.length,
    total: paths.length,
    added: result.added,
    duplicates: result.duplicates,
    skipped,
    elapsedMs: Date.now() - started,
  };
  onProgress(summary);
  return { ...summary, sourceId: result.sourceId };
}
