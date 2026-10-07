const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DocumentsService } = require('../dist/documents/documents.service');

function setup() {
  const rows = [];
  const objects = new Map();
  const jobs = new Map();
  const state = { databaseFails: false, queueFails: false, storageFails: false };
  const prisma = {
    document: {
      create: async ({ data }) => {
        if (state.databaseFails) throw new Error('database offline');
        const row = { id: 'test-document', queuedAt: null, ...data };
        rows.push(row);
        return row;
      },
      findMany: async () => rows.filter((row) => !row.queuedAt),
      findUnique: async ({ where }) => rows.find((row) => row.id === where.id),
      update: async ({ where, data }) =>
        Object.assign(
          rows.find((row) => row.id === where.id),
          data,
        ),
    },
  };
  const infra = {
    bucket: 'test',
    ensureBucket: async () => {},
    storage: {
      putObject: async (_, key, buffer) => {
        if (state.storageFails) throw new Error('offline');
        objects.set(key, buffer);
      },
      removeObject: async (_, key) => objects.delete(key),
    },
    queue: {
      add: async (name, data, options) => {
        if (state.queueFails) throw new Error('redis offline');
        jobs.set(options.jobId, { name, data });
      },
    },
  };
  return { service: new DocumentsService(prisma, infra), rows, objects, jobs, state };
}
const file = {
  originalname: 'sample.txt',
  mimetype: 'text/plain',
  size: 5,
  buffer: Buffer.from('hello'),
};

test('browser UTF-8 filenames retain Chinese characters', async () => {
  const context = setup();
  const result = await context.service.upload({
    ...file,
    originalname: Buffer.from('中文.txt').toString('latin1'),
  });
  assert.equal(result.fileName, '中文.txt');
});

test('reject missing and empty files before writing storage', async () => {
  const context = setup();
  await assert.rejects(context.service.upload(), (error) => error.getStatus() === 400);
  await assert.rejects(
    context.service.upload({ ...file, size: 0 }),
    (error) => error.getStatus() === 400,
  );
  assert.equal(context.objects.size, 0);
});

test('upload saves original, metadata and extract-text job with stable ID', async () => {
  const context = setup();
  const result = await context.service.upload(file);
  assert.equal(result.status, 'uploaded');
  assert.ok(result.queuedAt);
  assert.equal(result.sha256, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  assert.deepEqual(context.objects.get(result.objectKey), file.buffer);
  assert.equal(context.jobs.get(result.id).name, 'extract-text');
});

test('database failure removes newly stored object and never enqueues', async () => {
  const context = setup();
  context.state.databaseFails = true;
  await assert.rejects(context.service.upload(file), (error) => error.getStatus() === 503);
  assert.equal(context.objects.size, 0);
  assert.equal(context.jobs.size, 0);
});

test('storage failure leaves database and queue untouched', async () => {
  const context = setup();
  context.state.storageFails = true;
  await assert.rejects(context.service.upload(file), (error) => error.getStatus() === 503);
  assert.equal(context.rows.length, 0);
  assert.equal(context.jobs.size, 0);
});

test('Redis outage retains upload and dispatch recovers without duplicate jobs', async () => {
  const context = setup();
  context.state.queueFails = true;
  const result = await context.service.upload(file);
  assert.equal(result.queuedAt, null);
  assert.equal(context.objects.size, 1);
  context.state.queueFails = false;
  await context.service.dispatchPending();
  await context.service.dispatchPending();
  assert.ok(result.queuedAt);
  assert.equal(context.jobs.size, 1);
});

test('database outbox survives service restart', async () => {
  const context = setup();
  context.state.queueFails = true;
  await context.service.upload(file);
  context.state.queueFails = false;
  const restarted = new DocumentsService(context.service.prisma, context.service.infra);
  await restarted.dispatchPending();
  assert.equal(context.jobs.size, 1);
  assert.ok(context.rows[0].queuedAt);
});
