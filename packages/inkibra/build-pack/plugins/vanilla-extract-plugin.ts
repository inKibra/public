import type { BunPlugin } from 'bun';
import { vanillaExtractPlugin } from './vanilla-extract-esbuild';

/**
 * Bun plugin for vanilla-extract CSS-in-TypeScript
 */
export const vanillaBuildPlugin: BunPlugin = vanillaExtractPlugin({
  identifiers: process.env.NODE_ENV === 'production' ? 'short' : 'debug',
}) as unknown as BunPlugin;

/**
 * Create a vanilla-extract plugin with custom options
 */
export function createVanillaBuildPlugin(options: {
  identifiers?: 'short' | 'debug';
}): BunPlugin {
  return vanillaExtractPlugin(options) as unknown as BunPlugin;
}
