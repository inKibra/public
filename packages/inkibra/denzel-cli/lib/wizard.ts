import { checkbox, confirm, input, select } from '@inquirer/prompts';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { commands, type JsxArgs, type WorkerArgs } from './site-assets';

type WizardOptions = { autoYes?: boolean };

let PROJECT_PATH = '';

export async function runWizard(options: WizardOptions = {}) {
  const autoYes = Boolean(options.autoYes);

  // Project path selection (derive name from package.json)
  const projectPathAnswer = await input({
    message: 'Path to project root (contains package.json)',
  });
  PROJECT_PATH = resolve(projectPathAnswer);
  let project = 'unknown';
  try {
    const pkgJson = JSON.parse(
      readFileSync(join(PROJECT_PATH, 'package.json'), 'utf8'),
    ) as { name?: string };
    if (pkgJson.name) project = pkgJson.name;
  } catch {
    console.warn('Could not read package.json, using default project name');
  }
  console.log(`Project: ${project} (${PROJECT_PATH})`);

  // Preflight
  const hasWrangler = await checkWrangler();
  if (!hasWrangler) {
    const cont =
      autoYes ||
      (await confirm({
        message: 'Wrangler not found. Continue without deploy?',
        default: true,
      }));
    if (!cont) return;
  }

  // Flow selection
  const flow = await select({
    message: 'Site mappings wizard - choose a task',
    choices: [
      { value: 'add', name: 'Add mapping' },
      { value: 'view', name: 'View mappings (and get code snippet)' },
      { value: 'remove', name: 'Remove mapping' },
      { value: 'deploy', name: 'Deploy workers' },
    ],
  });

  if (flow === 'add') {
    const domainsStr = await input({
      message: 'Primary apex domain(s) (comma-separated)',
      default: 'inkibra.com',
    });
    const primaries = domainsStr
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean);
    const altStr = await input({
      message: 'Alternate domains (comma-separated, optional)',
      default: '',
    });
    const alts = altStr
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean);

    // Favicon dir
    const dir = await input({
      message: 'Path to favicon package directory',
      default: './',
    });
    const missing = REQUIRED_FILES.filter(
      (f) =>
        !readFileSafe(resolve(dir, f)) &&
        !readFileSafe(resolve(dir, 'favicon', f)),
    );
    if (missing.length > 0) {
      const cont =
        autoYes ||
        (await confirm({
          message: `Missing files: ${missing.join(', ')}. Continue anyway?`,
          default: false,
        }));
      if (!cont) return;
    }

    // Copy favicon files into project assets/<primary>/favicon
    const favOut = join(
      PROJECT_PATH,
      'assets',
      primaries[0] ?? 'site',
      'favicon',
    );
    mkdirSync(favOut, { recursive: true });
    const files = [
      'favicon.ico',
      'favicon-16x16.png',
      'favicon-32x32.png',
      'apple-touch-icon.png',
      'android-chrome-192x192.png',
      'android-chrome-512x512.png',
    ];
    for (const f of files) {
      const srcFaviconSubdir = join(dir, 'favicon', f);
      const srcFlat = join(dir, f);
      const src = readFileSafe(srcFaviconSubdir) ? srcFaviconSubdir : srcFlat;
      const buf = readFileSync(src);
      writeFileSync(join(favOut, f), buf);
    }
    console.log(`✓ Copied favicon files to ${favOut}`);

    // Update mappings file
    const mappingsPath = getMappingsPath();
    let mappings: Record<string, string> = {};
    try {
      mappings = JSON.parse(readFileSync(mappingsPath, 'utf8')) as Record<
        string,
        string
      >;
    } catch {}
    for (const d of primaries) {
      mappings[d] = d;
    }
    for (const a of alts) {
      mappings[a] = primaries[0] ?? alts[0] ?? 'default';
    }
    writeFileSync(mappingsPath, JSON.stringify(mappings, null, 2), 'utf8');
    console.log(`Saved domain mappings to ${mappingsPath}`);

    // JSX (intercept only)
    await commands.jsx.handler({
      domain: primaries[0] ?? 'site',
      _: [],
      $0: '',
    } as JsxArgs & { _: (string | number)[]; $0: string });
    return;
  }

  if (flow === 'view') {
    try {
      const data = readFileSync(getMappingsPath(), 'utf8');
      console.log(data);
    } catch {
      console.log('No mappings file found.');
    }
    return;
  }

  if (flow === 'remove') {
    let mappings: Record<string, string> = {};
    try {
      mappings = JSON.parse(readFileSync(getMappingsPath(), 'utf8')) as Record<
        string,
        string
      >;
    } catch {
      console.log('No mappings file found.');
      return;
    }
    const hosts = Object.keys(mappings);
    const toRemove = await checkbox({
      message: 'Select host mappings to remove',
      choices: hosts.map((h) => ({ value: h })),
    });
    for (const h of toRemove as string[]) delete mappings[h];
    writeFileSync(getMappingsPath(), JSON.stringify(mappings, null, 2), 'utf8');
    console.log('Updated mappings.');
    return;
  }

  if (flow === 'deploy') {
    let mappings: Record<string, string> = {};
    try {
      mappings = JSON.parse(readFileSync(getMappingsPath(), 'utf8')) as Record<
        string,
        string
      >;
    } catch {
      // continue with manual input
    }
    const domainsCsv = Object.keys(mappings).length
      ? Array.from(new Set(Object.keys(mappings).map(getApex))).join(',')
      : await input({
          message: 'Domains to deploy (comma-separated)',
          default: '',
        });
    await commands.worker.handler({
      action: 'deploy',
      domains: domainsCsv,
      'mappings-file': getMappingsPath(),
      _: [],
      $0: '',
    } as WorkerArgs & { _: (string | number)[]; $0: string });
    return;
  }
}

async function checkWrangler(): Promise<boolean> {
  try {
    const p = Bun.spawn(['wrangler', '-v'], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
    const code = await p.exited;
    return code === 0;
  } catch {
    return false;
  }
}

const REQUIRED_FILES = [
  'android-chrome-192x192.png',
  'android-chrome-512x512.png',
  'apple-touch-icon.png',
  'favicon-16x16.png',
  'favicon-32x32.png',
  'favicon.ico',
] as const;

function readFileSafe(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

function getApex(host: string): string {
  const parts = host.split('.');
  return parts.length <= 2 ? host : parts.slice(-2).join('.');
}

function getMappingsPath(): string {
  return join(PROJECT_PATH, 'workers', 'site-asset-worker.mappings.json');
}
