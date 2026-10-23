import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { app } from "electron";
import { openLibrary } from "./db";
import { importFolder } from "./importer";
import {
  EXTRACT_JOB,
  jobsSummary,
  queueExtraction,
  recoverInterruptedJobs,
  retryExtraction,
  runExtractionQueue,
} from "./jobs";
import { importLegacyExport } from "./legacy";
import { originalIntact, originalsDir } from "./originals";

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

/** 生成一份最小但结构合法的文本型 PDF，用于回归正文抽取。 */
function buildPdf(text: string): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 16 Tf 20 100 Td (${text}) Tj ET`;
  objects.push(`<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`);

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body, "ascii"));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const startxref = Buffer.byteLength(body, "ascii");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f\r\n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n\r\n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

/**
 * 原件保存与正文抽取的针对性回归：重复导入、同内容不同条目、损坏后重导、先正文后补原件，
 * 以及导入建任务、文本/PDF 抽取、失败重试、强制退出后继续处理。
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

    // 补齐失败：随包原件路径不存在时，不能因为已有占位记录就报告无需待补。
    const missing = path.join(legacyDir, "missing.json");
    await writeFile(
      missing,
      JSON.stringify({
        version: 2,
        documents: [{ ...document, localFile: path.join("missing.originals", `${documentId}.txt`) }],
      }),
    );
    const missingBackfill = await importLegacyExport(missing);
    check(
      "补齐失败：仍计入待补且不算跳过",
      missingBackfill.filesPending === 1 && missingBackfill.skipped === 0 && missingBackfill.backfilled === 0,
      JSON.stringify(missingBackfill),
    );
    const placeholder = db
      .prepare("SELECT storage_kind FROM files WHERE resource_id = ? LIMIT 1")
      .get(documentId) as { storage_kind: string };
    check("补齐失败：文件记录仍是占位", placeholder.storage_kind === "legacy");

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

    // 已存在的托管副本损坏时同样计入待补；重新补齐后恢复并清零。
    await writeFile(fileRow.path, Buffer.alloc(legacyBody.length, 0x59));
    check(
      "副本损坏：前置条件为不可读",
      !(await originalIntact(fileRow.path, { sha256: legacySha, size: legacyBody.length })),
    );
    const withoutOriginal = await importLegacyExport(textOnly);
    check(
      "副本损坏：无随包原件时计入待补",
      withoutOriginal.filesPending === 1 && withoutOriginal.skipped === 0,
      JSON.stringify(withoutOriginal),
    );
    const repaired = await importLegacyExport(full);
    check(
      "副本损坏：重新补齐后恢复且不再待补",
      repaired.filesPending === 0 &&
        (await originalIntact(fileRow.path, { sha256: legacySha, size: legacyBody.length })),
      JSON.stringify(repaired),
    );

    // 5. 两个旧库条目共享同一份原件：各自关联，物理副本只有一份。
    const sharedDir = path.join(root, "legacy-shared");
    await mkdir(sharedDir, { recursive: true });
    const sharedBody = Buffer.from("shared original content for two legacy entries\n".repeat(3), "utf8");
    const sharedSha = createHash("sha256").update(sharedBody).digest("hex");
    const sharedIds = [randomUUID(), randomUUID()];
    const sharedDocs = sharedIds.map((id, index) => ({
      id,
      archiveNumber: 9101 + index,
      title: `共享原件条目 ${index + 1}`,
      fileName: `shared-${index + 1}.txt`,
      mimeType: "text/plain",
      size: sharedBody.length,
      objectKey: `legacy/shared-${index + 1}.txt`,
      sha256: sharedSha,
      text: `共享原件正文 ${index + 1}`,
      summary: null,
      keyPoints: [] as string[],
      tags: [] as string[],
      category: null,
    }));

    const sharedText = path.join(sharedDir, "text-only.json");
    await writeFile(sharedText, JSON.stringify({ version: 2, documents: sharedDocs }));
    const sharedTextResult = await importLegacyExport(sharedText);
    check(
      "共享原件：先迁正文时两条都待补",
      sharedTextResult.added === 2 && sharedTextResult.filesPending === 2,
      JSON.stringify(sharedTextResult),
    );

    const sharedOriginals = path.join(sharedDir, "full.originals");
    await mkdir(sharedOriginals, { recursive: true });
    for (const id of sharedIds) await writeFile(path.join(sharedOriginals, `${id}.txt`), sharedBody);
    const sharedFull = path.join(sharedDir, "full.json");
    await writeFile(
      sharedFull,
      JSON.stringify({
        version: 2,
        documents: sharedDocs.map((doc) => ({
          ...doc,
          localFile: path.join("full.originals", `${doc.id}.txt`),
        })),
      }),
    );

    const sharedBackfill = await importLegacyExport(sharedFull);
    check(
      "共享原件：补齐后两条各自关联且无需待补",
      sharedBackfill.backfilled === 2 && sharedBackfill.filesPending === 0,
      JSON.stringify(sharedBackfill),
    );
    const sharedLinks = db
      .prepare("SELECT resource_id, storage_kind, path FROM files WHERE resource_id IN (?, ?)")
      .all(...sharedIds) as { resource_id: string; storage_kind: string; path: string }[];
    check(
      "共享原件：两条都登记为托管原件",
      sharedLinks.length === 2 &&
        sharedLinks.every((link) => link.storage_kind === "managed" && link.path.startsWith(originalsDir())),
      JSON.stringify(sharedLinks),
    );
    check("共享原件：物理副本只有一份", new Set(sharedLinks.map((link) => link.path)).size === 1);
    const sharedOpenable = await Promise.all(
      sharedLinks.map((link) => originalIntact(link.path, { sha256: sharedSha, size: sharedBody.length })),
    );
    check("共享原件：两个条目都能打开原件", sharedOpenable.length === 2 && sharedOpenable.every(Boolean));

    const sharedAgain = await importLegacyExport(sharedFull);
    check(
      "共享原件：重复迁移不重复关联",
      sharedAgain.added === 0 &&
        sharedAgain.backfilled === 0 &&
        sharedAgain.filesPending === 0 &&
        sharedAgain.skipped === 2,
      JSON.stringify(sharedAgain),
    );
    check(
      "共享原件：重复迁移后仍各有一条关联",
      one("SELECT COUNT(*) AS n FROM files WHERE resource_id IN (?, ?)", ...sharedIds) === 2,
    );

    // 6. 同一份导出包内两条共享内容：都在首次导入时建立关联，待补数为零。
    const directIds = [randomUUID(), randomUUID()];
    const directOriginals = path.join(sharedDir, "direct.originals");
    await mkdir(directOriginals, { recursive: true });
    for (const id of directIds) await writeFile(path.join(directOriginals, `${id}.txt`), sharedBody);
    const directDocs = directIds.map((id, index) => ({
      id,
      archiveNumber: 9201 + index,
      title: `同包共享原件 ${index + 1}`,
      fileName: `direct-${index + 1}.txt`,
      mimeType: "text/plain",
      size: sharedBody.length,
      objectKey: `legacy/direct-${index + 1}.txt`,
      sha256: sharedSha,
      text: `同包共享正文 ${index + 1}`,
      localFile: path.join("direct.originals", `${id}.txt`),
    }));
    const directJson = path.join(sharedDir, "direct.json");
    await writeFile(directJson, JSON.stringify({ version: 2, documents: directDocs }));
    const direct = await importLegacyExport(directJson);
    check(
      "同包共享原件：两条都新增且无待补",
      direct.added === 2 && direct.filesPending === 0,
      JSON.stringify(direct),
    );
    const directLinks = db
      .prepare("SELECT storage_kind, path FROM files WHERE resource_id IN (?, ?)")
      .all(...directIds) as { storage_kind: string; path: string }[];
    check(
      "同包共享原件：两条都能打开同一份原件",
      directLinks.length === 2 &&
        new Set(directLinks.map((link) => link.path)).size === 1 &&
        directLinks.every((link) => link.storage_kind === "managed" && link.path.startsWith(originalsDir())) &&
        (await originalIntact(directLinks[0].path, { sha256: sharedSha, size: sharedBody.length })),
      JSON.stringify(directLinks),
    );

    // 7. 可恢复的正文抽取：导入建任务、文本/PDF 抽取、失败重试、强制退出后继续处理。
    const extractDir = path.join(root, "extract");
    await mkdir(extractDir, { recursive: true });
    const noteText = "Rhine Lab extraction note body.";
    const guideText = "# 抽取指南\n\nMarkdown 正文也应被抽取。";
    await writeFile(path.join(extractDir, "note.txt"), Buffer.from(noteText, "utf8"));
    await writeFile(path.join(extractDir, "guide.md"), Buffer.from(guideText, "utf8"));
    await writeFile(path.join(extractDir, "paper.pdf"), buildPdf("Rhine Lab PDF extraction sample"));
    await writeFile(path.join(extractDir, "broken.pdf"), Buffer.from("%PDF-1.4\nnot a real document\n", "ascii"));

    const stateOf = (id: string) =>
      db.prepare("SELECT status, extracted FROM resources WHERE id = ?").get(id) as {
        status: string;
        extracted: string | null;
      };
    const jobOf = (id: string) =>
      db
        .prepare(
          "SELECT status, attempts, lease_until, error FROM jobs WHERE resource_id = ? AND type = ? ORDER BY created_at DESC LIMIT 1",
        )
        .get(id, EXTRACT_JOB) as
        | { status: string; attempts: number; lease_until: string | null; error: string | null }
        | undefined;
    const jobsOf = (id: string) =>
      one("SELECT COUNT(*) AS n FROM jobs WHERE resource_id = ? AND type = ?", id, EXTRACT_JOB);
    const textOf = (id: string) => stateOf(id).extracted ?? "";

    const extractImport = await importFolder(extractDir, noop);
    check("抽取入队：导入 4 项", extractImport.added === 4, JSON.stringify(extractImport));
    const extractSource = db
      .prepare("SELECT id FROM sources WHERE kind = 'folder' AND root_path = ? LIMIT 1")
      .get(extractDir) as { id: string } | undefined;
    const extractRows = db
      .prepare("SELECT id, title, status FROM resources WHERE source_id = ?")
      .all(extractSource?.id ?? "") as { id: string; title: string; status: string }[];
    const findResource = (title: string) => {
      const row = extractRows.find((item) => item.title === title);
      if (!row) throw new Error(`缺少导入条目：${title}`);
      return row;
    };
    check(
      "抽取入队：导入后 4 项均为待抽取",
      extractRows.length === 4 && extractRows.every((item) => item.status === "pending"),
      JSON.stringify(extractRows),
    );
    check(
      "抽取入队：4 项都建立持久化任务",
      extractRows.length === 4 && extractRows.every((item) => jobOf(item.id)?.status === "pending"),
    );

    const note = findResource("note");
    const guide = findResource("guide");
    const paper = findResource("paper");
    const broken = findResource("broken");
    await runExtractionQueue();

    check(
      "文本抽取：TXT 正文写入且状态可检索",
      stateOf(note.id).status === "ready" &&
        textOf(note.id) === noteText &&
        jobOf(note.id)?.status === "done",
      JSON.stringify(stateOf(note.id)),
    );
    check(
      "文本抽取：Markdown 正文写入",
      stateOf(guide.id).status === "ready" && textOf(guide.id).includes("Markdown 正文也应被抽取"),
      JSON.stringify(stateOf(guide.id)),
    );
    check(
      "PDF 抽取：文本型 PDF 写入正文",
      stateOf(paper.id).status === "ready" && textOf(paper.id).includes("Rhine Lab PDF extraction sample"),
      JSON.stringify({ status: stateOf(paper.id).status, text: textOf(paper.id) }),
    );
    check(
      "抽取失败：损坏 PDF 记为失败并保留原因",
      stateOf(broken.id).status === "failed" &&
        jobOf(broken.id)?.status === "failed" &&
        Boolean(jobOf(broken.id)?.error),
      JSON.stringify(jobOf(broken.id)),
    );
    const beforeRetry = jobsSummary();
    check(
      "抽取统计：失败 1、无待处理",
      beforeRetry.failed === 1 && beforeRetry.pending === 0,
      JSON.stringify(beforeRetry),
    );
    check("抽取入队：已完成的资料不再重复建任务", queueExtraction([note.id]) === 0);

    const brokenFile = db
      .prepare("SELECT path FROM files WHERE resource_id = ? AND storage_kind = 'managed' LIMIT 1")
      .get(broken.id) as { path: string };
    await writeFile(brokenFile.path, buildPdf("Recovered PDF extraction after retry"));
    check("失败重试：重新入队 1 条", retryExtraction(broken.id) === 1);
    check(
      "失败重试：任务复位为待处理并清空错误",
      jobOf(broken.id)?.status === "pending" &&
        jobOf(broken.id)?.error === null &&
        stateOf(broken.id).status === "pending",
      JSON.stringify(jobOf(broken.id)),
    );
    await runExtractionQueue();
    check(
      "失败重试：重新抽取成功",
      stateOf(broken.id).status === "ready" &&
        textOf(broken.id).includes("Recovered PDF extraction after retry") &&
        jobOf(broken.id)?.status === "done",
      JSON.stringify({ status: stateOf(broken.id).status, text: textOf(broken.id) }),
    );

    const resumeDir = path.join(root, "extract-resume");
    await mkdir(resumeDir, { recursive: true });
    const resumeText = "resume extraction after forced quit";
    await writeFile(path.join(resumeDir, "resume.txt"), Buffer.from(resumeText, "utf8"));
    const resumeImport = await importFolder(resumeDir, noop);
    const resumeRow = db
      .prepare("SELECT r.id FROM resources r JOIN sources s ON s.id = r.source_id WHERE s.root_path = ?")
      .get(resumeDir) as { id: string };
    check(
      "中断恢复：导入后创建待处理任务",
      resumeImport.added === 1 && jobOf(resumeRow.id)?.status === "pending",
      JSON.stringify(resumeImport),
    );

    db.prepare("UPDATE jobs SET status = 'running', lease_until = ? WHERE resource_id = ? AND type = ?").run(
      new Date(Date.now() - 60_000).toISOString(),
      resumeRow.id,
      EXTRACT_JOB,
    );
    db.prepare("UPDATE resources SET status = 'processing' WHERE id = ?").run(resumeRow.id);
    check(
      "中断恢复：前置条件为执行中且租约过期",
      jobOf(resumeRow.id)?.status === "running" && stateOf(resumeRow.id).status === "processing",
    );
    check("中断恢复：启动时复位中断任务", recoverInterruptedJobs() >= 1);
    check(
      "中断恢复：任务回到待处理并清空租约",
      jobOf(resumeRow.id)?.status === "pending" &&
        jobOf(resumeRow.id)?.lease_until === null &&
        stateOf(resumeRow.id).status === "pending",
      JSON.stringify(jobOf(resumeRow.id)),
    );
    check(
      "中断恢复：重复恢复不重复建任务",
      recoverInterruptedJobs() === 0 && jobsOf(resumeRow.id) === 1,
    );
    await runExtractionQueue();
    check(
      "中断恢复：重启后继续完成抽取",
      stateOf(resumeRow.id).status === "ready" &&
        textOf(resumeRow.id) === resumeText &&
        jobOf(resumeRow.id)?.status === "done",
      JSON.stringify(stateOf(resumeRow.id)),
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
