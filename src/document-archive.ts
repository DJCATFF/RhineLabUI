import type { ArchiveRecord } from './data.ts';
import type { DocumentRow } from './document-api.ts';

// The 3D archive renders one column per category, so the taxonomy stays small and
// the names stay short enough to read on a column header.
export const documentColumns = ['技术工程', '研究报告', '商务财务', '个人资料', '其他'];

// Placeholder classifier until the ingest pipeline assigns a content category.
// The first matching rule wins, so narrow domains are tested before broad ones:
// "体检报告" must reach 个人资料 rather than the generic 报告 rule.
const categoryRules: { lane: number; keywords: string[] }[] = [
  {
    lane: 0,
    keywords: [
      '技术', '架构', '接口', '代码', '开发', '部署', '数据库', '系统',
      '方案', '设计', 'api', 'sdk',
    ],
  },
  {
    lane: 2,
    keywords: ['合同', '协议', '发票', '报价', '预算', '财务', '采购', '报销', '账单', '付款'],
  },
  { lane: 3, keywords: ['简历', '证书', '证明', '护照', '体检', '保险', '个人', '证件'] },
  {
    lane: 1,
    keywords: ['研究', '报告', '论文', '分析', '调研', '白皮书', '综述', '实验', '数据'],
  },
];
const otherLane = documentColumns.length - 1;

export function documentCategory(
  document: Pick<DocumentRow, 'category' | 'title' | 'fileName'>,
) {
  // An assigned category always wins; this is the seam the ingest pipeline fills.
  const assigned = documentColumns.indexOf(document.category?.trim() ?? '');
  if (assigned >= 0) return assigned;
  const haystack = `${document.title ?? ''} ${document.fileName}`.toLowerCase();
  return (
    categoryRules.find(({ keywords }) => keywords.some((word) => haystack.includes(word)))
      ?.lane ?? otherLane
  );
}

export function archiveRecords(documents: DocumentRow[]): ArchiveRecord[] {
  const result: ArchiveRecord[] = [];
  for (const [lane, category] of documentColumns.entries()) {
    const items = documents
      .filter((doc) => documentCategory(doc) === lane)
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
