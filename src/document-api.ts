export type DocumentRow = {
  id: string;
  archiveNumber: number;
  title?: string;
  fileName: string;
  /** Assigned by the ingest pipeline; the archive shelves documents by this value. */
  category?: string | null;
  size: number;
  status: string;
  createdAt: string;
  extractedAt?: string | null;
  text?: string | null;
  extractionError?: string | null;
  /** Librarian pass results; absent when no LLM is configured or the call failed. */
  summary?: string | null;
  keyPoints?: string[];
  tags?: string[];
  /** Present on single-document reads only; also false when storage is unreachable. */
  previewable?: boolean;
};
export const documentStates: Record<string, string> = {
  uploaded: '等待处理',
  processing: '正在提取正文',
  retrying: '正在自动重试',
  ready: '处理完成',
  failed: '处理失败',
};
export function originalUrl(id: string, preview = false) {
  return `/api/documents/${encodeURIComponent(id)}/file${preview ? '?preview=1' : ''}`;
}
export function archiveUrl(id?: string) {
  return `/?library=documents${id ? `&document=${encodeURIComponent(id)}` : ''}`;
}
export async function readDocument(id: string, signal?: AbortSignal): Promise<DocumentRow> {
  const response = await fetch(`/api/documents/${encodeURIComponent(id)}`, {
    cache: 'no-store',
    signal,
  });
  if (!response.ok)
    throw new Error(
      response.status === 404 ? '文档已不存在，请刷新档案库。' : '文档暂时无法读取，请稍后重试。',
    );
  return response.json();
}
export async function loadDocumentCatalog(): Promise<DocumentRow[]> {
  const documents: DocumentRow[] = [];
  let after = '';
  const seen = new Set<string>();
  while (true) {
    const response = await fetch(
      `/api/documents${after ? `?after=${encodeURIComponent(after)}` : ''}`,
      { cache: 'no-store', signal: AbortSignal.timeout(15000) },
    );
    if (!response.ok) throw new Error('文档服务暂时不可用，请确认后端已启动。');
    const page: DocumentRow[] = await response.json();
    if (
      !Array.isArray(page) ||
      page.some(
        (item) => !item.id || !Number.isSafeInteger(item.archiveNumber) || item.archiveNumber < 1,
      )
    )
      throw new Error('文档数据版本不匹配，请先更新后端并应用数据库迁移。');
    for (const item of page)
      if (!seen.has(item.id)) {
        seen.add(item.id);
        documents.push(item);
      }
    if (page.length < 100) break;
    const next = page.at(-1)!.id;
    if (next === after) throw new Error('文档分页未能继续，请重试。');
    after = next;
  }
  return documents;
}
