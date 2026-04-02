/**
 * Built-in package manager (ts-pm) commands.
 * See spec §8.2 — Package Management table and §12–17.
 *
 * Packages are stored in the VFS:
 * - Source: /agent/scripts/<name>/
 * - Published: /runtime/packages/registry/<name>/<version>/
 * - Installed: /agent/packages/<name>/
 *
 * When a package's default export is a Command, `pm add` auto-registers it.
 */

import type { OverlayFs } from '@inkibra/ai-flow';
import { defineCommand } from '../define-command';
import type { Command } from '../types';

const SCRIPTS_DIR = '/agent/scripts';
const REGISTRY_DIR = '/runtime/packages/registry';
const MODULES_DIR = '/agent/packages';

/** Lock status per spec §17.2 */
type LockStatus = 'locked' | 'draft-propose' | 'auto-approve';

type PackageJson = {
  name: string;
  version: string;
  main?: string;
  description?: string;
  lockStatus?: LockStatus;
};

function checkLockStatus(pkg: PackageJson, operation: string): void {
  if (pkg.lockStatus === 'locked') {
    throw new Error(
      `Package "${pkg.name}" is locked (read-only system package). Cannot ${operation}.`,
    );
  }
}

// ---------------------------------------------------------------------------
// pm — sub-command dispatcher
// ---------------------------------------------------------------------------

export const pmCommand = defineCommand({
  name: 'pm',
  description:
    'Package manager: init, publish, add, list, versions, remove, link',
  args: {
    subcommand: {
      type: 'string',
      position: 0,
      required: true,
      description:
        'Sub-command: init, publish, add, list, versions, remove, link',
    },
    name: { type: 'string', position: 1, description: 'Package name' },
    version: {
      type: 'string',
      flag: '--version',
      description: 'Package version',
    },
  },
  async fn(parsed, ctx) {
    const sub = parsed.subcommand as string;
    const name = parsed.name as string | undefined;

    switch (sub) {
      // ─── init ────────────────────────────────────────────────────────
      case 'init': {
        if (!name) throw new Error('pm init requires a package name');
        const dir = `${SCRIPTS_DIR}/${name}`;
        const pkg: PackageJson = {
          name,
          version: '0.1.0',
          main: 'index.ts',
        };
        await ctx.fs.write(`${dir}/package.json`, JSON.stringify(pkg, null, 2));
        await ctx.fs.write(
          `${dir}/README.md`,
          [
            `# ${name}`,
            '',
            'Describe what this package does, when preview code should use it, and any important invariants or caveats.',
            '',
          ].join('\n'),
        );
        await ctx.fs.write(
          `${dir}/index.d.ts`,
          [
            '/**',
            ` * Public package surface for ${name}.`,
            ' * Keep this file focused on the API that preview code should depend on.',
            ' */',
            'declare const _default: Record<string, never>;',
            'export default _default;',
            '',
          ].join('\n'),
        );
        await ctx.fs.write(
          `${dir}/index.ts`,
          [
            '// ' + name,
            '// Write your package code here. Export a default Command to auto-register.',
            '',
            'export default {};',
            '',
          ].join('\n'),
        );
        return { subcommand: 'init', name, dir } as const;
      }

      // ─── publish ─────────────────────────────────────────────────────
      case 'publish': {
        if (!name) throw new Error('pm publish requires a package name');
        const srcDir = `${SCRIPTS_DIR}/${name}`;
        const pkgContent = await ctx.fs.read(`${srcDir}/package.json`);
        const pkg = JSON.parse(pkgContent) as PackageJson;
        checkLockStatus(pkg, 'publish');
        const version = pkg.version;
        const destDir = `${REGISTRY_DIR}/${name}/${version}`;

        // Check if version already published (immutable)
        try {
          await ctx.fs.read(`${destDir}/package.json`);
          throw new Error(
            `Version ${version} of ${name} is already published. Bump the version in package.json.`,
          );
        } catch (e) {
          if (e instanceof Error && e.message.includes('already published')) {
            throw e;
          }
          // File doesn't exist — good, we can publish
        }

        // Copy source files to registry
        const entries = await ctx.fs.list(srcDir);
        for (const entry of entries) {
          if (entry.type === 'file') {
            const content = await ctx.fs.read(entry.path);
            const destPath = `${destDir}/${entry.name}`;

            // Transpile .ts files to .js
            if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
              const transpiler = new Bun.Transpiler({ loader: 'ts' });
              const js = transpiler.transformSync(content);
              const jsName = entry.name.replace(/\.ts$/, '.js');
              await ctx.fs.write(`${destDir}/${jsName}`, js);
            } else {
              await ctx.fs.write(destPath, content);
            }
          }
        }

        // Write updated package.json with main pointing to .js
        const publishedPkg = {
          ...pkg,
          main: pkg.main?.replace(/\.ts$/, '.js') ?? 'index.js',
        };
        await ctx.fs.write(
          `${destDir}/package.json`,
          JSON.stringify(publishedPkg, null, 2),
        );

        return {
          subcommand: 'publish',
          name,
          version,
          dir: destDir,
        } as const;
      }

      // ─── add ─────────────────────────────────────────────────────────
      case 'add': {
        if (!name) throw new Error('pm add requires a package name');
        const requestedVersion = parsed.version as string | undefined;

        // Find latest version or requested version
        let versionDir: string;
        if (requestedVersion) {
          versionDir = `${REGISTRY_DIR}/${name}/${requestedVersion}`;
        } else {
          // Find latest
          const versions = await listVersions(ctx.fs, name);
          if (versions.length === 0) {
            throw new Error(`Package ${name} not found in registry`);
          }
          const latest = versions[versions.length - 1]!;
          versionDir = `${REGISTRY_DIR}/${name}/${latest}`;
        }

        // Copy from registry to installed modules
        const installDir = `${MODULES_DIR}/${name}`;
        const entries = await ctx.fs.list(versionDir);
        for (const entry of entries) {
          if (entry.type === 'file') {
            const content = await ctx.fs.read(entry.path);
            await ctx.fs.write(`${installDir}/${entry.name}`, content);
          }
        }

        const pkgContent = await ctx.fs.read(`${versionDir}/package.json`);
        const pkg = JSON.parse(pkgContent) as PackageJson;

        // Auto-registration (§17.3): if the package default export satisfies
        // the Command shape (name, description, args, fn, render), auto-register it.
        let autoRegistered = false;
        try {
          const mainFile = pkg.main ?? 'index.js';
          const mainContent = await ctx.fs.read(`${installDir}/${mainFile}`);

          // Evaluate the module to check its default export
          const AsyncFunction = Object.getPrototypeOf(async () => {})
            .constructor as new (
            ...a: string[]
          ) => (...a: unknown[]) => Promise<unknown>;
          const moduleExports: Record<string, unknown> = {};
          const evalFn = new AsyncFunction(
            'exports',
            `${mainContent}\nif (typeof module !== 'undefined' && module.exports) { Object.assign(exports, module.exports); }`,
          );
          try {
            await evalFn(moduleExports);
          } catch {
            // eval failed — try simpler pattern matching
          }

          // Check if default export looks like a Command
          const defaultExport = moduleExports.default ?? moduleExports;
          if (
            defaultExport &&
            typeof defaultExport === 'object' &&
            'name' in defaultExport &&
            'description' in defaultExport &&
            'args' in defaultExport &&
            'fn' in defaultExport &&
            'render' in defaultExport &&
            typeof (defaultExport as Record<string, unknown>).name === 'string'
          ) {
            // Register the command
            try {
              ctx.registry.register(defaultExport as Command);
              autoRegistered = true;
            } catch {
              // Already registered or invalid — skip
            }
          }
        } catch {
          // Best-effort
        }

        return {
          subcommand: 'add',
          name,
          version: pkg.version,
          dir: installDir,
          autoRegistered,
        } as const;
      }

      // ─── list ────────────────────────────────────────────────────────
      case 'list': {
        const installed: Array<{ name: string; version: string }> = [];
        try {
          const entries = await ctx.fs.list(MODULES_DIR);
          for (const entry of entries) {
            if (entry.type === 'directory') {
              try {
                const pkgContent = await ctx.fs.read(
                  `${entry.path}/package.json`,
                );
                const pkg = JSON.parse(pkgContent) as PackageJson;
                installed.push({ name: pkg.name, version: pkg.version });
              } catch {
                // Skip invalid packages
              }
            }
          }
        } catch {
          // No modules dir yet
        }
        return { subcommand: 'list', packages: installed } as const;
      }

      // ─── versions ────────────────────────────────────────────────────
      case 'versions': {
        if (!name) throw new Error('pm versions requires a package name');
        const versions = await listVersions(ctx.fs, name);
        return { subcommand: 'versions', name, versions } as const;
      }

      // ─── remove ──────────────────────────────────────────────────────
      case 'remove': {
        if (!name) throw new Error('pm remove requires a package name');
        const installDir = `${MODULES_DIR}/${name}`;
        try {
          const entries = await ctx.fs.list(installDir);
          for (const entry of entries) {
            if (entry.type === 'file') {
              await ctx.fs.delete(entry.path);
            }
          }
        } catch {
          throw new Error(`Package ${name} is not installed`);
        }
        return { subcommand: 'remove', name } as const;
      }

      // ─── link ────────────────────────────────────────────────────────
      case 'link': {
        if (!name) throw new Error('pm link requires a path');
        const srcDir = name; // positional arg is the path for link
        const installDir = `${MODULES_DIR}/${name.split('/').pop()}`;

        // Copy source to modules (simulating a symlink in VFS)
        const entries = await ctx.fs.list(srcDir);
        for (const entry of entries) {
          if (entry.type === 'file') {
            const content = await ctx.fs.read(entry.path);
            await ctx.fs.write(`${installDir}/${entry.name}`, content);
          }
        }
        return {
          subcommand: 'link',
          source: srcDir,
          target: installDir,
        } as const;
      }

      default:
        throw new Error(
          `Unknown pm sub-command: ${sub}. Use: init, publish, add, list, versions, remove, link`,
        );
    }
  },
  render(result) {
    switch (result.subcommand) {
      case 'init':
        return `Created package ${result.name} at ${result.dir}`;
      case 'publish':
        return `Published ${result.name}@${result.version} to ${result.dir}`;
      case 'add':
        return `Installed ${result.name}@${result.version} to ${result.dir}`;
      case 'list': {
        if (result.packages.length === 0) return 'No packages installed';
        return result.packages
          .map(
            (p: { name: string; version: string }) =>
              `  ${p.name}@${p.version}`,
          )
          .join('\n');
      }
      case 'versions': {
        if (result.versions.length === 0)
          return `No published versions for ${result.name}`;
        return result.versions.join(', ');
      }
      case 'remove':
        return `Removed ${result.name}`;
      case 'link':
        return `Linked ${result.source} → ${result.target}`;
      default:
        return '';
    }
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function listVersions(fs: OverlayFs, name: string): Promise<string[]> {
  try {
    const entries = await fs.list(`${REGISTRY_DIR}/${name}`);
    return entries
      .filter((e) => e.type === 'directory')
      .map((e) => e.name)
      .sort((a, b) => {
        const pa = a.split('.').map(Number);
        const pb = b.split('.').map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
          const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
          if (diff !== 0) return diff;
        }
        return 0;
      });
  } catch {
    return [];
  }
}
