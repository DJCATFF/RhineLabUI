import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { Client } from 'minio';

dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

const target = process.argv[2] ?? 'legacy-documents.json';
const absoluteTarget = resolve(target);
const bundleName = `${basename(target, extname(target))}.originals`;
const bundleDir = resolve(dirname(absoluteTarget), bundleName);

const prisma = new PrismaClient();
const storage = new Client({
  endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
  port: Number(process.env.MINIO_PORT ?? 9000),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY ?? '',
  secretKey: process.env.MINIO_SECRET_KEY ?? '',
});
const bucket = process.env.MINIO_BUCKET ?? 'apex-documents';

/** 下载单个原件并按旧库登记的 sha256 校验；失败时删除半成品。 */
async function downloadOriginal(document) {
  const ext = extname(document.fileName ?? '').toLowerCase();
  const name = `${document.id}${ext}`;
  const relative = `${bundleName}/${name}`;
  const destination = resolve(dirname(absoluteTarget), relative);
  const existing = await stat(destination).catch(() => null);
  if (existing?.isFile() && (!document.size || existing.size === document.size)) {
    return { relative, bytes: existing.size };
  }

  await mkdir(bundleDir, { recursive: true });
  const temp = `${destination}.part`;
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    const stream = await storage.getObject(bucket, document.objectKey);
    await pipeline(
      stream,
      new Transform({
        transform(chunk, _encoding, callback) {
          hash.update(chunk);
          bytes += chunk.length;
          callback(null, chunk);
        },
      }),
      createWriteStream(temp),
    );
    const digest = hash.digest('hex');
    if (document.sha256 && digest !== document.sha256) {
      throw new Error(`sha256 不一致：${digest}`);
    }
    if (document.size && bytes !== document.size) {
      throw new Error(`大小不一致：${bytes} / ${document.size}`);
    }
    await rm(destination, { force: true });
    await rename(temp, destination);
    return { relative, bytes };
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

try {
  const documents = await prisma.document.findMany({ orderBy: { archiveNumber: 'asc' } });
  const exported = [];
  let originals = 0;
  let missing = 0;

  for (const document of documents) {
    let localFile = null;
    if (document.objectKey) {
      try {
        const saved = await downloadOriginal(document);
        localFile = saved.relative;
        originals += 1;
      } catch (error) {
        missing += 1;
        console.warn(`LEGACY_ORIGINAL_FAILED ${document.archiveNumber} ${error.message}`);
      }
    } else {
      missing += 1;
    }

    exported.push({
      id: document.id,
      archiveNumber: document.archiveNumber,
      title: document.title,
      fileName: document.fileName,
      mimeType: document.mimeType,
      size: document.size,
      objectKey: document.objectKey,
      sha256: document.sha256,
      localFile,
      text: document.text,
      summary: document.summary,
      keyPoints: document.keyPoints,
      tags: document.tags,
      category: document.category,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
    });
  }

  const payload = {
    format: 'rhine-legacy-documents',
    version: 2,
    exportedAt: new Date().toISOString(),
    documents: exported,
  };
  await writeFile(absoluteTarget, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  const withText = documents.filter((document) => document.text).length;
  console.log(
    `LEGACY_EXPORT ${absoluteTarget} documents=${documents.length} withText=${withText} originals=${originals} missing=${missing}`,
  );
} finally {
  await prisma.$disconnect();
}
