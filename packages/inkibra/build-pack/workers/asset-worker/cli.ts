import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AssetWorkerConfig } from './config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_COMPAT_DATE = '2024-10-01';
const DEFAULT_ASSET_ROOT = '/assets';
const DEFAULT_LATEST_KEY = 'assets/latest.json';
const DEFAULT_BUILD_ENDPOINT = '/_internal/assets/build';

type AssetWorkerArgs = {
  action: 'deploy' | 'tail' | 'dry-run';
  configFile?: string;
  stageDir?: string;
  keepStage?: boolean;
  workerName?: string;
};

function parseArgs(argv: string[]): AssetWorkerArgs {
  const [action, ...rest] = argv;
  const args: AssetWorkerArgs = {
    action: (action || 'deploy') as AssetWorkerArgs['action'],
  };

  for (let i = 0; i < rest.length; i += 1) {
    const value = rest[i];
    if (!value) continue;
    if (value === '--config-file') {
      args.configFile = rest[i + 1];
      i += 1;
    } else if (value === '--stage-dir') {
      args.stageDir = rest[i + 1];
      i += 1;
    } else if (value === '--keep-stage') {
      args.keepStage = true;
    } else if (value === '--worker-name') {
      args.workerName = rest[i + 1];
      i += 1;
    }
  }

  return args;
}

function stagePath(customStageDir?: string): string {
  const ts = Date.now();
  const baseDir = customStageDir || '.wrangler-stage/asset-worker';
  return resolve(baseDir, String(ts));
}

function getWorkerMainPath(): string {
  return resolve(__dirname, 'worker.ts');
}

function jsonStringLiteral(s: string): string {
  return JSON.stringify(String(s));
}

function assertConfig(config: AssetWorkerConfig): void {
  if (!config.workerName) throw new Error('Missing workerName');
  if (!config.routes?.length) throw new Error('Missing routes');
  if (!config.r2Bucket) throw new Error('Missing r2Bucket');
  if (!config.assetOriginBase) throw new Error('Missing assetOriginBase');
}

async function readConfigFromStdinOrFile(
  configFile?: string,
): Promise<AssetWorkerConfig> {
  let configJson: string;

  if (configFile) {
    configJson = readFileSync(resolve(configFile), 'utf8');
  } else {
    if (process.stdin.isTTY) {
      throw new Error('No config provided. Use --config-file or pipe JSON.');
    }
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    configJson = Buffer.concat(chunks).toString('utf8');
  }

  const parsed = JSON.parse(configJson) as AssetWorkerConfig;
  assertConfig(parsed);
  return parsed;
}

function synthesizeWrangler(
  workerName: string,
  config: AssetWorkerConfig,
): string {
  const compatDate = config.compatibilityDate || DEFAULT_COMPAT_DATE;
  const routes = config.routes
    .map(
      (r) =>
        `{ pattern = ${jsonStringLiteral(r.pattern)}, zone_name = ${jsonStringLiteral(r.zoneName)} }`,
    )
    .join(',\n');

  const vars: string[] = [
    `ASSET_ORIGIN_BASE = ${jsonStringLiteral(config.assetOriginBase)}`,
    `ASSET_ROOT = ${jsonStringLiteral(config.assetRoot || DEFAULT_ASSET_ROOT)}`,
    `ASSET_LATEST_KEY = ${jsonStringLiteral(config.latestKey || DEFAULT_LATEST_KEY)}`,
    `BUILD_ENDPOINT = ${jsonStringLiteral(config.buildEndpoint || DEFAULT_BUILD_ENDPOINT)}`,
  ];

  if (config.cacheTtls) {
    vars.push(
      `ASSET_CACHE_TTLS_JSON = ${jsonStringLiteral(JSON.stringify(config.cacheTtls))}`,
    );
  }

  return [
    `name = ${jsonStringLiteral(workerName)}`,
    `main = ${jsonStringLiteral(getWorkerMainPath())}`,
    `compatibility_date = ${jsonStringLiteral(compatDate)}`,
    '',
    'routes = [',
    `  ${routes}`,
    ']',
    '',
    '[[r2_buckets]]',
    'binding = "ASSET_BUCKET"',
    `bucket_name = ${jsonStringLiteral(config.r2Bucket)}`,
    '',
    '[[durable_objects]]',
    'name = "ASSET_BUILD_LOCK"',
    'class_name = "AssetBuildLock"',
    '',
    '[[migrations]]',
    'tag = "v1"',
    'new_classes = ["AssetBuildLock"]',
    '',
    '[vars]',
    ...vars,
    '',
  ].join('\n');
}

async function run(cmd: string, args: string[] = []): Promise<void> {
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

export async function runAssetWorkerCli(
  args: string[] = process.argv.slice(2),
) {
  const parsed = parseArgs(args);
  const config = await readConfigFromStdinOrFile(parsed.configFile);
  const workerName = parsed.workerName || config.workerName;

  if (parsed.action === 'tail') {
    await run('wrangler', ['tail', '--name', workerName]);
    return;
  }

  const stageDir = stagePath(parsed.stageDir);
  mkdirSync(stageDir, { recursive: true });
  const wranglerToml = synthesizeWrangler(workerName, config);
  const configPath = resolve(stageDir, 'wrangler.toml');
  writeFileSync(configPath, wranglerToml, 'utf8');

  if (parsed.action === 'dry-run') {
    console.log('Generated wrangler.toml at:', configPath);
    console.log('\n--- wrangler.toml ---');
    console.log(wranglerToml);
    console.log('--- end wrangler.toml ---\n');
    return;
  }

  await run('wrangler', ['deploy', '--config', configPath]);

  if (!parsed.keepStage) {
    await run('rm', ['-rf', stageDir]);
  } else {
    console.log('Stage kept at', stageDir);
  }
}

if (import.meta.main) {
  runAssetWorkerCli().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
