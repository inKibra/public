/**
 * Vanilla Extract Noop Plugin
 *
 * Bun plugin that intercepts @vanilla-extract/* module files and replaces
 * them with noop implementations for SSR. This allows .css.ts files to
 * execute without crashing when VE build support is disabled.
 *
 * Usage:
 * ```typescript
 * import { plugin } from 'bun';
 * import { vanillaExtractNoopPlugin } from '@inkibra/build-pack';
 *
 * plugin(vanillaExtractNoopPlugin());
 * ```
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BunPlugin } from 'bun';

// Path to the noop module
const NOOP_MODULE_PATH = path.join(import.meta.dir, 'vanilla-extract-noop.ts');

// Cache the noop module contents
let noopContents: string | null = null;

function getNoopContents(): string {
  if (noopContents === null) {
    noopContents = fs.readFileSync(NOOP_MODULE_PATH, 'utf-8');
  }
  return noopContents;
}

/**
 * Create the vanilla-extract noop plugin
 *
 * Uses onLoad to intercept the actual @vanilla-extract module files from
 * node_modules and replace their content with our noop implementations.
 */
export function vanillaExtractNoopPlugin(): BunPlugin {
  return {
    name: 'vanilla-extract-noop',
    setup(build) {
      // Match ALL @vanilla-extract module files
      // This regex matches paths like:
      // - node_modules/@vanilla-extract/css/...
      // - node_modules/.bun/@vanilla-extract+css@.../...
      // Including subdirectories like fileScope, adapter, etc.
      const veModuleFilter = /@vanilla-extract[+/]/;

      build.onLoad({ filter: veModuleFilter }, (_args) => {
        // Return our noop module contents instead of the real VE code
        return {
          contents: getNoopContents(),
          loader: 'ts',
        };
      });
    },
  };
}

export default vanillaExtractNoopPlugin;
