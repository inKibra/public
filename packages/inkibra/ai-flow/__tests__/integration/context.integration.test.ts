import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import {
  createContextManager,
  createFilePersistence,
} from '../../context/index';

const TEST_DIR = '/tmp/ai-flow-context-test';

describe('context integration', () => {
  describe('FilePersistence', () => {
    beforeEach(async () => {
      await rm(TEST_DIR, { recursive: true, force: true });
      await mkdir(TEST_DIR, { recursive: true });
    });

    afterEach(async () => {
      await rm(TEST_DIR, { recursive: true, force: true });
    });

    test('save and load context', async () => {
      const persistence = createFilePersistence({ baseDir: TEST_DIR });

      await persistence.write({
        id: 'test-ctx-1',
        meta: {
          id: 'test-ctx-1',
          tags: ['important'],
          created: '2025-01-01T00:00:00Z',
          updated: '2025-01-01T00:00:00Z',
        },
        content: '# My Notes\n\nSome important notes.',
      });

      const loaded = await persistence.load('test-ctx-1');

      expect(loaded).not.toBeNull();
      expect(loaded?.meta.id).toBe('test-ctx-1');
      expect(loaded?.content).toContain('# My Notes');
    });

    test('supports nested ids with custom extensions', async () => {
      const persistence = createFilePersistence({ baseDir: TEST_DIR });

      await persistence.write({
        id: 'logs/entry-1.log',
        meta: {
          id: 'logs/entry-1.log',
          tags: ['logs'],
          created: '2025-01-01T00:00:00Z',
          updated: '2025-01-01T00:00:00Z',
        },
        content: 'line one',
      });

      const loaded = await persistence.load('logs/entry-1.log');

      expect(loaded).not.toBeNull();
      expect(loaded?.meta.id).toBe('logs/entry-1.log');
      expect(loaded?.content).toBe('line one');
    });

    test('list contexts', async () => {
      const persistence = createFilePersistence({ baseDir: TEST_DIR });

      await persistence.write({
        id: 'ctx-1',
        meta: {
          id: 'ctx-1',
          tags: ['a'],
          created: '2025-01-01T00:00:00Z',
          updated: '2025-01-01T00:00:00Z',
        },
        content: 'Content 1',
      });

      await persistence.write({
        id: 'ctx-2',
        meta: {
          id: 'ctx-2',
          tags: ['b'],
          created: '2025-01-02T00:00:00Z',
          updated: '2025-01-02T00:00:00Z',
        },
        content: 'Content 2',
      });

      await persistence.write({
        id: 'ctx-3',
        meta: {
          id: 'ctx-3',
          tags: ['a'],
          created: '2025-01-03T00:00:00Z',
          updated: '2025-01-03T00:00:00Z',
        },
        content: 'Content 3',
      });

      // List all
      const all = await persistence.list();
      expect(all.length).toBe(3);

      // Filter by tags
      const tagged = await persistence.list({ tags: ['a'] });
      expect(tagged.length).toBe(2);

      // Limit results
      const limited = await persistence.list({ limit: 1 });
      expect(limited.length).toBe(1);
    });

    test('delete context', async () => {
      const persistence = createFilePersistence({ baseDir: TEST_DIR });

      await persistence.write({
        id: 'to-delete',
        meta: { id: 'to-delete', tags: [], created: '', updated: '' },
        content: 'Will be deleted',
      });

      let loaded = await persistence.load('to-delete');
      expect(loaded).not.toBeNull();

      await persistence.remove('to-delete');

      loaded = await persistence.load('to-delete');
      expect(loaded).toBeNull();
    });

    test('search contexts', async () => {
      const persistence = createFilePersistence({ baseDir: TEST_DIR });

      await persistence.write({
        id: 'ctx-fitness',
        meta: {
          id: 'ctx-fitness',
          tags: ['fitness', 'health'],
          created: '',
          updated: '',
        },
        content: '# Fitness Goals\n\nRun a marathon.',
      });

      await persistence.write({
        id: 'ctx-cooking',
        meta: {
          id: 'ctx-cooking',
          tags: ['cooking', 'recipes'],
          created: '',
          updated: '',
        },
        content: '# Cooking Notes\n\nMake pasta.',
      });

      const results = await persistence.search!('fitness');

      expect(results.results.length).toBe(1);
      expect(results.results[0]?.id).toBe('ctx-fitness');
    });
  });

  describe('ContextManager', () => {
    beforeEach(async () => {
      await rm(TEST_DIR, { recursive: true, force: true });
      await mkdir(TEST_DIR, { recursive: true });
    });

    afterEach(async () => {
      await rm(TEST_DIR, { recursive: true, force: true });
    });

    test('load and track context', async () => {
      const persistence = createFilePersistence({ baseDir: TEST_DIR });
      const manager = createContextManager({ persistence });

      // Pre-save a context
      await persistence.write({
        id: 'existing',
        meta: { id: 'existing', tags: [], created: '', updated: '' },
        content: 'Existing content',
      });

      // Load it
      const loaded = await manager.load('existing');

      expect(loaded).not.toBeNull();
      expect(loaded?.meta.id).toBe('existing');
      expect(manager.isDirty('existing')).toBe(false);
    });

    test('save marks context as dirty', async () => {
      const persistence = createFilePersistence({ baseDir: TEST_DIR });
      const manager = createContextManager({ persistence });

      const id = await manager.stage({
        tags: ['test'],
        content: 'New content',
      });

      expect(manager.isDirty(id)).toBe(true);
      expect(manager.isDirty()).toBe(true);
    });

    test('commit persists changes', async () => {
      const persistence = createFilePersistence({ baseDir: TEST_DIR });
      const manager = createContextManager({ persistence });

      const id = await manager.stage({
        tags: ['test'],
        content: 'New content',
      });

      expect(manager.isDirty(id)).toBe(true);

      await manager.commit();

      expect(manager.isDirty(id)).toBe(false);

      // Verify it's actually persisted
      const loaded = await persistence.load(id);
      expect(loaded).not.toBeNull();
      expect(loaded?.content).toBe('New content');
    });

    test('discard reverts changes', async () => {
      const persistence = createFilePersistence({ baseDir: TEST_DIR });
      const manager = createContextManager({ persistence });

      // Pre-save a context
      await persistence.write({
        id: 'to-modify',
        meta: { id: 'to-modify', tags: [], created: '', updated: '' },
        content: 'Original content',
      });

      // Load and modify
      await manager.load('to-modify');
      await manager.stage({
        id: 'to-modify',
        content: 'Modified content',
      });

      expect(manager.isDirty('to-modify')).toBe(true);

      // Discard changes
      manager.discard('to-modify');

      expect(manager.isDirty('to-modify')).toBe(false);

      // Reload and verify original
      const reloaded = await manager.load('to-modify');
      expect(reloaded?.content).toBe('Original content');
    });

    test('getChanges returns tracked changes', async () => {
      const persistence = createFilePersistence({ baseDir: TEST_DIR });
      const manager = createContextManager({ persistence });

      // Pre-save a context for modification
      await persistence.write({
        id: 'to-modify',
        meta: { id: 'to-modify', tags: [], created: '', updated: '' },
        content: 'Original',
      });

      // Create new
      await manager.stage({ content: 'New 1' });

      // Modify existing
      await manager.load('to-modify');
      await manager.stage({ id: 'to-modify', content: 'Modified' });

      const changes = manager.getChanges();

      expect(changes.length).toBe(2);
      expect(changes.some((c) => c.action === 'created')).toBe(true);
      expect(changes.some((c) => c.action === 'modified')).toBe(true);
    });

    test('delete marks context for deletion', async () => {
      const persistence = createFilePersistence({ baseDir: TEST_DIR });
      const manager = createContextManager({ persistence });

      // Pre-save
      await persistence.write({
        id: 'to-delete',
        meta: { id: 'to-delete', tags: [], created: '', updated: '' },
        content: 'Will be deleted',
      });

      await manager.load('to-delete');
      await manager.remove('to-delete');

      const changes = manager.getChanges();
      expect(
        changes.some((c) => c.id === 'to-delete' && c.action === 'deleted'),
      ).toBe(true);

      // Commit the deletion
      await manager.commit();

      // Verify it's actually deleted
      const loaded = await persistence.load('to-delete');
      expect(loaded).toBeNull();
    });
  });
});
