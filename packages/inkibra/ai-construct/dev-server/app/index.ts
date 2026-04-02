import { createApp } from '@inkibra/router';
import { devAppConfigSchema } from './index.schemas';
import { devAppRoutes } from './route-tree';

export const DevServerApp = createApp({
  appId: 'ai-construct-dev',
  mountPath: '/constructs',
  schema: devAppConfigSchema,
  routes: devAppRoutes,
  defaultConfig: {
    version: '0.0.1',
  },
});
