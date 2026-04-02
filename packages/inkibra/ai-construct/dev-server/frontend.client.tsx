import { defineClientBuild } from '@inkibra/build-pack/client-config';

export const buildConfig = defineClientBuild({
  clientDir: 'ai-construct-dev',
  plugins: {
    vanillaExtract: false,
    assetsPath: true,
    loadSchemas: true,
  },
});

import createLogger from '@inkibra/logger';
import {
  implementApiRoutes,
  implementEventStreamRoutes,
} from '@inkibra/router';
import {
  createFetchTransport,
  createLocalStorageAdapter,
  createSegmentSource,
  createSessionStorageAdapter,
  hydrate,
  prepare,
} from '@inkibra/router/react';
import { DevServerApp } from './app';
import {
  constructRoutes,
  constructStreamRoutes,
  createConstructRoute,
  deleteConstructRoute,
  getCombinedSnapshotRoute,
  getContextTraceRoute,
  getLanesRoute,
  listConstructsRoute,
  readOnlyFileRoute,
} from './app/route-tree';

async function hydrateDevServer() {
  const preparedApp = prepare(DevServerApp);
  const logger = createLogger('ai-construct-dev.client');

  const transport = createFetchTransport({
    logger,
    includeCredentials: false,
    storageAdapters: {
      session: createSessionStorageAdapter(preparedApp.initialSessionStorage),
      device: createLocalStorageAdapter(preparedApp.initialDeviceStorage),
    },
  });

  const allApiRoutes = {
    ...constructRoutes,
    createDevConstruct: createConstructRoute,
    listDevConstructs: listConstructsRoute,
    deleteDevConstruct: deleteConstructRoute,
    readDevFileReadOnly: readOnlyFileRoute,
    getDevCombinedSnapshot: getCombinedSnapshotRoute,
    getDevContextTrace: getContextTraceRoute,
    getDevLanes: getLanesRoute,
  };

  const allStreamRoutes = {
    ...constructStreamRoutes,
  };

  const apiImplementations = implementApiRoutes(
    transport.provider,
    allApiRoutes,
  );
  const eventStreamImplementations = implementEventStreamRoutes(
    transport.provider,
    allStreamRoutes,
  );

  await hydrate({
    preparedApp,
    source: createSegmentSource(window.location.href),
    apiImplementations,
    eventStreamImplementations,
    readContext: transport.readContext,
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void hydrateDevServer().catch(console.error);
  });
} else {
  void hydrateDevServer().catch(console.error);
}
