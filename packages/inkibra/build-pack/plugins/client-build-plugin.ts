import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BunPlugin } from 'bun';

// Load the template code as a string
const clientBuildTemplateCode = fs.readFileSync(
  path.join(import.meta.dir, 'client-build-template.ts'),
  'utf-8',
);

type ClientBuildPluginOptions = {
  /**
   * Output directory for built client files
   * @default './dist'
   */
  outdir?: string;
  /**
   * Base path for the client files in the URL
   * @default '/dist'
   */
  publicPath?: string;
  /**
   * Path to the build-clients.ts script
   */
  buildScriptPath: string;
  /**
   * Path to the assets directory
   */
  assetsPath?: string;
  /**
   * Public path for assets
   */
  assetsPublicPath?: string;
  /**
   * Enable code splitting for bundle chunks
   * @default true
   */
  splitting?: boolean;
  /**
   * Per-frontend splitting overrides.
   * Keys are patterns to match against the client path.
   * Values are the splitting setting for that frontend.
   *
   * @example
   * ```typescript
   * splittingOverrides: {
   *   'my-ios-app': false,  // Disable splitting for iOS app (OTA needs single bundle)
   * }
   * ```
   */
  splittingOverrides?: Record<string, boolean>;
  /**
   * Per-frontend format overrides.
   * Keys are patterns to match against the client path.
   * Values are the format ('esm' | 'cjs' | 'iife') for that frontend.
   *
   * @example
   * ```typescript
   * formatOverrides: {
   *   'my-ios-app': 'cjs',  // Use CJS for iOS app (OTA loader can't handle ESM)
   * }
   * ```
   */
  formatOverrides?: Record<string, 'esm' | 'cjs' | 'iife'>;
  /**
   * Per-frontend minify overrides.
   * Keys are patterns to match against the client path.
   * Values are the minify setting for that frontend.
   */
  minifyOverrides?: Record<string, boolean>;
};

/**
 * Plugin that intercepts imports to .client.tsx files and transforms them
 * to export functions for client bundle integration.
 *
 * @deprecated Use the buildConfig pattern with getClientManifest() instead.
 *
 * Migration guide:
 * 1. In .client.tsx, add buildConfig export:
 *    ```tsx
 *    import { defineClientBuild } from '@inkibra/build-pack/client-config';
 *    export const buildConfig = defineClientBuild({ clientDir: 'name', ... });
 *    ```
 *
 * 2. In .server.tsx, use getClientManifest:
 *    ```tsx
 *    import { buildConfig } from './name.client';
 *    import { getClientManifest, getClientAssetTags } from '@inkibra/build-pack';
 *
 *    const manifest = await getClientManifest(buildConfig, { envDefines: {...} });
 *    {getClientAssetTags(manifest)}
 *    ```
 *
 * 3. In preload.ts, clientStub is now enabled by default.
 *    Remove `clientBuild: true` if present.
 */
export function clientBuildPlugin(
  options: ClientBuildPluginOptions,
): BunPlugin {
  const {
    outdir = './dist',
    publicPath = '/dist',
    buildScriptPath,
    assetsPath = './assets',
    assetsPublicPath = '/dist/assets',
    splitting = true,
    splittingOverrides = {},
    formatOverrides = {},
    minifyOverrides = {},
  } = options;

  if (!buildScriptPath) {
    throw new Error('clientBuildPlugin requires buildScriptPath option');
  }

  return {
    name: 'client-build-plugin',
    setup(build) {
      // Intercept imports to .client.tsx or .client.ts files
      build.onLoad(
        { filter: /\.client\.tsx?$/ },
        async ({ path: clientPath }) => {
          console.log(`[clientBuildPlugin] Processing: ${clientPath}`);

          // Determine output paths
          const clientDir = path.basename(path.dirname(clientPath));
          const outputDir = path.resolve(process.cwd(), outdir);

          // Ensure output directory exists
          await fs.promises.mkdir(path.join(outputDir, clientDir), {
            recursive: true,
          });

          // Determine build settings
          const NODE_ENV = process.env.NODE_ENV || 'development';
          const BUILD_MODE = process.env.BUILD_MODE || '';
          let minify = NODE_ENV === 'production';
          const sourcemap =
            NODE_ENV === 'production' ? 'none' : ('inline' as const);

          // Check minify overrides
          for (const [pattern, value] of Object.entries(minifyOverrides)) {
            if (clientPath.includes(pattern) || clientDir.includes(pattern)) {
              minify = value;
              console.log(
                `[clientBuildPlugin] Minify override for ${clientDir}: ${value}`,
              );
              break;
            }
          }

          // Determine effective splitting value by checking overrides
          let effectiveSplitting = splitting;
          for (const [pattern, value] of Object.entries(splittingOverrides)) {
            if (clientPath.includes(pattern) || clientDir.includes(pattern)) {
              effectiveSplitting = value;
              console.log(
                `[clientBuildPlugin] Splitting override for ${clientDir}: ${value}`,
              );
              break;
            }
          }

          // Determine effective format by checking overrides (default: esm)
          let effectiveFormat: 'esm' | 'cjs' | 'iife' = 'esm';
          for (const [pattern, value] of Object.entries(formatOverrides)) {
            if (clientPath.includes(pattern) || clientDir.includes(pattern)) {
              effectiveFormat = value;
              console.log(
                `[clientBuildPlugin] Format override for ${clientDir}: ${value}`,
              );
              break;
            }
          }

          // Build script path needs to be absolute
          const absoluteBuildScriptPath = path.resolve(
            process.cwd(),
            buildScriptPath,
          );
          const absoluteAssetsPath = path.resolve(process.cwd(), assetsPath);
          const absoluteAssetsOutdir = path.resolve(process.cwd(), outdir);

          // Generate the module code that will be returned
          // This code will be executed when the .client.tsx file is imported
          const generatedCode = clientBuildTemplateCode
            .replaceAll('__NODE_ENV__', NODE_ENV)
            .replaceAll('__BUILD_MODE__', BUILD_MODE)
            .replaceAll('__CLIENT_PATH__', clientPath)
            .replaceAll('__CLIENT_DIR__', clientDir)
            .replaceAll('__OUTPUT_DIR__', outputDir)
            .replaceAll('__PUBLIC_PATH__', publicPath)
            .replaceAll('__MINIFY__', String(minify))
            .replaceAll('__SOURCEMAP__', sourcemap)
            .replaceAll('__BUILD_SCRIPT_PATH__', absoluteBuildScriptPath)
            .replaceAll('__ASSETS_PATH__', absoluteAssetsPath)
            .replaceAll('__ASSETS_OUTDIR__', absoluteAssetsOutdir)
            .replaceAll('__ASSETS_PUBLIC_PATH__', assetsPublicPath)
            .replaceAll('__SPLITTING__', String(effectiveSplitting))
            .replaceAll('__FORMAT__', effectiveFormat);

          console.log(
            `[clientBuildPlugin] Generated module for: ${clientPath}`,
          );

          return {
            contents: generatedCode,
            loader: 'tsx',
          };
        },
      );
    },
  };
}
