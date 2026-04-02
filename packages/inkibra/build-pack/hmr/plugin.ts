/**
 * React Refresh Babel Plugin for Bun.
 *
 * This plugin transforms React components during build to support Hot Module
 * Replacement with React Fast Refresh. It registers components with
 * $RefreshReg$ and creates hook signatures with $RefreshSig$.
 *
 * @example
 * ```typescript
 * import { createReactRefreshPlugin } from '@inkibra/build-pack/hmr';
 *
 * await Bun.build({
 *   entrypoints: ['./src/client.tsx'],
 *   plugins: [createReactRefreshPlugin()],
 * });
 * ```
 */

import type { BunPlugin } from 'bun';

/**
 * Options for the React Refresh plugin.
 */
export interface ReactRefreshPluginOptions {
  /**
   * File pattern to match for transformation.
   * Default: /\.(tsx|jsx)$/
   */
  filter?: RegExp;

  /**
   * Directories to exclude from transformation.
   * Default: [/node_modules/]
   */
  exclude?: RegExp[];
}

/**
 * Creates a Bun plugin that transforms React components for Hot Module Replacement.
 *
 * Uses @babel/core with react-refresh/babel to:
 * - Register components with $RefreshReg$
 * - Create hook signatures with $RefreshSig$
 * - Enable state preservation during updates
 */
export function createReactRefreshPlugin(
  options: ReactRefreshPluginOptions = {},
): BunPlugin {
  const filter = options.filter ?? /\.(tsx|jsx)$/;
  const exclude = options.exclude ?? [/node_modules/];

  // Resolve react-refresh/babel path at plugin creation time
  // This ensures babel can find the plugin regardless of where it's invoked from
  let reactRefreshBabelPath: string | null = null;
  try {
    reactRefreshBabelPath = require.resolve('react-refresh/babel');
  } catch {
    console.warn(
      '[react-refresh] react-refresh/babel not found, transforms disabled',
    );
  }

  return {
    name: 'react-refresh',

    async setup(build) {
      // Skip if react-refresh isn't available
      if (!reactRefreshBabelPath) {
        return;
      }

      // Lazy load babel to avoid bundling in production
      const babel = await import('@babel/core');

      build.onLoad({ filter }, async (args) => {
        // Check exclusions
        for (const pattern of exclude) {
          if (pattern.test(args.path)) {
            return undefined; // Let Bun handle it normally
          }
        }

        // Read the source file
        const code = await Bun.file(args.path).text();

        try {
          // Transform with react-refresh/babel using resolved path
          const result = babel.transformSync(code, {
            filename: args.path,
            plugins: [reactRefreshBabelPath],
            parserOpts: {
              plugins: ['jsx', 'typescript'],
            },
            // Keep ESM, don't transform to CommonJS
            sourceType: 'module',
            // Generate sourcemaps for debugging
            sourceMaps: 'inline',
          });

          if (!result?.code) {
            // If transformation failed, return original
            return undefined;
          }

          // Determine loader based on file extension
          const loader = args.path.endsWith('.tsx') ? 'tsx' : 'jsx';

          return {
            contents: result.code,
            loader,
          };
        } catch (err) {
          console.error(
            `[react-refresh] Transform failed for ${args.path}:`,
            err,
          );
          // Return undefined to let Bun handle it with default behavior
          return undefined;
        }
      });
    },
  };
}

/**
 * Plugin that injects the HMR client runtime into the entry bundle.
 *
 * This should be used alongside createReactRefreshPlugin to enable
 * the full HMR experience.
 */
export function createHmrRuntimePlugin(): BunPlugin {
  return {
    name: 'hmr-runtime',

    setup(build) {
      // We'll inject the HMR connection code as a virtual module
      build.onResolve({ filter: /^virtual:hmr-runtime$/ }, () => {
        return {
          path: 'virtual:hmr-runtime',
          namespace: 'hmr-runtime',
        };
      });

      build.onLoad({ filter: /.*/, namespace: 'hmr-runtime' }, () => {
        return {
          contents: `
            // HMR Runtime - connects to dev server and handles updates
            import { connectHmr } from '@inkibra/router';

            // Auto-connect in development
            if (typeof window !== 'undefined') {
              connectHmr().catch(err => {
                console.warn('[HMR] Failed to connect:', err);
              });
            }

            export {};
          `,
          loader: 'ts',
        };
      });
    },
  };
}
