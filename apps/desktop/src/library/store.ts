import { openLibrary, nextArchiveNo, nowIso } from "./db";
import { discardOriginals, originalIntact, originalsDir, saveOriginal, type StoredOriginal } from "./originals";
import { EXTRACT_JOB, queueExtraction } from "./jobs";
import { isExtractable } from "./extract";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";

export type ViewKind = "all" | "inbox" | "recent" | "favorite" | "collection" | "tag" | "source" | "trash";
export type SortKind = "added" | "title" | "size" | "recent";

export interface ListParams {
  view: ViewKind;
  id?: string;
  search?: string;
  kinds?: string[];
  sort?: SortKind;
  limit?: number;
  offset?: number;
}

export interface ResourceRow {
  id: string;
  archive_no: number;
  title: string;
  kind: string;
  status: string;
  favorite: number;
  inbox: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  file_path: string | null;
  file_ext: string | null;
  file_size: number | null;
  tag_names: string | null;
  collection_count: number;
  reading_at: string | null;
  reading_progress: number | null;
}

export interface ResourceItem {
  id: string;
  archiveNo: number;
  title: string;
  kind: string;
  status: string;
  favorite: boolean;
  inbox: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  path: string | null;
  ext: string | null;
  size: number | null;
  tags: string[];
  collectionCount: number;
  readingAt: string | null;
  readingProgress: number | null;
}

const SELECT_COLUMNS = `
  r.id, r.archive_no, r.title, r.kind, r.status, r.favorite, r.inbox,
  r.created_at, r.updated_at, r.deleted_at,
  (SELECT f.path FROM files f WHERE f.resource_id = r.id ORDER BY f.created_at LIMIT 1) AS file_path,
  (SELECT f.ext FROM files f WHERE f.resource_id = r.id ORDER BY f.created_at LIMIT 1) AS file_ext,
  (SELECT f.size FROM files f WHERE f.resource_id = r.id ORDER BY f.created_at LIMIT 1) AS file_size,
  (SELECT group_concat(name, '|') FROM (
      SELECT t.name AS name FROM resource_tags rt JOIN tags t ON t.id = rt.tag_id
      WHERE rt.resource_id = r.id ORDER BY t.name
  )) AS tag_names,
  (SELECT count(*) FROM collection_resources cr WHERE cr.resource_id = r.id) AS collection_count,
  (SELECT rs.updated_at FROM reading_states rs WHERE rs.resource_id = r.id) AS reading_at,
  (SELECT rs.progress FROM reading_states rs WHERE rs.resource_id = r.id) AS reading_progress
`;

function toItem(row: ResourceRow): ResourceItem {
  return {
    id: row.id,
    archiveNo: row.archive_no,
    title: row.title,
    kind: row.kind,
    status: row.status,
    favorite: Boolean(row.favorite),
    inbox: Boolean(row.inbox),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    path: row.file_path,
    ext: row.file_ext,
    size: row.file_size,
    tags: row.tag_names ? row.tag_names.split("|") : [],
    collectionCount: row.collection_count,
    readingAt: row.reading_at,
    readingProgress: row.reading_progress,
  };
}

function buildWhere(params: ListParams): { sql: string; values: (string | number)[] } {
  const clauses: string[] = [];
  const values: (string | number)[] = [];

  if (params.view === "trash") {
    clauses.push("r.deleted_at IS NOT NULL");
  } else {
    clauses.push("r.deleted_at IS NULL");
    if (params.view === "inbox") clauses.push("r.inbox = 1");
    if (params.view === "favorite") clauses.push("r.favorite = 1");
    if (params.view === "recent") clauses.push("EXISTS (SELECT 1 FROM reading_states rs WHERE rs.resource_id = r.id)");
    if (params.view === "collection" && params.id) {
      clauses.push(
        "EXISTS (SELECT 1 FROM collection_resources cr WHERE cr.resource_id = r.id AND cr.collection_id = ?)",
      );
      values.push(params.id);
    }
    if (params.view === "tag" && params.id) {
      clauses.push("EXISTS (SELECT 1 FROM resource_tags rt WHERE rt.resource_id = r.id AND rt.tag_id = ?)");
      values.push(params.id);
    }
    if (params.view === "source" && params.id) {
      clauses.push("r.source_id = ?");
      values.push(params.id);
    }
  }

  if (params.kinds && params.kinds.length > 0) {
    clauses.push(`r.kind IN (${params.kinds.map(() => "?").join(", ")})`);
    values.push(...params.kinds);
  }

  const search = params.search?.trim();
  if (search) {
    const like = `%${search}%`;
    clauses.push(`(
      r.title LIKE ? OR IFNULL(r.note, '') LIKE ? OR
      EXISTS (SELECT 1 FROM files f WHERE f.resource_id = r.id AND f.path LIKE ?) OR
      EXISTS (SELECT 1 FROM resource_tags rt2 JOIN tags t2 ON t2.id = rt2.tag_id
              WHERE rt2.resource_id = r.id AND t2.name LIKE ?)
    )`);
    values.push(like, like, like, like);
  }

  return { sql: clauses.join(" AND "), values };
}

function orderBy(sort: SortKind | undefined): string {
  switch (sort) {
    case "title":
      return "r.title COLLATE NOCASE ASC";
    case "size":
      return "(SELECT f.size FROM files f WHERE f.resource_id = r.id LIMIT 1) DESC";
    case "recent":
      return "COALESCE((SELECT rs.updated_at FROM reading_states rs WHERE rs.resource_id = r.id), r.updated_at) DESC";
    default:
      return "r.created_at DESC";
  }
}

export function listResources(params: ListParams): { items: ResourceItem[]; total: number } {
  const db = openLibrary();
  const where = buildWhere(params);
  const limit = Math.min(Math.max(params.limit ?? 120, 1), 500);
  const offset = Math.max(params.offset ?? 0, 0);

  const rows = db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM resources r WHERE ${where.sql} ORDER BY ${orderBy(params.sort)} LIMIT ? OFFSET ?`,
    )
    .all(...where.values, limit, offset) as unknown as ResourceRow[];

  const total = db
    .prepare(`SELECT count(*) AS total FROM resources r WHERE ${where.sql}`)
    .get(...where.values) as { total: number };

  return { items: rows.map(toItem), total: total.total };
}

export function getResource(id: string) {
  const db = openLibrary();
  const row = db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM resources r WHERE r.id = ?`)
    .get(id) as unknown as ResourceRow | undefined;
  if (!row) return null;

  const files = db
    .prepare("SELECT id, storage_kind, path, mime_type, ext, size, sha256 FROM files WHERE resource_id = ?")
    .all(id) as unknown as {
    id: string;
    storage_kind: string;
    path: string;
    mime_type: string;
    ext: string;
    size: number;
    sha256: string;
  }[];

  const collections = db
    .prepare(
      `SELECT c.id, c.name FROM collections c
       JOIN collection_resources cr ON cr.collection_id = c.id
       WHERE cr.resource_id = ? ORDER BY c.sort, c.name`,
    )
    .all(id) as unknown as { id: string; name: string }[];

  const tags = db
    .prepare(
      `SELECT t.id, t.name, rt.origin FROM tags t
       JOIN resource_tags rt ON rt.tag_id = t.id
       WHERE rt.resource_id = ? ORDER BY t.name`,
    )
    .all(id) as unknown as { id: string; name: string; origin: string }[];

  const reading = db
    .prepare("SELECT locator, progress, updated_at FROM reading_states WHERE resource_id = ?")
    .get(id) as unknown as { locator: string; progress: number; updated_at: string } | undefined;

  const source = db
    .prepare(
      `SELECT s.id, s.kind, s.label, s.root_path FROM sources s
       JOIN resources r ON r.source_id = s.id WHERE r.id = ?`,
    )
    .get(id) as unknown as { id: string; kind: string; label: string; root_path: string | null } | undefined;

  const text = db.prepare("SELECT note, summary, extracted FROM resources WHERE id = ?").get(id) as {
    note: string | null;
    summary: string | null;
    extracted: string | null;
  };

  const job = db
    .prepare(
      "SELECT id, status, attempts, error, updated_at FROM jobs WHERE resource_id = ? AND type = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(id, EXTRACT_JOB) as
    | { id: string; status: string; attempts: number; error: string | null; updated_at: string }
    | undefined;

  return {
    ...toItem(row),
    note: text.note,
    summary: text.summary,
    extracted: text.extracted,
    files,
    collections,
    tagDetails: tags,
    reading: reading ?? null,
    source: source ?? null,
    job: job
      ? { id: job.id, status: job.status, attempts: job.attempts, error: job.error, updatedAt: job.updated_at }
      : null,
  };
}

export function facets() {
  const db = openLibrary();
  const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;

  return {
    all: one("SELECT count(*) AS n FROM resources WHERE deleted_at IS NULL"),
    inbox: one("SELECT count(*) AS n FROM resources WHERE deleted_at IS NULL AND inbox = 1"),
    recent: one(
      "SELECT count(*) AS n FROM resources WHERE deleted_at IS NULL AND EXISTS (SELECT 1 FROM reading_states rs WHERE rs.resource_id = resources.id)",
    ),
    favorite: one("SELECT count(*) AS n FROM resources WHERE deleted_at IS NULL AND favorite = 1"),
    trash: one("SELECT count(*) AS n FROM resources WHERE deleted_at IS NOT NULL"),
    collections: db
      .prepare(
        `SELECT c.id, c.name, count(cr.resource_id) AS n FROM collections c
         LEFT JOIN collection_resources cr ON cr.collection_id = c.id
         LEFT JOIN resources r ON r.id = cr.resource_id AND r.deleted_at IS NULL
         GROUP BY c.id ORDER BY c.sort, c.name`,
      )
      .all() as unknown as { id: string; name: string; n: number }[],
    tags: db
      .prepare(
        `SELECT t.id, t.name, count(r.id) AS n FROM tags t
         LEFT JOIN resource_tags rt ON rt.tag_id = t.id
         LEFT JOIN resources r ON r.id = rt.resource_id AND r.deleted_at IS NULL
         GROUP BY t.id ORDER BY n DESC, t.name LIMIT 40`,
      )
      .all() as unknown as { id: string; name: string; n: number }[],
    sources: db
      .prepare(
        `SELECT s.id, s.label, s.kind, count(r.id) AS n FROM sources s
         LEFT JOIN resources r ON r.source_id = s.id AND r.deleted_at IS NULL
         GROUP BY s.id ORDER BY s.created_at`,
      )
      .all() as unknown as { id: string; label: string; kind: string; n: number }[],
  };
}

export function updateResource(id: string, patch: { title?: string; favorite?: boolean; note?: string; inbox?: boolean }) {
  const db = openLibrary();
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.title !== undefined) {
    sets.push("title = ?");
    values.push(patch.title.trim() || "未命名资料");
  }
  if (patch.favorite !== undefined) {
    sets.push("favorite = ?");
    values.push(patch.favorite ? 1 : 0);
  }
  if (patch.note !== undefined) {
    sets.push("note = ?");
    values.push(patch.note);
  }
  if (patch.inbox !== undefined) {
    sets.push("inbox = ?");
    values.push(patch.inbox ? 1 : 0);
  }
  if (sets.length === 0) return getResource(id);
  sets.push("updated_at = ?");
  values.push(nowIso());
  db.prepare(`UPDATE resources SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
  return getResource(id);
}

export function setResourceTags(id: string, names: string[]) {
  const db = openLibrary();
  const clean = [...new Set(names.map((name) => name.trim()).filter(Boolean))].slice(0, 24);
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM resource_tags WHERE resource_id = ?").run(id);
    for (const name of clean) {
      const existing = db.prepare("SELECT id FROM tags WHERE name = ?").get(name) as { id: string } | undefined;
      const tagId = existing?.id ?? randomUUID();
      if (!existing) db.prepare("INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)").run(tagId, name, nowIso());
      db.prepare("INSERT INTO resource_tags (resource_id, tag_id, origin) VALUES (?, ?, 'user')").run(id, tagId);
    }
    db.prepare("UPDATE resources SET updated_at = ? WHERE id = ?").run(nowIso(), id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getResource(id);
}

export function setResourceCollections(id: string, collectionIds: string[]) {
  const db = openLibrary();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM collection_resources WHERE resource_id = ?").run(id);
    for (const collectionId of [...new Set(collectionIds)]) {
      db.prepare("INSERT OR IGNORE INTO collection_resources (collection_id, resource_id) VALUES (?, ?)").run(
        collectionId,
        id,
      );
    }
    db.prepare("UPDATE resources SET updated_at = ? WHERE id = ?").run(nowIso(), id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getResource(id);
}

export function createCollection(name: string) {
  const db = openLibrary();
  const clean = name.trim();
  if (!clean) throw new Error("集合名称不能为空");
  const existing = db.prepare("SELECT id FROM collections WHERE name = ?").get(clean) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = randomUUID();
  db.prepare("INSERT INTO collections (id, name, sort, created_at) VALUES (?, ?, 0, ?)").run(id, clean, nowIso());
  return id;
}

export function moveToTrash(ids: string[]) {
  const db = openLibrary();
  const statement = db.prepare("UPDATE resources SET deleted_at = ?, updated_at = ? WHERE id = ?");
  const stamp = nowIso();
  db.exec("BEGIN");
  try {
    for (const id of ids) statement.run(stamp, stamp, id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { moved: ids.length };
}

export function restoreFromTrash(ids: string[]) {
  const db = openLibrary();
  const statement = db.prepare("UPDATE resources SET deleted_at = NULL, updated_at = ? WHERE id = ?");
  const stamp = nowIso();
  db.exec("BEGIN");
  try {
    for (const id of ids) statement.run(stamp, id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { restored: ids.length };
}

export function markOpened(id: string) {
  const db = openLibrary();
  db.prepare("UPDATE resources SET opened_at = ? WHERE id = ?").run(nowIso(), id);
  return true;
}

export function saveReadingState(id: string, locator: string, progress: number) {
  const db = openLibrary();
  db.prepare(
    `INSERT INTO reading_states (resource_id, locator, progress, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(resource_id) DO UPDATE SET locator = excluded.locator, progress = excluded.progress, updated_at = excluded.updated_at`,
  ).run(id, locator, Math.max(0, Math.min(1, progress)), nowIso());
  return { ok: true };
}

export function findRegisteredFile(target: string) {
  const db = openLibrary();
  const row = db
    .prepare("SELECT path, mime_type FROM files WHERE path = ? LIMIT 1")
    .get(target) as { path: string; mime_type: string } | undefined;
  return row ?? null;
}

interface IncomingFile {
  path: string;
  ext: string;
  mimeType: string;
  kind: string;
  size: number;
  sha256: string;
  title: string;
}

/**
 * 登记导入：先把原件复制进资料库托管目录并校验，再在一个事务里写入清单。
 * 复制失败的文件不登记，计入 failed；事务回滚时删除本次新建的副本。
 * 全部文件重复时不新建来源；已有托管副本损坏时按同一摘要重新复制修复。
 */
export async function registerImport(options: {
  sourceLabel: string;
  rootPath: string;
  files: IncomingFile[];
}): Promise<{
  sourceId: string | null;
  added: number;
  duplicates: number;
  failed: number;
  repaired: number;
  ids: string[];
}> {
  const db = openLibrary();
  const stamp = nowIso();

  const prepared: { file: IncomingFile; stored: StoredOriginal }[] = [];
  const copied: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let failed = 0;
  let repaired = 0;

  try {
    for (const file of options.files) {
      const digest = `${file.sha256}:${file.size}`;
      if (seen.has(digest)) {
        duplicates += 1;
        continue;
      }
      const known = db
        .prepare("SELECT path FROM files WHERE sha256 = ? AND size = ? AND storage_kind = 'managed' LIMIT 1")
        .get(file.sha256, file.size) as { path: string } | undefined;
      if (known) {
        seen.add(digest);
        duplicates += 1;
        if (!(await originalIntact(known.path, file))) {
          try {
            const stored = await saveOriginal(file.path, { sha256: file.sha256, size: file.size });
            if (stored.created) copied.push(stored.path);
            if (stored.path !== known.path) {
              // 只有确认没有其他资料引用旧路径时才删除，避免误删共享原件。
              db.prepare("UPDATE files SET path = ? WHERE path = ?").run(stored.path, known.path);
              const refs = db.prepare("SELECT COUNT(*) AS n FROM files WHERE path = ?").get(known.path) as { n: number };
              if (refs.n === 0 && known.path.startsWith(originalsDir())) {
                await rm(known.path, { force: true });
              }
            }
            repaired += 1;
          } catch {
            failed += 1;
          }
        }
        continue;
      }
      seen.add(digest);
      let stored: StoredOriginal;
      try {
        stored = await saveOriginal(file.path, { sha256: file.sha256, size: file.size });
      } catch {
        failed += 1;
        continue;
      }
      if (stored.created) copied.push(stored.path);
      prepared.push({ file, stored });
    }

    if (prepared.length === 0) {
      return { sourceId: null, added: 0, duplicates, failed, repaired, ids: [] };
    }

    db.exec("BEGIN");
    try {
      const existingSource = db
        .prepare("SELECT id FROM sources WHERE kind = 'folder' AND root_path = ? LIMIT 1")
        .get(options.rootPath) as { id: string } | undefined;
      const sourceId = existingSource?.id ?? randomUUID();
      if (!existingSource) {
        db.prepare("INSERT INTO sources (id, kind, label, root_path, created_at) VALUES (?, 'folder', ?, ?, ?)").run(
          sourceId,
          options.sourceLabel,
          options.rootPath,
          stamp,
        );
      }

      const ids: string[] = [];
      for (const { file, stored } of prepared) {
        const resourceId = randomUUID();
        db.prepare(
          `INSERT INTO resources (id, archive_no, title, kind, status, favorite, inbox, source_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?, ?)`,
        ).run(
          resourceId,
          nextArchiveNo(),
          file.title,
          file.kind,
          isExtractable(file.kind) ? "pending" : "ready",
          sourceId,
          stamp,
          stamp,
        );
        db.prepare(
          `INSERT INTO files (id, resource_id, storage_kind, path, mime_type, ext, size, sha256, created_at)
           VALUES (?, ?, 'managed', ?, ?, ?, ?, ?, ?)`,
        ).run(randomUUID(), resourceId, stored.path, file.mimeType, file.ext, stored.size, stored.sha256, stamp);
        ids.push(resourceId);
      }

      db.exec("COMMIT");
      queueExtraction(ids);
      return { sourceId, added: ids.length, duplicates, failed, repaired, ids };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } catch (error) {
    await discardOriginals(copied);
    throw error;
  }
}

export { nextArchiveNo };
