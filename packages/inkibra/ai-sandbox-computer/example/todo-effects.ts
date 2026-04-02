import { createEffectModule, effect } from '../effects';

export const todoEffects = createEffectModule({
  namespace: 'todo',
  effects: {
    notifyCreated: effect<{ text: string; tags: string[] }>({
      preview: ({ text }) => `Would emit todo-created effect for "${text}"`,
    }),
  },
});
