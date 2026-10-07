// Requires API + Worker + Vite. Use an isolated local development database.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { mkdirSync } = require('node:fs');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const apiRequire = createRequire(resolve('apps/api/package.json'));
apiRequire('dotenv').config({ path: resolve('.env'), quiet: true });
const { PrismaClient } = apiRequire('@prisma/client');
const { Client } = apiRequire('minio');
const { Queue } = apiRequire('bullmq');
const Redis = apiRequire('ioredis');
const base = process.env.APEX_UI_URL || 'http://127.0.0.1:5173';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Local UI only');

(async () => {
  const browser = await chromium.launch({
    channel: process.platform === 'win32' ? 'msedge' : undefined,
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  const errors = [];
  const created = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let postCount = 0;
  let reads = 0;
  page.on('request', (req) => {
    if (!req.url().includes('/api/documents')) return;
    if (req.method() === 'POST') postCount++;
    else reads++;
  });
  try {
    await page.goto(base);
    await page.getByRole('button', { name: '点击进入 →' }).click({ timeout: 60000 });
    const opener = page.getByRole('button', { name: '我的文档 ↗' });
    await opener.click({ timeout: 45000 });
    const dialog = page.getByRole('dialog', { name: '我的文档' });
    const submit = dialog.getByRole('button', { name: '上传文档 ↑' });
    await submit.click();
    await page.getByText('请选择一份非空文件。', { exact: true }).waitFor();
    await page
      .locator('#apex-file')
      .setInputFiles({
        name: 'oversize.txt',
        mimeType: 'text/plain',
        buffer: Buffer.alloc(20 * 1024 * 1024 + 1),
      });
    await submit.click();
    await page.getByText('文件超过 20 MiB，请选择较小的文件。', { exact: true }).waitFor();
    assert.equal(postCount, 0);

    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    await page.route('**/api/documents', async (route) => {
      if (route.request().method() === 'POST') await gate;
      await route.continue();
    });
    const text =
      'APEX 浏览器验证 <img src=x onerror="window.apexInjected=true">\n' +
      '可滚动的中文正文。\n'.repeat(160);
    await page
      .locator('#apex-file')
      .setInputFiles({
        name: 'APEX-界面验证.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(text),
      });
    const uploaded = page.waitForResponse(
      (r) => r.url().endsWith('/api/documents') && r.request().method() === 'POST',
    );
    await submit.click();
    await page.keyboard.press('Escape');
    assert.ok(await dialog.isVisible(), 'Uploading panel must remain open');
    assert.ok(await dialog.getByRole('button', { name: '正在上传…' }).isDisabled());
    release();
    const response = await uploaded;
    assert.equal(response.status(), 201);
    created.push(await response.json());
    await page.unroute('**/api/documents');
    await page.waitForFunction(
      () => document.querySelector('.apex-text')?.textContent.includes('APEX 浏览器验证'),
      { timeout: 90000 },
    );
    assert.equal(postCount, 1);
    assert.equal(await page.locator('.apex-text img').count(), 0);
    assert.equal(await page.evaluate(() => window.apexInjected), undefined);
    await page.locator('.apex-text').evaluate((el) => {
      el.scrollTop = 120;
    });
    await delay(3500);
    assert.ok(
      await page.locator('.apex-text').evaluate((el) => el.scrollTop >= 110),
      'Polling must preserve reading position',
    );
    mkdirSync('.tools', { recursive: true });
    await page.screenshot({ path: '.tools/apex-desktop.png' });

    await page.route('**/api/documents', (route) => route.abort());
    await page.getByRole('button', { name: '刷新 ↻' }).click();
    await page.waitForFunction(() =>
      document.querySelector('.apex-list-message')?.textContent.includes('连接中断'),
    );
    await page.unroute('**/api/documents');
    await page.getByRole('button', { name: '刷新 ↻' }).click();
    await page.waitForFunction(
      () => document.querySelector('.apex-list-message')?.textContent === '',
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(
      () => document.querySelector('#stage').dataset.layout === 'portrait',
    );
    const bounds = await dialog.boundingBox();
    assert.ok(
      bounds.x >= 0 && bounds.x + bounds.width <= 391,
      'Narrow panel stays inside viewport',
    );
    assert.ok(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      'No horizontal panel overflow',
    );
    await page.screenshot({ path: '.tools/apex-mobile.png' });
    await page.getByRole('button', { name: '关闭窗口' }).focus();
    await page.keyboard.press('Shift+Tab');
    assert.ok(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
      'Focus stays inside dialog',
    );
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.ok(
      await opener.evaluate((el) => el === document.activeElement),
      'Focus restored to opener',
    );
    const previousReads = reads;
    await delay(3600);
    assert.equal(reads, previousReads, 'Closing stops polling');
    await opener.click();
    await page.getByRole('button', { name: /APEX-界面验证.txt/ }).click();
    await page.waitForFunction(() =>
      document.querySelector('.apex-text')?.textContent.includes('APEX 浏览器验证'),
    );
    await page.keyboard.press('Escape');
    assert.deepEqual(errors, []);
    console.log(
      'PASS: real upload/extraction/reading, validation, upload close guard, plain-text safety, polling/scroll, service recovery, narrow layout, focus restoration and reopen.',
    );
  } finally {
    await browser.close();
    // Delete only records captured from this browser's own upload response.
    if (created.length) {
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
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
