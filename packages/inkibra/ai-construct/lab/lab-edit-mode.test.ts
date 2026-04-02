import { describe, expect, test } from 'bun:test';
import { createOverlayFs } from '@inkibra/ai-flow';
import { stub } from '@inkibra/test-support/stub';
import type { Construct } from '../construct/construct';
import {
  applyConstructStudioAction,
  buildEditModeSnapshot,
} from './lab-edit-mode';

// ---------------------------------------------------------------------------
// Mock construct with in-memory VFS
// ---------------------------------------------------------------------------

function createMockVfs() {
  return createOverlayFs();
}

function createMockConstruct(vfs: ReturnType<typeof createMockVfs>) {
  return stub<Construct>({
    getVfs: () => vfs,
  });
}

// ---------------------------------------------------------------------------
// applyConstructStudioAction
// ---------------------------------------------------------------------------

describe('applyConstructStudioAction', () => {
  test('upsertContextFile writes content to VFS', async () => {
    const vfs = createMockVfs();
    const construct = createMockConstruct(vfs);

    await applyConstructStudioAction(construct, {
      action: 'upsertContextFile',
      file: {
        path: 'core/persona.md',
        content: '# My Persona\n\nHello world',
      },
    });

    const written = await vfs.read('/agent/home/core/persona.md');
    expect(written).toBe('# My Persona\n\nHello world');
  });

  test('upsertContextFile normalizes path', async () => {
    const vfs = createMockVfs();
    const construct = createMockConstruct(vfs);

    await applyConstructStudioAction(construct, {
      action: 'upsertContextFile',
      file: {
        path: '/agent/home/test.md',
        content: 'test content',
      },
    });

    expect(await vfs.exists('/agent/home/test.md')).toBe(true);
  });

  test('upsertContextFile updates studio state', async () => {
    const vfs = createMockVfs();
    const construct = createMockConstruct(vfs);

    await applyConstructStudioAction(construct, {
      action: 'upsertContextFile',
      file: {
        path: 'core/persona.md',
        content: 'content',
      },
    });

    // Studio state file should exist
    const stateExists = await vfs.exists('/runtime/state/studio-workspace.md');
    expect(stateExists).toBe(true);

    // Read it and check active path
    const stateContent = await vfs.read('/runtime/state/studio-workspace.md');
    expect(stateContent).toContain('/agent/home/core/persona.md');
  });

  test('deleteContextFile removes file from VFS', async () => {
    const vfs = createMockVfs();
    const construct = createMockConstruct(vfs);

    // Pre-populate a file
    await vfs.write('/agent/home/test.md', 'test');

    await applyConstructStudioAction(construct, {
      action: 'deleteContextFile',
      path: '/agent/home/test.md',
    });

    expect(await vfs.exists('/agent/home/test.md')).toBe(false);
  });

  test('deleteContextFile ignores missing file', async () => {
    const vfs = createMockVfs();
    const construct = createMockConstruct(vfs);

    // Should not throw
    await applyConstructStudioAction(construct, {
      action: 'deleteContextFile',
      path: '/agent/home/nonexistent.md',
    });
  });

  test('setActiveContextFile updates studio state', async () => {
    const vfs = createMockVfs();
    const construct = createMockConstruct(vfs);

    await applyConstructStudioAction(construct, {
      action: 'setActiveContextFile',
      path: 'core/persona.md',
    });

    const stateContent = await vfs.read('/runtime/state/studio-workspace.md');
    expect(stateContent).toContain('/agent/home/core/persona.md');
  });
});

// ---------------------------------------------------------------------------
// buildEditModeSnapshot
// ---------------------------------------------------------------------------

describe('buildEditModeSnapshot', () => {
  test('returns empty when no context files exist', async () => {
    const vfs = createMockVfs();
    const construct = createMockConstruct(vfs);

    const snapshot = await buildEditModeSnapshot(construct);
    expect(snapshot.contextFiles).toHaveLength(0);
    expect(snapshot.activeContextFilePath).toBeUndefined();
  });
});
