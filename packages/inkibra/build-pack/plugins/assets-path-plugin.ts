import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BunPlugin } from 'bun';

type AssetsPathPluginOptions = {
  /**
   * Current package's assets directory (e.g., 'my-web-app/assets')
   */
  assetsPath: string;
  /**
   * Output directory for built assets
   * @default './dist'
   */
  outdir?: string;
  /**
   * Public URL prefix for assets
   * @default '/assets'
   */
  publicPath?: string;
};

type AssetCacheEntry = {
  hash: string;
  outputPath: string;
  publicUrl: string;
};

/**
 * Plugin that handles asset imports with smart routing:
 * - Current package assets: copy to dist/assets without hashing
 * - Cross-package assets: copy to dist/assets/{packageName} with content hash
 * - Virtual asset resolvers: function-based asset path builders
 * - Favicon references: direct path references
 */
export function assetsPathPlugin(options: AssetsPathPluginOptions): BunPlugin {
  const { assetsPath, outdir = './dist', publicPath = '/assets' } = options;

  const normalizedAssetsPath = path.resolve(assetsPath);
  const assetCache = new Map<string, AssetCacheEntry>();

  return {
    name: 'assets-path-plugin',
    setup(build) {
      // Handler 1: Virtual asset path functions (/assets/{site}/asset)
      build.onLoad(
        { filter: /\/assets\/[^/]+\/asset$/ },
        ({ path: assetPath }) => {
          const siteMatch = assetPath.match(/assets\/([^/]+)\/asset$/);
          const site = siteMatch?.[1] ?? 'inkibra.com';
          const contents = `export default function assetPath(file){return '${publicPath}/${site}/' + file}`;
          return { contents, loader: 'js' };
        },
      );

      // Handler 2: Favicon file references (/assets/{site}/favicon/*)
      build.onLoad(
        { filter: /\/assets\/[^/]+\/favicon\/[^/]+\.(ico|png|webmanifest)$/ },
        ({ path: assetPath }) => {
          const match = assetPath.match(/assets\/([^/]+)\/favicon\/([^/]+)$/);
          const site = match?.[1] ?? 'inkibra.com';
          const file = match?.[2] ?? 'favicon.ico';
          const contents = `export default '${publicPath}/${site}/favicon/${file}'`;
          return { contents, loader: 'js' };
        },
      );

      // Handler 3: Absolute module imports (any scoped package)
      build.onResolve(
        { filter: /^@[^/]+\/.*\.(png|jpg|jpeg|svg|gif|webp|ico)$/ },
        ({ path: modulePath }) => {
          // Convert @scope/package-name/path to actual file path
          const match = modulePath.match(/^@([^/]+)\/([^/]+)\/(.+)$/);
          if (!match) return null;

          const [, scope, packageName, relativePath] = match;

          // Check if all required parts are defined
          if (!scope || !packageName || !relativePath) {
            return null;
          }

          // Try to find the package in common locations
          const possiblePaths = [
            // Monorepo structure: packages/inkibra/package-name (for @inkibra)
            scope === 'inkibra'
              ? path.resolve(
                  process.cwd(),
                  '..',
                  '..',
                  '..',
                  'packages',
                  'inkibra',
                  packageName,
                  relativePath,
                )
              : null,
            // Monorepo structure: packages/scope/package-name
            path.resolve(
              process.cwd(),
              '..',
              '..',
              '..',
              'packages',
              scope,
              packageName,
              relativePath,
            ),
            // Direct package structure: node_modules/@scope/package-name
            path.resolve(
              process.cwd(),
              '..',
              '..',
              '..',
              'node_modules',
              `@${scope}`,
              packageName,
              relativePath,
            ),
            // Current directory structure
            path.resolve(
              process.cwd(),
              'packages',
              scope,
              packageName,
              relativePath,
            ),
          ].filter(Boolean);

          // Find the first path that exists
          for (const possiblePath of possiblePaths) {
            if (possiblePath && fs.existsSync(possiblePath)) {
              return { path: possiblePath };
            }
          }

          // If no path found, return null to let other resolvers handle it
          return null;
        },
      );

      // Handler 4: Image file imports with smart routing
      build.onLoad(
        { filter: /\.(png|jpg|jpeg|svg|gif|webp|ico)$/ },
        async ({ path: assetPath }) => {
          const absolutePath = path.resolve(assetPath);

          // Check cache first
          if (assetCache.has(absolutePath)) {
            const cached = assetCache.get(absolutePath);
            if (cached) {
              const contents = `export default ${JSON.stringify(cached.publicUrl)};`;
              return { contents, loader: 'js' };
            }
          }

          // Read file and compute hash
          const fileContent = await Bun.file(absolutePath).arrayBuffer();
          const hash = createHash('sha256')
            .update(Buffer.from(fileContent))
            .digest('hex')
            .substring(0, 8);

          const parsedPath = path.parse(absolutePath);
          const ext = parsedPath.ext;
          const base = parsedPath.name;

          // Determine if this is a current-package asset
          const isCurrentPackageAsset = absolutePath.startsWith(
            normalizedAssetsPath + path.sep,
          );

          let outputPath: string;
          let publicUrl: string;

          if (isCurrentPackageAsset) {
            // Current package asset: copy to outdir/{relativePath} (no hash)
            const relativePath = path.relative(
              normalizedAssetsPath,
              absolutePath,
            );
            outputPath = path.join(outdir, relativePath);
            publicUrl = `${publicPath}/${relativePath.replace(/\\/g, '/')}`;
          } else {
            // Cross-package asset: extract package name and copy with hash
            const packageMatch = absolutePath.match(
              /packages\/[^/]+\/([^/]+)\//,
            );
            const packageName = packageMatch?.[1] ?? 'shared';

            const filename = `${base}.${hash}${ext}`;
            outputPath = path.join(outdir, packageName, filename);
            publicUrl = `${publicPath}/${packageName}/${filename}`;
          }

          // Ensure output directory exists
          await fs.promises.mkdir(path.dirname(outputPath), {
            recursive: true,
          });

          // Copy file if it doesn't exist or hash changed
          const shouldCopy = !fs.existsSync(outputPath);
          if (shouldCopy) {
            await fs.promises.writeFile(outputPath, Buffer.from(fileContent));
            console.log(`Copied asset: ${absolutePath} -> ${outputPath}`);
          }

          // Cache result
          const cacheEntry: AssetCacheEntry = { hash, outputPath, publicUrl };
          assetCache.set(absolutePath, cacheEntry);

          // Return module that exports the URL
          const contents = `export default ${JSON.stringify(publicUrl)};`;
          return { contents, loader: 'js' };
        },
      );
    },
  };
}
