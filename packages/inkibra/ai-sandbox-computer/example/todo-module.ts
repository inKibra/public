import { defineCommand } from '../define-command';
import { defineAiComputerModule } from '../define-module';
import { notificationsModule } from './notification-module';
import { addTodo, completeTodo, listTodos, removeTodo } from './todo-api.tool';
import { createTodoDeps } from './todo-deps';
import type { TodoItem } from './todo-helpers';

function renderTodoLines(items: TodoItem[]): string {
  return items
    .map((item, index) => {
      const check = item.done ? 'x' : ' ';
      const tags =
        item.tags.length > 0
          ? ` ${item.tags.map((tag) => `#${tag}`).join(' ')}`
          : '';
      return `${index}. [${check}] ${item.text}${tags}`;
    })
    .join('\n');
}

export const todoModule = defineAiComputerModule({
  name: 'todo-example',
  readme: `# todo-example

Todo management bindings plus command adapters used by the example computer surface.

The package exposes direct function-style bindings for list/add/complete/remove flows. The same capabilities are also available as developer commands for command-oriented preview code.
`,
  deps: createTodoDeps,
  bindings: {
    listTodos,
    addTodo,
    completeTodo,
    removeTodo,
  },
  commands: ({ self }) => [
    defineCommand({
      name: 'todo-list',
      description: 'List todo items, optionally filtered by tag',
      args: {
        tag: { type: 'string', flag: '--tag', description: 'Filter by tag' },
      },
      async fn(parsed) {
        const tag = parsed.tag as string | undefined;
        const items = await self.listTodos({ tag });
        return { items, tag };
      },
      render(result) {
        if (result.items.length === 0) {
          return result.tag
            ? `No todos with tag #${result.tag}`
            : 'No todos yet. Use: todo-add "your task"';
        }
        const header = result.tag ? `Todos (#${result.tag}):` : 'Todos:';
        return `${header}\n${renderTodoLines(result.items)}`;
      },
    }),
    defineCommand({
      name: 'todo-add',
      description: 'Add a new todo item',
      args: {
        text: {
          type: 'string',
          position: 0,
          required: true,
          description: 'Todo text (inline #tags extracted automatically)',
        },
      },
      async fn(parsed) {
        return self.addTodo({ text: parsed.text as string });
      },
      render(result) {
        const tagStr =
          result.tags.length > 0
            ? ` (${result.tags.map((tag) => `#${tag}`).join(' ')})`
            : '';
        return `Added: "${result.text}"${tagStr} — ${result.total} total`;
      },
    }),
    defineCommand({
      name: 'todo-done',
      description: 'Mark a todo item as done',
      args: {
        index: {
          type: 'number',
          position: 0,
          required: true,
          description: 'Item index (0-based)',
        },
      },
      async fn(parsed) {
        return self.completeTodo({ index: parsed.index as number });
      },
      render(result) {
        return `Done: "${result.text}"`;
      },
    }),
    defineCommand({
      name: 'todo-remove',
      description: 'Remove a todo item',
      args: {
        index: {
          type: 'number',
          position: 0,
          required: true,
          description: 'Item index (0-based)',
        },
      },
      async fn(parsed) {
        return self.removeTodo({ index: parsed.index as number });
      },
      render(result) {
        return `Removed: "${result.text}" — ${result.remaining} remaining`;
      },
    }),
  ],
  // Explicit dependency for readability in the module definition.
  depends: {
    notifications: notificationsModule,
  },
});
