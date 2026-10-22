import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat, unlink } from "node:fs/promises";
import * as path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { app } from "electron";

export interface StoredOriginal {
  path: string;
  sha256: string;
  size: number;
  /** false 表示资料库中已有同一份原件，本次没有新增副本。 */
  created: boolean;
}

/** 资料库托管原件目录：<userData>/rhine/originals/<sha 前两位>/<sha256><ext>。 */
export function originalsDir(): string {
  return path.join(app.getPath("userData"), "rhine", "originals");
}

function storedPath(sha256: string, ext: string): string {
  return path.join(originalsDir(), sha256.slice(0, 2), `${sha256}${ext.toLowerCase()}`);
}

/**
 * 把源文件复制进资料库托管目录，并按 sha256/大小校验复制结果。
 * 校验不通过或复制中断时删除临时文件，不留下半个原件。
 */
export async function saveOriginal(
  source: string,
  expected: { sha256?: string; size?: number } = {},
): Promise<StoredOriginal> {
  const info = await stat(source).catch(() => null);
  if (!info?.isFile()) throw new Error(`原件不可读取：${source}`);

  const ext = path.extname(source).toLowerCase();
  const tempDir = path.join(originalsDir(), "tmp");
  await mkdir(tempDir, { recursive: true });
  const temp = path.join(tempDir, randomUUID());

  const hash = createHash("sha256");
  let size = 0;
  try {
    await pipeline(
      createReadStream(source, { highWaterMark: 1024 * 1024 }),
      new Transform({
        transform(chunk, _encoding, callback) {
          const buffer = chunk as Buffer;
          hash.update(buffer);
          size += buffer.length;
          callback(null, buffer);
        },
      }),
      createWriteStream(temp),
    );
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }

  const sha256 = hash.digest("hex");
  const failed = async (message: string) => {
    await unlink(temp).catch(() => {});
    return new Error(message);
  };
  if (size !== info.size) throw await failed("复制后的原件大小与源文件不一致");
  if (expected.size !== undefined && expected.size !== size) {
    throw await failed(`原件大小与登记值不一致：${size} / ${expected.size}`);
  }
  if (expected.sha256 && expected.sha256 !== sha256) {
    throw await failed("原件校验失败：摘要与登记值不一致");
  }

  const target = storedPath(sha256, ext);
  await mkdir(path.dirname(target), { recursive: true });
  if (await stat(target).then(() => true, () => false)) {
    await unlink(temp).catch(() => {});
    return { path: target, sha256, size, created: false };
  }
  await rename(temp, target);
  return { path: target, sha256, size, created: true };
}

/** 事务回滚时清理本次新建的原件副本，已存在的副本不会删除。 */
export async function discardOriginals(paths: string[]): Promise<void> {
  await Promise.all(paths.map((target) => rm(target, { force: true })));
}
