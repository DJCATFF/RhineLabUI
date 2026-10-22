import { assetUrl } from "../asset-url";
import type { ArchiveRecord } from "../data";
import { escapeHtml } from "../html";

export type DetailMarkupOptions = {
  record: ArchiveRecord;
  /** Zero-based index inside the record list. */
  index: number;
  total: number;
  saved: boolean;
  /** Pre-rendered overview panel, reused as the initial tab body. */
  overviewHtml: string;
};

/** Overview tab body for a demo record. */
export function overviewPanel(abstract: string) {
  return `<div class="panel-label">ABSTRACT / 摘要</div><p>${escapeHtml(abstract)}</p>`;
}

/** Detail pane for a record that only exists in the demo dataset. */
export function detailMarkup({ record: r, index, total, saved, overviewHtml }: DetailMarkupOptions) {
  return `
  <div class="detail-kicker"><span>FILE ${r.id}</span><span>${escapeHtml(r.clearance)}</span></div>
  <h2>${escapeHtml(r.en)}</h2><div class="detail-title-cn">${escapeHtml(r.title)}<span>${escapeHtml(r.category)}</span></div>
  <div class="detail-rule"></div>
  <dl class="metadata"><div><dt>DEPARTMENT / 科室</dt><dd>${escapeHtml(r.department)}</dd></div><div><dt>COLLECTION / 编目范围</dt><dd>${escapeHtml(r.date)}</dd></div><div><dt>RELATED / 相关人物</dt><dd>${escapeHtml(r.lead)}</dd></div><div><dt>STATUS / 状态</dt><dd><i></i>${r.clearance === "RESTRICTED" ? "目录访问" : "已归档 · 可读取"}</dd></div></dl>
  <div class="detail-tabs" role="tablist"><button id="tab-overview" class="active" role="tab" aria-controls="tab-panel" aria-selected="true" data-tab="overview">01 <span>概述</span></button><button id="tab-notes" role="tab" aria-controls="tab-panel" aria-selected="false" data-tab="notes">02 <span>研究记录</span></button><button id="tab-history" role="tab" aria-controls="tab-panel" aria-selected="false" data-tab="history">03 <span>访问日志</span></button><i class="tab-indicator" aria-hidden="true"></i></div>
  <div id="tab-panel" class="tab-panel" role="tabpanel">${overviewHtml}</div>
  <div class="detail-actions"><button class="solid-button" data-action="bookmark">${saved ? "− REMOVE FROM SAVED" : "＋ SAVE ARCHIVE"}<span>${saved ? "已收藏" : "收藏档案"}</span></button><a class="export-button" href="${assetUrl(`archives/RHINE-LAB-${r.id}.txt`)}" download="RHINE-LAB-${r.id}.txt" aria-label="导出 ${r.id} 档案">EXPORT <span>↓</span></a></div>
  <div class="detail-footnote"><a href="${escapeHtml(r.source)}" target="_blank" rel="noopener">设定参考 ↗</a><span>${String(index + 1).padStart(3, "0")} / ${String(total).padStart(3, "0")}</span></div>`;
}

/** Body of the tab panel in the detail pane for a demo record. */
export function tabPanelMarkup(tab: string, record: ArchiveRecord, accessLog: { time: string }[]) {
  if (tab === "overview") return overviewPanel(record.abstract);
  if (tab === "notes")
    return `<div class="panel-label">RESEARCH NOTES / 研究记录</div><ol class="research-notes">${record.findings.map((f, i) => `<li><span>${String(i + 1).padStart(2, "0")}</span>${escapeHtml(f)}</li>`).join("")}</ol>`;
  return `<div class="panel-label">ACCESS LOG / 本次访问</div>${accessLog
    .slice(0, 4)
    .map(
      (entry) =>
        `<div class="log-row"><span>${entry.time}</span><span>JOYCE MOORE</span><b>READ AUTHORIZED</b></div>`,
    )
    .join("")}<p class="log-note">本次会话已通过身份验证。档案内容以当前终端可访问范围展示。</p>`;
}
