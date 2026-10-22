import { createRollingClock } from "./rolling-clock";
import { InspectionOverlay } from "./inspection-overlay";
import { DocumentDecryption } from "./document-decryption";
import "./document-decryption.css";
import "./decryption.css";
import "./apex-documents.css";
import { archiveUrl } from "./document-api";
import { documentDetailMarkup, watchDocument } from "./document-detail";
import { syncQualityUI } from "./quality-settings";
import { superPerformanceQuality, wallpaperQuality } from "./wallpaper-quality";
import "@kitlangton/rolling-number/styles.css";
import "./style.css";
import "./quality-settings.css";
import "./responsive.css";
import { viewportLayout, openingLayout } from "./viewport-layout";
import { loadPreferences, persistPreferences } from "./app/preferences";
import { ModalController } from "./app/modal-controller";
import { bindInput } from "./app/input";
import { detailMarkup, overviewPanel, tabPanelMarkup } from "./views/detail-markup";
import { initPwa } from "./pwa";
import { createRollingNumber, createRollingText } from "@kitlangton/rolling-number";
import { ArchiveScene } from "./scene";
import { ModelViewer } from "./model-viewer";
import { ContentTransition, SurfaceTransition } from "./ui-transitions";
import { BootSequence } from "./boot";
import { loadBootWebfonts } from "./boot-lettering";
import { wrap, type ArchiveNavigation } from "./archive-loop";
import {
  records,
  categories,
  archiveColumns,
  columnFiles,
  fileLocation,
  usingDocumentArchive,
} from "./data";
import { TerminalAudio } from "./audio";
import { StartupGate } from "./startup";
import { isWallpaper, wallpaperHost, wallpaperFrame, type WallpaperProperties } from "./wallpaper";
import "./startup.css";
import "./wallpaper.css";
import { Workbench } from "./workbench";
let workbench: Workbench | undefined;
import { ArchivePlayground } from "./archive-playground";
import { ARRAY_OPENING_END, openingShowsDetail } from "./wallpaper-opening";
import { paintTheme } from "./theme-ui";
let playground: ArchivePlayground | undefined;
import { WallpaperEffects } from "./wallpaper-effects";
import { WallpaperBackground } from "./wallpaper-background";
let wallpaperEffects: WallpaperEffects | undefined;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
import { stageMarkup } from "./views/stage-markup";
const apexEnabled = !isWallpaper && (import.meta.env.DEV || import.meta.env.VITE_APEX_ENABLED === "true");
let stopDocumentWatch: (() => void) | undefined;
const requestedDocument = new URLSearchParams(location.search).get("document");
const initialSelection = usingDocumentArchive ? Math.max(0, records.findIndex(record => requestedDocument ? record.documentId === requestedDocument : Boolean(record.documentId))) : 0;

$("#stage").innerHTML = stageMarkup({
  apexEnabled,
  documentArchive: usingDocumentArchive,
  wallpaper: isWallpaper,
});
$("#boot-background").insertAdjacentHTML(
  "beforeend",
  '<div class="boot-white"></div>',
);
const bootSequence = new BootSequence($("#stage"));
$("#viewport").insertAdjacentHTML("beforeend", '<button class="mobile-entry" data-action="skip">进入档案 <span>→</span></button>');

type Mode = "boot" | "archive" | "detail";
let mode: Mode = "boot",
  selected = initialSelection,
  bootStart = 0,
  lastStep = "",
  ready = false;
let activeTab = "overview";
const reviewParams = new URLSearchParams(location.search);
let frozenTime =
  reviewParams.get("freeze") === "1"
    ? Number(reviewParams.get("time") ?? 0)
    : null;
if (reviewParams.get("review") === "1") {
  $("#stage").dataset.review = "true";
  window.addEventListener("message", (event) => {
    if (
      event.origin !== location.origin ||
      event.source !== window.parent ||
      event.data?.type !== "rhine-review-frame"
    )
      return;
    const t = Number(event.data.time);
    if (!Number.isFinite(t) || t < 0 || t >= 35) return;
    frozenTime = t;
    if (ready && mode !== "boot") setMode("boot");
  });
}
let toastTimer: ReturnType<typeof setTimeout>;
const detailTransition = new SurfaceTransition($("#detail-ui"), undefined, 180, 180);
const tabTransition = new ContentTransition();
let pendingDetailFocus = false;
let bookmarkFeedback: Animation | undefined;
function readLocal<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
const savedKey = usingDocumentArchive ? "apex-saved" : "rhine-saved";
const saved = new Set<string>(readLocal<string[]>(savedKey, []));
const prefs = loadPreferences();
paintTheme(prefs.colorTheme === "dark" ? 1 : 0);
const rollingMotion = {
  duration: 460,
  motionBlur: true,
  animated: !prefs.reduced,
};
const updateFooterClock = createRollingClock($("#clock"));
const numberOptions = {
  ...rollingMotion,
  locales: "en-US",
  format: { minimumIntegerDigits: 2, useGrouping: false },
};
const fileCounter = createRollingNumber($("#selected-number"), {
  ...numberOptions,
  value: 1,
});
const columnCounter = createRollingNumber($("#column-index"), {
  ...numberOptions,
  value: 3,
});
const codeOptions = {
  ...numberOptions,
  format: { minimumIntegerDigits: 3, useGrouping: false },
  value: 1,
};
const textOptions = {
  ...rollingMotion,
  transition: "direct" as const,
  stagger: "none" as const,
};
const selectionTitle = createRollingText($("#selected-title"), {
  ...textOptions,
  text: $("#selected-title").textContent ?? "",
});
const columnTitle = createRollingText($("#column-name"), {
  ...textOptions,
  text: $("#column-name").textContent ?? "",
});
const hoverTitle = createRollingText($("#hover-title"), { ...textOptions, text: "" });
const categoryTitle = createRollingText($("#archive-category"), {
  ...textOptions,
  text: $("#archive-category").textContent ?? "",
});
const clearanceTitle = createRollingText($("#selected-clearance"), {
  ...textOptions,
  text: $("#selected-clearance").textContent ?? "",
});
const rollingTitles = [selectionTitle, columnTitle, hoverTitle, categoryTitle, clearanceTitle];
const selectedCode = createRollingNumber($("#selected-code"), codeOptions);
const hoverCode = createRollingNumber($("#hover-code"), codeOptions);
const audio = new TerminalAudio();
let musicSuppressed = false;
function configureAudio() { audio.configure({ ...prefs, music: prefs.music && !musicSuppressed }); }
configureAudio();
const reviewEntry = reviewParams.has("scene") || reviewParams.has("time") || reviewParams.get("review") === "1";
let started = false;
const loading = $("#loading");
// The entry screen uses the actual viewport, including portrait phones; the
// reference animation still uses its calibrated 1920 x 1080 stage.
$("#viewport").append(loading);
$("#stage").inert = true;
$(".mobile-entry").inert = true;
const entry = !isWallpaper && !reviewEntry && (prefs.sound || prefs.music) ? new StartupGate({
  root: loading,
  unlock: () => audio.unlock(),
  cancel: () => audio.cancelEntry(),
  start: silent => completeStartup(silent),
}) : undefined;
if (entry) {
  audio.holdForEntry();
  if (prefs.music) void audio.prepareMusic().catch(() => { /* Entry offers retry. */ });
}
let audioPreview = false, audioPreviewRequest = 0;
let scene: ArchiveScene | undefined;
let threeState: "on" | "closing" | "off" | "loading" = "on";
let resumeCell: { lane: number; row: number } | undefined;
let resumeSelection = -1;
let viewer: ModelViewer | undefined;
const accessLog: { id: string; time: string }[] = [];
const columnMemory = archiveColumns.map((_, lane) => columnFiles(lane)[0]);
function recordAccess() {
  accessLog.unshift({
    id: records[selected].id,
    time: new Date().toLocaleTimeString("en-GB"),
  });
}
function saveAudioPrefs() {
  persistPreferences(prefs);
  configureAudio();
}
function superPerformanceEnabled() { return isWallpaper ? wallpaperHost()?.properties.superperformance?.value === true : prefs.superPerformance; }
function effectiveRenderQuality() { return superPerformanceEnabled() ? superPerformanceQuality : prefs.rendering; }
function savePrefs() {
  saveAudioPrefs();
  if (prefs.reduced) {
    rollingTitles.forEach(title => title.finish());
    detailTransition.finish();
    modals.finish();
    tabTransition.cancel();
    bookmarkFeedback?.cancel();
  }
  scene?.setReduced(prefs.reduced);
  scene?.setTheme(prefs.colorTheme === "dark", prefs.reduced || !started);
  document.querySelectorAll<HTMLElement>("[data-color-theme]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.colorTheme === prefs.colorTheme)));
  scene?.setSuperPerformance(superPerformanceEnabled());
  viewer?.setSuperPerformance(superPerformanceEnabled());
  scene?.setQuality(effectiveRenderQuality());
  viewer?.setQuality(effectiveRenderQuality());
  syncQualityUI(prefs.rendering);
  updateQualitySummary();
  fileCounter.update({ animated: !prefs.reduced && mode === "archive" });
  rollingTitles.forEach(title => title.update({ animated: !prefs.reduced && mode === "archive" }));
  columnCounter.update({ animated: !prefs.reduced && mode === "archive" });
  selectedCode.update({ animated: !prefs.reduced && mode === "archive" });
  hoverCode.update({ animated: !prefs.reduced && mode === "archive" });
  $("#stage").classList.toggle("reduce-motion", prefs.reduced);
  syncWallpaperBackground();
}
let previousLayout = "";
function fit() {
  const stage = $("#stage");
  const viewport = $("#viewport");
  const coarse = matchMedia("(pointer: coarse)").matches;
  const reference = reviewParams.has("time") || reviewParams.get("review") === "1";
  const { width, height, scale, kind } = mode === "boot" && !reference
    ? openingLayout(viewport.clientWidth, viewport.clientHeight)
    : viewportLayout(viewport.clientWidth, viewport.clientHeight, coarse, mode === "boot");
  stage.style.width = `${width}px`;
  stage.style.height = `${height}px`;
  stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
  stage.dataset.layout = kind;
  stage.dataset.touch = String(coarse);
  viewport.dataset.mobileBoot = String(mode === "boot" && (coarse || viewport.clientWidth < 1100));
  stage.style.setProperty("--stage-scale", String(scale));
  stage.style.setProperty("--opening-width", `${width}px`);
  stage.style.setProperty("--opening-height", `${height}px`);
  stage.style.setProperty("--opening-scan-scale", String(Math.min(1, width / 1920)));
  stage.dataset.openingPortrait = String(width < height);
  // The software keyboard resizes dialogs without recomposing the 3D scene.
  const visible = window.visualViewport;
  const stageTop = (viewport.clientHeight - height * scale) / 2;
  stage.style.setProperty("--modal-top", `${Math.max(0, (visible?.offsetTop ?? 0) - stageTop) / scale}px`);
  stage.style.setProperty("--modal-height", `${Math.min(height, (visible?.height ?? viewport.clientHeight) / scale)}px`);
  $("#viewport").style.setProperty("--scale", String(scale));
  const marks = document.querySelector("#inspection-marks");
  marks?.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const layoutKey = JSON.stringify([width, height, scale, kind, devicePixelRatio]);
  if (layoutKey !== previousLayout) {
    previousLayout = layoutKey;
    scene?.resize();
    viewer?.resize();
  }
  updateQualitySummary();
  // Re-measure line covers and tab underline after wrapping changes.
  requestAnimationFrame(() => {
    documentDecryption.refresh();
    const tab = document.querySelector<HTMLElement>(".detail-tabs button.active");
    const indicator = document.querySelector<HTMLElement>(".tab-indicator");
    if (tab && indicator) indicator.style.transform = `translateX(${tab.offsetLeft}px) scaleX(${tab.offsetWidth})`;
  });
}
window.addEventListener("resize", fit);
window.visualViewport?.addEventListener("resize", fit);
window.visualViewport?.addEventListener("scroll", fit);
matchMedia("(pointer: coarse)").addEventListener("change", fit);
fit();
$("#file-ticks").innerHTML = Array.from({ length: 8 }, (_, index) => index)
  .map(
    (index) => `<button data-select="${index}"></button>`,
  )
  .join("");
const fileTicks = [...$("#file-ticks").querySelectorAll<HTMLButtonElement>("button")];

function setMode(next: Mode) {
  if (next !== "detail") { stopDocumentWatch?.(); stopDocumentWatch = undefined; }
  if (workbench?.enabled && next === "detail") next = "archive";
  const previousMode = mode;
  rollingTitles.forEach(title => title.update({ animated: !prefs.reduced && next === "archive" }));
  if (next !== "archive") {
    rollingTitles.forEach(title => title.finish());
    hoverCode.finish();
    $("#hover-label").hidden = true;
  }
  if (next === "detail" && mode !== "detail") recordAccess();
  mode = next;
  syncWallpaperBackground();
  audio.setScene(next);
  if (next !== "boot" && audioPreview) {
    audioPreview = false;
    audioPreviewRequest++;
    configureAudio();
  }
  $("#stage").dataset.mode = next;
  workbench?.syncVisibility();
  if (previousMode !== next) fit();
  $("#boot").inert = next !== "boot";
  $("#boot").setAttribute("aria-hidden", String(next !== "boot"));
  $("#archive-ui").inert = next !== "archive" || modals.open || Boolean(workbench?.enabled);
  $("#archive-ui").setAttribute("aria-hidden", String(next !== "archive" || Boolean(workbench?.enabled)));
  $(".system-nav").inert = next === "boot" || modals.open;
  $(".system-footer").inert = next === "boot" || modals.open;
  if (next === "detail") {
    if (previousMode !== "detail") detailTransition.show(prefs.reduced);
  } else if (previousMode === "detail" || (next === "boot" && !$("#detail-ui").hidden)) {
    pendingDetailFocus = false;
    tabTransition.cancel();
    detailTransition.hide(prefs.reduced || next === "boot");
    if (!modals.open && next === "archive") $(".read-file").focus({ preventScroll: true });
  }
  $("#detail-ui").inert = next !== "detail" || modals.open;
  scene?.setMode(next === "boot" ? "hidden" : next);
  if (next !== "boot") {
    bootSequence.reset();
    $(".file-title").firstChild!.textContent = "FILE NUMBER: ";
    $("#stage").dataset.boot = "done";
  }
  if (next === "detail" && previousMode !== "detail") {
    renderDetail();
    pendingDetailFocus = true;
    if (!scene) {
      $("#detail-content").style.opacity = "1";
      $("#detail-content").style.translate = "0 0";
      $("#detail-content").inert = false;
    }
  }
}
function select(index: number, navigation?: ArchiveNavigation) {
  selected = (index + records.length) % records.length;
  columnMemory[fileLocation(selected).lane] = selected;
  if (mode === "detail") setMode("archive");
  activeTab = "overview";
  scene?.select(selected, navigation);
  updateSelection(navigation);
  const columnMove = navigation && "axis" in navigation && navigation.axis === "lane";
  audio.play(columnMove ? "column" : "tick", columnMove ? navigation.direction * .45 : 0);
}
function stepFile(direction: number) {
  const files = columnFiles(fileLocation(selected).lane);
  if (files.length < 2) return;
  select(
    files[(files.indexOf(selected) + direction + files.length) % files.length],
    { axis: "row", direction },
  );
}
function stepColumn(direction: number) {
  const lane = fileLocation(selected).lane;
  const next = wrap(lane + direction, archiveColumns.length);
  select(columnMemory[next], { axis: "lane", direction });
}
function updateSelection(navigation?: ArchiveNavigation) {
  const r = records[selected];
  const { lane } = fileLocation(selected);
  const files = columnFiles(lane);
  $("#selected-id").firstChild!.textContent = `${r.id.slice(0, 2)}`;
  $<HTMLButtonElement>(".read-file").disabled = Boolean(r.empty);
  selectionTitle.update({ text: r.title, animated: !prefs.reduced && mode === "archive" });
  clearanceTitle.update({ text: r.clearance, animated: !prefs.reduced && mode === "archive" });
  categoryTitle.update({ text: r.category, animated: !prefs.reduced && mode === "archive" });
  const direction =
    navigation && "axis" in navigation
      ? navigation.direction > 0
        ? "up"
        : "down"
      : "auto";
  selectedCode.update({
    value: Number(r.id.slice(2)),
    animated: !prefs.reduced && mode === "archive",
    direction,
  });
  fileCounter.update({
    value: r.empty ? 0 : files.indexOf(selected) + 1,
    animated: !prefs.reduced && mode === "archive",
    direction:
      navigation && "axis" in navigation && navigation.axis === "row"
        ? direction
        : "auto",
  });
  $(".count-total").textContent = String(r.empty ? 0 : files.length).padStart(2, "0");
  columnCounter.update({
    value: lane + 1,
    animated: !prefs.reduced && mode === "archive",
    direction:
      navigation && "axis" in navigation && navigation.axis === "lane"
        ? direction
        : "auto",
  });
  columnTitle.update({ text: archiveColumns[lane], animated: !prefs.reduced && mode === "archive" });
  $<HTMLButtonElement>('[data-action="column-prev"]').disabled = false;
  $<HTMLButtonElement>('[data-action="column-next"]').disabled = false;
  const tickStart = Math.max(0, Math.min(files.indexOf(selected) - 3, files.length - fileTicks.length));
  fileTicks.forEach((button, slot) => {
    const index = files[tickStart + slot], record = records[index];
    button.hidden = !record || Boolean(record.empty);
    if (!record) return;
    button.dataset.select = String(index);
    button.setAttribute("aria-label", `选择档案 ${record.id} ${record.title}`);
    button.title = `${record.id} · ${record.title}`;
    button.classList.toggle("selected", index === selected);
    button.setAttribute("aria-pressed", String(index === selected));
  });
  $("#saved-count").textContent = String(saved.size).padStart(2, "0");
}
function replayBoot(forcePreview = false) {
  if (!ready) return;
  modals.close(() => replayBootAfterModal(forcePreview));
}
function replayBootAfterModal(forcePreview: boolean) {
  bootStart = performance.now() / 1000 - 1.76;
  frozenTime = null;
  lastStep = "";
  setMode(prefs.reduced && !forcePreview ? "archive" : "boot");
  audio.restartBoot();
  scene?.select(initialSelection);
  selected = initialSelection;
  updateSelection();
  if (!forcePreview) audio.play("ui-tick");
}
function openFile() {
  if (!ready) return;
  if (records[selected].empty) { notify("此分类暂无文档，请从“我的文档”上传。"); return; }
  modals.close(() => {
    setMode("detail");
    audio.play("open");
  });
}
function toggleSaved() {
  const id = records[selected].id;
  if (saved.has(id)) saved.delete(id);
  else saved.add(id);
  try {
    localStorage.setItem(savedKey, JSON.stringify([...saved]));
  } catch {}
  $("#saved-count").textContent = String(saved.size).padStart(2, "0");
  const button = $<HTMLButtonElement>('[data-action="bookmark"]');
  const added = saved.has(id);
  button.firstChild!.textContent = added ? "− REMOVE FROM SAVED" : "＋ SAVE ARCHIVE";
  button.querySelector("span")!.textContent = added ? "已收藏" : "收藏档案";
  button.setAttribute("aria-pressed", String(added));
  bookmarkFeedback?.cancel();
  if (!prefs.reduced) bookmarkFeedback = button.animate(
    [{ backgroundColor: "#67634c" }, { backgroundColor: "#252820" }],
    { duration: 220, easing: "ease-out" },
  );
  audio.play("confirm");
  notify(saved.has(id) ? "档案已加入收藏" : "已取消收藏");
}
function renderDetail() {
  stopDocumentWatch?.(); stopDocumentWatch = undefined;
  tabTransition.cancel();
  const r = records[selected];
  if (r.documentId) {
    $("#object-id").textContent = r.id;
    $("#detail-content").innerHTML = documentDetailMarkup(r, saved.has(r.id));
    $("#detail-content").setAttribute("tabindex", "-1");
    $('[data-action="bookmark"]').setAttribute("aria-pressed", String(saved.has(r.id)));
    documentDecryption.reset($("#detail-content"), prefs.reduced || !scene || scene.decryptionFrame.phase === "clear");
    stopDocumentWatch = watchDocument($("#detail-content"), r.documentId, () => documentDecryption.refresh());
    return;
  }
  $("#object-id").textContent = "NO." + String(selected + 1).padStart(3, "0");
  $("#detail-content").innerHTML = detailMarkup({
    record: r,
    index: selected,
    total: records.length,
    saved: saved.has(r.id),
    overviewHtml: overview(),
  });
  $("#detail-content").setAttribute("tabindex", "-1");
  $('[data-action="bookmark"]').setAttribute("aria-pressed", String(saved.has(r.id)));
  documentDecryption.reset($("#detail-content"), prefs.reduced || !scene || scene.decryptionFrame.phase === "clear");
  setTab(activeTab, false);
}
function overview() {
  return overviewPanel(records[selected].abstract);
}
function setTab(tab: string, sound = true) {
  if (sound && tab === activeTab) return;
  activeTab = tab;
  document.querySelectorAll("[data-tab]").forEach((b) => {
    const active = (b as HTMLElement).dataset.tab === tab;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", String(active));
    b.setAttribute("tabindex", active ? "0" : "-1");
  });
  const r = records[selected];
  const tabButton = $<HTMLButtonElement>(`[data-tab="${tab}"]`);
  const indicator = $(".tab-indicator");
  indicator.style.transition = sound ? "" : "none";
  indicator.style.transform = `translateX(${tabButton.offsetLeft}px) scaleX(${tabButton.offsetWidth})`;
  $("#tab-panel").setAttribute("aria-labelledby", tabButton.id);
  $("#tab-panel").innerHTML = tabPanelMarkup(
    tab,
    r,
    accessLog.filter((entry) => entry.id === r.id),
  );
  $("#tab-panel").scrollTop = 0;
  documentDecryption.refresh();
  if (sound) {
    tabTransition.reveal($("#tab-panel"), prefs.reduced);
    audio.play("ui-tick");
  }
}
function notify(message: string) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 2600);
}

const modals = new ModalController({
  isReady: () => ready,
  mode: () => mode,
  preferences: () => prefs,
  saved: () => saved,
  records: () => records,
  categories: () => categories,
  audio,
  notify,
  workbenchSettings: () => workbench?.settingsMarkup() ?? "",
  workbenchEnabled: () => Boolean(workbench?.enabled),
  wallpaper: () => isWallpaper,
  updateQualitySummary,
});
function updateQualitySummary() {
  const summary = document.querySelector("#quality-summary");
  if (!summary) return;
  if (!scene) { summary.textContent = "3D 已关闭 · 三维模型与渲染资源已释放"; return; }
  const canvas = scene.renderer.domElement;
  const metrics = JSON.parse(canvas.parentElement?.dataset.renderQuality ?? "{}");
  summary.textContent = `${superPerformanceEnabled() ? "超级性能模式已启用 · 画质设置暂被覆盖，关闭后恢复 · " : ""}实际渲染 ${canvas.width} × ${canvas.height} · ${effectiveRenderQuality().antialias === "smaa" ? "SMAA" : "原始抗锯齿"} · 纹理 ${metrics.anisotropy ?? 1}×${metrics.limited ? " · 已达到缓冲上限" : ""}`;
}

function openModelViewer(el: HTMLElement) {
  if (mode !== "detail" || !scene) return;
  const activeScene = scene;
  // Safari does not always focus a button when it is tapped. Capture the
  // actual opener so closing the modal reliably restores the right control.
  el.focus({ preventScroll: true });
  viewer ??= new ModelViewer($("#stage"), () => { audio.setScene(mode); audio.play("page-close"); }, (sound) => audio.play(sound === "tick" ? "ui-tick" : sound));
  audio.setScene("viewer");
  viewer.setSuperPerformance(superPerformanceEnabled());
  viewer.setQuality(effectiveRenderQuality());
  scene.finishDecryption();
  viewer.open(
    records[selected].id,
    records[selected].title,
    () => activeScene.createAssemblyModel(),
    prefs.reduced,
  );
  audio.play("page-open");
}
bindInput({
  prefs: () => prefs,
  started: () => started,
  ready: () => ready,
  mode: () => mode,
  activeTab: () => activeTab,
  audio,
  modals,
  savePrefs,
  saveAudioPrefs,
  select,
  stepFile,
  stepColumn,
  openFile,
  setTab,
  setMode,
  replayBoot,
  notify,
  toggleSaved,
  toggleThree,
  openModelViewer,
  viewerOpen: () => Boolean(viewer?.isOpen),
  playgroundActive: () => Boolean(playground?.active),
  stopPlayground: () => playground?.stop(),
  apexEnabled: () => apexEnabled,
  archiveUrl,
});

const ease = (t: number) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};
function bootFrame(t: number) {
  if (isWallpaper && !scene && frozenTime === null && t >= 21.9) {
    setMode("archive");
    return undefined;
  }
  if (isWallpaper && frozenTime === null && t >= ARRAY_OPENING_END &&
      !openingShowsDetail(wallpaperHost()?.properties.openingdetail?.value, !!workbench?.enabled)) {
    setMode("archive");
    return undefined;
  }
  audio.updateBoot(t, frozenTime !== null);
  const motion = bootSequence.update(t);
  if (workbench?.enabled && frozenTime === null) {
    const end = openingShowsDetail(wallpaperHost()?.properties.openingdetail?.value, true) ? 35 : ARRAY_OPENING_END;
    if (t > end - .35) $(".powered").style.opacity = String(1 - ease((t - end + .35) / .35));
  }
  let step: string = motion.step;
  if (t >= 22) {
    step = "array";
  }
  if (t >= 25.68) {
    step = "select";
  }
  if (t >= 28.3) {
    step = "inspect";
  }
  if (step !== lastStep) {
    $("#stage").dataset.boot = step;
    lastStep = step;
  }
  $(".file-title").firstChild!.textContent =
    step === "array"
      ? "SELECTING FILES...".slice(0, Math.max(0, Math.floor((t - 21.94) * 18)))
      : "FILE NUMBER: ";
  $("#stage").style.setProperty(
    "--entry-opacity",
    String(ease((t - 21.9) / 0.13)),
  );
  $(".callout-rule").style.transform = `scaleX(${ease((t - 22.08) / 0.9)})`;
  const reveal = ease((t - 22) / 0.4),
    lift = ease((t - 26) / 1.8),
    zoom = 0.55 * ease((t - 27.3) / 1.65) + 0.45 * ease((t - 29.0) / 5.0);
  if (t >= 35) {
    setMode("detail");
    return undefined;
  }
  return { reveal, lift, zoom, time: t };
}

const inspectionOverlay = new InspectionOverlay();
const documentDecryption = new DocumentDecryption();
// A newly opened archive can introduce another font shard. Re-measure its
// redaction lines after font swap while retaining the current reveal progress.
document.fonts.addEventListener("loadingdone", () => documentDecryption.refresh());

let lastTime = 0,
  frameCount = 0,
  frameStart = performance.now(),
  fps = 0;
function frame(ms: number) {
  if (!wallpaperFrame(ms)) { requestAnimationFrame(frame); return; }
  if (document.hidden) { requestAnimationFrame(frame); return; }
  workbench?.tick();
  const time = ms / 1000;
  const theme = scene?.themeAmount ?? (prefs.colorTheme === "dark" ? 1 : 0);
  paintTheme(theme);
  viewer?.setTheme(theme);
  playground?.tick(time);
  const cinema =
    mode === "boot" && ready
      ? bootFrame(frozenTime ?? time - bootStart)
      : undefined;
  wallpaperEffects?.update(time, prefs.reduced);
  // The calibrated 2D opening fully covers the scene until array entry.
  if (!viewer?.isOpen && (!cinema || cinema.time >= 21.9)) scene?.update(time, cinema);
  viewer?.update(time);
  if (threeState === "closing" && scene?.presentationHidden) releaseThree();
  playground?.position();
  if (scene && mode === "detail") {
    $("#detail-content").style.setProperty("--apex-text-clarity", String(prefs.reduced ? 1 : scene.decryptionFrame.clarity));
    documentDecryption.update(time, scene.decryptionFrame, prefs.reduced);
    $("#detail-content").style.opacity = String(scene.detailVisibility);
    $("#detail-content").style.translate =
      `0 ${(1 - scene.detailVisibility) * 18}px`;
    $("#detail-content").inert = scene.detailVisibility < 0.1;
    if (pendingDetailFocus && scene.detailVisibility >= 0.1 && !modals.open && !viewer?.isOpen) {
      $("#detail-content").focus({ preventScroll: true });
      pendingDetailFocus = false;
    }
  }
  $("#stage").style.setProperty("--detail-shade", String(mode === "boot" ? 0 : scene?.detailVisibility ?? 0));
  const currentScene = scene;
  if (currentScene) inspectionOverlay.render(currentScene.decryptionFrame,
    (x, y) => currentScene.projectCard(x, y), Boolean(cinema));
  if (Math.floor(time) !== lastTime) {
    lastTime = Math.floor(time);
    updateFooterClock(new Date(), !prefs.reduced);
  }
  frameCount++;
  if (ms - frameStart > 1000) {
    fps = (frameCount * 1000) / (ms - frameStart);
    frameStart = ms;
    frameCount = 0;
    $("#three-scene").dataset.fps = String(Math.round(fps));
    $("#three-scene").dataset.renderStats = JSON.stringify(scene?.getStats() ?? { loaded: false, drawCalls: 0, triangles: 0 });
  }
  requestAnimationFrame(frame);
}
function bindScene(scene: ArchiveScene, cell?: { lane: number; row: number }) {
    scene.select(selected, cell ? { cell } : undefined);
    scene.onSelect = (i, cell) => {
      if (mode !== "archive" || modals.open || viewer?.isOpen) return;
      select(i, cell ? { cell } : undefined);
    };
    scene.onNavigate = (axis, direction) => {
      if (mode !== "archive" || modals.open || viewer?.isOpen) return;
      if (axis === "lane") stepColumn(direction);
      else stepFile(direction);
    };
    scene.onHover = (i) => {
      const label = $("#hover-label");
      if (i === null || records[i].empty) {
        label.hidden = true;
        hoverCode.finish();
        hoverTitle.finish();
        return;
      }
      const animated = !prefs.reduced && mode === "archive";
      label.firstChild!.textContent = records[i].id.slice(0, 2);
      hoverCode.update({
        value: Number(records[i].id.slice(2)),
        animated: !label.hidden && animated,
      });
      hoverTitle.update({ text: records[i].title, animated: !label.hidden && animated });
      label.hidden = false;
      // Prepare the first visible value so the next hover can animate immediately.
      hoverCode.update({ animated });
      hoverTitle.update({ animated });
    };
}
function syncThreeButton() {
  $("#stage").dataset.threeState = threeState;
  syncWallpaperBackground();
  const button = document.querySelector<HTMLButtonElement>('[data-action="toggle-three"]');
  if (!button) return;
  button.textContent = threeState === "loading" ? "3D 载入中…" : threeState === "closing" ? "3D 关闭中…" : threeState === "off" ? "3D 关闭" : "3D 开启";
  button.disabled = threeState === "loading";
  button.setAttribute("aria-pressed", String(threeState === "on"));
  button.title = threeState === "off" ? "重新载入三维模型" : threeState === "closing" ? "取消关闭，恢复三维画面" : "卸载三维模型，保留 2D 界面";
}
function releaseThree() {
  if (!scene) return;
  resumeCell = { ...scene.getStats().selectedCell }; resumeSelection = selected;
  viewer?.dispose(); viewer = undefined;
  scene.dispose(); scene = undefined;
  if (mode === "detail") {
    $("#detail-content").style.opacity = "1";
    $("#detail-content").style.translate = "0 0";
    $("#detail-content").inert = false;
    documentDecryption.reset($("#detail-content"), true);
  }
  threeState = "off"; syncThreeButton();
  $("#hover-label").hidden = true;
  delete $("#three-scene").dataset.renderQuality;
  updateQualitySummary();
}
async function toggleThree() {
  if (!isWallpaper || !ready || threeState === "loading") return;
  if (threeState === "closing") {
    scene?.setPresentationVisible(true, prefs.reduced);
    threeState = "on"; syncThreeButton(); return;
  }
  if (scene) {
    playground?.stop();
    threeState = "closing"; syncThreeButton();
    scene.setPresentationVisible(false, prefs.reduced);
    if (prefs.reduced) releaseThree();
    return;
  }
  threeState = "loading"; syncThreeButton();
  let next: ArchiveScene | undefined;
  try {
    next = new ArchiveScene($("#three-scene"));
    next.renderer.domElement.style.opacity = "0";
    next.setPresentationVisible(false, true);
    await next.load();
    next.setMode(mode === "detail" ? "detail" : "archive");
    bindScene(next, resumeSelection === selected ? resumeCell : undefined);
    next.revealImmediately();
    scene = next;
    scene.setTheme(prefs.colorTheme === "dark", true);
    scene.setArchiveCoverage(wallpaperHost()?.properties.archivecoverage?.value === "extra");
    savePrefs();
    scene.setPresentationVisible(true, prefs.reduced);
    threeState = "on"; syncThreeButton();
  } catch (error) {
    next?.dispose(); scene = undefined;
    threeState = "off"; syncThreeButton();
    notify("三维模型载入失败，请点击 3D 关闭重试。");
    console.error(error);
  }
}

async function start() {
  try {
    if (isWallpaper) await window.rhineWallpaperPropertiesReady;
    if (!isWallpaper || wallpaperHost()?.properties.load3donstartup?.value !== false) {
      scene = new ArchiveScene($("#three-scene"));
      scene.setTheme(prefs.colorTheme === "dark", true);
      scene.setArchiveCoverage(wallpaperHost()?.properties.archivecoverage?.value === "extra");
    } else {
      threeState = "off";
      syncThreeButton();
    }
    await Promise.all([
      scene?.load(),
      loadBootWebfonts(),
      // With unicode-range faces, preload the opening's actual characters,
      // not every font shard. Other archive text loads on demand.
      document.fonts.load("300 20px MiSans", "ACCESS WELCOME TO INTERNAL DATABASE"),
      document.fonts.load("400 20px MiSans", "身份信息确认请求已接收开始处理权限验证通过欢迎访问莱茵生命内部资料档案编号保密级别商业区选择档案：0123456789 JOYCE MOORE"),
      document.fonts.load("600 20px MiSans", "SYNTHESIZE INFORMATION ANALYSIS OS"),
      document.fonts.load("700 20px MiSans", "RHINE LAB WELCOME TO INTERNAL DATABASE"),
    ]);
    if (scene) bindScene(scene);
    savePrefs();
    ready = true;
    select(initialSelection);
    if (entry) entry.ready();
    else {
      if (isWallpaper) {
        // CEF allows automatic audio; never block the visual on audio policy or decoding.
        await Promise.race([audio.unlock(), new Promise(resolve => setTimeout(resolve, 3000))]);
      }
      completeStartup(false);
    }
  } catch (error) {
    console.error(error);
    $("#loading").innerHTML =
      '<div class="error-state"><strong>CONNECTION INTERRUPTED</strong><p>三维档案资源未能载入。请确认浏览器已启用硬件加速，然后重新连接。</p><button onclick="location.reload()">RECONNECT →</button></div>';
  }
}
function completeStartup(silent: boolean) {
  if (started || !ready) return;
  started = true;
  if (silent) {
    prefs.sound = false;
    prefs.music = false;
    saveAudioPrefs();
  }
  audio.releaseEntry();
  audio.restartBoot();
  const fade = prefs.reduced ? 0 : 600;
  bootStart = performance.now() / 1000 - (reviewParams.has("time") ? Number(reviewParams.get("time")) : 1.76);
  if (!reviewParams.has("time")) bootStart += fade / 1000;
  setMode("boot");
  if (reviewParams.get("scene") === "archive" || (prefs.reduced && !reviewParams.has("time"))) setMode("archive");
  if (reviewParams.get("scene") === "detail") setMode("detail");
  if (isWallpaper && wallpaperHost()?.properties.boot?.value === false) setMode("archive");
  $("#stage").inert = false;
  $(".mobile-entry").inert = false;
  loading.classList.add("loaded");
  loading.inert = true;
  setTimeout(() => {
    const restoreFocus = loading.contains(document.activeElement) || document.activeElement === document.body;
    loading.remove();
    if (entry && restoreFocus) {
      const skip = $("#skip");
      const target = mode === "boot" ? skip.getClientRects().length ? skip : $(".mobile-entry") : $(".read-file");
      target.focus({ preventScroll: true });
    }
  }, fade);
  requestAnimationFrame(frame);
  // Do not compete with entry audio/font downloads. Full offline installation
  // begins after startup is complete and remains atomic.
  setTimeout(() => void initPwa(notify), 1500);
}
updateSelection();
const customBackground = isWallpaper ? new WallpaperBackground($("#stage"), notify) : undefined;
function syncWallpaperBackground(retry = false) {
  customBackground?.update(wallpaperHost()?.properties ?? {}, mode !== "boot" && (threeState === "off" || threeState === "loading"), prefs.reduced, retry);
}
if (isWallpaper) {
  const apply = (properties: WallpaperProperties) => {
    const theme = properties.colortheme?.value;
    if (theme === "light" || theme === "dark") prefs.colorTheme = theme;
    scene?.setArchiveCoverage(properties.archivecoverage?.value === "extra" || wallpaperHost()?.properties.archivecoverage?.value === "extra");
    for (const key of ["sound", "music", "reduced"] as const)
      if (typeof properties[key]?.value === "boolean") prefs[key] = properties[key].value as boolean;
    for (const key of ["soundVolume", "musicVolume"] as const) {
      const value = properties[key.toLowerCase()]?.value;
      if (typeof value === "number" && Number.isFinite(value)) prefs[key] = Math.max(0, Math.min(1, value / 100));
    }
    const qualityProperties = { ...wallpaperHost()?.properties, ...properties };
    if (Object.keys(properties).some(key => key === "renderquality" || key.startsWith("quality")))
      prefs.rendering = wallpaperQuality(qualityProperties, prefs.rendering);
    savePrefs();
    if (properties.customwallpaperfile || properties.customwallpaper?.value === true) syncWallpaperBackground(true);
    if (properties.boot?.value === false && started && mode === "boot") setMode("archive");
    // Keep an already-open settings surface in sync without replacing focused controls.
    document.querySelectorAll<HTMLInputElement>("[data-pref]").forEach(input => {
      const key = input.dataset.pref as "sound" | "music" | "reduced";
      if (key in prefs) input.checked = prefs[key];
    });
    for (const key of ["soundVolume", "musicVolume"] as const) {
      const input = document.querySelector<HTMLInputElement>(`[data-volume="${key}"]`);
      if (input) { input.value = String(Math.round(prefs[key] * 100)); input.closest("label")?.querySelector("output")?.replaceChildren(`${input.value}%`); }
    }
  };
  window.addEventListener("rhine-wallpaper-properties", event => apply((event as CustomEvent<WallpaperProperties>).detail));
  let pausedAt: number | undefined;
  const pause = () => {
    const paused = wallpaperHost()?.paused ?? false;
    if (paused && pausedAt === undefined) pausedAt = performance.now();
    if (!paused && pausedAt !== undefined) {
      if (started && mode === "boot") bootStart += (performance.now() - pausedAt) / 1000;
      pausedAt = undefined;
    }
    audio.setHostPaused(paused);
  };
  window.addEventListener("rhine-wallpaper-pause", pause);
  apply(wallpaperHost()?.properties ?? {});
  pause();
}
if (isWallpaper) {
  workbench = new Workbench($("#stage"), () => {
    if (ready && mode !== "boot") setMode("archive");
  }, lane => {
    if (ready && !modals.open) select(columnMemory[lane]);
  });
  playground = new ArchivePlayground($("#stage"), () => scene,
    () => ({ enabled: !!workbench?.enabled && mode === "archive" && ready, paused: modals.open || modals.isClosing || Boolean(wallpaperHost()?.paused) || document.hidden, reduced: prefs.reduced }),
    value => { musicSuppressed = value; configureAudio(); }, () => audio.play("tick"));
  wallpaperEffects = new WallpaperEffects($("#stage"), () => scene);
  document.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLElement>("[data-workbench-mode]");
    if (button) modals.close(() => { workbench!.setEnabled(button.dataset.workbenchMode === "workbench"); });
  });
}
void start();
// Deterministic review controls: the running application, never a video surrogate.
Object.assign(window, {
  rhine: {
    // The review button supplies a real user activation. Preferences stay local to this preview.
    playBootPreview: async (music = false) => {
      if (!ready || !navigator.userActivation.isActive) return false;
      const request = ++audioPreviewRequest;
      audioPreview = true;
      audio.configure({ ...prefs, sound: true, music });
      const unlocked = await audio.unlock();
      if (request !== audioPreviewRequest) return false;
      if (!unlocked) {
        audioPreview = false;
        configureAudio();
        return false;
      }
      replayBoot(true);
      return true;
    },
    seek: (t: number) => {
      setMode("boot");
      bootStart = performance.now() / 1000 - t;
      lastStep = "";
    },
    archive: () => setMode("archive"),
    detail: () => openFile(),
    select: (i: number) => select(i),
    stats: () => ({
      ...scene?.getStats(),
      threeState,
      fps: Math.round(fps),
      mode,
      ready,
      startup: started ? "started" : entry?.phase ?? "loading",
      motion: { reduced: prefs.reduced, systemReduced: matchMedia("(prefers-reduced-motion: reduce)").matches },
      bootTime: mode === "boot" ? started ? (frozenTime ?? performance.now() / 1000 - bootStart) + 5 : 6.76 : null,
      selected: records[selected].id,
      saved: [...saved],
      audio: audio.stats(),
      wallpaper: isWallpaper ? wallpaperHost() : null,
    }),
  },
});
if (import.meta.hot) import.meta.hot.dispose(() => audio.dispose());

