import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { Client } from 'minio';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const api = process.env.API_URL ?? 'http://127.0.0.1:3000';
const prisma = new PrismaClient();
const storage = new Client({
  endPoint: process.env.MINIO_ENDPOINT,
  port: Number(process.env.MINIO_PORT),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY,
});
const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 });
const queue = new Queue('documents', { connection: redis });
let uploaded;
try {
  const health = await fetch(`${api}/api/health`, { signal: AbortSignal.timeout(10000) });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');
  assert.equal((await fetch(`${api}/api/docs`)).status, 200);
  const extensions =
    await prisma.$queryRaw`SELECT extname FROM pg_extension WHERE extname = 'vector'`;
  assert.equal(extensions.length, 1);
  const bytes = Buffer.from('APEX verification: 文档上传、原始文件校验。');
  const body = new FormData();
  body.set('file', new Blob([bytes], { type: 'text/plain' }), 'APEX-中文验证.txt');
  const response = await fetch(`${api}/api/documents`, { method: 'POST', body });
  assert.equal(response.status, 201);
  uploaded = await response.json();
  assert.equal(uploaded.status, 'uploaded');
  assert.equal(uploaded.fileName, 'APEX-中文验证.txt');
  assert.equal(uploaded.sha256, createHash('sha256').update(bytes).digest('hex'));
  const persisted = await prisma.document.findUniqueOrThrow({ where: { id: uploaded.id } });
  assert.equal(persisted.size, bytes.length);
  const stream = await storage.getObject(process.env.MINIO_BUCKET, uploaded.objectKey);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), bytes);
  const job = await queue.getJob(uploaded.id);
  assert.equal(job?.name, 'extract-text');
  assert.equal(job?.data.documentId, uploaded.id);
  const listing = await (await fetch(`${api}/api/documents`)).json();
  assert.ok(listing.some((document) => document.id === uploaded.id));
  assert.equal(
    (await fetch(`${api}/api/documents`, { method: 'POST', body: new FormData() })).status,
    400,
  );
  const empty = new FormData();
  empty.set('file', new Blob([]), 'empty.txt');
  assert.equal((await fetch(`${api}/api/documents`, { method: 'POST', body: empty })).status, 400);
  const oversized = new FormData();
  oversized.set('file', new Blob([new Uint8Array(20 * 1024 * 1024 + 1)]), 'large.txt');
  assert.equal(
    (await fetch(`${api}/api/documents`, { method: 'POST', body: oversized })).status,
    413,
  );
  console.log(
    'PASS: health, Swagger, pgvector, upload, stored bytes, database, queue, listing, missing/empty/oversized file rejection.',
  );
} finally {
  // Remove only data created by this verification, never user documents or volumes.
  if (uploaded?.id) {
    await (await queue.getJob(uploaded.id))?.remove();
    await prisma.document.delete({ where: { id: uploaded.id } });
    await storage.removeObject(process.env.MINIO_BUCKET, uploaded.objectKey);
  }
  await queue.close();
  redis.disconnect();
  await prisma.$disconnect();
}
