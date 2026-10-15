import type { ArchiveRecord } from './data.ts';
import type { DocumentRow } from './document-api.ts';

export const documentColumns = ['PDF 文档', 'Word 文档', '表格文档', '演示文稿', '其他文档'];
export function documentLane(fileName: string) {
  const extension = fileName.split('.').at(-1)?.toLowerCase();
  if (extension === 'pdf') return 0;
  if (extension === 'doc' || extension === 'docx') return 1;
  if (['xls', 'xlsx', 'csv', 'ods'].includes(extension ?? '')) return 2;
  if (['ppt', 'pptx', 'odp'].includes(extension ?? '')) return 3;
  return 4;
}
export function archiveRecords(documents: DocumentRow[]): ArchiveRecord[] {
  const result: ArchiveRecord[] = [];
  for (const [lane, category] of documentColumns.entries()) {
    const items = documents
      .filter((doc) => documentLane(doc.fileName) === lane)
      .sort((a, b) => a.archiveNumber - b.archiveNumber);
    for (const doc of items)
      result.push({
        id: `D-${String(doc.archiveNumber).padStart(3, '0')}`,
        documentId: doc.id,
        title: doc.title || doc.fileName,
        en: 'DOCUMENT ARCHIVE',
        category,
        department: category,
        date: doc.createdAt.slice(0, 10),
        lead: '本地上传',
        clearance: 'LOCAL DOCUMENT',
        abstract: '原件已保存，打开档案可查看处理状态、阅读正文或下载原文件。',
        findings: [],
        source: '',
      });
    if (!items.length)
      result.push({
        id: `E-${String(lane).padStart(3, '0')}`,
        empty: true,
        title: '此分类暂无文档',
        en: 'EMPTY COLLECTION',
        category,
        department: category,
        date: '',
        lead: '',
        clearance: 'EMPTY',
        abstract: '',
        findings: [],
        source: '',
      });
  }
  return result;
}
