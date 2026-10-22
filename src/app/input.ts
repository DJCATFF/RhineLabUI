import type { TerminalAudio } from "../audio";
import { normalizeQuality, qualityPresets, type QualityPreset, type RenderQuality } from "../render-quality";
import { usingDocumentArchive } from "../data";
import { motionSettingsMarkup } from "../views/settings-markup";
import type { ModalController } from "./modal-controller";
import type { Preferences } from "./preferences";

export type AppMode = "boot" | "archive" | "detail";

export type InputHost = {
  prefs(): Preferences;
  started(): boolean;
  ready(): boolean;
  mode(): AppMode;
  activeTab(): string;
  audio: TerminalAudio;
  modals: ModalController;
  savePrefs(): void;
  saveAudioPrefs(): void;
  select(index: number): void;
  stepFile(direction: number): void;
  stepColumn(direction: number): void;
  openFile(): void;
  setTab(tab: string): void;
  setMode(mode: AppMode): void;
  replayBoot(): void;
  notify(message: string): void;
  toggleSaved(): void;
  toggleThree(): void | Promise<void>;
  openModelViewer(button: HTMLElement): void;
  viewerOpen(): boolean;
  playgroundActive(): boolean;
  stopPlayground(): void;
  apexEnabled(): boolean;
  archiveUrl(): string;
};

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

/** Routes all global input/change/click/keydown events to the application host. */
export function bindInput(host: InputHost) {
  document.addEventListener("input", (e) => {
    const slider = e.target as HTMLInputElement;
    if (slider.dataset.quality) {
      const output = document.querySelector<HTMLOutputElement>(`[data-quality-output="${slider.dataset.quality}"]`);
      if (output) output.value = `${slider.value}%`;
    }
    const volume = e.target as HTMLInputElement;
    if (volume.dataset.volume === "musicVolume" || volume.dataset.volume === "soundVolume") {
      host.prefs()[volume.dataset.volume] = Number(volume.value) / 100;
      volume.closest("label")?.querySelector("output")?.replaceChildren(`${volume.value}%`);
      host.saveAudioPrefs();
    }
    if ((e.target as HTMLElement).id === "archive-search") {
      host.modals.setQuery((e.target as HTMLInputElement).value);
    }
  });
  document.addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement;
    const prefs = host.prefs();
    if (el.id === "quality-preset" && Object.hasOwn(qualityPresets, el.value)) {
      prefs.rendering = { ...qualityPresets[el.value as QualityPreset] };
      host.savePrefs();
    } else if (el.dataset.quality) {
      const key = el.dataset.quality as keyof RenderQuality;
      prefs.rendering = normalizeQuality({ ...prefs.rendering, [key]: key === "antialias" ? el.value : Number(el.value) });
      host.savePrefs();
    }
    if (el.dataset.pref) {
      const key = el.dataset.pref;
      if (key === "sound" || key === "music" || key === "reduced" || key === "quality" || key === "superPerformance") prefs[key] = el.checked;
      if (key === "sound" || key === "music") host.saveAudioPrefs(); else host.savePrefs();
      if (key === "reduced") $("#motion-preference-note").outerHTML = motionSettingsMarkup(prefs.reduced, matchMedia("(prefers-reduced-motion: reduce)").matches);
      host.audio.play("confirm");
    }
  });
  document.addEventListener("click", (e) => {
    const themeButton = (e.target as Element).closest<HTMLElement>("[data-color-theme]");
    if (themeButton) {
      host.prefs().colorTheme = themeButton.dataset.colorTheme === "dark" ? "dark" : "light";
      host.savePrefs();
      return;
    }
    if (!host.started()) return;
    if (host.modals.isClosing) return;
    const el = (e.target as Element).closest<HTMLElement>("button");
    if (!el) return;
    if (el.dataset.select) {
      host.select(Number(el.dataset.select));
      return;
    }
    if (el.dataset.result) {
      const index = Number(el.dataset.result);
      host.modals.close(() => {
        host.select(index);
        host.openFile();
      });
      return;
    }
    if (el.dataset.filter) {
      host.modals.setFilter(el.dataset.filter);
      return;
    }
    if (el.dataset.tab) {
      host.setTab(el.dataset.tab);
      return;
    }
    const action = el.dataset.action;
    if (action === "toggle-three") { void host.toggleThree(); return; }
    if (action === "sound-preview") host.audio.play("confirm");
    if (action === "skip") {
      host.setMode("archive");
      host.audio.play("confirm");
    }
    if (action === "prev") host.stepFile(-1);
    if (action === "next") host.stepFile(1);
    if (action === "column-prev") host.stepColumn(-1);
    if (action === "column-next") host.stepColumn(1);
    if (action === "open") host.openFile();
    if (action === "model-viewer") host.openModelViewer(el);
    if (action === "back") {
      host.setMode("archive");
      host.audio.play("back");
    }
    if (action === "library" && host.apexEnabled()) location.href = host.archiveUrl();
    if (action === "demo" && host.apexEnabled()) location.href = "/";
    if (action === "search" || action === "saved" || action === "settings" || (action === "documents" && host.apexEnabled())) {
      el.focus({ preventScroll: true });
      host.modals.openModal(action === "search" && usingDocumentArchive ? "documents" : action);
    }
    if (action === "close-modal") host.modals.close();
    if (action === "bookmark") host.toggleSaved();
    if (action === "reset-search") {
      host.modals.resetSearch();
    }
    if (action === "replay" || action === "restart") {
      host.replayBoot();
    }
    if (action === "enable-motion") {
      host.prefs().reduced = false;
      host.savePrefs();
      host.replayBoot();
    }
    if (action === "fullscreen" && document.fullscreenEnabled) {
      if (document.fullscreenElement) void document.exitFullscreen();
      else
        void document.documentElement
          .requestFullscreen()
          .catch(() => host.notify("请使用浏览器的全屏快捷键 F11"));
    }
  });
  document.addEventListener("keydown", (e) => {
    if (!host.started()) return;
    if (host.viewerOpen()) return;
    if (host.playgroundActive() && !host.modals.open) {
      if (e.key === "Escape") { e.preventDefault(); host.stopPlayground(); }
      else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", "/"].includes(e.key) && !(e.target instanceof HTMLButtonElement)) e.preventDefault();
      return;
    }
    if (host.modals.isClosing) {
      e.preventDefault();
      return;
    }
    const typing = e.target instanceof HTMLInputElement;
    if (e.key === "Escape") {
      if (host.modals.open) host.modals.close();
      else if (host.mode() === "detail" || (host.mode() === "boot" && host.ready())) { const sound = host.mode() === "detail" ? "back" : "ui-tick"; host.setMode("archive"); host.audio.play(sound); }
      return;
    }
    if (host.modals.open && e.key === "Tab") {
      const focusables = [
        ...$("#modal-root").querySelectorAll<HTMLElement>(
          'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,[tabindex="0"]',
        ),
      ];
      const visible = focusables.filter(el => el.getClientRects().length > 0);
      const first = visible[0],
        last = visible.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
      return;
    }
    if (typing || host.modals.open || !host.ready()) return;
    if (
      (e.target as HTMLElement).dataset.tab &&
      ["ArrowLeft", "ArrowRight"].includes(e.key)
    ) {
      e.preventDefault();
      const tabs = ["overview", "notes", "history"];
      host.setTab(
        tabs[(tabs.indexOf(host.activeTab()) + (e.key === "ArrowRight" ? 1 : 2)) % 3],
      );
      $<HTMLButtonElement>(`[data-tab="${host.activeTab()}"]`).focus();
      return;
    }
    if (e.key === "/") {
      e.preventDefault();
      if (host.mode() === "boot") host.setMode("archive");
      host.modals.openModal(usingDocumentArchive ? "documents" : "search");
    }
    if (e.key === "ArrowLeft" && host.mode() !== "boot") {
      e.preventDefault();
      host.stepColumn(-1);
    }
    if (e.key === "ArrowRight" && host.mode() !== "boot") {
      e.preventDefault();
      host.stepColumn(1);
    }
    if (["ArrowUp", "ArrowDown"].includes(e.key) && host.mode() !== "boot") {
      e.preventDefault();
      host.stepFile(e.key === "ArrowUp" ? -1 : 1);
    }
    if (
      e.key === "Enter" &&
      (document.activeElement === document.body ||
        document.activeElement?.id === "detail-content" ||
        ["prev", "next", "column-prev", "column-next"].includes(
          (document.activeElement as HTMLElement)?.dataset.action ?? "",
        ) ||
        (document.activeElement as HTMLElement)?.dataset.select)
    ) {
      e.preventDefault();
      if (host.mode() === "boot") host.setMode("archive");
      else if (host.mode() === "archive") host.openFile();
    }
  });
}
