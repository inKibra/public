/**
 * Build script for client bundles
 *
 * Uses createClientBuildRunner for reduced boilerplate.
 * Called by clientBuildPlugin when building .client.tsx files.
 */

import { createClientBuildRunner } from '@inkibra/build-pack';

await createClientBuildRunner({
  packageDir: import.meta.dir,

  // Explicit plugin configuration
  plugins: {
    loadSchemas: true,
    assetsPath: true,
    reactRefresh: true, // Enable React Refresh for HMR
    vanillaExtract: true, // Enable vanilla-extract CSS processing
  },

  // Enable code splitting for lazy-loaded routes
  splitting: true,

  // Path configuration (using defaults, but explicit for clarity)
  paths: {
    assets: `${import.meta.dir}/assets`,
    outdir: './dist',
    publicPath: '/dist',
    assetsPublicPath: '/dist/assets',
  },
}).run();
