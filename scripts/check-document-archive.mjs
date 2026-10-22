import assert from 'node:assert/strict';
import { archiveRecords, documentColumns, documentCategory } from '../src/document-archive.ts';
import { installDocumentArchive, records, columnFiles, fileLocation } from '../src/data.ts';
import { fileAtCell, selectionCell, rowRebaseShift } from '../src/archive-loop.ts';

const createdAt = '2026-10-15T00:00:00Z';
// Enough unnamed documents to keep one column wider than the 32 visible rows.
const bulk = Array.from({ length: 35 }, (_, i) => ({
  id: `bulk-${i}`,
  archiveNumber: 31 + i,
  fileName: `资料${i}.pdf`,
  createdAt,
}));
const documents = [
  { id: 'tech-0', archiveNumber: 21, fileName: '系统架构评审.pdf', createdAt },
  { id: 'tech-1', archiveNumber: 22, fileName: '接口设计说明.pdf', createdAt },
  { id: 'research-0', archiveNumber: 23, fileName: '年度研究报告.pdf', createdAt },
  { id: 'research-1', archiveNumber: 24, fileName: '市场调研分析.pdf', createdAt },
  // An assigned category wins over the file name, which is how the pipeline will shelve.
  { id: 'assigned-0', archiveNumber: 25, fileName: '未命名材料.pdf', category: '研究报告', createdAt },
  { id: 'assigned-1', archiveNumber: 26, fileName: '扫描件.pdf', category: '研究报告', createdAt },
  { id: 'business-0', archiveNumber: 27, fileName: '采购合同.docx', createdAt },
  { id: 'business-1', archiveNumber: 28, fileName: '差旅报销发票.pdf', createdAt },
  { id: 'personal-0', archiveNumber: 29, fileName: '个人简历.pdf', createdAt },
  { id: 'personal-1', archiveNumber: 30, fileName: '护照扫描.pdf', createdAt },
  ...bulk,
];
installDocumentArchive(archiveRecords(documents.reverse()), documentColumns);

assert.equal(documentColumns.length, 5);
assert.equal(documentCategory({ fileName: '架构方案.pdf' }), 0);
assert.equal(documentCategory({ fileName: '体检报告.pdf' }), 3);
assert.equal(documentCategory({ fileName: '年度报告.pdf' }), 1);
assert.equal(documentCategory({ fileName: '扫描件.pdf', category: '商务财务' }), 2);
assert.equal(documentCategory({ fileName: '扫描件.pdf', category: '不存在的分类' }), 4);
assert.equal(columnFiles(0).length, 2);
assert.equal(columnFiles(1).length, 4);
assert.equal(columnFiles(2).length, 2);
assert.equal(columnFiles(3).length, 2);
assert.equal(columnFiles(4).length, 35);
assert.equal(records.filter((r) => r.empty).length, 0);
assert.equal(records[0].id, 'D-021');
for (let i = 0; i < records.length; i++) {
  assert.equal(fileAtCell(fileLocation(i)), i);
  assert.equal(fileAtCell(selectionCell(i, { lane: 0, row: 3200 })), i);
}
for (const row of [-3500, 3500]) {
  const shift = rowRebaseShift(row);
  assert.notEqual(shift, 0);
  for (let lane = 0; lane < 5; lane++)
    assert.equal(fileAtCell({ lane, row }), fileAtCell({ lane, row: row - shift }));
}
// Column 0 holds two documents, so stepping down from its last row wraps to the first.
assert.equal(fileAtCell(selectionCell(0, { lane: 0, row: 13 }, { axis: 'row', direction: 1 })), 0);
installDocumentArchive(archiveRecords([]), documentColumns);
assert.equal(records.length, 5);
assert.ok(records.every((r) => r.empty && !r.documentId));
console.log(
  'PASS: content columns, assigned category precedence, stable IDs, empty columns, selection beyond 32 rows, wrapping and shared rebase period.',
);
