import { createPreload } from '@inkibra/build-pack';

createPreload({
  packageDir: import.meta.dir,
  matchScripts: ['cli/demo.tsx', 'dev-server/server.ts', '.test.ts', 'test'],
  plugins: {
    loadSchemas: true,
    assetsPath: true,
    clientStub: true,
    codeMode: false,
    vanillaExtractNoop: false,
  },
});
