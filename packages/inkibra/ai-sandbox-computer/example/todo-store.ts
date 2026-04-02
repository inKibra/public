import type { FsApi } from '@inkibra/ai-flow/codemode/types';
import {
  parseTodos,
  serializeTodos,
  TODO_PATH,
  type TodoItem,
} from './todo-helpers';

function extractTags(raw: string): { text: string; tags: string[] } {
  const tags: string[] = [];
  const text = raw
    .replace(/#(\w+)/g, (_match, tag) => {
      tags.push(tag as string);
      return '';
    })
    .trim();
  return { text, tags };
}

async function loadTodos(fs: FsApi): Promise<TodoItem[]> {
  let content = '';
  try {
    content = await fs.read(TODO_PATH);
  } catch {
    // File doesn't exist yet.
  }
  return parseTodos(content);
}

async function saveTodos(fs: FsApi, items: TodoItem[]): Promise<void> {
  await fs.write(TODO_PATH, serializeTodos(items));
}

export type TodoStore = ReturnType<typeof createTodoStore>;

export function createTodoStore() {
  return {
    async list(fs: FsApi, tag?: string): Promise<TodoItem[]> {
      const items = await loadTodos(fs);
      return tag ? items.filter((item) => item.tags.includes(tag)) : items;
    },

    async add(
      fs: FsApi,
      rawText: string,
    ): Promise<{ text: string; tags: string[]; total: number }> {
      const { text, tags } = extractTags(rawText);
      const items = await loadTodos(fs);
      items.push({ text, done: false, tags });
      await saveTodos(fs, items);
      return { text, tags, total: items.length };
    },

    async complete(
      fs: FsApi,
      index: number,
    ): Promise<{ index: number; text: string }> {
      const items = await loadTodos(fs);
      const item = items[index];
      if (!item) {
        throw new Error(`Invalid index: ${index} (have ${items.length} items)`);
      }
      items[index] = { ...item, done: true };
      await saveTodos(fs, items);
      return { index, text: item.text };
    },

    async remove(
      fs: FsApi,
      index: number,
    ): Promise<{ index: number; text: string; remaining: number }> {
      const items = await loadTodos(fs);
      const removed = items[index];
      if (!removed) {
        throw new Error(`Invalid index: ${index} (have ${items.length} items)`);
      }
      items.splice(index, 1);
      await saveTodos(fs, items);
      return { index, text: removed.text, remaining: items.length };
    },
  };
}
