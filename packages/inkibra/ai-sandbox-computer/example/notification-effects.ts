import { createEffectModule, effect } from '../effects';

export const notificationEffects = createEffectModule({
  namespace: 'notification',
  effects: {
    send: effect<{ target: string; message: string }>({
      preview: ({ target, message }) => `Would notify ${target}: ${message}`,
    }),
  },
});
