#!/usr/bin/env bun
import * as fs from 'fs';
import * as path from 'path';

type AssetImport = {
  modulePath: string;
  importedFrom: string;
  type: 'denzel-asset' | 'denzel-client';
};

type GenerateOptions = {
  packageRoot: string;
};

const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|svg|gif|webp|ico)$/;
const CLIENT_PATTERN = /\.client(\.tsx?)?$/;

export async function generateAssetDeclarations(options: GenerateOptions) {
  const { packageRoot } = options;

  const collectedImports = new Map<string, AssetImport>();
  const errors: string[] = [];

  // Scan all TypeScript files in the package
  const glob = new Bun.Glob('**/*.{ts,tsx}');
  const files = Array.from(glob.scanSync({ cwd: packageRoot, absolute: true }));

  for (const filePath of files) {
    // Skip node_modules, dist, build, and test files
    if (
      filePath.includes('node_modules') ||
      filePath.includes('/dist/') ||
      filePath.includes('/build/') ||
      filePath.includes('.test.') ||
      filePath.includes('.generated.')
    ) {
      continue;
    }

    try {
      const contents = await fs.promises.readFile(filePath, 'utf-8');

      // Regex to find imports with attributes
      // Matches: import x from 'path' with { type: 'denzel-asset' }
      const importWithAttributesRegex =
        /import\s+(?:[\w*{},\s]+\s+from\s+)?['"]([^'"]+)['"]\s+with\s+\{[^}]*type:\s*['"]([^'"]+)['"]/g;

      let match: RegExpExecArray | null = null;
      // biome-ignore lint/suspicious/noAssignInExpressions: this is a good pattern here
      while ((match = importWithAttributesRegex.exec(contents)) !== null) {
        const [, importPath, attributeType] = match;

        // Check if importPath is defined
        if (!importPath) {
          continue;
        }

        if (
          attributeType !== 'denzel-asset' &&
          attributeType !== 'denzel-client'
        ) {
          continue;
        }

        // Require absolute imports for denzel assets/clients
        if (importPath.startsWith('.')) {
          // For relative imports, we'll generate wildcard declarations in the same directory
          // This is actually fine and more flexible
        }

        // Resolve the import path relative to the importing file
        const resolvedPath = resolveImportPath(
          importPath,
          filePath,
          packageRoot,
        );

        if (!resolvedPath) {
          errors.push(
            `Cannot resolve import '${importPath}' from ${path.relative(packageRoot, filePath)}`,
          );
          continue;
        }

        // Validate the import
        if (attributeType === 'denzel-asset') {
          if (!IMAGE_EXTENSIONS.test(importPath)) {
            errors.push(
              `Invalid denzel-asset import: '${importPath}' in ${path.relative(packageRoot, filePath)}.\n` +
                '  denzel-asset can only be used with image files (.png, .jpg, .jpeg, .svg, .gif, .webp, .ico)',
            );
            continue;
          }

          if (!fs.existsSync(resolvedPath)) {
            errors.push(
              `Asset file not found: ${resolvedPath} (imported from ${path.relative(packageRoot, filePath)})`,
            );
            continue;
          }
        } else if (attributeType === 'denzel-client') {
          if (!CLIENT_PATTERN.test(importPath)) {
            errors.push(
              `Invalid denzel-client import: '${importPath}' in ${path.relative(packageRoot, filePath)}.\n` +
                '  denzel-client can only be used with .client files (.client.tsx, .client.ts)',
            );
            continue;
          }

          // For client files, check with .tsx extension if not specified
          const clientPath =
            resolvedPath.endsWith('.tsx') || resolvedPath.endsWith('.ts')
              ? resolvedPath
              : resolvedPath + '.tsx';

          if (
            !fs.existsSync(clientPath) &&
            !fs.existsSync(resolvedPath + '.ts')
          ) {
            errors.push(
              `Client file not found: ${clientPath} (imported from ${path.relative(packageRoot, filePath)})`,
            );
            continue;
          }
        }

        // Collect the import with the EXACT path as written in the source
        // This is important for TypeScript module resolution
        collectedImports.set(importPath, {
          modulePath: importPath,
          importedFrom: path.relative(packageRoot, filePath),
          type: attributeType as 'denzel-asset' | 'denzel-client',
        });
      }
    } catch (err) {
      // Silently skip files that can't be read
    }
  }

  // Report errors
  if (errors.length > 0) {
    console.error('\n❌ Asset declaration errors:\n');
    errors.forEach((err) => console.error(`  ${err}\n`));
    throw new Error(`Found ${errors.length} error(s) in asset declarations`);
  }

  // Show where declarations are found
  console.log(`\n📋 Found ${collectedImports.size} denzel declarations:`);
  for (const import_ of collectedImports.values()) {
    console.log(
      `  ${import_.type}: ${import_.modulePath} (from ${import_.importedFrom})`,
    );
  }

  // Generate individual .d.ts files next to each asset file
  let totalFiles = 0;
  let assetImports = 0;

  for (const import_ of collectedImports.values()) {
    if (import_.type === 'denzel-asset') {
      assetImports++;

      // Resolve the actual file path
      const resolvedPath = resolveImportPath(
        import_.modulePath,
        path.join(packageRoot, import_.importedFrom),
        packageRoot,
      );

      if (resolvedPath && fs.existsSync(resolvedPath)) {
        // Generate .d.ts file next to the asset
        const dtsPath = resolvedPath + '.d.ts';
        const relativeDtsPath = path.relative(packageRoot, dtsPath);

        // Use the original import path as declared in the source
        const declarations = generateAssetDeclaration(import_.modulePath);
        await fs.promises.writeFile(dtsPath, declarations, 'utf-8');

        console.log(`  📝 Generated: ${relativeDtsPath}`);
        totalFiles++;
      }
    }
  }

  console.log(
    `✅ Generated ${totalFiles} .d.ts files with ${collectedImports.size} total declarations`,
  );

  return {
    count: collectedImports.size,
    files: totalFiles,
    imports: Array.from(collectedImports.values()),
  };
}

function resolveImportPath(
  importPath: string,
  fromFile: string,
  packageRoot: string,
): string | null {
  // Handle absolute imports (like @inkibra/...)
  if (importPath.startsWith('@inkibra/')) {
    const packageName = importPath.split('/').slice(0, 2).join('/');
    const relativePath = importPath.substring(packageName.length + 1);

    // Resolve to the packages directory
    const packagesDir = path.resolve(packageRoot, '../');
    const targetPackage = packageName.replace('@inkibra/', '');
    const resolved = path.resolve(packagesDir, targetPackage, relativePath);

    return resolved;
  }

  // Handle relative imports
  if (importPath.startsWith('.')) {
    const fromDir = path.dirname(fromFile);
    return path.resolve(fromDir, importPath);
  }

  return null;
}

function generateAssetDeclaration(absoluteModulePath: string): string {
  return `declare module "${absoluteModulePath}" {
  const src: string;
  export default src;
}
`;
}

// CLI usage
if (import.meta.main) {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('Usage: generate-asset-declarations <packageRoot>');
    console.error('Example: generate-asset-declarations .');
    process.exit(1);
  }

  const [packageRoot] = args;

  if (!packageRoot) {
    console.error('Error: packageRoot is required');
    process.exit(1);
  }

  await generateAssetDeclarations({
    packageRoot,
  });
}
