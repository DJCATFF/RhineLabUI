import { randomUUID } from "node:crypto";
import { openLibrary, nowIso } from "./db";
import { isExtractable, type ExtractLimits, type ExtractResult } from "./extract";
import { ExtractionCancelled, extractInWorker } from "../extract-runner";

export const EXTRACT_JOB = "extract_text";

/** 执行中任务的租约；超过租约仍为 running 视为进程被强制结束。必须长于单任务超时。 */
const LEASE_MS = 240_000;

export interface JobsSummary {
  pending: number;
  running: number;
  failed: number;
  done: number;
  total: number;
}

/** 正在抽取的资料与页码进度；没有任务在执行时为 null。 */
export interface ExtractionProgress {
  resourceId: string;
  title: string;
  pages: number;
  pageTotal: number;
}

export interface JobsState extends JobsSummary {
  current: ExtractionProgress | null;
}

export interface RunExtractionOptions {
  limits?: Partial<ExtractLimits>;
  timeoutMs?: number;
}

interface ClaimedJob {
  id: string;
  resourceId: string;
  attempts: number;
}

type JobsListener = () => void;

const listeners = new Set<JobsListener>();
let current: ExtractionProgress | null = null;

/** 订阅任务变化；返回取消订阅函数。 */
export function onJobsChanged(listener: JobsListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // 界面推送失败不影响队列本身。
    }
  }
}

/**
 * 为资料建立正文抽取任务。只写库并通知界面，不启动执行器：
 * 队列由调用方（主进程启动、导入完成、手动重试）显式 kick，保证回归可预期。
 * 幂等：已有待处理/执行中/完成的任务、已抽出正文、非可抽取类型、原件未入库都跳过；
 * 之前的任务失败时原地复位为待处理。
 */
export function queueExtraction(ids: string[]): number {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return 0;
  const db = openLibrary();
  const stamp = nowIso();
  const readResource = db.prepare(
    `SELECT r.kind, r.extracted, r.deleted_at,
            EXISTS (SELECT 1 FROM files f WHERE f.resource_id = r.id AND f.storage_kind = 'managed') AS managed
       FROM resources r WHERE r.id = ?`,
  );
  const readJob = db.prepare(
    "SELECT id, status FROM jobs WHERE resource_id = ? AND type = ? ORDER BY created_at DESC LIMIT 1",
  );
  const insertJob = db.prepare(
    `INSERT INTO jobs (id, resource_id, type, stage, status, attempts, created_at, updated_at)
     VALUES (?, ?, ?, 'extract', 'pending', 0, ?, ?)`,
  );
  const resetJob = db.prepare(
    "UPDATE jobs SET status = 'pending', stage = 'extract', error = NULL, lease_until = NULL, updated_at = ? WHERE id = ?",
  );
  const markResource = db.prepare("UPDATE resources SET status = 'pending', updated_at = ? WHERE id = ?");

  let queued = 0;
  db.exec("BEGIN");
  try {
    for (const id of unique) {
      const resource = readResource.get(id) as
        | { kind: string; extracted: string | null; deleted_at: string | null; managed: number }
        | undefined;
      if (!resource || resource.deleted_at) continue;
      if (!isExtractable(resource.kind) || !resource.managed) continue;
      if (resource.extracted && resource.extracted.trim()) continue;
      const job = readJob.get(id, EXTRACT_JOB) as { id: string; status: string } | undefined;
      if (job && (job.status === "pending" || job.status === "running" || job.status === "done")) continue;
      if (job) resetJob.run(stamp, job.id);
      else insertJob.run(randomUUID(), id, EXTRACT_JOB, stamp, stamp);
      markResource.run(stamp, id);
      queued += 1;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  if (queued > 0) notify();
  return queued;
}

/**
 * 启动恢复：执行中的任务视为进程中断，复位为待处理；
 * 同时为还没有任务的可抽取资料补建任务（旧库升级后的补抽取）。
 */
export function recoverInterruptedJobs(): number {
  const db = openLibrary();
  const stamp = nowIso();
  let recovered = 0;
  db.exec("BEGIN");
  try {
    const reset = db.prepare(
      "UPDATE jobs SET status = 'pending', lease_until = NULL, updated_at = ? WHERE type = ? AND status = 'running'",
    );
    recovered = Number(reset.run(stamp, EXTRACT_JOB).changes);
    db.prepare("UPDATE resources SET status = 'pending', updated_at = ? WHERE status = 'processing'").run(stamp);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const rows = db
    .prepare(
      `SELECT r.id FROM resources r
        WHERE r.deleted_at IS NULL AND r.kind IN ('text', 'pdf')
          AND (r.extracted IS NULL OR trim(r.extracted) = '')
          AND EXISTS (SELECT 1 FROM files f WHERE f.resource_id = r.id AND f.storage_kind = 'managed')
          AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.resource_id = r.id AND j.type = ?)`,
    )
    .all(EXTRACT_JOB) as { id: string }[];
  return recovered + queueExtraction(rows.map((row) => row.id));
}

/** 取最旧的一条待处理任务并加租约；没有任务时返回 null。 */
export function claimNextJob(): ClaimedJob | null {
  const db = openLibrary();
  const row = db
    .prepare("SELECT id, resource_id, attempts FROM jobs WHERE type = ? AND status = 'pending' ORDER BY created_at LIMIT 1")
    .get(EXTRACT_JOB) as { id: string; resource_id: string; attempts: number } | undefined;
  if (!row) return null;
  const stamp = nowIso();
  const lease = new Date(Date.now() + LEASE_MS).toISOString();
  const result = db
    .prepare(
      `UPDATE jobs SET status = 'running', attempts = attempts + 1, stage = 'extract', lease_until = ?, updated_at = ?
        WHERE id = ? AND status = 'pending'`,
    )
    .run(lease, stamp, row.id);
  if (Number(result.changes) !== 1) return null;
  db.prepare("UPDATE resources SET status = 'processing', updated_at = ? WHERE id = ?").run(stamp, row.resource_id);
  notify();
  return { id: row.id, resourceId: row.resource_id, attempts: row.attempts + 1 };
}

/**
 * 写入抽取结果。只有仍由本次尝试持有的执行中任务才会落库：
 * 旧进程迟到或已被重新领取的结果直接丢弃，不会覆盖新任务。
 */
export function completeJob(
  jobId: string,
  resourceId: string,
  attempts: number,
  result: ExtractResult,
): boolean {
  const db = openLibrary();
  const stamp = nowIso();
  db.exec("BEGIN");
  try {
    const changed = db
      .prepare(
        `UPDATE jobs SET status = 'done', stage = 'done', error = NULL, lease_until = NULL, updated_at = ?
          WHERE id = ? AND status = 'running' AND attempts = ?`,
      )
      .run(stamp, jobId, attempts);
    if (Number(changed.changes) !== 1) {
      db.exec("ROLLBACK");
      return false;
    }
    db.prepare(
      `UPDATE resources SET extracted = ?, status = 'ready', extract_truncated = ?, extract_pages = ?,
              extract_page_total = ?, updated_at = ? WHERE id = ?`,
    ).run(result.text, result.truncated, result.pages, result.pageTotal, stamp, resourceId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  notify();
  return true;
}

/** 记录失败原因；已被重新领取的任务不会被旧失败覆盖。 */
export function failJob(jobId: string, resourceId: string, attempts: number, message: string): boolean {
  const db = openLibrary();
  const stamp = nowIso();
  db.exec("BEGIN");
  try {
    const changed = db
      .prepare(
        `UPDATE jobs SET status = 'failed', error = ?, lease_until = NULL, updated_at = ?
          WHERE id = ? AND status = 'running' AND attempts = ?`,
      )
      .run(message.slice(0, 500), stamp, jobId, attempts);
    if (Number(changed.changes) !== 1) {
      db.exec("ROLLBACK");
      return false;
    }
    db.prepare("UPDATE resources SET status = 'failed', updated_at = ? WHERE id = ?").run(stamp, resourceId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  notify();
  return true;
}

/** 重新排队一条资料的抽取；返回实际入队条数。 */
export function retryExtraction(id: string): number {
  return queueExtraction([id]);
}

/** 重新排队全部失败任务。 */
export function retryFailedExtractions(): number {
  const db = openLibrary();
  const rows = db
    .prepare("SELECT DISTINCT resource_id FROM jobs WHERE type = ? AND status = 'failed' AND resource_id IS NOT NULL")
    .all(EXTRACT_JOB) as { resource_id: string }[];
  return queueExtraction(rows.map((row) => row.resource_id));
}

export function jobsSummary(): JobsSummary {
  const db = openLibrary();
  const rows = db
    .prepare("SELECT status, count(*) AS n FROM jobs WHERE type = ? GROUP BY status")
    .all(EXTRACT_JOB) as { status: string; n: number }[];
  const summary: JobsSummary = { pending: 0, running: 0, failed: 0, done: 0, total: 0 };
  for (const row of rows) {
    if (row.status === "pending") summary.pending = row.n;
    else if (row.status === "running") summary.running = row.n;
    else if (row.status === "failed") summary.failed = row.n;
    else if (row.status === "done") summary.done = row.n;
    summary.total += row.n;
  }
  return summary;
}

/** 界面使用的任务状态：汇总加上当前任务的页码进度。 */
export function jobsState(): JobsState {
  return { ...jobsSummary(), current };
}

let activeRun: Promise<void> | null = null;

/** 串行执行抽取队列；重复调用复用同一次运行，避免并发重入。 */
export function runExtractionQueue(options: RunExtractionOptions = {}): Promise<void> {
  if (!activeRun) {
    activeRun = drain(options).finally(() => {
      activeRun = null;
    });
  }
  return activeRun;
}

async function drain(options: RunExtractionOptions): Promise<void> {
  for (;;) {
    const job = claimNextJob();
    if (!job) return;
    const db = openLibrary();
    const target = db
      .prepare(
        `SELECT r.kind AS kind, r.title AS title, f.path AS path, f.size AS size, f.sha256 AS sha256
           FROM resources r
           LEFT JOIN files f ON f.resource_id = r.id AND f.storage_kind = 'managed'
          WHERE r.id = ? ORDER BY f.created_at LIMIT 1`,
      )
      .get(job.resourceId) as
      | { kind: string; title: string; path: string | null; size: number | null; sha256: string | null }
      | undefined;
    if (!target?.path || target.size === null || !target.sha256) {
      failJob(job.id, job.resourceId, job.attempts, "原件尚未入库，无法抽取正文");
      continue;
    }
    let lastNotified = 0;
    try {
      const result = await extractInWorker(
        job.id,
        job.attempts,
        { kind: target.kind, path: target.path, size: target.size, sha256: target.sha256 },
        {
          limits: options.limits,
          timeoutMs: options.timeoutMs,
          onProgress: (progress) => {
            current = { resourceId: job.resourceId, title: target.title, ...progress };
            const now = Date.now();
            if (now - lastNotified < 300 && progress.pages < progress.pageTotal) return;
            lastNotified = now;
            notify();
          },
        },
      );
      completeJob(job.id, job.resourceId, job.attempts, result);
    } catch (error) {
      // 应用退出时保持任务为执行中，下次启动按中断恢复继续处理。
      if (error instanceof ExtractionCancelled) return;
      failJob(job.id, job.resourceId, job.attempts, error instanceof Error ? error.message : String(error));
    } finally {
      current = null;
      notify();
    }
  }
}
