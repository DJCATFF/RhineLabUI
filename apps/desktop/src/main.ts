import { app, BrowserWindow, dialog, ipcMain, nativeImage, protocol, shell, utilityProcess } from "electron";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { libraryPath, openLibrary } from "./library/db";
import { importFolder } from "./library/importer";
import { importLegacyExport } from "./library/legacy";
import { runLibraryRegression } from "./library/regress";
import {
  jobsState,
  onJobsChanged,
  recoverInterruptedJobs,
  retryExtraction,
  retryFailedExtractions,
  runExtractionQueue,
} from "./library/jobs";
import { extractWorkerPid, shutdownExtraction } from "./extract-runner";
import {
  createCollection,
  facets,
  findRegisteredFile,
  getResource,
  listResources,
  markOpened,
  moveToTrash,
  restoreFromTrash,
  saveReadingState,
  setResourceCollections,
  setResourceTags,
  updateResource,
} from "./library/store";

let win: BrowserWindow | null = null;

const WORKBENCH_HOST = "workbench";
const WORKBENCH_DIR = process.env.RHINE_WORKBENCH_DIR ?? path.join(app.getAppPath(), "..", "workbench", "dist");
const DEV_URL = process.env.RHINE_DEV_URL ?? null;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".bcmap": "application/octet-stream",
  ".pfb": "application/octet-stream",
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
  {
    scheme: "asset",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    registerWorkbenchProtocol();
    registerAssetProtocol();

    const pdfProbe = process.argv.find((arg) => arg.startsWith("--probe-pdf="));
    if (pdfProbe) {
      await runPdfProbe(pdfProbe.slice("--probe-pdf=".length));
      return;
    }

    if (process.argv.includes("--smoke")) {
      await runSmoke();
      return;
    }

    if (process.argv.includes("--regress-library")) {
      await runLibraryRegression();
      return;
    }

    const shot = process.argv.find((arg) => arg.startsWith("--shot="));
    const importRoot = process.argv.find((arg) => arg.startsWith("--import="));
    const legacyFile = process.argv.find((arg) => arg.startsWith("--import-legacy="));
    if (shot || importRoot || legacyFile) {
      openLibrary();
      if (legacyFile) {
        const result = await importLegacyExport(legacyFile.slice("--import-legacy=".length));
        console.log("LEGACY_IMPORT_RESULT " + JSON.stringify(result));
      }
      if (importRoot) {
        const result = await importFolder(importRoot.slice("--import=".length), (progress) => {
          console.log("IMPORT_PROGRESS " + JSON.stringify(progress));
        });
        console.log("IMPORT_RESULT " + JSON.stringify(result));
      }
      if (shot && process.argv.includes("--shot-extracting")) {
        const running = runExtractionQueue();
        const live = await waitForExtractionProgress(15000);
        console.log("EXTRACT_LIVE " + JSON.stringify({ ...live, responsiveness: await measureResponsiveness() }));
        void running;
        await runWorkbenchShot(shot.slice("--shot=".length));
        return;
      }
      await runExtractionQueue();
      console.log("EXTRACT_JOBS " + JSON.stringify(jobsState()));
      if (shot) {
        await runWorkbenchShot(shot.slice("--shot=".length));
      } else {
        shutdownExtraction();
        app.exit(0);
      }
      return;
    }

    openLibrary();
    onJobsChanged(broadcastJobs);
    recoverInterruptedJobs();
    createWindow();
    void runExtractionQueue();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("before-quit", () => {
    shutdownExtraction();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

function registerWorkbenchProtocol(): void {
  protocol.handle("app", async (request) => {
    const url = new URL(request.url);
    if (url.host !== WORKBENCH_HOST) {
      return new Response("not found", { status: 404 });
    }
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    const target = path.join(WORKBENCH_DIR, relative);
    if (!target.startsWith(WORKBENCH_DIR)) {
      return new Response("forbidden", { status: 403 });
    }
    try {
      const data = await readFile(target);
      return new Response(new Uint8Array(data), {
        headers: { "content-type": MIME[path.extname(target).toLowerCase()] ?? "application/octet-stream" },
      });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });
}

function workbenchUrl(route: string): string {
  return DEV_URL ? `${DEV_URL.replace(/\/$/, "")}/${route}` : `app://${WORKBENCH_HOST}/${route}`;
}

function registerAssetProtocol(): void {
  protocol.handle("asset", async (request) => {
    const url = new URL(request.url);
    const encoded = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    let target: string;
    try {
      target = Buffer.from(encoded, "base64url").toString("utf8");
    } catch {
      return new Response("bad request", { status: 400 });
    }
    const file = findRegisteredFile(target);
    if (!file) return new Response("forbidden", { status: 403 });
    try {
      const data = await readFile(target);
      return new Response(new Uint8Array(data), { headers: { "content-type": file.mime_type } });
    } catch {
      return new Response("missing", { status: 404 });
    }
  });
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: "#f4f1ec",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once("ready-to-show", () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  void win.loadURL(workbenchUrl("index.html"));
}

interface Entry {
  name: string;
  relativePath: string;
  size: number;
  isDirectory: boolean;
}

async function walk(root: string, current: string, depth: number, out: Entry[]): Promise<void> {
  if (depth < 0 || out.length >= 500) return;
  const items = await readdir(current, { withFileTypes: true });
  for (const item of items) {
    const full = path.join(current, item.name);
    const info = await stat(full).catch(() => null);
    if (!info) continue;
    out.push({
      name: item.name,
      relativePath: path.relative(root, full),
      size: info.size,
      isDirectory: item.isDirectory(),
    });
    if (item.isDirectory()) await walk(root, full, depth - 1, out);
  }
}

async function scanFolder(folder: string) {
  const started = Date.now();
  const out: Entry[] = [];
  await walk(folder, folder, 1, out);
  const files = out.filter((entry) => !entry.isDirectory);
  return {
    total: out.length,
    files: files.length,
    bytes: files.reduce((sum, entry) => sum + entry.size, 0),
    elapsedMs: Date.now() - started,
    sample: files.slice(0, 5),
  };
}

async function hashFile(file: string) {
  const started = Date.now();
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file, { highWaterMark: 1024 * 1024 });
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  return { sha256: hash.digest("hex"), elapsedMs: Date.now() - started };
}

async function runWorker() {
  const child = utilityProcess.fork(path.join(__dirname, "worker.js"), [], { serviceName: "rhine-probe-worker" });
  const message = await new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("worker timeout")), 8000);
    child.once("message", (value) => {
      clearTimeout(timer);
      resolve(value);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`worker exit ${code}`));
    });
  });
  child.kill();
  return message;
}

async function runSmoke(): Promise<void> {
  const root = path.join(__dirname, "..");
  const scan = await scanFolder(root);
  const hash = await hashFile(path.join(root, "src", "index.html"));
  const worker = await runWorker();
  console.log("SMOKE_RESULT " + JSON.stringify({
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    scan: { total: scan.total, files: scan.files, bytes: scan.bytes, elapsedMs: scan.elapsedMs },
    hash: { sha256: hash.sha256.slice(0, 16), elapsedMs: hash.elapsedMs },
    worker,
  }));
  app.exit(0);
}

async function runPdfProbe(file: string): Promise<void> {
  const shot = process.argv.find((arg) => arg.startsWith("--probe-shot="));
  const shotPath = shot ? shot.slice("--probe-shot=".length) : path.join(app.getAppPath(), "probe-page.png");

  win = new BrowserWindow({
    width: 1240,
    height: 1000,
    show: false,
    backgroundColor: "#f4f1ec",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: false,
    },
  });

  const result = await new Promise<unknown>((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: "probe timeout" }), 60000);
    pdfProbeResolve = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
    win?.webContents.once("did-finish-load", () => {
      console.log("PDF_PROBE_LOADED");
    });
    void win?.loadURL(workbenchUrl(`probe.html?file=${encodeURIComponent(file)}`));
  });

  await win.webContents.executeJavaScript(
    "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))",
  );
  const image = await win.webContents.capturePage();
  await writeFile(shotPath, nativeImage.createFromBuffer(image.toPNG()).toPNG());

  console.log("PDF_PROBE " + JSON.stringify(result));
  console.log("PDF_PROBE_SHOT " + shotPath);
  app.exit(0);
}

async function runWorkbenchShot(target: string): Promise<void> {
  const size = process.argv.find((arg) => arg.startsWith("--shot-size="));
  const [width, height] = (size ? size.slice("--shot-size=".length) : "1440x900")
    .split("x")
    .map((value) => Number.parseInt(value, 10));

  win = new BrowserWindow({
    width,
    height,
    show: false,
    backgroundColor: "#f4f1ec",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.on("console-message", (_event, level, message) => {
    console.log(`WORKBENCH_CONSOLE ${level} ${message}`);
  });
  win.webContents.on("did-fail-load", (_event, code, description) => {
    console.log(`WORKBENCH_FAIL ${code} ${description}`);
  });

  await win.loadURL(workbenchUrl("index.html"));
  await new Promise((resolve) => setTimeout(resolve, 2200));

  const actionArg = process.argv.find((arg) => arg.startsWith("--shot-action="));
  const action = actionArg ? actionArg.slice("--shot-action=".length) : null;
  if (action) {
    console.log("WORKBENCH_ACTION " + (await win.webContents.executeJavaScript(shotActionScript(action))));
    const waitArg = process.argv.find((arg) => arg.startsWith("--shot-wait="));
    const wait = waitArg ? Number.parseInt(waitArg.slice("--shot-wait=".length), 10) : action === "read" ? 5000 : 1200;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }

  const image = await win.webContents.capturePage();
  await writeFile(target, nativeImage.createFromBuffer(image.toPNG()).toPNG());
  console.log(`WORKBENCH_SHOT ${target} ${width}x${height}`);
  app.exit(0);
}

function shotActionScript(action: string): string {
  const pick = `const item = document.querySelector(".list .row") || document.querySelector(".cards .card");`;
  const fire = `const fire = (type) => item.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));`;
  if (action.startsWith("search=")) {
    const query = JSON.stringify(action.slice("search=".length));
    return `(() => {
      const input = document.querySelector(".search input");
      if (!input) return "no-input";
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, ${query});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return "search";
    })()`;
  }
  if (action === "cards" || action === "list") {
    const index = action === "cards" ? 1 : 0;
    return `(() => {
      document.querySelectorAll(".segmented button")[${index}]?.click();
      return new Promise((resolve) => setTimeout(() => {
        ${pick}
        if (!item) return resolve("no-item");
        ${fire}
        fire("click");
        resolve("${action}");
      }, 400));
    })()`;
  }
  if (action === "read") {
    return `(() => {
      ${pick}
      if (!item) return "no-item";
      ${fire}
      fire("click");
      fire("dblclick");
      return "read";
    })()`;
  }
  if (action === "info") {
    return `(() => {
      ${pick}
      if (!item) return "no-item";
      ${fire}
      fire("click");
      fire("dblclick");
      return new Promise((resolve) => setTimeout(() => {
        const button = [...document.querySelectorAll(".reader-actions button")].find(
          (node) => node.textContent && node.textContent.includes("资料信息"),
        );
        if (!button) return resolve("no-reader");
        button.click();
        resolve("info");
      }, 900));
    })()`;
  }
  return `(() => {
    ${pick}
    if (!item) return "no-item";
    ${fire}
    fire("click");
    return "select";
  })()`;
}

let pdfProbeResolve: ((value: unknown) => void) | null = null;

ipcMain.handle("probe:pick-folder", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("probe:scan", (_event, folder: string) => scanFolder(folder));

ipcMain.handle("probe:hash", (_event, file: string) => hashFile(file));

ipcMain.handle("probe:worker", () => runWorker());

ipcMain.handle("probe:reveal", (_event, target: string) => {
  shell.showItemInFolder(target);
  return true;
});

ipcMain.handle("file:read", async (_event, file: string) => {
  const data = await readFile(file);
  return new Uint8Array(data);
});

ipcMain.handle("probe:report-pdf", (_event, result: unknown) => {
  pdfProbeResolve?.(result);
  pdfProbeResolve = null;
  return true;
});

ipcMain.handle("library:info", () => ({ path: libraryPath() }));

ipcMain.handle("library:list", (_event, params) => listResources(params));

ipcMain.handle("library:get", (_event, id: string) => getResource(id));

ipcMain.handle("library:facets", () => facets());

ipcMain.handle("library:update", (_event, id: string, patch) => updateResource(id, patch));

ipcMain.handle("library:tags", (_event, id: string, names: string[]) => setResourceTags(id, names));

ipcMain.handle("library:collections", (_event, id: string, ids: string[]) => setResourceCollections(id, ids));

ipcMain.handle("library:create-collection", (_event, name: string) => createCollection(name));

ipcMain.handle("library:trash", (_event, ids: string[]) => moveToTrash(ids));

ipcMain.handle("library:restore", (_event, ids: string[]) => restoreFromTrash(ids));

ipcMain.handle("library:touch", (_event, id: string) => markOpened(id));

ipcMain.handle("library:reading", (_event, id: string, locator: string, progress: number) =>
  saveReadingState(id, locator, progress),
);

ipcMain.handle("library:open", async (_event, id: string) => {
  const resource = getResource(id);
  const target = resource?.files[0]?.path;
  if (!target) return { ok: false, error: "没有可打开的原件" };
  const error = await shell.openPath(target);
  return error ? { ok: false, error } : { ok: true };
});

ipcMain.handle("library:reveal", (_event, id: string) => {
  const resource = getResource(id);
  const target = resource?.files[0]?.path;
  if (!target) return false;
  shell.showItemInFolder(target);
  return true;
});

ipcMain.handle("library:import", async () => {
  const result = await dialog.showOpenDialog({
    title: "选择要登记的资料文件夹",
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const summary = await importFolder(result.filePaths[0], (progress) => {
    win?.webContents.send("library:import-progress", progress);
  });
  void runExtractionQueue();
  return summary;
});

ipcMain.handle("library:jobs", () => jobsState());

ipcMain.handle("library:retry", (_event, id: string) => {
  const queued = retryExtraction(id);
  if (queued > 0) void runExtractionQueue();
  return { queued, jobs: jobsState() };
});

ipcMain.handle("library:retry-all", () => {
  const queued = retryFailedExtractions();
  if (queued > 0) void runExtractionQueue();
  return { queued, jobs: jobsState() };
});

function broadcastJobs(): void {
  const state = jobsState();
  for (const target of BrowserWindow.getAllWindows()) {
    target.webContents.send("library:jobs-changed", state);
  }
}

/** 等待工作进程回报第一页进度；用于真实桌面响应性验收。 */
async function waitForExtractionProgress(timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = jobsState();
    if (state.current) return { current: state.current, workerPid: extractWorkerPid() };
    if (state.pending === 0 && state.running === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return { current: jobsState().current, workerPid: extractWorkerPid() };
}

/**
 * 抽取进行中测量主进程是否仍能及时响应：
 * 定时器抖动反映事件循环拥塞，资料查询反映数据库与界面请求是否可用。
 */
async function measureResponsiveness() {
  const delays: number[] = [];
  for (let index = 0; index < 10; index += 1) {
    const started = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 20));
    delays.push(Date.now() - started - 20);
  }
  const listStarted = Date.now();
  const page = listResources({ view: "all", limit: 50 });
  const listMs = Date.now() - listStarted;
  const detailStarted = Date.now();
  if (page.items[0]) getResource(page.items[0].id);
  const detailMs = Date.now() - detailStarted;
  return {
    timerMaxLagMs: Math.max(...delays),
    timerAvgLagMs: Math.round(delays.reduce((sum, value) => sum + value, 0) / delays.length),
    listMs,
    detailMs,
    listed: page.total,
  };
}
