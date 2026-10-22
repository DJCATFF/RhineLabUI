import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const electron = createRequire(import.meta.url)("electron");
const userData = await mkdtemp(path.join(tmpdir(), "rhine-regress-"));

const code = await new Promise((resolve) => {
  const child = spawn(electron, [".", "--regress-library", `--user-data-dir=${userData}`], {
    cwd: appDir,
    stdio: "inherit",
  });
  child.on("exit", (exitCode) => resolve(exitCode ?? 1));
});

await rm(userData, { recursive: true, force: true }).catch(() => {});
process.exit(code);
