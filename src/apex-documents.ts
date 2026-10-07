type DocumentRow = {
  id: string;
  fileName: string;
  size: number;
  status: string;
  createdAt: string;
  extractedAt?: string | null;
  text?: string | null;
  extractionError?: string | null;
};
const labels: Record<string, string> = {
  uploaded: '等待处理',
  processing: '正在提取正文',
  retrying: '正在自动重试',
  ready: '处理完成',
  failed: '处理失败',
};
const pending = (status: string) => ['uploaded', 'processing', 'retrying'].includes(status);

export const documentsMarkup = `<div class="modal-backdrop"><section class="terminal-modal apex-modal" role="dialog" aria-modal="true" aria-label="我的文档">
  <div class="modal-top"><span>APEX / DOCUMENT LIBRARY</span><button data-action="close-modal" aria-label="关闭窗口">CLOSE <span>×</span></button></div>
  <h2>MY DOCUMENTS <small>我的文档</small></h2>
  <form class="apex-upload"><label for="apex-file">选择文档 <small>单个文件不超过 20 MiB</small></label><input id="apex-file" type="file" aria-describedby="apex-upload-help"/><button type="submit">上传文档 ↑</button></form>
  <p id="apex-upload-help" class="apex-hint">上传 TXT、PDF、Word 等文档，完成处理后即可阅读提取的正文。</p>
  <p class="apex-feedback" role="status" aria-live="polite"></p>
  <div class="apex-columns"><section class="apex-directory" aria-label="文档列表"><div class="apex-list-heading"><span>最近 100 份文档</span><button type="button" class="apex-refresh">刷新 ↻</button></div><p class="apex-list-message">正在读取文档…</p><div class="apex-list"></div></section>
  <article class="apex-reader" aria-label="文档正文"><h3>选择一份文档</h3><p class="apex-meta"></p><p class="apex-state" role="status" aria-live="polite">上传文件，或从左侧列表选择文档。</p><pre class="apex-text" tabindex="0" aria-label="提取的正文" hidden></pre></article></div>
  <p class="apex-hint apex-bottom">此处展示提取的纯文本，原文件的排版和图片不会在正文中呈现。</p>
</section></div>`;

/** One mounted panel owns its requests and timers; disposing invalidates late responses. */
export class DocumentsPanel {
  private controller = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private refreshing = false;
  private selection = 0;
  private selected?: DocumentRow;
  private rows = new Map<string, HTMLButtonElement>();
  private readerKey = '';
  busy = false;

  constructor(private root: HTMLElement) {
    this.node<HTMLFormElement>('.apex-upload').addEventListener('submit', (event) => {
      event.preventDefault();
      void this.upload();
    });
    this.node('.apex-refresh').addEventListener('click', () => void this.refresh());
    void this.refresh();
  }

  private node<T extends HTMLElement = HTMLElement>(selector: string) {
    return this.root.querySelector<T>(selector)!;
  }

  private async request(path: string, init: RequestInit = {}) {
    const response = await fetch(`/api/documents${path}`, {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.any([
        this.controller.signal,
        AbortSignal.timeout(init.method ? 120000 : 15000),
      ]),
    });
    if (!response.ok) {
      if (response.status === 404) throw new Error('未找到这份文档，请刷新列表。');
      if (response.status === 413) throw new Error('文件过大，请选择不超过 20 MiB 的文件。');
      throw new Error('文档服务暂时不可用，请稍后刷新重试。');
    }
    return response.json();
  }

  private feedback(message: string) {
    this.node('.apex-feedback').textContent = message;
  }

  private paint(document: DocumentRow) {
    this.node('h3').textContent = document.fileName;
    this.node('.apex-meta').textContent =
      `${(document.size / 1024).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} KiB · ${new Date(document.createdAt).toLocaleString('zh-CN')}`;
    const state =
      document.status === 'failed'
        ? `处理失败：${document.extractionError || '未能提取正文'}。原件已保留。`
        : (labels[document.status] ?? '状态待更新');
    this.node('.apex-state').textContent = pending(document.status)
      ? `${state}，本窗口会自动更新。`
      : state;
    const text = this.node<HTMLPreElement>('.apex-text');
    const key = `${document.id}:${document.status}:${document.extractedAt ?? ''}`;
    if (document.status === 'ready' && typeof document.text === 'string') {
      text.hidden = false;
      if (this.readerKey !== key) {
        text.textContent = document.text || '此文档没有可提取的文字。扫描件或图片可能需要 OCR。';
        text.scrollTop = 0;
        this.readerKey = key;
      }
    } else {
      text.hidden = true;
      text.textContent = '';
      this.readerKey = '';
    }
  }

  private async select(document: DocumentRow) {
    const revision = ++this.selection;
    this.selected = document;
    for (const [id, button] of this.rows)
      button.setAttribute('aria-pressed', String(id === document.id));
    this.paint(document);
    if (document.status === 'ready') this.node('.apex-state').textContent = '正在读取正文…';
    try {
      const detail = (await this.request(`/${encodeURIComponent(document.id)}`)) as DocumentRow;
      if (this.disposed || revision !== this.selection) return;
      this.selected = detail;
      this.paint(detail);
    } catch (error) {
      if (!this.disposed && revision === this.selection)
        this.node('.apex-state').textContent = this.error(error);
    }
  }

  private error(error: unknown) {
    return error instanceof Error && error.name === 'Error'
      ? error.message
      : '连接中断，请确认文档服务正在运行，然后刷新重试。';
  }

  private async refresh() {
    if (this.disposed || this.refreshing) return;
    clearTimeout(this.timer);
    this.refreshing = true;
    const button = this.node<HTMLButtonElement>('.apex-refresh');
    button.disabled = true;
    try {
      const documents = (await this.request('')) as DocumentRow[];
      if (this.disposed) return;
      if (!Array.isArray(documents) || documents.some((d) => typeof d.id !== 'string'))
        throw new Error('文档服务返回异常，请稍后重试。');
      const list = this.node('.apex-list');
      this.node('.apex-list-message').textContent = documents.length
        ? ''
        : '还没有文档，选择文件开始上传。';
      const ids = new Set(documents.map((d) => d.id));
      for (const [id, row] of this.rows)
        if (!ids.has(id)) {
          row.remove();
          this.rows.delete(id);
        }
      for (const [index, document] of documents.entries()) {
        let row = this.rows.get(document.id);
        if (!row) {
          row = window.document.createElement('button');
          row.type = 'button';
          row.className = 'apex-row';
          row.append(
            window.document.createElement('strong'),
            window.document.createElement('span'),
          );
          this.rows.set(document.id, row);
        }
        row.onclick = () => void this.select(document);
        row.children[0].textContent = document.fileName;
        row.children[1].textContent = labels[document.status] ?? '状态待更新';
        row.dataset.status = document.status;
        row.setAttribute('aria-pressed', String(this.selected?.id === document.id));
        if (list.children[index] !== row) list.insertBefore(row, list.children[index] ?? null);
      }
      if (this.selected) {
        const next = documents.find((d) => d.id === this.selected!.id);
        if (
          next &&
          (pending(this.selected.status) ||
            next.status !== this.selected.status ||
            this.selected.text === undefined)
        )
          await this.select(next);
        else if (!next && pending(this.selected.status)) await this.select(this.selected);
      }
    } catch (error) {
      if (!this.disposed) this.node('.apex-list-message').textContent = this.error(error);
    } finally {
      this.refreshing = false;
      if (!this.disposed) {
        button.disabled = false;
        this.timer = setTimeout(() => {
          if (document.hidden) this.timer = setTimeout(() => void this.refresh(), 5000);
          else void this.refresh();
        }, 3000);
      }
    }
  }

  private async upload() {
    if (this.busy || this.disposed) return;
    const input = this.node<HTMLInputElement>('#apex-file');
    const file = input.files?.[0];
    if (!file || file.size === 0) {
      this.feedback('请选择一份非空文件。');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      this.feedback('文件超过 20 MiB，请选择较小的文件。');
      return;
    }
    this.busy = true;
    input.disabled = true;
    const button = this.node<HTMLButtonElement>('[type="submit"]');
    button.disabled = true;
    button.textContent = '正在上传…';
    this.feedback('正在保存文件，请保持窗口打开。');
    const body = new FormData();
    body.set('file', file);
    try {
      const uploaded = (await this.request('', { method: 'POST', body })) as DocumentRow;
      if (this.disposed) return;
      input.value = '';
      this.feedback('上传成功，文件已保存。处理进度会自动更新。');
      await this.select(uploaded);
      await this.refresh();
    } catch (error) {
      if (!this.disposed)
        this.feedback(
          `${this.error(error)} 若连接在上传途中断开，请先刷新列表确认是否已保存，再决定是否重新上传。`,
        );
    } finally {
      this.busy = false;
      if (!this.disposed) {
        input.disabled = false;
        button.disabled = false;
        button.textContent = '上传文档 ↑';
      }
    }
  }

  dispose() {
    this.disposed = true;
    this.selection++;
    clearTimeout(this.timer);
    this.controller.abort();
  }
}
