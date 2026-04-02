import { describe, expect, test } from 'bun:test';
import { createOverlayFs, serializeContextFile } from '@inkibra/ai-flow';
import { stub } from '@inkibra/test-support/stub';
import type { Construct } from '../construct/construct';
import { ImpulsePool } from '../impulse/pool';
import { ResponseScheduler } from '../scheduler/scheduler';
import { savePinnedState } from '../vfs/pinned';
import {
  buildConstructCombinedSnapshot,
  buildConstructLabSnapshot,
  buildConstructRuntimeSnapshot,
  buildConstructStudioSnapshot,
} from './index';

function createMockVfs() {
  return createOverlayFs();
}

function createMockConstruct(vfs: ReturnType<typeof createMockVfs>) {
  const impulsePool = new ImpulsePool();
  const scheduler = new ResponseScheduler(vfs, impulsePool);

  return stub<Construct>({
    getVfs: () => vfs,
    getState: async () => ({
      id: 'construct-1',
      storage: 'memory',
      isRunning: true,
      activeImpulses: 0,
      queuedPerceptions: 0,
      scheduledResponses: 0,
    }),
    getRuntimeState: async () => ({
      activeImpulses: 0,
      activeResponses: 0,
      scheduledResponses: 0,
      schedulerBusy: false,
    }),
    getScheduler: () => scheduler,
    getImpulsePool: () => impulsePool,
    isHypnoActive: () => false,
    getHypnoStage: () => null,
    getHypnoReviewState: () => null,
    getRecentNapToolLog: () => [],
  });
}

async function seedContextFiles(vfs: ReturnType<typeof createMockVfs>) {
  const now = '2026-03-17T00:00:00.000Z';
  await vfs.write(
    '/agent/home/persona.md',
    serializeContextFile(
      {
        id: '/agent/home/persona.md',
        tags: ['persona', 'core'],
        title: 'Persona Core',
        summary: 'Core identity',
        created: now,
        updated: now,
      },
      '# Persona Core\n\nHello world',
    ),
  );
  await vfs.write(
    '/runtime/state/studio-workspace.md',
    serializeContextFile(
      {
        id: '/runtime/state/studio-workspace.md',
        tags: ['studio', 'workspace'],
        active_context_file_path: '/agent/home/persona.md',
        last_saved_at: now,
        created: now,
        updated: now,
      },
      'Studio workspace state',
    ),
  );
}

async function seedPressureContext(vfs: ReturnType<typeof createMockVfs>) {
  const now = '2026-03-17T00:00:00.000Z';

  await vfs.write(
    '/developer/config/lanes.yaml',
    [
      'conversation: {}',
      'heartbeat:',
      '  can_respond_to:',
      '    - conversation',
    ].join('\n'),
  );
  await vfs.write(
    '/runtime/handles/context-dirs.yaml',
    ['directories:', '  - runtime-pinned'].join('\n'),
  );
  await vfs.write('/agent/home/awake.md', 'awake context');
  await vfs.write('/agent/home/nap.md', 'n'.repeat(800));
  await savePinnedState(vfs, [
    {
      path: '/agent/home/awake.md',
      kind: 'file',
      mode: 'full',
      scope: 'conversation',
      source: 'ai',
      created_at: now,
      updated: now,
    },
    {
      path: '/agent/home/nap.md',
      kind: 'file',
      mode: 'full',
      scope: 'nap',
      source: 'ai',
      created_at: now,
      updated: now,
    },
  ]);
}

describe('construct snapshot contracts', () => {
  test('buildConstructStudioSnapshot returns pure construct studio shape', async () => {
    const vfs = createMockVfs();
    await seedContextFiles(vfs);
    const construct = createMockConstruct(vfs);

    const snapshot = await buildConstructStudioSnapshot({ construct });

    expect(Object.keys(snapshot).sort()).toEqual([
      'activeContextFilePath',
      'contextFiles',
      'lastSavedAt',
    ]);
    expect('persona' in snapshot).toBe(false);
    expect(snapshot.contextFiles).toHaveLength(1);
  });

  test('buildConstructStudioSnapshot pretty-prints CONTEXT.yaml for lab display', async () => {
    const vfs = createMockVfs();
    await seedContextFiles(vfs);
    await vfs.write(
      '/agent/home/CONTEXT.yaml',
      serializeContextFile(
        {
          id: '/agent/home/CONTEXT.yaml',
          tags: ['context'],
          created: '2026-03-17T00:00:00.000Z',
          updated: '2026-03-17T00:00:00.000Z',
        },
        "{stages: {scheduler: {renderer: {type: verbatim}}, 'nap/commit': {renderer: {type: summary}}}, lanes: {conversation: {impulse: {renderer: {type: verbatim}}}}}",
      ),
    );
    const construct = createMockConstruct(vfs);

    const snapshot = await buildConstructStudioSnapshot({ construct });
    const contextFile = snapshot.contextFiles.find(
      (file) => file.path === '/agent/home/CONTEXT.yaml',
    );

    expect(contextFile?.content).toMatch(/stages:\s*\n {2}scheduler:/);
    expect(contextFile?.content).toMatch(/ {2}nap\/commit:\s*\n {4}renderer:/);
    expect(contextFile?.content).toMatch(/lanes:\s*\n {2}conversation:/);
    expect(contextFile?.content).not.toContain('{stages:');
    expect(contextFile?.content).not.toContain('&impulse');
    expect(contextFile?.content).not.toContain('*impulse');
  });

  test('buildConstructLabSnapshot returns pure construct lab shape', async () => {
    const vfs = createMockVfs();
    await seedContextFiles(vfs);
    const construct = createMockConstruct(vfs);

    const snapshot = await buildConstructLabSnapshot(construct);

    expect('persona' in snapshot).toBe(false);
    expect(snapshot).toHaveProperty('transcript');
    expect(snapshot).toHaveProperty('runtimeState');
    expect(snapshot).toHaveProperty('hypno');
    expect(snapshot).toHaveProperty('toolLog');
    expect(snapshot).toHaveProperty('decisionLog');
  });

  test('buildConstructLabSnapshot includes recent nap tool log entries', async () => {
    const vfs = createMockVfs();
    await seedContextFiles(vfs);
    const construct = stub<Construct>({
      ...createMockConstruct(vfs),
      getRecentNapToolLog: () => [
        {
          id: 'nap:1',
          tool: 'nap',
          command: 'ls /context',
          output: 'core',
          createdAt: '2026-03-17T00:00:00.000Z',
        },
      ],
    });

    const snapshot = await buildConstructLabSnapshot(construct);

    expect(snapshot.toolLog).toContainEqual(
      expect.objectContaining({
        tool: 'nap',
        command: 'ls /context',
        output: 'core',
      }),
    );
  });

  test('buildConstructRuntimeSnapshot returns pure construct runtime shape', async () => {
    const vfs = createMockVfs();
    await seedContextFiles(vfs);
    const construct = createMockConstruct(vfs);

    const snapshot = await buildConstructRuntimeSnapshot(construct);

    expect('persona' in snapshot).toBe(false);
    expect(snapshot).toHaveProperty('constructState');
    expect(snapshot).toHaveProperty('runtimeState');
    expect(snapshot).toHaveProperty('residency');
    expect(snapshot).toHaveProperty('vfs');
    expect(snapshot).toHaveProperty('impulses');
    expect(snapshot).toHaveProperty('scheduledResponses');
  });

  test('buildConstructRuntimeSnapshot exposes the global max rendered lane/stage pressure', async () => {
    const vfs = createMockVfs();
    await seedContextFiles(vfs);
    await seedPressureContext(vfs);
    const construct = createMockConstruct(vfs);

    const snapshot = await buildConstructRuntimeSnapshot(construct);

    expect(snapshot.context?.maxPair).toBeDefined();
    expect(snapshot.context?.maxPair?.lane).toBe('conversation');
    expect(snapshot.context?.maxPair?.stage).toBe('impulse');
    expect(
      snapshot.context?.pairs.some(
        (entry) => entry.lane === 'conversation' && entry.stage === 'response',
      ),
    ).toBe(true);
  });

  test('combined snapshot view=studio only contains studio + cursor', async () => {
    const vfs = createMockVfs();
    await seedContextFiles(vfs);
    const construct = createMockConstruct(vfs);

    const snapshot = await buildConstructCombinedSnapshot({
      construct,
      options: {
        view: 'studio',
        cursor: 'cursor-1',
      },
    });

    expect(snapshot.cursor).toBe('cursor-1');
    expect(snapshot.studio).toBeDefined();
    expect(snapshot.lab).toBeUndefined();
    expect(snapshot.runtime).toBeUndefined();
  });

  test('combined snapshot view=lab contains studio + lab + runtime', async () => {
    const vfs = createMockVfs();
    await seedContextFiles(vfs);
    const construct = createMockConstruct(vfs);

    const snapshot = await buildConstructCombinedSnapshot({
      construct,
      options: {
        view: 'lab',
      },
    });

    expect(snapshot.studio).toBeDefined();
    expect(snapshot.lab).toBeDefined();
    expect(snapshot.runtime).toBeDefined();
  });

  test('combined snapshot view=runtime only contains runtime + cursor', async () => {
    const vfs = createMockVfs();
    await seedContextFiles(vfs);
    const construct = createMockConstruct(vfs);

    const snapshot = await buildConstructCombinedSnapshot({
      construct,
      options: {
        view: 'runtime',
        cursor: 'cursor-2',
      },
    });

    expect(snapshot.cursor).toBe('cursor-2');
    expect(snapshot.studio).toBeUndefined();
    expect(snapshot.lab).toBeUndefined();
    expect(snapshot.runtime).toBeDefined();
  });
});
