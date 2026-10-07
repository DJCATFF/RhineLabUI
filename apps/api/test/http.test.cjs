const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const { Module, Logger } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { DocumentsController } = require('../dist/documents/documents.controller');
const { DocumentsService } = require('../dist/documents/documents.service');
const { HealthController } = require('../dist/health/health.controller');

test('real multipart route rejects over-limit and multiple files before service writes', async () => {
  let writes = 0;
  class TestModule {}
  Module({
    controllers: [DocumentsController],
    providers: [
      {
        provide: DocumentsService,
        useValue: {
          upload: async () => {
            writes++;
            return { status: 'uploaded' };
          },
          findAll: async () => [],
        },
      },
    ],
  })(TestModule);
  Logger.overrideLogger(false);
  const app = await NestFactory.create(TestModule, { logger: false });
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  const url = `${await app.getUrl()}/api/documents`;
  try {
    const oversized = new FormData();
    oversized.set('file', new Blob([new Uint8Array(20 * 1024 * 1024 + 1)]), 'large.bin');
    assert.equal((await fetch(url, { method: 'POST', body: oversized })).status, 413);
    const multiple = new FormData();
    multiple.append('file', new Blob(['one']), 'one.txt');
    multiple.append('file', new Blob(['two']), 'two.txt');
    assert.equal((await fetch(url, { method: 'POST', body: multiple })).status, 400);
    const extra = new FormData();
    extra.set('title', 'unexpected');
    assert.equal((await fetch(url, { method: 'POST', body: extra })).status, 400);
    assert.equal(writes, 0);
    const valid = new FormData();
    valid.set('file', new Blob(['test']), 'sample.txt');
    assert.equal((await fetch(url, { method: 'POST', body: valid })).status, 201);
    assert.equal(writes, 1);
  } finally {
    await app.close();
  }
});

test('health exposes dependency status and returns 503 when Redis fails', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, text: async () => 'Tika test' });
  try {
    const controller = new HealthController(
      { $queryRaw: async () => [1] },
      {
        redis: {
          ping: async () => {
            throw new Error('offline');
          },
        },
        storage: { listBuckets: async () => [] },
      },
      { getOrThrow: () => 'http://unused' },
    );
    await assert.rejects(controller.check(), (error) => {
      assert.equal(error.getStatus(), 503);
      assert.deepEqual(error.getResponse().checks, {
        database: 'ok',
        redis: 'unavailable',
        storage: 'ok',
        tika: 'ok',
      });
      return true;
    });
  } finally {
    global.fetch = originalFetch;
  }
});
