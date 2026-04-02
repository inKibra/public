import { createPreload } from '../build-pack';

createPreload({
  packageDir: import.meta.dir,
  matchScripts: ['.test.ts', 'test'],
  plugins: {
    loadSchemas: true,
    codeMode: true,
    assetsPath: false,
    clientStub: false,
    clientBuild: false,
  },
});
