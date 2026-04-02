import type { EffectModuleApi } from '../effects';
import type { AiModuleBindings } from '../module-deps';
import { createAiModuleDeps } from '../module-deps';
import { notificationsModule } from './notification-module';
import { todoEffects } from './todo-effects';
import { createTodoStore, type TodoStore } from './todo-store';

export type TodoDeps = {
  store: TodoStore;
  notifications: AiModuleBindings<typeof notificationsModule>;
  todoEffects: EffectModuleApi<typeof todoEffects>;
};

export const createTodoDeps = createAiModuleDeps<TodoDeps>()
  .depends({ notifications: notificationsModule })
  .factory(({ effects, modules }) => ({
    store: createTodoStore(),
    notifications: modules.notifications,
    todoEffects: todoEffects.bind(effects),
  }));
