import { DatabaseSync } from "node:sqlite";
import { openLibrary } from "./db";

/**
 * 索引结构版本：拼接方式或分词规则变化时递增，下次启动自动重建。
 * 只改数据（标题、标签、正文）不会触发重建。
 */
export const SEARCH_INDEX_VERSION = "1";

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;
const WORD = /[\p{L}\p{N}]/u;

export interface SearchHit {
  field: "title" | "tag" | "file" | "note" | "body";
  label: string;
  snippet: string;
  keyword: string;
  page: number | null;
  locator: string | null;
  offset: number;
}

export interface SearchPlan {
  /** 传给 FTS5 的 MATCH 表达式。 */
  match: string;
  /** 原文关键词，用于在标题、标签、正文里定位与截取片段。 */
  needles: string[];
}

export interface IndexStatus {
  indexed: number;
  total: number;
  withText: number;
  version: string | null;
  ready: boolean;
}

/**
 * unicode61 会把连续汉字当成一个 token，两字短词（“巡检”）就查不到“起重机巡检记录”。
 * 写入与查询前把每个汉字单独拆开，短语查询即可按字相邻匹配。
 */
export function splitCjk(text: string): string {
  let out = "";
  for (const char of text) out += CJK.test(char) ? `${char} ` : char;
  return out;
}

function quote(text: string): string {
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * 把用户输入拆成 FTS5 查询：
 * 汉字按逐字短语，西文与型号按前缀短语，多段之间取交集。
 * 无有效字符（只有标点）时返回 null，调用方按无搜索处理。
 */
export function planQuery(raw: string): SearchPlan | null {
  const input = raw.replace(/[\u0000-\u001f]/g, " ").trim();
  if (!input) return null;

  const expressions: string[] = [];
  const needles: string[] = [];

  for (const chunk of input.split(/\s+/)) {
    if (!chunk) continue;
    let run = "";
    let runIsCjk: boolean | null = null;

    const flush = () => {
      const text = run;
      const isCjk = runIsCjk;
      run = "";
      if (!text || !WORD.test(text)) return;
      if (isCjk) {
        expressions.push(quote(splitCjk(text).trim()));
        needles.push(text);
        return;
      }
      const body = text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      if (!body) return;
      expressions.push(`${quote(body)}*`);
      needles.push(body);
    };

    for (const char of chunk) {
      const isCjk = CJK.test(char);
      if (runIsCjk === null) runIsCjk = isCjk;
      else if (isCjk !== runIsCjk) {
        flush();
        runIsCjk = isCjk;
      }
      run += char;
    }
    flush();
  }

  if (expressions.length === 0) return null;
  return { match: expressions.join(" AND "), needles: [...new Set(needles)] };
}

const SOURCE_SQL = `
  SELECT r.archive_no, r.title, r.note, r.extracted,
    (SELECT group_concat(f.name, ' ') FROM files f WHERE f.resource_id = r.id) AS names,
    (SELECT group_concat(t.name, ' ') FROM resource_tags rt JOIN tags t ON t.id = rt.tag_id
       WHERE rt.resource_id = r.id) AS tags
  FROM resources r WHERE r.id = ?
`;

interface IndexSource {
  archive_no: number;
  title: string | null;
  note: string | null;
  extracted: string | null;
  names: string | null;
  tags: string | null;
}

/**
 * 重建一条资料的索引行。rowid 复用 archive_no，保证搜索可直接 join 回资源。
 * 回收站与恢复只改 deleted_at，索引行不变，列表查询按 join 过滤即可。
 */
export function reindexResource(id: string, db: DatabaseSync = openLibrary()): boolean {
  const row = db.prepare(SOURCE_SQL).get(id) as IndexSource | undefined;
  if (!row) return false;
  db.prepare("DELETE FROM search_fts WHERE rowid = ?").run(row.archive_no);
  db.prepare("INSERT INTO search_fts (rowid, title, names, tags, note, body) VALUES (?, ?, ?, ?, ?, ?)").run(
    row.archive_no,
    splitCjk(row.title ?? ""),
    splitCjk(row.names ?? ""),
    splitCjk(row.tags ?? ""),
    splitCjk(row.note ?? ""),
    splitCjk(row.extracted ?? ""),
  );
  return true;
}

/** 全量重建；返回写入的资料条数。调用方负责保证只在主进程、无并发写入时执行。 */
export function rebuildSearchIndex(): number {
  const db = openLibrary();
  const rows = db.prepare("SELECT id FROM resources ORDER BY archive_no").all() as { id: string }[];
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM search_fts");
    for (const row of rows) reindexResource(row.id, db);
    db.prepare(
      `INSERT INTO meta (key, value) VALUES ('search_index_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(SEARCH_INDEX_VERSION);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return rows.length;
}

/** 启动时调用：索引结构版本不一致（含首次升级）或索引条数与资料不一致就整体重建。 */
export function ensureSearchIndex(): { rebuilt: boolean; indexed: number } {
  const db = openLibrary();
  const version = db.prepare("SELECT value FROM meta WHERE key = 'search_index_version'").get() as
    | { value: string }
    | undefined;
  const status = indexStatus();
  if (version?.value === SEARCH_INDEX_VERSION && status.indexed === status.total) {
    return { rebuilt: false, indexed: status.indexed };
  }
  return { rebuilt: true, indexed: rebuildSearchIndex() };
}

export function indexStatus(): IndexStatus {
  const db = openLibrary();
  const indexed = (db.prepare("SELECT count(*) AS n FROM search_fts").get() as { n: number }).n;
  const total = (db.prepare("SELECT count(*) AS n FROM resources").get() as { n: number }).n;
  const withText = (
    db
      .prepare("SELECT count(*) AS n FROM resources WHERE extracted IS NOT NULL AND length(trim(extracted)) > 0")
      .get() as { n: number }
  ).n;
  const version = db.prepare("SELECT value FROM meta WHERE key = 'search_index_version'").get() as
    | { value: string }
    | undefined;
  return {
    indexed,
    total,
    withText,
    version: version?.value ?? null,
    ready: indexed === total && version?.value === SEARCH_INDEX_VERSION,
  };
}
