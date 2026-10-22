import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { app } from "electron";
import { openLibrary } from "./db";
import { importFolder } from "./importer";
import { importLegacyExport } from "./legacy";
import { originalIntact, originalsDir } from "./originals";

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

/**
 * 原件保存的针对性回归：重复导入、同内容不同条目、损坏后重导、先正文后补原件。
 * 只写入 --user-data-dir 指定的临时资料库，不触碰正式数据。
 */
export async function runLibraryRegression(): Promise<void> {
  const root = path.join(app.getPath("userData"), "regress");
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  const db = openLibrary();
  const checks: CheckResult[] = [];
  const check = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });
  const one = (sql: string, ...args: (string | number)[]): number => {
    const row = db.prepare(sql).get(...args) as { n: number } | undefined;
    return row?.n ?? 0;
  };
  const noop = () => {};

  try {
    // 1. 同内容不同条目：只登记一条，只保留一份托管副本。
    const sameDir = path.join(root, "same-content");
    await mkdir(sameDir, { recursive: true });
    const payload = Buffer.from("Rhine Lab duplicate payload\n".repeat(20), "utf8");
    const sha256 = createHash("sha256").update(payload).digest("hex");
    await writeFile(path.join(sameDir, "alpha.txt"), payload);
    await writeFile(path.join(sameDir, "beta.txt"), payload);

    const first = await importFolder(sameDir, noop);
    check(
      "同内容不同条目：新增 1、重复 1",
      first.added === 1 && first.duplicates === 1,
      JSON.stringify(first),
    );
    check("同内容不同条目：只保留一份托管副本", one("SELECT COUNT(*) AS n FROM files WHERE sha256 = ?", sha256) === 1);

    // 2. 重复导入：全部重复时不新增来源。
    const sourcesBefore = one("SELECT COUNT(*) AS n FROM sources");
    const second = await importFolder(sameDir, noop);
    check(
      "重复导入：新增 0、重复 2",
      second.added === 0 && second.duplicates === 2,
      JSON.stringify(second),
    );
    check("重复导入：不新增来源", one("SELECT COUNT(*) AS n FROM sources") === sourcesBefore);
    check("重复导入：不返回来源 ID", second.sourceId === null);

    // 3. 损坏后重导：等大小覆盖破坏后，重新导入可以恢复为正确摘要。
    const row = db.prepare("SELECT path FROM files WHERE sha256 = ?").get(sha256) as { path: string };
    await writeFile(row.path, Buffer.alloc(payload.length, 0x58));
    check("损坏后重导：前置条件为副本已损坏", !(await originalIntact(row.path, { sha256, size: payload.length })));

    const third = await importFolder(sameDir, noop);
    check(
      "损坏后重导：计为重复并修复 1 个",
      third.duplicates === 2 && third.repaired === 1,
      JSON.stringify(third),
    );
    check(
      "损坏后重导：副本恢复为原摘要",
      await originalIntact(row.path, { sha256, size: payload.length }),
    );
    check("损坏后重导：不新增来源", one("SELECT COUNT(*) AS n FROM sources") === sourcesBefore);

    // 4. 先正文后原件：同一旧库文档先只迁正文，再导入带原件的完整包应当补齐。
    const legacyDir = path.join(root, "legacy");
    await mkdir(legacyDir, { recursive: true });
    const documentId = randomUUID();
    const archiveNumber = 9001;
    const legacyBody = Buffer.from("legacy text body for backfill regression", "utf8");
    const legacySha = createHash("sha256").update(legacyBody).digest("hex");
    const document = {
      id: documentId,
      archiveNumber,
      title: "旧库补齐原件",
      fileName: "legacy.txt",
      mimeType: "text/plain",
      size: legacyBody.length,
      objectKey: "legacy/object.txt",
      sha256: legacySha,
      text: "只有正文，没有原件。",
      summary: null,
      keyPoints: [],
      tags: ["旧库回归"],
      category: null,
    };

    const textOnly = path.join(legacyDir, "text-only.json");
    await writeFile(textOnly, JSON.stringify({ version: 2, documents: [document] }));
    const legacySources = one("SELECT COUNT(*) AS n FROM sources");
    const bodyOnly = await importLegacyExport(textOnly);
    check(
      "先正文：新增 1 条且原件待补",
      bodyOnly.added === 1 && bodyOnly.filesPending === 1,
      JSON.stringify(bodyOnly),
    );
    check("先正文：建立旧库来源", one("SELECT COUNT(*) AS n FROM sources") === legacySources + 1);

    const bundleOriginals = path.join(legacyDir, "full.originals");
    await mkdir(bundleOriginals, { recursive: true });
    await writeFile(path.join(bundleOriginals, `${documentId}.txt`), legacyBody);
    const full = path.join(legacyDir, "full.json");
    await writeFile(
      full,
      JSON.stringify({
        version: 2,
        documents: [{ ...document, localFile: path.join("full.originals", `${documentId}.txt`) }],
      }),
    );

    const sourcesBeforeBackfill = one("SELECT COUNT(*) AS n FROM sources");
    const backfill = await importLegacyExport(full);
    check("补齐原件：backfilled 1", backfill.backfilled === 1, JSON.stringify(backfill));
    check("补齐原件：不再跳过", backfill.skipped === 0);
    check("补齐原件：不新增来源", one("SELECT COUNT(*) AS n FROM sources") === sourcesBeforeBackfill);

    const fileRow = db
      .prepare("SELECT storage_kind, path, sha256 FROM files WHERE resource_id = ? LIMIT 1")
      .get(documentId) as { storage_kind: string; path: string; sha256: string };
    check(
      "补齐原件：登记为托管且路径在原件目录",
      fileRow.storage_kind === "managed" &&
        fileRow.path.startsWith(originalsDir()) &&
        fileRow.sha256 === legacySha,
      JSON.stringify(fileRow),
    );

    const again = await importLegacyExport(full);
    check(
      "补齐后重复导入：backfilled 0、skipped 1",
      again.backfilled === 0 && again.skipped === 1,
      JSON.stringify(again),
    );
  } finally {
    const failed = checks.filter((item) => !item.ok);
    console.log(
      "REGRESSION_RESULT " +
        JSON.stringify({ total: checks.length, failed: failed.length, checks }, null, 2),
    );
    await rm(root, { recursive: true, force: true }).catch(() => {});
    app.exit(failed.length ? 1 : 0);
  }
}
