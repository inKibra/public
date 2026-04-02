import { describe, expect, test } from 'bun:test';
import { type ContextMeta, createOverlayFs } from '@inkibra/ai-flow';
import { createTestDriver } from '@inkibra/dal-connection/create-driver';
import initLogger from '@inkibra/logger';
import {
  contextIdToPath,
  contextPathToId,
  createDalContextPersistence,
  createVfsContextManager,
  createVfsContextPersistence,
} from './context-persistence';

function buildMeta(id: string): ContextMeta {
  const now = new Date().toISOString();
  return {
    id,
    tags: [],
    created: now,
    updated: now,
  };
}

describe('context persistence (vfs adapter)', () => {
  test('converts between context paths and ids', () => {
    expect(contextPathToId('/agent/home/SOUL.md')).toBe('SOUL.md');
    expect(contextPathToId('/agent/home/core/session.md')).toBe(
      'core/session.md',
    );
    expect(contextPathToId('some/relative/path.md')).toBe(
      'some/relative/path.md',
    );
    expect(contextIdToPath('SOUL.md')).toBe('/agent/home/SOUL.md');
    expect(contextIdToPath('core/session.md')).toBe(
      '/agent/home/core/session.md',
    );
  });

  test('writes and loads nested ids with custom extensions', async () => {
    const vfs = createOverlayFs();
    const persistence = createVfsContextPersistence(vfs);

    await persistence.write({
      id: 'logs/2026-02-06.log',
      meta: buildMeta('logs/2026-02-06.log'),
      content: 'log entry',
    });

    expect(await vfs.exists('/agent/home/logs/2026-02-06.log')).toBe(true);

    const loaded = await persistence.load('logs/2026-02-06.log');
    expect(loaded).not.toBeNull();
    expect(loaded?.meta.id).toBe('logs/2026-02-06.log');
    expect(loaded?.content).toBe('log entry');
  });

  test('defaults extensionless ids to .md', async () => {
    const vfs = createOverlayFs();
    const persistence = createVfsContextPersistence(vfs);

    await persistence.write({
      id: 'notes/today',
      meta: buildMeta('notes/today'),
      content: 'daily notes',
    });

    expect(await vfs.exists('/agent/home/notes/today.md')).toBe(true);

    const loaded = await persistence.load('notes/today');
    expect(loaded).not.toBeNull();
    expect(loaded?.content).toBe('daily notes');
  });

  test('supports manager stage/commit against vfs adapter', async () => {
    const vfs = createOverlayFs();
    const manager = createVfsContextManager(vfs);

    const id = await manager.stage({
      id: 'core/session.md',
      tags: ['core'],
      meta: { started_at: '2026-02-06T00:00:00.000Z' },
      content: '',
    });

    expect(manager.isDirty(id)).toBe(true);

    await manager.commit(id);

    const loaded = await manager.load(id);
    expect(loaded).not.toBeNull();
    expect(loaded?.meta.id).toBe('core/session.md');
    expect(loaded?.meta.tags).toEqual(['core']);
    expect(loaded?.meta.started_at).toBe('2026-02-06T00:00:00.000Z');
  });

  test('lists, searches, and removes contexts', async () => {
    const vfs = createOverlayFs();
    const persistence = createVfsContextPersistence(vfs);

    await persistence.write({
      id: 'notes/fitness.md',
      meta: { ...buildMeta('notes/fitness.md'), tags: ['fitness', 'health'] },
      content: 'run a marathon',
    });

    await persistence.write({
      id: 'notes/cooking.md',
      meta: { ...buildMeta('notes/cooking.md'), tags: ['cooking'] },
      content: 'make pasta',
    });

    const tagged = await persistence.list({ tags: ['fitness'] });
    expect(tagged.map((m) => m.id)).toEqual(['notes/fitness.md']);

    const searched = await persistence.search?.('marathon');
    expect(searched?.results.length).toBe(1);
    expect(searched?.results[0]?.id).toBe('notes/fitness.md');

    await persistence.remove('notes/cooking.md');
    expect(await persistence.load('notes/cooking.md')).toBeNull();
  });
});

describe('context persistence (dal adapter)', () => {
  test('writes, lists, and loads context files', async () => {
    const driver = await createTestDriver();
    const logger = initLogger('dal-context-persistence-test');

    try {
      const persistence = createDalContextPersistence({
        driver,
        logger,
        constructId: 'construct-test-1',
      });

      await persistence.write({
        id: 'core/session.md',
        meta: buildMeta('core/session.md'),
        content: 'session body',
      });

      const loaded = await persistence.load('core/session.md');
      expect(loaded).not.toBeNull();
      expect(loaded?.content).toBe('session body');

      const listed = await persistence.listFs?.('/agent/home/core');
      expect(
        listed?.some((entry) => entry.path === '/agent/home/core/session.md'),
      ).toBe(true);
    } finally {
      await driver.disconnect();
    }
  });
});
