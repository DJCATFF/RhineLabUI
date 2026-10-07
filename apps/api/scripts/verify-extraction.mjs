import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { Client } from 'minio';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { pdf, docx } from './extraction-fixtures.mjs';

dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const api = process.env.API_URL ?? 'http://127.0.0.1:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(api).hostname)) throw new Error('Local API only');
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
const documents = [];
const extraJobs = [];
let worker;
let failures = 0;
let hang = false;
let requests = 0;
// Controlled proxy: real Tika for success, deterministic failures for recovery tests.
const proxy = createServer(async (req, res) => {
  try {
    requests++;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (hang) return;
    if (failures > 0) {
      failures--;
      res.writeHead(503);
      res.end('verification outage');
      return;
    }
    const upstream = await fetch(`${process.env.TIKA_URL}/tika`, {
      method: 'PUT',
      headers: { Accept: 'text/plain', 'Content-Type': 'application/octet-stream' },
      body: Buffer.concat(chunks),
      signal: AbortSignal.timeout(60000),
    });
    res.writeHead(upstream.status);
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    res.writeHead(502);
    res.end();
  }
});
async function waitFor(predicate, message, timeout = 120000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await predicate()) return;
    await delay(500);
  }
  throw new Error(message);
}
async function startWorker() {
  worker = spawn(process.execPath, ['dist/worker.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, TIKA_URL: `http://127.0.0.1:${proxy.address().port}` },
    windowsHide: true,
    stdio: 'ignore',
  });
  await waitFor(async () => {
    assert.equal(worker.exitCode, null, 'Worker exited');
    return (await queue.getWorkers()).length > 0;
  }, 'Worker startup timed out');
}
async function stopWorker() {
  if (!worker || worker.exitCode !== null) return;
  const exited = once(worker, 'exit');
  worker.kill('SIGKILL');
  await exited;
  worker = undefined;
}
async function upload(name, content) {
  const body = new FormData();
  body.set('file', new Blob([content]), name);
  const response = await fetch(`${api}/api/documents`, { method: 'POST', body });
  assert.equal(response.status, 201);
  const document = await response.json();
  documents.push(document);
  return document;
}
async function finished(document, status = 'ready') {
  await waitFor(async () => {
    const row = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
    const state = await (await queue.getJob(document.id))?.getState();
    return row.status === status && state === (status === 'ready' ? 'completed' : 'failed');
  }, `Document did not become ${status}`);
  return prisma.document.findUniqueOrThrow({ where: { id: document.id } });
}
try {
  assert.equal((await fetch(`${api}/api/health`)).status, 200);
  assert.equal(
    (await queue.getWorkers()).length,
    0,
    'Stop other workers before this controlled test',
  );
  assert.equal(await queue.getWaitingCount(), 0, 'Existing waiting jobs must be processed first');
  assert.equal(await queue.getDelayedCount(), 0, 'Existing delayed jobs must be processed first');
  assert.equal(await queue.getActiveCount(), 0, 'Existing active jobs must finish first');
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  await startWorker();
  const txt = await upload('抽取验证.txt', '\ufeffAPEX 中文正文验证。');
  const result = await finished(txt);
  assert.ok(result.text.includes('中文正文验证'));
  const detail = await (await fetch(`${api}/api/documents/${txt.id}`)).json();
  assert.equal(detail.text, result.text);
  const list = await (await fetch(`${api}/api/documents`)).json();
  assert.ok(
    !Object.hasOwn(
      list.find((row) => row.id === txt.id),
      'text',
    ),
  );
  assert.equal((await fetch(`${api}/api/documents/not-found-verification`)).status, 404);
  const html = await upload(
    'extraction.html',
    '<html><meta charset="utf-8"><body>APEX HTML 正文</body></html>',
  );
  assert.ok((await finished(html)).text.includes('HTML 正文'));
  assert.ok(
    (await finished(await upload('extraction.pdf', pdf))).text.includes(
      'APEX PDF extraction verification',
    ),
  );
  assert.ok(
    (await finished(await upload('extraction.docx', docx))).text.includes('APEX DOCX 中文验证'),
  );
  console.log('PASS: TXT, HTML, PDF and DOCX through real Tika.');
  const duplicate = await queue.add('extract-text', { documentId: txt.id, objectKey: 'ignored' });
  extraJobs.push(duplicate.id);
  await waitFor(
    async () => (await duplicate.getState()) === 'completed',
    'Duplicate did not finish',
  );
  assert.equal(
    (await prisma.document.findUniqueOrThrow({ where: { id: txt.id } })).extractionAttempts,
    1,
  );
  failures = 2;
  const retry = await upload('retry.txt', 'retry success');
  assert.equal((await finished(retry)).extractionAttempts, 3);
  console.log('PASS: automatic retry after two Tika failures.');
  failures = 99;
  const failed = await upload('failure.txt', 'failed extraction');
  assert.equal((await finished(failed, 'failed')).extractionAttempts, 3);
  assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: failed.id } })).text, null);
  failures = 0;
  hang = true;
  const before = requests;
  const interrupted = await upload('restart.txt', 'recovered after process termination');
  await waitFor(() => requests > before, 'Worker did not start interrupted request');
  await stopWorker();
  proxy.closeAllConnections();
  hang = false;
  await startWorker();
  const recovered = await finished(interrupted);
  assert.ok(recovered.text.includes('recovered after process termination'));
  assert.equal(recovered.extractionAttempts, 2);
  console.log(
    'PASS: real TXT/HTML/PDF/DOCX extraction, detail/list, duplicate delivery, automatic retry, terminal failure, active worker crash and restart recovery.',
  );
} finally {
  await stopWorker();
  proxy.closeAllConnections();
  await new Promise((resolve) => proxy.close(resolve));
  for (const id of extraJobs) await (await queue.getJob(id))?.remove();
  for (const document of documents) {
    const job = await queue.getJob(document.id);
    // A failing crash test can leave an active lock. Retain its data for diagnosis.
    if (job && (await job.getState()) === 'active') {
      console.error(`Retained interrupted test document: ${document.id}`);
      continue;
    }
    await job?.remove();
    await prisma.document.delete({ where: { id: document.id } });
    await storage.removeObject(process.env.MINIO_BUCKET, document.objectKey);
  }
  await queue.close();
  redis.disconnect();
  await prisma.$disconnect();
}
