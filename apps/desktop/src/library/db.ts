import { DatabaseSync } from "node:sqlite";
import { app } from "electron";
import { mkdirSync } from "node:fs";
import * as path from "node:path";

let db: DatabaseSync | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS counters (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  root_path TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  archive_no INTEGER NOT NULL UNIQUE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  favorite INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  extracted TEXT,
  summary TEXT,
  key_points TEXT,
  extract_truncated TEXT,
  extract_pages INTEGER,
  extract_page_total INTEGER,
  extract_page_offsets TEXT,
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  inbox INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  opened_at TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  storage_kind TEXT NOT NULL,
  path TEXT NOT NULL,
  name TEXT,
  mime_type TEXT NOT NULL,
  ext TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (resource_id, sha256, size)
);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_resources (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  PRIMARY KEY (collection_id, resource_id)
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS resource_tags (
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  origin TEXT NOT NULL DEFAULT 'user',
  PRIMARY KEY (resource_id, tag_id)
);

CREATE TABLE IF NOT EXISTS reading_states (
  resource_id TEXT PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
  locator TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  resource_id TEXT REFERENCES resources(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_until TEXT,
  error TEXT,
  payload TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS resources_status_idx ON resources (deleted_at, created_at);
CREATE INDEX IF NOT EXISTS resources_kind_idx ON resources (kind);
CREATE INDEX IF NOT EXISTS files_resource_idx ON files (resource_id);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (status, created_at);
CREATE INDEX IF NOT EXISTS jobs_resource_idx ON jobs (resource_id);

-- 全文搜索索引：rowid 复用 resources.archive_no；contentless 不存正文副本。
-- CJK 在写入与查询前逐字拆分，配合 unicode61 才能支持两字短词。
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
  title, names, tags, note, body,
  content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2'
);
`;

export function libraryPath(): string {
  return path.join(app.getPath("userData"), "rhine", "library.db");
}

/**
 * 旧版资料表的唯一约束是 (sha256, size)，同一份内容只能挂在一个资料上。
 * 多个旧库条目可能共享同一份原件，因此改为按资料去重；已有库在这里重建表。
 */
function allowSharedOriginals(handle: DatabaseSync): void {
  const table = handle.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'files'").get() as
    | { sql: string }
    | undefined;
  if (!table?.sql.includes("UNIQUE (sha256, size)")) return;
  handle.exec("BEGIN");
  try {
    handle.exec(`
CREATE TABLE files_next (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  storage_kind TEXT NOT NULL,
  path TEXT NOT NULL,
  name TEXT,
  mime_type TEXT NOT NULL,
  ext TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (resource_id, sha256, size)
);
INSERT INTO files_next (id, resource_id, storage_kind, path, name, mime_type, ext, size, sha256, created_at)
  SELECT id, resource_id, storage_kind, path, name, mime_type, ext, size, sha256, created_at FROM files;
DROP TABLE files;
ALTER TABLE files_next RENAME TO files;
CREATE INDEX IF NOT EXISTS files_resource_idx ON files (resource_id);
`);
    handle.exec("COMMIT");
  } catch (error) {
    handle.exec("ROLLBACK");
    throw error;
  }
}

export function openLibrary(): DatabaseSync {
  if (db) return db;
  const file = libraryPath();
  mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  const columns = db.prepare("PRAGMA table_info(resources)").all() as { name: string }[];
  const has = (name: string) => columns.some((column) => column.name === name);
  if (!has("key_points")) {
    db.exec("ALTER TABLE resources ADD COLUMN key_points TEXT;");
  }
  if (!has("extract_truncated")) {
    db.exec("ALTER TABLE resources ADD COLUMN extract_truncated TEXT;");
  }
  if (!has("extract_pages")) {
    db.exec("ALTER TABLE resources ADD COLUMN extract_pages INTEGER;");
  }
  if (!has("extract_page_total")) {
    db.exec("ALTER TABLE resources ADD COLUMN extract_page_total INTEGER;");
  }
  if (!has("extract_page_offsets")) {
    db.exec("ALTER TABLE resources ADD COLUMN extract_page_offsets TEXT;");
  }
  // 原件名单独存一列：托管副本按内容哈希命名，索引里要记录用户看到的文件名。
  const fileColumns = db.prepare("PRAGMA table_info(files)").all() as { name: string }[];
  if (!fileColumns.some((column) => column.name === "name")) {
    db.exec("ALTER TABLE files ADD COLUMN name TEXT;");
  }
  allowSharedOriginals(db);
  const version = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined;
  if (!version) {
    db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', '5')").run();
  } else if (Number(version.value) < 5) {
    db.prepare("UPDATE meta SET value = '5' WHERE key = 'schema_version'").run();
  }
  return db;
}

export function closeLibrary(): void {
  db?.close();
  db = null;
}

export function nextArchiveNo(): number {
  const handle = openLibrary();
  handle.prepare("INSERT INTO counters (key, value) VALUES ('archive_no', 1) ON CONFLICT(key) DO UPDATE SET value = value + 1").run();
  const row = handle.prepare("SELECT value FROM counters WHERE key = 'archive_no'").get() as { value: number };
  return row.value;
}

export function nowIso(): string {
  return new Date().toISOString();
}
