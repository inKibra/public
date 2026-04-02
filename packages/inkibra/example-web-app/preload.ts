/**
 * Bun Preload Script
 *
 * Registers plugins for server, dev, and build-clients scripts.
 * Uses createPreload for reduced boilerplate.
 *
 * Note: clientStub is now enabled by default for server context,
 * so we don't need to enable clientBuild anymore.
 */

import { createPreload } from '@inkibra/build-pack';

createPreload({
  packageDir: import.meta.dir,

  // Match different scripts with appropriate plugin sets
  matchScripts: {
    // Server scripts get full plugin support (clientStub is default)
    server: ['server', 'dev.ts', 'start.ts', 'scripts', '.test.ts', 'test'],
    // Build scripts only need loadSchemas and assetsPath
    buildClients: ['build-clients.ts'],
  },

  // Explicit plugin configuration
  plugins: {
    loadSchemas: true,
    assetsPath: true,
    // clientStub is enabled by default - no need to specify
  },

  // Path configuration
  paths: {
    assets: `${import.meta.dir}/assets`,
    outdir: './dist',
    publicPath: '/dist',
    assetsPublicPath: '/dist/assets',
  },
});
