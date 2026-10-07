import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { Client } from 'minio';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

const root = fileURLToPath(new URL('../../../', import.meta.url));
dotenv.config({ path: `${root}/.env`, quiet: true });
const api = process.env.API_URL ?? 'http://127.0.0.1:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(api).hostname), 'Local development only');
const prisma = new PrismaClient();
const compose = (...args) =>
  execFileSync('docker', ['compose', '--project-directory', root, ...args], { stdio: 'inherit' });
let document;
let redis;
let queue;
try {
  assert.equal(
    (await fetch(`${api}/api/health`, { signal: AbortSignal.timeout(10000) })).status,
    200,
    'Start the test only after all four dependencies are healthy',
  );
  compose('stop', 'redis');
  const health = await fetch(`${api}/api/health`, { signal: AbortSignal.timeout(10000) });
  assert.equal(health.status, 503);
  assert.equal((await health.json()).checks.redis, 'unavailable');
  const body = new FormData();
  body.set('file', new Blob(['APEX Redis recovery verification']), 'recovery-test.txt');
  const response = await fetch(`${api}/api/documents`, {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, 201);
  document = await response.json();
  assert.equal(document.queuedAt, null);
  compose('start', 'redis');
  for (let attempt = 0; attempt < 20; attempt++) {
    const row = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
    if (row.queuedAt) break;
    await delay(1000);
  }
  assert.ok((await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).queuedAt);
  redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 });
  queue = new Queue('documents', { connection: redis });
  const job = await queue.getJob(document.id);
  assert.equal(job?.name, 'extract-text');
  assert.equal((await fetch(`${api}/api/health`)).status, 200);
  console.log(
    'PASS: real Redis outage, degraded health, durable upload and automatic re-dispatch after recovery.',
  );
} finally {
  compose('start', 'redis');
  if (document?.id) {
    redis ??= new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 });
    queue ??= new Queue('documents', { connection: redis });
    await (await queue.getJob(document.id))?.remove();
    await prisma.document.delete({ where: { id: document.id } });
    const storage = new Client({
      endPoint: process.env.MINIO_ENDPOINT,
      port: Number(process.env.MINIO_PORT),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY,
      secretKey: process.env.MINIO_SECRET_KEY,
    });
    await storage.removeObject(process.env.MINIO_BUCKET, document.objectKey);
  }
  await queue?.close();
  redis?.disconnect();
  await prisma.$disconnect();
}
