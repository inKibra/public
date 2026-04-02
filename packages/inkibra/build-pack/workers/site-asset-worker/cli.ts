/**
 * Site Asset Worker CLI
 *
 * Deploy and manage the site asset worker via Wrangler.
 *
 * Usage:
 *   bun run cli.ts deploy --config-file ./config.json
 *   bun run cli.ts dry-run --config-file ./config.json
 *   bun run cli.ts tail
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildOriginMappings,
  buildRoutes,
  DEFAULT_CACHE_TTLS,
  type SiteAssetWorkerConfig,
} from './config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_COMPAT_DATE = '2024-10-01';

type CliArgs = {
  action: 'deploy' | 'tail' | 'dry-run';
  configFile?: string;
  stageDir?: string;
  keepStage?: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const [action, ...rest] = argv;
  const args: CliArgs = {
    action: (action || 'deploy') as CliArgs['action'],
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
    }
  }

  return args;
}

function stagePath(customStageDir?: string): string {
  const ts = Date.now();
  const baseDir = customStageDir || '.wrangler-stage/site-asset-worker';
  return resolve(baseDir, String(ts));
}

function getWorkerMainPath(): string {
  return resolve(__dirname, 'worker.ts');
}

function jsonStringLiteral(s: string): string {
  return JSON.stringify(String(s));
}

function assertConfig(config: SiteAssetWorkerConfig): void {
  if (!config.name) throw new Error('Missing name');
  if (!config.r2Bucket) throw new Error('Missing r2Bucket');
  if (!config.origins || Object.keys(config.origins).length === 0) {
    throw new Error('Missing origins');
  }

  for (const [originId, origin] of Object.entries(config.origins)) {
    if (!origin.url) throw new Error(`Missing url for origin ${originId}`);
    if (!origin.zoneName)
      throw new Error(`Missing zoneName for origin ${originId}`);
    if (!origin.hosts?.length)
      throw new Error(`Missing hosts for origin ${originId}`);

    for (const host of origin.hosts) {
      if (!host.pattern)
        throw new Error(`Missing pattern for host in origin ${originId}`);
      if (!host.routes?.length)
        throw new Error(`Missing routes for host ${host.pattern}`);
    }
  }
}

async function readConfigFromFile(
  configFile: string,
): Promise<SiteAssetWorkerConfig> {
  const configJson = readFileSync(resolve(configFile), 'utf8');
  const parsed = JSON.parse(configJson) as SiteAssetWorkerConfig;
  assertConfig(parsed);
  return parsed;
}

function synthesizeWrangler(config: SiteAssetWorkerConfig): string {
  const compatDate = config.compatibilityDate || DEFAULT_COMPAT_DATE;

  // Build routes from config
  const routes = buildRoutes(config.origins);
  const routesStr = routes
    .map(
      (r) =>
        `{ pattern = ${jsonStringLiteral(r.pattern)}, zone_name = ${jsonStringLiteral(r.zoneName)} }`,
    )
    .join(',\n  ');

  // Build origin mappings for runtime
  const originMappings = buildOriginMappings(config.origins);

  // Build cache TTLs
  const cacheTtls = {
    assetsTtl: config.cacheTtls?.assetsTtl ?? DEFAULT_CACHE_TTLS.assetsTtl,
    manifestTtl:
      config.cacheTtls?.manifestTtl ?? DEFAULT_CACHE_TTLS.manifestTtl,
    manifestStaleWhileRevalidate:
      config.cacheTtls?.manifestStaleWhileRevalidate ??
      DEFAULT_CACHE_TTLS.manifestStaleWhileRevalidate,
  };

  const vars = [
    `ORIGINS_JSON = ${jsonStringLiteral(JSON.stringify(originMappings))}`,
    `CACHE_TTLS_JSON = ${jsonStringLiteral(JSON.stringify(cacheTtls))}`,
  ];

  return [
    `name = ${jsonStringLiteral(config.name)}`,
    `main = ${jsonStringLiteral(getWorkerMainPath())}`,
    `compatibility_date = ${jsonStringLiteral(compatDate)}`,
    'compatibility_flags = ["nodejs_compat"]',
    '',
    'routes = [',
    `  ${routesStr}`,
    ']',
    '',
    '[[r2_buckets]]',
    'binding = "ASSET_BUCKET"',
    `bucket_name = ${jsonStringLiteral(config.r2Bucket)}`,
    '',
    '[[durable_objects.bindings]]',
    'name = "MANIFEST_LOCK"',
    'class_name = "ManifestLock"',
    '',
    '[[migrations]]',
    'tag = "v1"',
    'new_classes = ["ManifestLock"]',
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

export async function runSiteAssetWorkerCli(
  args: string[] = process.argv.slice(2),
) {
  const parsed = parseArgs(args);

  if (parsed.action === 'tail') {
    // For tail, we need the worker name from config or assume default
    const config = parsed.configFile
      ? await readConfigFromFile(parsed.configFile)
      : null;
    const workerName = config?.name || 'site-asset-worker';
    await run('wrangler', ['tail', '--name', workerName]);
    return;
  }

  if (!parsed.configFile) {
    throw new Error('--config-file is required for deploy/dry-run');
  }

  const config = await readConfigFromFile(parsed.configFile);
  const stageDir = stagePath(parsed.stageDir);
  mkdirSync(stageDir, { recursive: true });

  const wranglerToml = synthesizeWrangler(config);
  const configPath = resolve(stageDir, 'wrangler.toml');
  writeFileSync(configPath, wranglerToml, 'utf8');

  if (parsed.action === 'dry-run') {
    console.log('Generated wrangler.toml at:', configPath);
    console.log('\n--- wrangler.toml ---');
    console.log(wranglerToml);
    console.log('--- end wrangler.toml ---\n');

    console.log('\n--- Origin Mappings ---');
    const mappings = buildOriginMappings(config.origins);
    console.log(JSON.stringify(mappings, null, 2));
    console.log('--- end mappings ---\n');

    console.log('\n--- Routes ---');
    const routes = buildRoutes(config.origins);
    for (const route of routes) {
      console.log(`  ${route.pattern} -> ${route.zoneName}`);
    }
    console.log('--- end routes ---\n');
    return;
  }

  console.log(`Deploying ${config.name}...`);
  await run('wrangler', ['deploy', '--config', configPath]);

  if (!parsed.keepStage) {
    await run('rm', ['-rf', stageDir]);
  } else {
    console.log('Stage kept at', stageDir);
  }

  console.log(`Successfully deployed ${config.name}`);
}

if (import.meta.main) {
  runSiteAssetWorkerCli().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
