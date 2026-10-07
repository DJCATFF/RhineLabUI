import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { Client } from 'minio';

dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const storage = new Client({
  endPoint: process.env.MINIO_ENDPOINT,
  port: Number(process.env.MINIO_PORT),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY,
});
const bucket = process.env.MINIO_BUCKET;
const key = `verification/${randomUUID()}`;
const bytes = Buffer.from('APEX 原文件存储测试');
if (!(await storage.bucketExists(bucket))) await storage.makeBucket(bucket);
try {
  await storage.putObject(bucket, key, bytes, bytes.length);
  const stream = await storage.getObject(bucket, key);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), bytes);
  console.log('PASS: real MinIO bucket, upload and byte-for-byte readback.');
} finally {
  await storage.removeObject(bucket, key);
}
