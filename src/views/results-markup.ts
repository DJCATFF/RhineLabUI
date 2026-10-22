import type { ArchiveRecord } from "../data";
import { escapeHtml } from "../html";

export type SearchResultRow = { record: ArchiveRecord; index: number };

export type SearchResultsOptions = {
  rows: SearchResultRow[];
  saved: Set<string>;
  /** The saved-archives modal: empty copy and reset action differ. */
  savedMode: boolean;
  hasQuery: boolean;
};

/** Rows of the archive index, or the empty state when nothing matches. */
export function searchResultsMarkup({ rows, saved, savedMode, hasQuery }: SearchResultsOptions) {
  if (!rows.length) {
    return `<div class="empty-results"><span>∅</span><strong>${savedMode && !hasQuery ? "尚无收藏档案" : "没有匹配的档案"}</strong><p>${savedMode && !hasQuery ? "读取档案时，选择 SAVE ARCHIVE 将其保存在此处。" : "尝试其他名称、档案编号，或切换科室分类。"}</p><button data-action="reset-search">${savedMode ? "查看全部档案 →" : "重置检索 →"}</button></div>`;
  }
  return rows
    .map(
      ({ record: r, index }) =>
        `<button class="result-row" data-result="${index}"><span class="result-name"><b>${r.id}</b><span>${escapeHtml(r.title)}<small>${escapeHtml(r.en)}</small></span>${saved.has(r.id) ? "<i>＋</i>" : ""}</span><span>${escapeHtml(r.department)}</span><span>${r.clearance === "RESTRICTED" ? "CATALOG ONLY" : "AUTHORIZED"} <i>↗</i></span></button>`,
    )
    .join("");
}
