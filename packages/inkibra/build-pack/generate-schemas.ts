import * as path from 'node:path';
import { Glob } from 'bun';
import { createTypiaTransformPlugin } from './plugins/typia-transform';

type SchemaGroup = {
  entrypoints: string[];
  outdir: string;
};

/**
 * Finds the deepest common ancestor directory for a set of file paths
 */
function findCommonBase(files: string[]): string {
  if (files.length === 0) return './';
  if (files.length === 1) {
    const firstFile = files[0];
    if (!firstFile) return './';
    return path.dirname(firstFile);
  }

  // Normalize all paths to use forward slashes and remove leading './'
  const normalizedPaths = files.map((f) => f.replace(/^\.\//, '').split('/'));

  // Find common prefix
  const firstPath = normalizedPaths[0];
  if (!firstPath) return './';

  const commonParts: string[] = [];

  for (let i = 0; i < firstPath.length - 1; i++) {
    // -1 to exclude filename
    const part = firstPath[i];
    if (!part) break;

    const allMatch = normalizedPaths.every(
      (p) => p.length > i && p[i] === part,
    );

    if (allMatch) {
      commonParts.push(part);
    } else {
      break;
    }
  }

  return commonParts.length > 0 ? `./${commonParts.join('/')}/` : './';
}

/**
 * Groups schema files by their common base directory
 */
function groupSchemaFiles(files: string[]): SchemaGroup[] {
  // For simplicity, we'll use a single group with common base
  // This matches the user's requirement: all files in one build with common base as outdir
  const commonBase = findCommonBase(files);

  return [
    {
      entrypoints: files.map((f) => (f.startsWith('./') ? f : `./${f}`)),
      outdir: commonBase,
    },
  ];
}

/**
 * Main function to generate schemas
 */
async function generateSchemas(packageDir: string = process.cwd()) {
  console.info('Scanning for schema files...');

  // Find all schema files using Bun's Glob
  const glob = new Glob('**/{*.schemas.ts,schemas.ts}');
  const schemaFiles: string[] = [];

  for await (const file of glob.scan({
    cwd: packageDir,
    onlyFiles: true,
  })) {
    // Filter out node_modules, build, and dist directories
    if (
      !file.includes('node_modules/') &&
      !file.includes('/build/') &&
      !file.includes('/dist/')
    ) {
      schemaFiles.push(file);
    }
  }

  if (schemaFiles.length === 0) {
    console.info('No schema files found.');
    return;
  }

  console.info(`Found ${schemaFiles.length} schema file(s):`);
  for (const file of schemaFiles) {
    console.info(`  - ${file}`);
  }

  // Group files by common base
  const groups = groupSchemaFiles(schemaFiles);

  // Generate schemas for each group
  for (const group of groups) {
    const packageName = path.basename(packageDir);
    console.info(
      `\nGenerating schemas for ${packageName} (${group.entrypoints.length} file(s))...`,
    );
    console.info(`  Output directory: ${group.outdir}`);

    try {
      const result = await Bun.build({
        entrypoints: group.entrypoints,
        outdir: group.outdir,
        plugins: [
          createTypiaTransformPlugin({
            filter: /(?:\.schemas|(?:^|[/\\])schemas)\.ts$/,
            baseDir: packageDir,
            cache: true,
            skipIfNoTypia: true,
          }),
        ],
      });

      if (!result.success) {
        console.error('Build failed:');
        for (const log of result.logs) {
          console.error(log);
        }
        process.exit(1);
      }

      console.info(
        `  ✓ Successfully generated ${result.outputs.length} output file(s)`,
      );
    } catch (error) {
      console.error('Error during build:', error);
      process.exit(1);
    }
  }

  console.info('\n✓ Schema generation complete!');
}

// Run if called directly
if (import.meta.main) {
  await generateSchemas();
}

export { generateSchemas };
