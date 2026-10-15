import type { ArchiveRecord } from './data';
import { documentStates, originalUrl, readDocument } from './document-api';
import { escapeHtml } from './html';

export function documentDetailMarkup(record: ArchiveRecord, saved: boolean) {
  const id = record.documentId!;
  const pdf = record.category === 'PDF 文档';
  return `<div class="detail-kicker"><span>FILE ${escapeHtml(record.id)}</span><span>LOCAL DOCUMENT</span></div>
    <h2>DOCUMENT ARCHIVE</h2><div class="detail-title-cn">${escapeHtml(record.title)}<span>${escapeHtml(record.category)}</span></div>
    <div class="detail-rule"></div><dl class="metadata"><div><dt>CREATED / 上传日期</dt><dd>${escapeHtml(record.date)}</dd></div><div><dt>STATUS / 处理状态</dt><dd id="document-state">正在读取…</dd></div></dl>
    <div class="apex-original-actions">${pdf ? `<a href="${originalUrl(id, true)}" target="_blank" rel="noopener noreferrer">OPEN DOCUMENT / 查看 PDF ↗</a>` : '<span>此格式可阅读正文或下载原件。</span>'}<a href="${originalUrl(id)}" download>下载原件 ↓</a><button class="solid-button" data-action="bookmark">${saved ? '− REMOVE FROM SAVED' : '＋ SAVE ARCHIVE'}<span>${saved ? '已收藏' : '收藏档案'}</span></button></div>
    <div class="tab-panel apex-document-body"><div class="panel-label">EXTRACTED TEXT / 提取正文</div><pre id="document-body">正在加载正文…</pre><button type="button" id="document-refresh">刷新处理结果 ↻</button></div>
    <p class="log-note">解密效果为视觉过渡。本地开发版本尚未启用用户权限；收藏保存在本浏览器。</p>`;
}

export function watchDocument(root: HTMLElement, id: string, changed: () => void) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let loading = false;
  let stopped = false;
  const refresh = root.querySelector<HTMLButtonElement>('#document-refresh')!;
  const update = async () => {
    if (stopped || loading) return;
    clearTimeout(timer);
    loading = true;
    refresh.disabled = true;
    let again = false;
    try {
      const document = await readDocument(
        id,
        AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      );
      if (stopped) return;
      root.querySelector('#document-state')!.textContent =
        documentStates[document.status] ?? document.status;
      const body = root.querySelector('#document-body')!;
      const value =
        document.status === 'ready'
          ? document.text || '没有可提取的文字，扫描件可能需要 OCR。'
          : document.status === 'failed'
            ? `正文处理失败：${document.extractionError || '请稍后重试'}。仍可查看或下载原件。`
            : '文档正在后台处理，完成后会自动显示正文。原文件可以直接查看或下载。';
      if (body.textContent !== value) {
        body.textContent = value;
        changed();
      }
      again = ['uploaded', 'processing', 'retrying'].includes(document.status);
    } catch (error) {
      if (!stopped)
        root.querySelector('#document-state')!.textContent =
          error instanceof Error && error.name === 'Error'
            ? error.message
            : '连接中断，请点击刷新重试。';
    } finally {
      loading = false;
      if (!stopped) {
        refresh.disabled = false;
        if (again) timer = setTimeout(() => void update(), 3000);
      }
    }
  };
  refresh.onclick = () => void update();
  void update();
  return () => {
    stopped = true;
    clearTimeout(timer);
    controller.abort();
  };
}
