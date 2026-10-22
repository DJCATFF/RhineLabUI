import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./probe.css";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const SCALE = 1.5;

type ProbeState =
  | { phase: "idle" }
  | { phase: "running"; file: string }
  | { phase: "done"; file: string; result: Record<string, unknown> }
  | { phase: "error"; file: string; error: string };

async function renderPdf(data: Uint8Array, canvas: HTMLCanvasElement) {
  const bytes = data.byteLength;
  const started = performance.now();
  const doc = await pdfjs.getDocument({ data }).promise;

  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: SCALE });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas 2d context 不可用");

  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  await page.render({
    canvas,
    canvasContext: context,
    viewport,
    transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
  }).promise;
  const renderMs = Math.round(performance.now() - started);

  const textStarted = performance.now();
  const textContent = await page.getTextContent();
  const text = textContent.items.map((item) => ("str" in item ? item.str : "")).join("");
  const textMs = Math.round(performance.now() - textStarted);

  await doc.destroy();

  return {
    ok: true,
    bytes,
    pages: doc.numPages,
    renderMs,
    textMs,
    textLength: text.length,
    textSample: text.replace(/\s+/g, " ").slice(0, 80),
    canvasCssWidth: Math.floor(viewport.width),
    canvasCssHeight: Math.floor(viewport.height),
  };
}

function Probe() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<ProbeState>({ phase: "idle" });

  const runBytes = async (file: string, bytes: Uint8Array) => {
    setState({ phase: "running", file });
    try {
      const result = await renderPdf(bytes, canvasRef.current as HTMLCanvasElement);
      const payload = { ...result, file };
      (window as unknown as Record<string, unknown>).__pdfProbe = payload;
      setState({ phase: "done", file, result: payload });
      await window.desk?.reportPdf(payload as never);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const payload = { ok: false, file, error: message };
      (window as unknown as Record<string, unknown>).__pdfProbe = payload;
      setState({ phase: "error", file, error: message });
      await window.desk?.reportPdf(payload as never);
    }
  };

  useEffect(() => {
    const target = new URLSearchParams(location.search).get("file");
    if (!target) return;
    if (!window.desk) {
      setState({ phase: "error", file: target, error: "未在 Electron 宿主中运行，缺少文件读取通道" });
      return;
    }
    void window.desk
      .readFile(target)
      .then((bytes) => {
        if (!bytes) throw new Error("读取文件失败");
        return runBytes(target, bytes);
      })
      .catch((error: unknown) => {
        setState({ phase: "error", file: target, error: String(error) });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="probe">
      <header>
        <h1>PDF 渲染验证</h1>
        <p>PDF.js 首页渲染、文本层读取与真实中文排版检查。</p>
      </header>

      <section className="picker">
        <label>
          选择本地 PDF
          <input
            type="file"
            accept="application/pdf"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void file
                .arrayBuffer()
                .then((buffer) => runBytes(file.name, new Uint8Array(buffer)));
            }}
          />
        </label>
        {state.phase !== "idle" && <span className="file">{state.file}</span>}
      </section>

      <section className="viewport">
        <canvas ref={canvasRef} />
      </section>

      <section className="result">
        {state.phase === "running" && <p>渲染中…</p>}
        {state.phase === "error" && <pre className="error">{state.error}</pre>}
        {state.phase === "done" && <pre>{JSON.stringify(state.result, null, 2)}</pre>}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<Probe />);
