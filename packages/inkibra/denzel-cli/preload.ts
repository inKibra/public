/**
 * Bun Preload Script
 *
 * Registers loadSchemas plugin for CLI scripts.
 */

import { createPreload } from '@inkibra/build-pack';

createPreload({
  packageDir: import.meta.dir,
  matchScripts: ['cli.ts'],
  plugins: {
    loadSchemas: true,
    assetsPath: false,
    clientBuild: false,
  },
});
