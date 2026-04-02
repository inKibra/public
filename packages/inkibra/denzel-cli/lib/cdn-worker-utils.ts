import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { CdnWorkerConfig } from './cdn-worker-config';
import { validateParseCdnWorkerConfig } from './cdn-worker-config.schemas';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function stagePath(customStageDir?: string): string {
  const ts = Date.now();
  const baseDir = customStageDir || '.wrangler-stage/cdn-worker';
  return resolve(baseDir, String(ts));
}

export function getWorkerMainPath(): string {
  // Get absolute path to the worker file from the denzel-workers package
  // __dirname is denzel-cli/lib, worker is at denzel-workers/workers/cdn-worker/worker.ts
  return resolve(
    __dirname,
    '../../denzel-workers/workers/cdn-worker/worker.ts',
  );
}

export function jsonStringLiteral(s: string): string {
  return JSON.stringify(String(s));
}

export function resolveWorkerName(workerName?: string): string {
  // Priority: --worker-name flag, then CDN_WORKER_NAME env
  if (workerName) {
    return workerName;
  }

  const envWorkerName = process.env.CDN_WORKER_NAME;
  if (envWorkerName) {
    return envWorkerName;
  }

  throw new Error(
    'Must provide either --worker-name flag or CDN_WORKER_NAME environment variable.',
  );
}

export async function run(cmd: string, args: string[] = []): Promise<void> {
  const allArgs = args.length > 0 ? args : cmd.split(' ').slice(1);
  const command = args.length > 0 ? cmd : cmd.split(' ')[0];

  if (!command) {
    throw new Error('Command cannot be empty');
  }

  const proc = Bun.spawn([command, ...allArgs], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exit = await proc.exited;
  if (exit !== 0)
    throw new Error(`Command failed: ${command} ${allArgs.join(' ')}`);
}

export async function readConfigFromStdinOrFile(
  configFile?: string,
): Promise<CdnWorkerConfig> {
  let configJson: string;

  if (configFile) {
    const filePath = resolve(configFile);
    configJson = readFileSync(filePath, 'utf8');
  } else {
    if (process.stdin.isTTY) {
      throw new Error(
        'No config provided. Either pass --config-file or pipe JSON to stdin.',
      );
    }
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    configJson = Buffer.concat(chunks).toString('utf8');
  }

  const validation = validateParseCdnWorkerConfig(configJson);
  if (!validation.success) {
    const errors = validation.errors
      .map((e) => (typeof e === 'string' ? e : JSON.stringify(e)))
      .slice(0, 5)
      .join('\n  ');
    const moreErrors =
      validation.errors.length > 5
        ? `\n  ... and ${validation.errors.length - 5} more errors`
        : '';
    throw new Error(`Invalid CDN worker config:\n  ${errors}${moreErrors}`);
  }

  return validation.data;
}

export function synthesizeWrangler(
  workerName: string,
  config: CdnWorkerConfig,
): string {
  const routes: string[] = [];
  routes.push(
    `{ pattern = "${config.cdnDomain}/*", zone_name = "${config.zoneName}" }`,
  );

  const r2Buckets: string[] = [];
  for (const bucket of config.buckets) {
    r2Buckets.push('[[r2_buckets]]');
    r2Buckets.push(`binding = ${jsonStringLiteral(bucket)}`);
    r2Buckets.push(`bucket_name = ${jsonStringLiteral(bucket)}`);
    r2Buckets.push('');
  }

  return [
    `name = ${jsonStringLiteral(workerName)}`,
    `main = ${jsonStringLiteral(getWorkerMainPath())}`,
    'compatibility_date = "2024-10-01"',
    '',
    'routes = [',
    routes.map((r) => `  ${r}`).join(',\n'),
    ']',
    '',
    '[images]',
    'binding = "IMAGES"',
    '',
    ...r2Buckets,
    '[observability]',
    'enabled = true',
    '',
  ].join('\n');
}
