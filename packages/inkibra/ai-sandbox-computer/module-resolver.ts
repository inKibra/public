/**
 * Module Resolver — Provides ESM-like imports inside preview code.
 *
 * Since vm.SourceTextModule crashes Bun with top-level await (SIGTRAP),
 * we use a pre-transform that rewrites `import { x } from 'mod'` into
 * `const { x } = __require('mod')`. The __require function is injected
 * as a global and resolves modules from a registry.
 *
 * Module tiers (spec §11.1):
 * 1. 'sys'         → { command } (command dispatch global)
 * 2. 'sys/ai'      → { ai } (lightweight LLM SDK)
 * 3. Product bindings → exported functions from CodeFunction definitions
 * 4. 'sys/fs'      → construct VFS proxy
 * 5. 'node:path'   → Node.js path module (pure JS, safe)
 * 6. VFS modules   → loaded from /developer/packages/ and /agent/packages/
 * 7. '@commands/*' → AI-installed commands from /agent/commands/
 */

import type { OverlayFs } from '@inkibra/ai-flow';
import type { PreviewGlobals } from './globals';
import type { AiSdkConfig } from './sys-ai';
import {
  createSystemStaticModuleMap,
  type SystemStaticPackageRuntimeConfig,
} from './system-static-packages';
import { transpileTs } from './transpile';
import type { CommandRegistry } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModuleDefinition = {
  exports: Record<string, unknown>;
};

export type ModuleResolverConfig = {
  registry: CommandRegistry;
  fs: OverlayFs;
  globals: PreviewGlobals;
  /** Product binding modules: { 'workout-api': { getWorkouts, logWorkout } } */
  /** Product binding modules (unwrapped callables). */
  bindings?: Record<string, Record<string, unknown>>;
  /** sys/ai SDK configuration */
  aiSdkConfig?: AiSdkConfig;
  /** Pre-loaded VFS modules: { 'zod': { z, ZodSchema, ... } } */
  preloadedModules?: Record<string, Record<string, unknown>>;
};

export type StaticPreviewModuleConfig = Pick<
  ModuleResolverConfig,
  'fs' | 'globals' | 'bindings' | 'aiSdkConfig' | 'preloadedModules'
>;

// ---------------------------------------------------------------------------
// Import rewriting
// ---------------------------------------------------------------------------

/**
 * Rewrite ESM import statements to __require calls.
 * Handles:
 *   import { a, b } from 'mod'  →  const { a, b } = __require('mod')
 *   import x from 'mod'         →  const x = __require('mod').default
 *   import * as x from 'mod'    →  const x = __require('mod')
 */
export function rewriteImports(code: string): string {
  // Named imports: import { a, b as c } from 'mod'
  let result = code.replace(
    /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]\s*;?/g,
    (_match, names: string, mod: string) => {
      const cleaned = names
        .split(',')
        .map((n: string) => n.trim())
        .filter(Boolean)
        .map((n: string) => n.replace(/\s+as\s+/, ': '))
        .join(', ');
      return `const { ${cleaned} } = __require('${mod}');`;
    },
  );

  // Default import: import x from 'mod'
  result = result.replace(
    /import\s+(\w+)\s+from\s*['"]([^'"]+)['"]\s*;?/g,
    (_match, name: string, mod: string) => {
      return `const ${name} = __require('${mod}').default ?? __require('${mod}');`;
    },
  );

  // Namespace import: import * as x from 'mod'
  result = result.replace(
    /import\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]\s*;?/g,
    (_match, name: string, mod: string) => {
      return `const ${name} = __require('${mod}');`;
    },
  );

  return result;
}

// ---------------------------------------------------------------------------
// Module registry
// ---------------------------------------------------------------------------

function withDefaultExport(
  exports: Record<string, unknown>,
): Record<string, unknown> {
  return Object.hasOwn(exports, 'default')
    ? exports
    : { ...exports, default: exports };
}

const VFS_PACKAGE_ROOTS = ['/agent/packages', '/developer/packages'] as const;
const VFS_COMMAND_ROOT = '/agent/commands';

async function pathExists(fs: OverlayFs, path: string): Promise<boolean> {
  try {
    await fs.read(path);
    return true;
  } catch {
    return false;
  }
}

async function safeList(fs: OverlayFs, path: string) {
  try {
    return await fs.list(path);
  } catch {
    return [];
  }
}

export async function resolvePackageEntryFromDir(
  fs: OverlayFs,
  dir: string,
): Promise<string | null> {
  let packageMain: string | undefined;
  try {
    const packageJson = JSON.parse(await fs.read(`${dir}/package.json`)) as {
      main?: string;
    };
    packageMain = packageJson.main;
  } catch {
    packageMain = undefined;
  }

  const candidates = [
    ...(packageMain
      ? [
          packageMain.startsWith('/')
            ? packageMain
            : `${dir}/${packageMain}`.replace(/\/+/g, '/'),
        ]
      : []),
    `${dir}/index.ts`,
    `${dir}/index.js`,
  ];

  for (const candidate of candidates) {
    if (await pathExists(fs, candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveCommandFileSpecifier(path: string): string | null {
  const relative = path.slice(VFS_COMMAND_ROOT.length + 1);
  if (relative.length === 0) {
    return null;
  }

  if (relative.endsWith('/index.ts') || relative.endsWith('/index.js')) {
    const spec = relative.replace(/\/index\.(?:ts|js)$/, '');
    return spec.length > 0 ? `@commands/${spec}` : null;
  }

  if (relative.endsWith('.ts') || relative.endsWith('.js')) {
    const spec = relative.replace(/\.(?:ts|js)$/, '');
    return spec.length > 0 ? `@commands/${spec}` : null;
  }

  return null;
}

export async function resolveVfsPackagePath(
  specifier: string,
  fs: OverlayFs,
): Promise<string | null> {
  const directPath =
    specifier.startsWith('/agent/packages/') ||
    specifier.startsWith('/developer/packages/')
      ? specifier
      : null;

  if (directPath) {
    return resolvePackageEntryFromDir(fs, directPath);
  }

  for (const root of VFS_PACKAGE_ROOTS) {
    const resolved = await resolvePackageEntryFromDir(
      fs,
      `${root}/${specifier}`,
    );
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

export async function resolveVfsCommandPath(
  specifier: string,
  fs: OverlayFs,
): Promise<string | null> {
  const commandName = specifier.startsWith('@commands/')
    ? specifier.slice('@commands/'.length)
    : specifier.startsWith('/agent/commands/')
      ? specifier.slice('/agent/commands/'.length)
      : null;

  if (!commandName) {
    return null;
  }

  const dirResolved = await resolvePackageEntryFromDir(
    fs,
    `${VFS_COMMAND_ROOT}/${commandName}`,
  );
  if (dirResolved) {
    return dirResolved;
  }

  for (const candidate of [
    `${VFS_COMMAND_ROOT}/${commandName}.ts`,
    `${VFS_COMMAND_ROOT}/${commandName}.js`,
  ]) {
    if (await pathExists(fs, candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function listVfsCommandSpecs(
  fs: OverlayFs,
): Promise<Array<{ specifier: string; path: string }>> {
  const discovered = new Map<string, string>();

  async function walk(dir: string): Promise<void> {
    const entries = await safeList(fs, dir);
    for (const entry of entries) {
      if (entry.type === 'directory') {
        const resolved = await resolvePackageEntryFromDir(fs, entry.path);
        if (resolved) {
          const specifier = resolveCommandFileSpecifier(resolved);
          if (specifier) {
            discovered.set(specifier, resolved);
            continue;
          }
        }
        await walk(entry.path);
        continue;
      }

      if (entry.name === '.keep' || entry.name.endsWith('.d.ts')) {
        continue;
      }
      const specifier = resolveCommandFileSpecifier(entry.path);
      if (specifier) {
        discovered.set(specifier, entry.path);
      }
    }
  }

  await walk(VFS_COMMAND_ROOT);
  return Array.from(discovered.entries())
    .map(([specifier, path]) => ({ specifier, path }))
    .sort((left, right) => left.specifier.localeCompare(right.specifier));
}

export async function loadVfsSource(
  path: string,
  fs: OverlayFs,
): Promise<string> {
  const content = await fs.read(path);
  return path.endsWith('.ts') ? transpileTs(content) : content;
}

export function populateStaticPreviewModules(
  modules: Map<string, Record<string, unknown>>,
  config: StaticPreviewModuleConfig,
): void {
  modules.set('__globals__', {
    show: config.globals.show,
    plan_response: config.globals.plan_response,
  });

  const systemModules = createSystemStaticModuleMap(
    config satisfies SystemStaticPackageRuntimeConfig,
  );
  for (const [name, exports] of systemModules) {
    modules.set(name, exports);
  }

  if (config.bindings) {
    for (const [name, exports] of Object.entries(config.bindings)) {
      modules.set(name, withDefaultExport(exports));
    }
  }

  if (config.preloadedModules) {
    for (const [name, exports] of Object.entries(config.preloadedModules)) {
      modules.set(name, withDefaultExport(exports));
    }
  }
}

/**
 * Create a __require function that resolves modules from the configured tiers.
 */
export function createModuleRequire(
  config: ModuleResolverConfig,
): (specifier: string) => Record<string, unknown> {
  const modules = new Map<string, Record<string, unknown>>();
  populateStaticPreviewModules(modules, config);

  // VFS module cache (loaded lazily from VFS)
  const vfsModuleCache = new Map<string, Record<string, unknown>>();

  return function __require(specifier: string): Record<string, unknown> {
    const mod = modules.get(specifier);
    if (mod) return mod;

    const cached = vfsModuleCache.get(specifier);
    if (cached) return cached;

    throw new Error(
      `Module not found: "${specifier}". Available: ${Array.from(modules.keys()).join(', ')}`,
    );
  };
}
