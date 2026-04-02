#!/usr/bin/env bun
/**
 * Prepare workspace packages for npm publish.
 *
 * - Reads each package.json in the workspace
 * - Builds a dependency graph of internal (@inkibra/*) packages
 * - Topologically sorts so dependencies are published before dependents
 * - Resolves workspace:* references to actual version numbers
 * - Outputs the list of package directories in publish order
 *
 * The actual `npm publish` is done by the shell wrapper so OIDC
 * environment variables are available to the npm CLI directly.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const PACKAGES_DIR = join(import.meta.dir, '..', 'packages', 'inkibra');

interface PkgInfo {
  name: string;
  dir: string;
  version: string;
  internalDeps: string[];
  private: boolean;
}

function loadPackages(): Map<string, PkgInfo> {
  const packages = new Map<string, PkgInfo>();

  for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(PACKAGES_DIR, entry.name);
    const pkgPath = join(dir, 'package.json');
    if (!existsSync(pkgPath)) continue;

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    };

    const internalDeps = Object.keys(allDeps).filter((d) =>
      d.startsWith('@inkibra/'),
    );

    packages.set(pkg.name, {
      name: pkg.name,
      dir,
      version: pkg.version,
      internalDeps,
      private: pkg.private === true,
    });
  }

  return packages;
}

function topoSort(packages: Map<string, PkgInfo>): PkgInfo[] {
  const sorted: PkgInfo[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(name: string) {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      throw new Error(`Circular dependency detected: ${name}`);
    }

    const pkg = packages.get(name);
    if (!pkg) return;

    visiting.add(name);
    for (const dep of pkg.internalDeps) {
      visit(dep);
    }
    visiting.delete(name);
    visited.add(name);
    sorted.push(pkg);
  }

  for (const name of packages.keys()) {
    visit(name);
  }

  return sorted;
}

function resolveWorkspaceDeps(
  pkgDir: string,
  packages: Map<string, PkgInfo>,
): void {
  const pkgPath = join(pkgDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

  let modified = false;
  for (const depField of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
    const deps = pkg[depField];
    if (!deps) continue;
    for (const [name, version] of Object.entries(deps)) {
      if (typeof version !== 'string') continue;
      if (!version.startsWith('workspace:')) continue;

      const resolved = packages.get(name);
      if (!resolved) continue;

      const prefix = version.replace('workspace:', '');
      if (prefix === '*' || prefix === '') {
        deps[name] = resolved.version;
      } else if (prefix === '^') {
        deps[name] = `^${resolved.version}`;
      } else if (prefix === '~') {
        deps[name] = `~${resolved.version}`;
      }
      modified = true;
    }
  }

  if (modified) {
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  }
}

function main() {
  const packages = loadPackages();
  const sorted = topoSort(packages);
  const publishable = sorted.filter((p) => !p.private);

  // Resolve workspace deps for all packages
  for (const pkg of publishable) {
    resolveWorkspaceDeps(pkg.dir, packages);
  }

  // Output package dirs in publish order, one per line
  for (const pkg of publishable) {
    console.log(`${pkg.dir}\t${pkg.name}\t${pkg.version}`);
  }
}

main();
