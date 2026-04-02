import { defineCodeBinding } from '@inkibra/ai-flow/codemode';
import type { FsApi } from '@inkibra/ai-flow/codemode/types';
import type { TodoDeps } from './todo-deps';
import type { TodoItem } from './todo-helpers';

/** List todo items, optionally filtered by tag. */
export const listTodos = defineCodeBinding(async function listTodos(
  { tag }: { tag?: string },
  { deps, fs }: { deps: TodoDeps; fs: FsApi },
): Promise<TodoItem[]> {
  return deps.store.list(fs, tag);
});

/** Add a todo item, emit a todo effect, and notify the user. */
export const addTodo = defineCodeBinding(async function addTodo(
  { text }: { text: string },
  { deps, fs }: { deps: TodoDeps; fs: FsApi },
): Promise<{ text: string; tags: string[]; total: number }> {
  const result = await deps.store.add(fs, text);
  await deps.todoEffects.notifyCreated({
    text: result.text,
    tags: result.tags,
  });
  await deps.notifications.sendNotification({
    target: 'user',
    message: `New todo: "${result.text}"`,
  });
  return result;
});

/** Mark a todo item as done. */
export const completeTodo = defineCodeBinding(async function completeTodo(
  { index }: { index: number },
  { deps, fs }: { deps: TodoDeps; fs: FsApi },
): Promise<{ index: number; text: string }> {
  return deps.store.complete(fs, index);
});

/** Remove a todo item. */
export const removeTodo = defineCodeBinding(async function removeTodo(
  { index }: { index: number },
  { deps, fs }: { deps: TodoDeps; fs: FsApi },
): Promise<{ index: number; text: string; remaining: number }> {
  return deps.store.remove(fs, index);
});
