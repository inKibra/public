import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { MigrationWorkerConfig } from './migration-worker-config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function stagePath(customStageDir?: string): string {
  const ts = Date.now();
  const baseDir = customStageDir || '.wrangler-stage/migration-worker';
  return resolve(baseDir, String(ts));
}

export function getMigrationWorkerMainPath(): string {
  return resolve(
    __dirname,
    '../../denzel-workers/workers/migration-worker/worker.ts',
  );
}

function jsonStringLiteral(s: string): string {
  return JSON.stringify(String(s));
}

export function resolveMigrationWorkerName(workerName?: string): string {
  if (workerName) {
    return workerName;
  }

  const envWorkerName = process.env.MIGRATION_WORKER_NAME;
  if (envWorkerName) {
    return envWorkerName;
  }

  return 'gcs-r2-migration-worker';
}

export function synthesizeMigrationWrangler(
  workerName: string,
  config: MigrationWorkerConfig,
): string {
  return [
    `name = ${jsonStringLiteral(workerName)}`,
    `main = ${jsonStringLiteral(getMigrationWorkerMainPath())}`,
    'compatibility_date = "2024-10-01"',
    '',
    '[[r2_buckets]]',
    'binding = "R2_BUCKET"',
    `bucket_name = ${jsonStringLiteral(config.r2BucketName)}`,
    '',
    '[observability]',
    'enabled = true',
    '',
  ].join('\n');
}
