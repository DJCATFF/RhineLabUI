const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');
const { createServer } = require('node:http');
const { ExtractionService } = require('../dist/worker/extraction.service');

async function setup(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const bytes = Buffer.from('中文 document');
  const row = {
    id: 'doc',
    status: 'uploaded',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    objectKey: 'trusted-key',
    extractionAttempts: 0,
  };
  const prisma = {
    document: {
      findUnique: async () => row,
      update: async ({ data }) => {
        const { extractionAttempts, ...rest } = data;
        Object.assign(row, rest);
        if (extractionAttempts) row.extractionAttempts += extractionAttempts.increment;
        return row;
      },
    },
  };
  prisma.document.updateMany = async ({ where, data }) => {
    if (where.status?.not === row.status) return { count: 0 };
    if (where.status?.in && !where.status.in.includes(row.status)) return { count: 0 };
    await prisma.document.update({ data });
    return { count: 1 };
  };
  const infra = {
    bucket: 'test',
    storage: {
      getObject: async (_, key) => {
        assert.equal(key, 'trusted-key');
        return Readable.from([bytes]);
      },
    },
  };
  const service = new ExtractionService(prisma, infra, {
    getOrThrow: () => `http://127.0.0.1:${server.address().port}`,
  });
  const job = {
    name: 'extract-text',
    data: { documentId: 'doc', objectKey: 'untrusted' },
    attemptsMade: 0,
    opts: { attempts: 3 },
  };
  return { service, row, job, infra };
}

test('extracts UTF-8, removes database-invalid NUL, and skips duplicate completed jobs', async (t) => {
  let requests = 0;
  const c = await setup(t, (req, res) => {
    requests++;
    assert.equal(req.method, 'PUT');
    assert.equal(req.url, '/tika');
    req.resume();
    res.end('正文\0\n');
  });
  await c.service.process(c.job);
  await c.service.process(c.job);
  assert.equal(c.row.text, '正文\n');
  assert.equal(c.row.status, 'ready');
  assert.equal(c.row.extractionAttempts, 1);
  assert.equal(requests, 1);
});

test('temporary Tika failure retries; final attempt persists a sanitized failure', async (t) => {
  const c = await setup(t, (req, res) => {
    req.resume();
    res.writeHead(503);
    res.end('private upstream detail');
  });
  await assert.rejects(c.service.process(c.job), /HTTP 503/);
  assert.equal(c.row.status, 'retrying');
  c.job.attemptsMade = 2;
  await assert.rejects(c.service.process(c.job), /HTTP 503/);
  assert.equal(c.row.status, 'failed');
  assert.equal(c.row.extractionError, 'Tika returned HTTP 503');
  assert.equal(c.row.text, undefined);
});

test('rejects oversized extracted text without persisting partial output', async (t) => {
  const c = await setup(t, (req, res) => {
    req.resume();
    res.end(Buffer.alloc(2 * 1024 * 1024 + 1, 65));
  });
  await assert.rejects(c.service.process(c.job), /2 MiB/);
  assert.equal(c.row.text, undefined);
});

test('checks stored original integrity before calling Tika', async (t) => {
  const c = await setup(t, () => assert.fail('Tika must not be called'));
  c.row.sha256 = 'incorrect';
  await assert.rejects(c.service.process(c.job), /integrity/);
});

test('empty extraction is a completed result, not an infinite retry', async (t) => {
  const c = await setup(t, (req, res) => {
    req.resume();
    res.writeHead(204);
    res.end();
  });
  await c.service.process(c.job);
  assert.equal(c.row.status, 'ready');
  assert.equal(c.row.text, '');
});

test('a stale failed attempt cannot overwrite a completed document', async (t) => {
  let context;
  context = await setup(t, (req, res) => {
    req.resume();
    context.row.status = 'ready';
    context.row.text = 'already completed';
    res.writeHead(503);
    res.end();
  });
  await assert.rejects(context.service.process(context.job), /HTTP 503/);
  assert.equal(context.row.status, 'ready');
  assert.equal(context.row.text, 'already completed');
});

test('exhausted stalled jobs reconcile to failed without overwriting ready documents', async (t) => {
  const c = await setup(t, () => {});
  c.infra.queue = { getFailed: async () => [{ data: { documentId: 'doc' } }] };
  c.row.status = 'processing';
  await c.service.reconcileFailures();
  assert.equal(c.row.status, 'failed');
  c.row.status = 'ready';
  await c.service.reconcileFailures();
  assert.equal(c.row.status, 'ready');
});
