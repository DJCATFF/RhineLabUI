// Requires local API, Worker and Vite; only this run's captured uploads are removed.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { mkdirSync } = require('node:fs');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const apiRequire = createRequire(resolve('apps/api/package.json'));
apiRequire('dotenv').config({ path: resolve('.env'), quiet: true });
const base = 'http://127.0.0.1:5173';
const created = [];
(async () => {
  const { pdf } = await import('../apps/api/scripts/extraction-fixtures.mjs');
  const browser = await chromium.launch({
    channel: process.platform === 'win32' ? 'msedge' : undefined,
    headless: true,
  });
  const fullMotion = process.env.APEX_FULL_MOTION === '1';
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: fullMotion ? 'no-preference' : 'reduce',
  });
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const enter = async () => {
    await page.getByRole('button', { name: '点击进入 →' }).click();
    if (fullMotion) await page.locator('#skip').click();
    await page.waitForFunction(() => window.rhine?.stats().mode === 'archive');
  };
  const prefix = `APEX-档案验证-${Date.now()}`;
  const upload = async (name, bytes) => {
    const body = new FormData();
    body.set('file', new Blob([bytes]), name);
    const response = await fetch(`${base}/api/documents`, { method: 'POST', body });
    assert.equal(response.status, 201);
    const row = await response.json();
    created.push(row);
    return row;
  };
  try {
    for (let i = 0; i < 33; i++) await upload(`${prefix}-${i}.pdf`, pdf);
    const txt = await upload(
      `${prefix}.txt`,
      Buffer.from('正文关键词：跨列知识测试 <img src=x onerror=alert(1)>'),
    );
    await page.goto(base);
    await enter();
    await page.getByRole('button', { name: '我的文档 ↗' }).click();
    await page
      .locator('#apex-file')
      .setInputFiles({ name: `${prefix}-浏览器.pdf`, mimeType: 'application/pdf', buffer: pdf });
    const uploaded = page.waitForResponse(
      (r) => r.url().endsWith('/api/documents') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '上传文档 ↑' }).click();
    const response = await uploaded;
    assert.equal(response.status(), 201);
    const doc = await response.json();
    created.push(doc);
    await page.locator('.apex-view-archive').waitFor();
    await page.locator('.apex-view-archive').click();
    await page.waitForURL(`**document=${doc.id}`);
    await enter();
    const code = `D-${String(doc.archiveNumber).padStart(3, '0')}`;
    await page.waitForFunction((code) => window.rhine?.stats().selected === code, code);
    assert.ok(Number(await page.locator('.count-total').textContent()) >= 34);
    assert.ok((await page.locator('.file-ticks button:not([hidden])').count()) <= 8);
    await page.locator('.read-file').click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('#document-body')
          ?.textContent.includes('APEX PDF extraction verification'),
      null,
      { timeout: 90000 },
    );
    await page.waitForFunction(
      () => Number(getComputedStyle(document.querySelector('#document-body')).opacity) > 0.99,
    );
    if (fullMotion)
      assert.equal(await page.evaluate(() => window.rhine.stats().motion.reduced), false);
    assert.ok((await page.locator('.detail-title-cn').textContent()).includes(doc.fileName));
    const download = await fetch(`${base}/api/documents/${doc.id}/file`);
    assert.equal(download.status, 200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf);
    assert.ok(
      download.headers.get('content-disposition').includes(encodeURIComponent(doc.fileName)),
    );
    const preview = await fetch(`${base}/api/documents/${doc.id}/file?preview=1`, {
      headers: { range: 'bytes=0-15' },
    });
    assert.equal(preview.status, 206);
    assert.equal(preview.headers.get('content-type'), 'application/pdf');
    assert.equal(preview.headers.get('content-range'), `bytes 0-15/${pdf.length}`);
    assert.deepEqual(Buffer.from(await preview.arrayBuffer()), pdf.subarray(0, 16));
    const invalid = await fetch(`${base}/api/documents/${doc.id}/file`, {
      headers: { range: 'bytes=999999-' },
    });
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers.get('content-range'), `bytes */${pdf.length}`);
    assert.equal((await fetch(`${base}/api/documents/${txt.id}/file?preview=1`)).status, 400);
    assert.equal((await fetch(`${base}/api/documents/missing/file`)).status, 404);
    const popupWait = page.waitForEvent('popup');
    await page.getByRole('link', { name: 'OPEN DOCUMENT / 查看 PDF ↗' }).click();
    const popup = await popupWait;
    await popup.waitForLoadState();
    await delay(3500);
    assert.ok(popup.url().includes(`/api/documents/${doc.id}/file?preview=1`));
    mkdirSync('.tools', { recursive: true });
    await popup.screenshot({ path: '.tools/apex-pdf-preview.png' });
    await popup.close();
    await page.locator('[data-action="bookmark"]').click();
    assert.equal(await page.locator('#stage').evaluate((el) => el.scrollLeft), 0);
    assert.equal(
      await page.locator('[data-action="bookmark"]').getAttribute('aria-pressed'),
      'true',
    );
    await page.screenshot({ path: '.tools/apex-real-detail.png' });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.rhine.stats().mode === 'archive');
    await page.locator('[data-action="column-next"]').click();
    assert.ok(await page.locator('.read-file').isDisabled());
    assert.equal((await page.locator('.count-total').textContent()).trim(), '00');
    await page.locator('[data-action="column-prev"]').click();
    assert.equal(await page.evaluate(() => window.rhine.stats().selected), code);
    await page.getByRole('button', { name: '我的文档 ↗' }).click();
    await page.getByRole('searchbox', { name: '搜索文档' }).fill('跨列知识测试');
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(`${prefix}\\.txt`) }).click();
    await page.waitForFunction(() =>
      document.querySelector('.apex-text')?.textContent.includes('跨列知识测试'),
    );
    assert.equal(await page.locator('.apex-text img').count(), 0);
    const results = await (
      await fetch(`${base}/api/documents?q=${encodeURIComponent('跨列知识测试')}`)
    ).json();
    assert.ok(results.some((row) => row.id === txt.id));
    assert.ok(results.every((row) => row.text === undefined));
    const first = await (await fetch(`${base}/api/documents`)).json();
    const next = await (await fetch(`${base}/api/documents?after=${first[0].id}`)).json();
    assert.equal(next[0].id, first[1].id);
    await page.setViewportSize({ width: 390, height: 844 });
    await delay(500);
    const bounds = await page.getByRole('dialog', { name: '我的文档' }).boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391);
    await page.screenshot({ path: '.tools/apex-real-mobile.png' });
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: '演示档案', exact: true }).click();
    await enter();
    await page.waitForFunction(() => window.rhine?.stats().selected === 'X-001');
    assert.equal((await page.locator('.count-total').textContent()).trim(), '08');
    assert.deepEqual(errors, []);
    console.log(
      'PASS: 34 real PDFs, browser upload → 3D target beyond row 32 → extracted text → native PDF tab/download, range/404/non-PDF errors, bookmark, empty column, column memory, Chinese body search, cursor, narrow layout and demo fallback.',
    );
  } finally {
    await browser.close();
    const { PrismaClient } = apiRequire('@prisma/client');
    const { Client } = apiRequire('minio');
    const { Queue } = apiRequire('bullmq');
    const Redis = apiRequire('ioredis');
    const prisma = new PrismaClient();
    const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 });
    const queue = new Queue('documents', { connection: redis });
    const storage = new Client({
      endPoint: process.env.MINIO_ENDPOINT,
      port: Number(process.env.MINIO_PORT),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY,
      secretKey: process.env.MINIO_SECRET_KEY,
    });
    try {
      for (const row of created) {
        const job = await queue.getJob(row.id);
        if (job && ['active', 'waiting', 'delayed'].includes(await job.getState())) {
          console.error(`Retained in-flight test document: ${row.id}`);
          continue;
        }
        await job?.remove();
        await prisma.document.delete({ where: { id: row.id } });
        await storage.removeObject(process.env.MINIO_BUCKET, row.objectKey);
      }
    } finally {
      await queue.close();
      redis.disconnect();
      await prisma.$disconnect();
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
