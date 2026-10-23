import { utilityProcess, type UtilityProcess } from "electron";
import * as path from "node:path";
import {
  EXTRACT_LIMITS,
  type ExtractLimits,
  type ExtractProgress,
  type ExtractResult,
  type ExtractTarget,
} from "./library/extract";

/** 单个任务的执行上限：超时后停止工作进程并记为失败，主窗口继续可用。 */
export const EXTRACT_TIMEOUT_MS = 120_000;

function timeoutText(ms: number): string {
  return ms >= 1000 ? `${Math.round(ms / 1000)} 秒` : `${Math.round(ms)} 毫秒`;
}

export interface ExtractRunOptions {
  limits?: Partial<ExtractLimits>;
  timeoutMs?: number;
  onProgress?: (progress: ExtractProgress) => void;
}

/** 应用退出时主动停止抽取：任务保持执行中，下次启动按中断恢复处理。 */
export class ExtractionCancelled extends Error {}

interface ActiveRun {
  jobId: string;
  attempt: number;
  worker: UtilityProcess;
  timer: NodeJS.Timeout;
  resolve: (result: ExtractResult) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: ExtractProgress) => void;
}

let child: UtilityProcess | null = null;
let active: ActiveRun | null = null;

function finish(error: Error | null, result?: ExtractResult): void {
  const run = active;
  if (!run) return;
  active = null;
  clearTimeout(run.timer);
  if (error) run.reject(error);
  else run.resolve(result as ExtractResult);
}

function stopWorker(): void {
  const worker = child;
  child = null;
  worker?.kill();
}

function ensureWorker(): UtilityProcess {
  if (child) return child;
  const worker = utilityProcess.fork(path.join(__dirname, "extract-worker.js"), [], {
    serviceName: "rhine-extract-worker",
  });
  worker.on("message", (message: unknown) => {
    const event = message as
      | { type: string; jobId?: string; attempt?: number; pages?: number; pageTotal?: number; chars?: number; result?: ExtractResult; error?: string }
      | undefined;
    if (!event || !active) return;
    // 旧任务迟到的消息不能影响当前任务。
    if (event.jobId !== active.jobId || event.attempt !== active.attempt) return;
    if (event.type === "progress") {
      active.onProgress?.({
        pages: Number(event.pages ?? 0),
        pageTotal: Number(event.pageTotal ?? 0),
        chars: Number(event.chars ?? 0),
      });
      return;
    }
    if (event.type === "done" && event.result) finish(null, event.result);
    else finish(new Error(event.error || "抽取进程未返回结果"));
  });
  worker.on("exit", (code) => {
    if (child === worker) child = null;
    // 已被超时或退出流程结束的旧进程不能再牵连后一个任务。
    if (active && active.worker === worker) {
      finish(new Error(`抽取进程意外退出（代码 ${code ?? 0}）`));
    }
  });
  child = worker;
  return worker;
}

/** 在独立工作进程里串行执行一次抽取；同一时间只允许一个任务。 */
export function extractInWorker(
  jobId: string,
  attempt: number,
  target: ExtractTarget,
  options: ExtractRunOptions = {},
): Promise<ExtractResult> {
  if (active) return Promise.reject(new Error("已有抽取任务在执行"));
  const maxBytes = options.limits?.maxBytes ?? EXTRACT_LIMITS.maxBytes;
  if (target.size > maxBytes) {
    return Promise.reject(new Error(`原件超过 ${Math.round(maxBytes / (1024 * 1024))} MB，未自动抽取正文`));
  }
  const timeoutMs = options.timeoutMs ?? EXTRACT_TIMEOUT_MS;
  const worker = ensureWorker();
  return new Promise<ExtractResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!active) return;
      finish(new Error(`抽取超时（超过 ${timeoutText(timeoutMs)}），已停止工作进程`));
      stopWorker();
    }, timeoutMs);
    active = { jobId, attempt, worker, timer, resolve, reject, onProgress: options.onProgress };
    worker.postMessage({ type: "extract", jobId, attempt, target, limits: options.limits });
  });
}

/** 当前工作进程 PID；仅用于诊断与回归验证。 */
export function extractWorkerPid(): number | null {
  return child?.pid ?? null;
}

/** 退出前停止工作进程；被停止的任务保持执行中，由下次启动清理。 */
export function shutdownExtraction(): void {
  if (active) finish(new ExtractionCancelled("抽取已停止"));
  stopWorker();
}
