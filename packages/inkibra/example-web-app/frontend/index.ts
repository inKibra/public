import { createApp } from '@inkibra/router';
import { appRoutes } from '../app/routes';
import { appConfigSchema } from './index.schemas';

export const ExampleApp = createApp({
  appId: 'example',
  mountPath: '/app',
  schema: appConfigSchema,
  routes: appRoutes,
  defaultConfig: {
    version: '0.0.1',
  },
});
