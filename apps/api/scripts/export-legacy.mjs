import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

const target = process.argv[2] ?? 'legacy-documents.json';
const prisma = new PrismaClient();

try {
  const documents = await prisma.document.findMany({ orderBy: { archiveNumber: 'asc' } });
  const payload = {
    format: 'rhine-legacy-documents',
    version: 1,
    exportedAt: new Date().toISOString(),
    documents: documents.map((document) => ({
      id: document.id,
      archiveNumber: document.archiveNumber,
      title: document.title,
      fileName: document.fileName,
      mimeType: document.mimeType,
      size: document.size,
      objectKey: document.objectKey,
      sha256: document.sha256,
      text: document.text,
      summary: document.summary,
      keyPoints: document.keyPoints,
      tags: document.tags,
      category: document.category,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
    })),
  };
  await writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  const withText = documents.filter((document) => document.text).length;
  console.log(`LEGACY_EXPORT ${target} documents=${documents.length} withText=${withText}`);
} finally {
  await prisma.$disconnect();
}
