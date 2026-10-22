import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { openLibrary, nowIso } from "./db";
import { kindOf } from "./importer";
import { discardOriginals, saveOriginal, type StoredOriginal } from "./originals";
import { createCollection } from "./store";

export interface LegacyDocument {
  id: string;
  archiveNumber: number;
  title: string;
  fileName: string;
  mimeType: string;
  size: number;
  objectKey: string;
  sha256: string;
  /** 导出时一并下载的原件路径，相对导出 JSON 所在目录。 */
  localFile?: string | null;
  text?: string | null;
  summary?: string | null;
  keyPoints?: string[];
  tags?: string[];
  category?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface LegacyImportResult {
  added: number;
  skipped: number;
  conflicts: number;
  tags: number;
  collections: number;
  /** 原件未随导出包提供、只登记了元数据的资料数。 */
  filesPending: number;
}

/**
 * 导入旧版 PostgreSQL 文档导出（apps/api/scripts/export-legacy.mjs 生成）。
 * 保留原文档 ID 与 archiveNumber；标签进入关联表，要点保存为 JSON，
 * category 转为集合；导出包内附带的原件走与普通导入相同的复制校验流程。
 */
export async function importLegacyExport(file: string): Promise<LegacyImportResult> {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { documents?: LegacyDocument[] } | LegacyDocument[];
  const documents = Array.isArray(parsed) ? parsed : parsed.documents;
  if (!Array.isArray(documents)) throw new Error("旧资料导出缺少 documents 数组");

  const db = openLibrary();
  const baseDir = path.dirname(path.resolve(file));
  const stored = new Map<string, StoredOriginal>();
  const copied: string[] = [];

  // 只为确实会写入的资料复制原件，避免给重复/冲突记录留下孤儿副本。
  const eligible = new Set<string>();
  for (const doc of documents) {
    const id = typeof doc.id === "string" ? doc.id.trim() : "";
    const archiveNo = Number(doc.archiveNumber);
    if (!id || !Number.isInteger(archiveNo) || archiveNo <= 0 || eligible.has(id)) continue;
    if (db.prepare("SELECT id FROM resources WHERE id = ?").get(id)) continue;
    if (db.prepare("SELECT id FROM resources WHERE archive_no = ?").get(archiveNo)) continue;
    eligible.add(id);
  }

  for (const doc of documents) {
    const documentId = typeof doc.id === "string" ? doc.id.trim() : "";
    if (!doc.localFile || !documentId || !eligible.has(documentId)) continue;
    try {
      const saved = await saveOriginal(path.resolve(baseDir, doc.localFile), {
        sha256: doc.sha256 || undefined,
        size: Number(doc.size) || undefined,
      });
      if (saved.created) copied.push(saved.path);
      stored.set(documentId, saved);
    } catch {
      // 原件缺失或校验失败：保留元数据与正文，计入 filesPending。
    }
  }

  const stamp = nowIso();
  const sourceId = randomUUID();
  const result: LegacyImportResult = {
    added: 0,
    skipped: 0,
    conflicts: 0,
    tags: 0,
    collections: 0,
    filesPending: 0,
  };
  const tagNames = new Set<string>();
  const collectionNames = new Set<string>();
  let maxArchiveNo = 0;

  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO sources (id, kind, label, root_path, created_at) VALUES (?, 'legacy', ?, NULL, ?)").run(
      sourceId,
      "旧版上传（PostgreSQL）",
      stamp,
    );

    for (const doc of documents) {
      const id = typeof doc.id === "string" ? doc.id.trim() : "";
      const archiveNo = Number(doc.archiveNumber);
      if (!id || !Number.isInteger(archiveNo) || archiveNo <= 0) {
        result.skipped += 1;
        continue;
      }
      if (db.prepare("SELECT id FROM resources WHERE id = ?").get(id)) {
        result.skipped += 1;
        continue;
      }
      if (db.prepare("SELECT id FROM resources WHERE archive_no = ?").get(archiveNo)) {
        result.conflicts += 1;
        continue;
      }

      const fileName = doc.fileName ?? "";
      const ext = path.extname(fileName).toLowerCase();
      const title = (doc.title || fileName || "未命名资料").trim();
      db.prepare(
        `INSERT INTO resources
           (id, archive_no, title, kind, status, favorite, extracted, summary, key_points,
            source_id, inbox, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'ready', 0, ?, ?, ?, ?, 1, ?, ?)`,
      ).run(
        id,
        archiveNo,
        title,
        kindOf(ext),
        doc.text ?? null,
        doc.summary ?? null,
        JSON.stringify(Array.isArray(doc.keyPoints) ? doc.keyPoints : []),
        sourceId,
        doc.createdAt ?? stamp,
        doc.updatedAt ?? stamp,
      );

      const saved = stored.get(id);
      if (saved) {
        const known = db.prepare("SELECT id FROM files WHERE sha256 = ? AND size = ?").get(saved.sha256, saved.size);
        if (!known) {
          db.prepare(
            `INSERT INTO files (id, resource_id, storage_kind, path, mime_type, ext, size, sha256, created_at)
             VALUES (?, ?, 'managed', ?, ?, ?, ?, ?, ?)`,
          ).run(
            randomUUID(),
            id,
            saved.path,
            doc.mimeType || "application/octet-stream",
            path.extname(doc.fileName || saved.path).toLowerCase(),
            saved.size,
            saved.sha256,
            stamp,
          );
        }
      } else if (fileName) {
        const sha256 = doc.sha256 ?? "";
        const size = Number(doc.size) || 0;
        const known = sha256
          ? db.prepare("SELECT id FROM files WHERE sha256 = ? AND size = ?").get(sha256, size)
          : undefined;
        if (!known) {
          db.prepare(
            `INSERT INTO files (id, resource_id, storage_kind, path, mime_type, ext, size, sha256, created_at)
             VALUES (?, ?, 'legacy', ?, ?, ?, ?, ?, ?)`,
          ).run(
            randomUUID(),
            id,
            doc.objectKey || fileName,
            doc.mimeType || "application/octet-stream",
            ext,
            size,
            sha256,
            stamp,
          );
        }
        result.filesPending += 1;
      }

      for (const rawName of Array.isArray(doc.tags) ? doc.tags : []) {
        const name = rawName.trim();
        if (!name) continue;
        const existing = db.prepare("SELECT id FROM tags WHERE name = ?").get(name) as { id: string } | undefined;
        const tagId = existing?.id ?? randomUUID();
        if (!existing) {
          db.prepare("INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)").run(tagId, name, stamp);
          tagNames.add(name);
        }
        db.prepare("INSERT OR IGNORE INTO resource_tags (resource_id, tag_id, origin) VALUES (?, ?, 'ai')").run(
          id,
          tagId,
        );
      }

      const category = doc.category?.trim();
      if (category) {
        const collectionId = createCollection(category);
        db.prepare("INSERT OR IGNORE INTO collection_resources (collection_id, resource_id) VALUES (?, ?)").run(
          collectionId,
          id,
        );
        collectionNames.add(category);
      }

      maxArchiveNo = Math.max(maxArchiveNo, archiveNo);
      result.added += 1;
    }

    if (maxArchiveNo > 0) {
      db.prepare(
        `INSERT INTO counters (key, value) VALUES ('archive_no', ?)
         ON CONFLICT(key) DO UPDATE SET value = MAX(value, excluded.value)`,
      ).run(maxArchiveNo);
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    await discardOriginals(copied);
    throw error;
  }

  result.tags = tagNames.size;
  result.collections = collectionNames.size;
  return result;
}
