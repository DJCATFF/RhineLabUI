import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { openLibrary, nowIso } from "./db";
import { kindOf } from "./importer";
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
  filesPending: number;
}

/**
 * 导入旧版 PostgreSQL 文档导出（apps/api/scripts/export-legacy.mjs 生成）。
 * 保留原文档 ID 与 archiveNumber；标签进入关联表，要点保存为 JSON，
 * category 转为集合；原件字节需后续从 MinIO 恢复。
 */
export function importLegacyExport(file: string): LegacyImportResult {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { documents?: LegacyDocument[] } | LegacyDocument[];
  const documents = Array.isArray(parsed) ? parsed : parsed.documents;
  if (!Array.isArray(documents)) throw new Error("旧资料导出缺少 documents 数组");

  const db = openLibrary();
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

      if (fileName) {
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
    throw error;
  }

  result.tags = tagNames.size;
  result.collections = collectionNames.size;
  return result;
}
