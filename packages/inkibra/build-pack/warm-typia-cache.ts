import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transformTypiaSource } from './plugins/typia-transform';

type WarmStats = {
  schemasVisited: number;
  toolsVisited: number;
  schemaErrors: number;
  toolErrors: number;
};

const EXCLUDED_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
]);

const thisDir = path.dirname(fileURLToPath(import.meta.url));

function collectTypeFiles(rootDir: string): {
  schemaFiles: string[];
  toolFiles: string[];
} {
  const schemaFiles: string[] = [];
  const toolFiles: string[] = [];

  const walk = (dir: string): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (EXCLUDED_DIR_NAMES.has(entry.name)) {
          continue;
        }
        walk(fullPath);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith('.ts')) {
        continue;
      }

      if (entry.name === 'schemas.ts' || entry.name.endsWith('.schemas.ts')) {
        schemaFiles.push(fullPath);
        continue;
      }

      if (entry.name.endsWith('.tool.ts')) {
        toolFiles.push(fullPath);
      }
    }
  };

  walk(rootDir);

  return {
    schemaFiles: schemaFiles.sort(),
    toolFiles: toolFiles.sort(),
  };
}

async function warmSchemaFiles(
  files: string[],
  stats: WarmStats,
): Promise<void> {
  for (const filePath of files) {
    stats.schemasVisited += 1;
    try {
      const source = fs.readFileSync(filePath, 'utf-8');
      transformTypiaSource(filePath, source, {
        cache: true,
        skipIfNoTypia: true,
      });
    } catch (error) {
      stats.schemaErrors += 1;
      console.warn(
        `[warm-typia-cache] Failed schema transform for ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function warmToolFiles(files: string[], stats: WarmStats): Promise<void> {
  if (files.length === 0) {
    return;
  }

  let pluginTesting: {
    extractBindings: (id: string, source: string) => unknown[];
    generateCodeBindings: (source: string, bindings: unknown[]) => string;
    transformWithTypia: (id: string, source: string) => Promise<string>;
  } | null = null;

  try {
    const moduleName = '@inkibra/ai-flow/codemode/plugin';
    const mod = await import(moduleName);
    pluginTesting = mod._testing;
  } catch {
    try {
      const monorepoPluginPath = path.resolve(
        thisDir,
        '../ai-flow/codemode/plugin.ts',
      );
      const mod = await import(pathToFileURL(monorepoPluginPath).href);
      pluginTesting = mod._testing;
    } catch {
      console.warn(
        '[warm-typia-cache] Skipping .tool.ts warm-up: @inkibra/ai-flow/codemode/plugin not available in this package.',
      );
      return;
    }
  }

  if (!pluginTesting) {
    return;
  }

  for (const filePath of files) {
    stats.toolsVisited += 1;
    try {
      const source = fs.readFileSync(filePath, 'utf-8');
      const bindings = pluginTesting.extractBindings(filePath, source);
      if (bindings.length === 0) {
        continue;
      }
      const generatedSource = pluginTesting.generateCodeBindings(
        source,
        bindings,
      );
      await pluginTesting.transformWithTypia(filePath, generatedSource);
    } catch (error) {
      stats.toolErrors += 1;
      console.warn(
        `[warm-typia-cache] Failed .tool.ts warm-up for ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function main() {
  const rootDir = process.cwd();
  const start = Date.now();
  const stats: WarmStats = {
    schemasVisited: 0,
    toolsVisited: 0,
    schemaErrors: 0,
    toolErrors: 0,
  };

  const { schemaFiles, toolFiles } = collectTypeFiles(rootDir);

  console.log(
    `[warm-typia-cache] Found ${schemaFiles.length} schema file(s) and ${toolFiles.length} tool file(s) under ${rootDir}`,
  );

  await warmSchemaFiles(schemaFiles, stats);
  await warmToolFiles(toolFiles, stats);

  const durationMs = Date.now() - start;
  console.log(
    `[warm-typia-cache] Done in ${durationMs}ms. schemas=${stats.schemasVisited} (errors=${stats.schemaErrors}), tools=${stats.toolsVisited} (errors=${stats.toolErrors})`,
  );

  if (stats.schemaErrors > 0 || stats.toolErrors > 0) {
    process.exitCode = 1;
  }
}

await main();
