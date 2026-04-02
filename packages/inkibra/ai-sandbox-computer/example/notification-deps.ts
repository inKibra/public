import type { EffectModuleApi } from '../effects';
import { createAiModuleDeps } from '../module-deps';
import { notificationEffects } from './notification-effects';

export type NotificationDeps = {
  notificationEffects: EffectModuleApi<typeof notificationEffects>;
};

export const createNotificationDeps =
  createAiModuleDeps<NotificationDeps>().factory(({ effects }) => ({
    notificationEffects: notificationEffects.bind(effects),
  }));
