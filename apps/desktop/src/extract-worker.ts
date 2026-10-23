import {
  EXTRACT_LIMITS,
  extractOriginal,
  type ExtractLimits,
  type ExtractTarget,
} from "./library/extract";

/**
 * 抽取工作进程：主进程下发一份原件，这里校验并抽取正文，只回传进度和结果。
 * 数据库、任务状态与窗口交互都留在主进程，主线程不会被解析和读取占住。
 */

interface ExtractRequest {
  type: "extract";
  jobId: string;
  attempt: number;
  target: ExtractTarget;
  limits?: Partial<ExtractLimits>;
}

const port = process.parentPort;

port.on("message", (event: { data?: unknown }) => {
  const request = event.data as ExtractRequest | undefined;
  if (!request || request.type !== "extract") return;
  void run(request);
});

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function run(request: ExtractRequest): Promise<void> {
  let lastSent = 0;
  try {
    const result = await extractOriginal(request.target, {
      limits: { ...EXTRACT_LIMITS, ...request.limits },
      onProgress: (progress) => {
        const now = Date.now();
        // 进度只用于展示：按时间节流，但最后一页一定发出，避免停在 1999/2000。
        if (now - lastSent < 250 && progress.pages < progress.pageTotal) return;
        lastSent = now;
        port.postMessage({
          type: "progress",
          jobId: request.jobId,
          attempt: request.attempt,
          pages: progress.pages,
          pageTotal: progress.pageTotal,
          chars: progress.chars,
        });
      },
    });
    port.postMessage({ type: "done", jobId: request.jobId, attempt: request.attempt, result });
  } catch (error) {
    port.postMessage({
      type: "error",
      jobId: request.jobId,
      attempt: request.attempt,
      error: messageOf(error),
    });
  }
}
