import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL('../node_modules/prisma/build/index.js', import.meta.url)),
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit', cwd: fileURLToPath(new URL('../', import.meta.url)) },
);
process.exit(result.status ?? 1);
