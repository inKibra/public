import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import type { Argv, CommandModule } from 'yargs';

function jsonStringLiteral(s: string): string {
  return JSON.stringify(String(s));
}

function stagePath(): string {
  const ts = Date.now();
  return resolve('.wrangler-stage/site-asset-worker', String(ts));
}

function relativeToWorkerMain(): string {
  return '../../denzel-workers/workers/site-asset-worker/worker.ts';
}

function shellEscape(p: string): string {
  return `'${p.replace(/'/g, "'\\''")}'`;
}

export type UploadArgs = {};

export type JsxArgs = { domain: string };

export type MappingsArgs = {
  add?: string[];
  printJson?: boolean;
};

export type WorkerArgs = {
  action: 'deploy' | 'tail' | 'dry-run';
  domains?: string;
  bucket?: string;
  mappingsFile?: string;
  keepStage?: boolean;
};

export const commands = {
  upload: {
    command: 'site-assets upload-favicon',
    describe: '[removed] Upload is no longer supported (use repo assets)',
    builder: (y: Argv<UploadArgs>) => y,
    handler: async () => {
      console.error(
        'Upload is removed. Put files in your project assets/<site>/ directory.',
      );
      process.exit(2);
    },
  } as CommandModule<object, UploadArgs>,

  jsx: {
    command: 'site-assets jsx',
    describe: 'Output JSX snippet for favicons',
    builder: (y: Argv<JsxArgs>) =>
      y.option('domain', { type: 'string', demandOption: true }),
    handler: () => {
      const lines = interceptJsx();
      process.stdout.write(lines.join('\n') + '\n');
    },
  } as CommandModule<object, JsxArgs>,

  mappings: {
    command: 'site-assets mappings',
    describe: 'Build/print DOMAIN_MAPPINGS_JSON',
    builder: (y: Argv<MappingsArgs>) =>
      y.option('add', { type: 'array' }).option('print-json', {
        type: 'boolean',
        default: true,
      }),
    handler: (args: MappingsArgs) => {
      const map: Record<string, string> = {};
      for (const ent of args.add ?? []) {
        const [host, domain] = String(ent).split('=');
        if (host && domain) map[host] = domain;
      }
      if (args.printJson !== false) {
        console.log(JSON.stringify(map));
      } else {
        for (const [k, v] of Object.entries(map)) console.log(`${k}=${v}`);
      }
    },
  } as CommandModule<object, MappingsArgs>,

  worker: {
    command: 'site-assets worker <action>',
    describe: 'Deploy/manage the site asset worker via Wrangler',
    builder: (y: Argv<WorkerArgs>) =>
      y
        .positional('action', {
          type: 'string',
          choices: ['deploy', 'tail', 'dry-run'] as const,
        })
        .option('domains', { type: 'string' })
        .option('mappings-file', { type: 'string' })
        .option('keep-stage', { type: 'boolean', default: false }),
    handler: async (args: WorkerArgs) => {
      const stageDir = stagePath();
      mkdirSync(stageDir, { recursive: true });
      if (args.action === 'tail') {
        await run('wrangler tail --name site-asset-worker');
        return;
      }
      const mappings = args.mappingsFile
        ? readFileSync(resolve(String(args.mappingsFile)), 'utf8')
        : '{}';
      const domains = (args.domains ?? '')
        .split(',')
        .map((d: string) => d.trim())
        .filter(Boolean);
      const wranglerToml = synthesizeWrangler(domains, mappings);
      const configPath = join(stageDir, 'wrangler.toml');
      writeFileSync(configPath, wranglerToml, 'utf8');
      if (args.action === 'dry-run') {
        console.log(configPath);
        console.log(wranglerToml);
        return;
      }
      await run(`wrangler deploy --config ${shellEscape(configPath)}`);
      if (!args.keepStage) {
        try {
          await run(`rm -rf ${shellEscape(stageDir)}`);
        } catch {}
      } else {
        console.log('Stage kept at', stageDir);
      }
    },
  } as CommandModule<object, WorkerArgs>,
};

function interceptJsx(): string[] {
  return [
    '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />',
    '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />',
    '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />',
    '<link rel="manifest" href="/site.webmanifest" />',
    '<link rel="shortcut icon" href="/favicon.ico" />',
  ];
}

// no CDN mode anymore

function synthesizeWrangler(domains: string[], mappingsJson: string): string {
  const routes: string[] = [];
  for (const d of domains) {
    routes.push(`{ pattern = "${d}/assets/*", zone_name = "${d}" }`);
    routes.push(`{ pattern = "${d}/favicon*", zone_name = "${d}" }`);
    routes.push(`{ pattern = "${d}/.well-known/*", zone_name = "${d}" }`);
  }
  return [
    'name = "site-asset-worker"',
    `main = "${relativeToWorkerMain()}"`,
    'compatibility_date = "2024-10-01"',
    'compatibility_flags = ["nodejs_compat"]',
    '',
    '[vars]',
    `DOMAIN_MAPPINGS_JSON = ${jsonStringLiteral(mappingsJson)}`,
    '',
    'routes = [',
    routes.map((r) => `  ${r}`).join(',\n'),
    ']',
    '',
  ].join('\n');
}

async function run(cmd: string): Promise<void> {
  const proc = Bun.spawn(cmd.split(' '), {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exit = await proc.exited;
  if (exit !== 0) throw new Error(`Command failed: ${cmd}`);
}
