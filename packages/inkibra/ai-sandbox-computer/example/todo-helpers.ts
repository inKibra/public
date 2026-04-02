import type { OverlayFs } from '@inkibra/ai-flow';

export const TODO_PATH = '/agent/home/TODO.md';

export type TodoItem = {
  text: string;
  done: boolean;
  tags: string[];
};

export function parseTodos(content: string): TodoItem[] {
  // Skip YAML frontmatter block
  const bodyStart = content.indexOf('\n---\n');
  const body = bodyStart >= 0 ? content.slice(bodyStart + 5) : content;

  const items: TodoItem[] = [];
  for (const line of body.split('\n')) {
    const match = line.match(/^- \[([ x])\] (.+)$/);
    if (!match) continue;
    const done = match[1] === 'x';
    const rawText = match[2]!;
    const tags: string[] = [];
    const text = rawText
      .replace(/#(\w+)/g, (_m, tag) => {
        tags.push(tag as string);
        return '';
      })
      .trim();
    items.push({ text, done, tags });
  }
  return items;
}

export function serializeTodos(items: TodoItem[]): string {
  const now = new Date().toISOString();
  const meta = [
    '---',
    'id: todos',
    `count: ${items.length}`,
    `updated: ${now}`,
    '---',
  ].join('\n');

  const lines = items.map((item) => {
    const check = item.done ? 'x' : ' ';
    const tags =
      item.tags.length > 0 ? ` ${item.tags.map((t) => `#${t}`).join(' ')}` : '';
    return `- [${check}] ${item.text}${tags}`;
  });

  return `${meta}\n${lines.join('\n')}\n`;
}

export async function loadTodos(fs: OverlayFs): Promise<TodoItem[]> {
  let content = '';
  try {
    content = await fs.read(TODO_PATH);
  } catch {
    // File doesn't exist yet — start with empty list
  }
  return parseTodos(content);
}

export async function saveTodos(
  fs: OverlayFs,
  items: TodoItem[],
): Promise<void> {
  await fs.write(TODO_PATH, serializeTodos(items));
}
