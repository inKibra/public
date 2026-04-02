import { createPreload } from '@inkibra/build-pack';

process.env.INKIBRA_TYPIA_CACHE_DIR ??= `${import.meta.dir}/node_modules/.cache/inkibra-typia-tests`;

createPreload({
  packageDir: import.meta.dir,
  matchScripts: ['.test.ts', 'test'],
  plugins: {
    loadSchemas: true,
    assetsPath: false,
    clientStub: false,
    clientBuild: false,
  },
});
