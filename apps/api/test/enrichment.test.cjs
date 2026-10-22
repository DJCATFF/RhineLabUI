const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const {
  EnrichmentService,
  documentCategories,
  parseRefinement,
} = require('../dist/worker/enrichment.service');

function config(values = {}) {
  return { get: (key) => values[key] };
}

async function serve(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    values: (model = 'test-model') => ({
      LLM_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`,
      LLM_API_KEY: 'secret-key',
      LLM_MODEL: model,
    }),
  };
}

const reply = (res, content) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content } }] }));
};

test('parses JSON wrapped in code fences and clamps the field sizes', () => {
  const parsed = parseRefinement(
    '```json\n{"summary":"  一份架构方案  ","keyPoints":["一","","二"],"tags":[" 技术 ","技术","#架构 "],"category":"技术工程"}\n```',
  );
  assert.deepEqual(parsed, {
    summary: '一份架构方案',
    keyPoints: ['一', '二'],
    tags: ['技术', '#架构'],
    category: '技术工程',
  });
});

test('rejects responses without a usable summary or a known category', () => {
  assert.equal(parseRefinement('not json'), null);
  assert.equal(parseRefinement('{"summary":"","category":"其他"}'), null);
  assert.equal(parseRefinement('{"summary":"摘要","category":"未知分类"}'), null);
  assert.equal(parseRefinement('{"summary":"摘要","category":"其他"}').category, '其他');
});

test('stays inert when the LLM is not configured', async (t) => {
  const api = await serve(t, () => assert.fail('LLM must not be called'));
  for (const values of [
    {},
    { LLM_BASE_URL: api.url, LLM_API_KEY: 'k' },
    { LLM_BASE_URL: api.url, LLM_API_KEY: 'k', LLM_MODEL: '  ' },
  ]) {
    const service = new EnrichmentService(config(values));
    assert.equal(await service.refine('正文'), null);
  }
});

test('posts to an OpenAI-compatible endpoint and returns the refinement', async (t) => {
  let seen;
  const api = await serve(t, (req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer secret-key');
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      seen = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      reply(res, JSON.stringify({
        summary: '季度财务复盘。',
        keyPoints: ['收入增长', '成本下降'],
        tags: ['财务', '季度'],
        category: '商务财务',
      }));
    });
  });
  const service = new EnrichmentService(config(api.values('deepseek-chat')));
  const outcome = await service.refine('第三季度财报正文');
  assert.equal(seen.model, 'deepseek-chat');
  assert.equal(seen.messages.length, 2);
  assert.equal(outcome.error, null);
  assert.equal(outcome.refinement.category, '商务财务');
  assert.deepEqual(outcome.refinement.tags, ['财务', '季度']);
});

test('retries once on a transient failure', async (t) => {
  let requests = 0;
  const api = await serve(t, (req, res) => {
    req.resume();
    if (++requests === 1) {
      res.writeHead(503);
      res.end('busy');
      return;
    }
    reply(res, '{"summary":"恢复后的摘要","keyPoints":[],"tags":[],"category":"其他"}');
  });
  const service = new EnrichmentService(config(api.values()));
  const outcome = await service.refine('正文');
  assert.equal(requests, 2);
  assert.equal(outcome.refinement.summary, '恢复后的摘要');
});

test('does not retry a rejected request and never echoes the response body', async (t) => {
  let requests = 0;
  const api = await serve(t, (req, res) => {
    requests++;
    req.resume();
    res.writeHead(401);
    res.end('secret provider detail');
  });
  const service = new EnrichmentService(config(api.values()));
  const outcome = await service.refine('正文');
  assert.equal(requests, 1);
  assert.equal(outcome.refinement, null);
  assert.equal(outcome.error, 'LLM returned HTTP 401');
});

test('reports unusable model output after the second attempt', async (t) => {
  let requests = 0;
  const api = await serve(t, (req, res) => {
    requests++;
    req.resume();
    reply(res, '抱歉，我无法回答。');
  });
  const service = new EnrichmentService(config(api.values()));
  const outcome = await service.refine('正文');
  assert.equal(requests, 2);
  assert.equal(outcome.refinement, null);
  assert.match(outcome.error, /unusable/);
});

test('every generated category is an archive column', () => {
  assert.deepEqual(documentCategories, ['技术工程', '研究报告', '商务财务', '个人资料', '其他']);
});
