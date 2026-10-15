import assert from 'node:assert/strict';
import { archiveRecords, documentColumns } from '../src/document-archive.ts';
import { installDocumentArchive, records, columnFiles, fileLocation } from '../src/data.ts';
import { fileAtCell, selectionCell, rowRebaseShift } from '../src/archive-loop.ts';

const documents = Array.from({ length: 45 }, (_, i) => ({
  id: `test-${i}`,
  archiveNumber: i + 21,
  fileName: `资料${i}.${i < 35 ? 'pdf' : 'docx'}`,
  createdAt: '2026-10-15T00:00:00Z',
}));
installDocumentArchive(archiveRecords(documents.reverse()), documentColumns);
assert.equal(columnFiles(0).length, 35);
assert.equal(columnFiles(1).length, 10);
assert.equal(records.filter((r) => r.empty).length, 3);
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
assert.equal(fileAtCell(selectionCell(0, { lane: 0, row: 46 }, { axis: 'row', direction: 1 })), 0);
installDocumentArchive(archiveRecords([]), documentColumns);
assert.equal(records.length, 5);
assert.ok(records.every((r) => r.empty && !r.documentId));
console.log(
  'PASS: 35 PDF / 10 Word documents, stable IDs, empty columns, selection beyond 32 rows, wrapping and shared rebase period.',
);
