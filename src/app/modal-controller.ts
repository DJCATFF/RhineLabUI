import { DocumentsPanel, documentsMarkup } from "../apex-documents";
import type { TerminalAudio } from "../audio";
import type { ArchiveRecord } from "../data";
import { escapeHtml } from "../html";
import { SurfaceTransition } from "../ui-transitions";
import { searchResultsMarkup } from "../views/results-markup";
import { settingsMarkup } from "../views/settings-markup";
import type { Preferences } from "./preferences";

export type ModalKind = "search" | "saved" | "settings" | "documents";

export type ModalHost = {
  isReady(): boolean;
  mode(): "boot" | "archive" | "detail";
  preferences(): Preferences;
  saved(): Set<string>;
  records(): ArchiveRecord[];
  categories(): string[];
  audio: TerminalAudio;
  notify(message: string): void;
  workbenchSettings(): string;
  workbenchEnabled(): boolean;
  wallpaper(): boolean;
  updateQualitySummary(): void;
};

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

/** Owns the modal dialog lifecycle: open/close, backdrop transition and search results. */
export class ModalController {
  private kind: ModalKind | null = null;
  private query = "";
  private category = "全部档案";
  private closing = false;
  private transition: SurfaceTransition | undefined;
  private siblings: { node: HTMLElement; inert: boolean }[] = [];
  private previousFocus: HTMLElement | null = null;
  private documents: DocumentsPanel | undefined;

  constructor(private readonly host: ModalHost) {}

  get open() {
    return this.kind !== null;
  }

  get isClosing() {
    return this.closing;
  }

  finish() {
    this.transition?.finish();
  }

  openModal(kind: ModalKind) {
    if (!this.host.isReady()) return;
    if (!this.kind) {
      this.previousFocus = document.activeElement as HTMLElement;
      this.siblings = [...$("#stage").children]
        .filter(
          (node): node is HTMLElement =>
            node instanceof HTMLElement && node.id !== "modal-root",
        )
        .map((node) => ({ node, inert: node.inert }));
      this.siblings.forEach(({ node }) => (node.inert = true));
    }
    this.closing = false;
    this.kind = kind;
    this.query = "";
    this.category = "全部档案";
    this.host.audio.play("page-open");
    this.render();
  }

  close(afterClose?: () => void) {
    if (this.documents?.busy) {
      this.host.notify("文件正在上传，请等待上传结束后关闭。");
      return;
    }
    if (!this.kind) {
      afterClose?.();
      return;
    }
    if (this.closing) return;
    this.closing = true;
    this.documents?.dispose();
    this.documents = undefined;
    this.host.audio.play("page-close");
    this.transition!.hide(this.host.preferences().reduced, () => {
      this.kind = null;
      this.closing = false;
      $("#modal-root").replaceChildren();
      this.transition = undefined;
      this.siblings.forEach(({ node, inert }) => (node.inert = inert));
      this.siblings = [];
      $("#archive-ui").inert =
        this.host.mode() !== "archive" || this.host.workbenchEnabled();
      $("#detail-ui").inert = this.host.mode() !== "detail";
      this.previousFocus?.focus({ preventScroll: true });
      afterClose?.();
    });
  }

  setQuery(value: string) {
    this.query = value;
    this.renderResults();
  }

  setFilter(value: string) {
    this.category = value;
    document
      .querySelectorAll("[data-filter]")
      .forEach((button) =>
        button.classList.toggle(
          "active",
          (button as HTMLElement).dataset.filter === this.category,
        ),
      );
    this.renderResults();
  }

  resetSearch() {
    this.kind = "search";
    this.query = "";
    this.category = "全部档案";
    this.render();
  }

  render() {
    const kind = this.kind;
    if (!kind) return;
    const prefs = this.host.preferences();
    this.documents?.dispose();
    this.documents = undefined;
    this.transition?.dispose();
    if (kind === "documents") {
      $("#modal-root").innerHTML = documentsMarkup;
      const backdrop = $(".modal-backdrop");
      backdrop.hidden = true;
      this.transition = new SurfaceTransition(backdrop, $(".terminal-modal"));
      this.transition.show(prefs.reduced);
      this.documents = new DocumentsPanel($(".apex-modal"));
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) this.close();
      });
      requestAnimationFrame(() => {
        if (backdrop.isConnected && !this.closing)
          $('[data-action="close-modal"]').focus({ preventScroll: true });
      });
      return;
    }
    $("#modal-root").innerHTML =
      `<div class="modal-backdrop"><section class="terminal-modal ${kind === "settings" ? "settings-modal" : ""}" role="dialog" aria-modal="true" aria-label="${kind === "settings" ? "系统设置" : kind === "saved" ? "收藏档案" : "档案检索"}"><div class="modal-top"><span>RHINE LAB / ${kind === "settings" ? "SYSTEM PREFERENCES" : "ARCHIVE DIRECTORY"}</span><button data-action="close-modal" aria-label="关闭窗口">CLOSE <span>×</span></button></div>${kind === "settings" ? settingsMarkup({ prefs, wallpaper: this.host.wallpaper(), workbenchSettings: this.host.workbenchSettings(), systemReducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches }) : `<h2>${kind === "saved" ? "SAVED ARCHIVES" : "ARCHIVE INDEX"}<small>${kind === "saved" ? "收藏档案" : "内部档案检索"}</small></h2><div class="search-field"><span>⌕</span><input id="archive-search" type="search" autocomplete="off" placeholder="输入档案编号、名称或科室" aria-label="检索档案"/><span class="key">ESC</span></div><div class="category-filters">${this.host.categories().map((category, index) => `<button data-filter="${escapeHtml(category)}" class="${index === 0 ? "active" : ""}">${escapeHtml(category)}</button>`).join("")}</div><div class="result-header"><span>FILE / 档案</span><span>DEPARTMENT / 科室</span><span>ACCESS</span></div><div id="search-results" class="search-results"></div><div class="modal-bottom"><span id="result-count"></span><span>INTERNAL DATABASE <i>●</i> CONNECTED</span></div>`}</section></div>`;
    const backdrop = $(".modal-backdrop");
    backdrop.hidden = true;
    this.transition = new SurfaceTransition(backdrop, $(".terminal-modal"));
    this.transition.show(prefs.reduced);
    if (kind === "settings") this.host.updateQualitySummary();
    if (kind !== "settings") {
      this.renderResults();
      requestAnimationFrame(() => {
        if (backdrop.isConnected && !this.closing)
          $("#archive-search").focus();
      });
    } else
      requestAnimationFrame(() => {
        if (backdrop.isConnected && !this.closing)
          $('[data-action="close-modal"]').focus();
      });
    $("#modal-root")
      .querySelector(".modal-backdrop")
      ?.addEventListener("click", (event) => {
        if (event.target === event.currentTarget) this.close();
      });
  }

  private renderResults() {
    const saved = this.host.saved();
    const results = this.host
      .records()
      .map((record, index) => ({ record, index }))
      .filter(({ record }) => !record.empty)
      .filter(
        ({ record }) =>
          (this.kind !== "saved" || saved.has(record.id)) &&
          (this.category === "全部档案" || record.category === this.category) &&
          `${record.id} ${record.title} ${record.en} ${record.department} ${record.lead}`
            .toLowerCase()
            .includes(this.query.toLowerCase()),
      );
    $("#search-results").innerHTML = searchResultsMarkup({
      rows: results.map(({ record, index }) => ({ record, index })),
      saved,
      savedMode: this.kind === "saved",
      hasQuery: Boolean(this.query),
    });
    $("#result-count").textContent =
      `${String(results.length).padStart(2, "0")} RECORDS FOUND`;
  }
}
