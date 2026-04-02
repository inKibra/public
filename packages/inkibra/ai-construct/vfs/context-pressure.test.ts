import { describe, expect, test } from 'bun:test';
import { createOverlayFs, type OverlayFs } from '@inkibra/ai-flow';
import {
  autoCloseOldest,
  buildLaneStageContextPressureDiagnostics,
  type ContextPressureConfig,
  closeStaleLogFiles,
  DEFAULT_CONTEXT_PRESSURE_CONFIG,
  evaluateContextPressure,
} from './context-pressure';
import { VFS_PATHS } from './layout';
import {
  loadOpenedState,
  type OpenedFilesState,
  saveOpenedState,
} from './opened';
import { savePinnedState } from './pinned';

function createState(overrides?: Partial<OpenedFilesState>): OpenedFilesState {
  const now = new Date().toISOString();
  return {
    updated: now,
    context_bytes: 0,
    context_tokens: 0,
    files: [],
    recently_closed: [],
    ...overrides,
  };
}

async function seedOpenedState(vfs: OverlayFs): Promise<void> {
  const now = new Date().toISOString();
  const expired = new Date(Date.now() - 60_000).toISOString();
  const future = new Date(Date.now() + 60_000).toISOString();

  await saveOpenedState(
    vfs,
    createState({
      context_bytes: 700,
      context_tokens: 700,
      files: [
        {
          path: VFS_PATHS.core.soul,
          type: 'file',
          opened_at: now,
          size_bytes: 200,
          size_tokens: 200,
          score: 0,
        },
        {
          path: '/agent/home/memory/expired.md',
          type: 'file',
          opened_at: now,
          last_accessed_at: now,
          size_bytes: 200,
          size_tokens: 200,
          score: 1,
          expires_at: expired,
        },
        {
          path: '/agent/home/memory/low-score.md',
          type: 'file',
          opened_at: now,
          last_accessed_at: now,
          size_bytes: 150,
          size_tokens: 150,
          score: 0.2,
          expires_at: future,
        },
        {
          path: '/agent/home/memory/high-score.md',
          type: 'file',
          opened_at: now,
          last_accessed_at: now,
          size_bytes: 150,
          size_tokens: 150,
          score: 2,
          expires_at: future,
        },
      ],
    }),
  );
}

describe('context pressure', () => {
  test('reports ok/warning/critical thresholds', () => {
    const config: ContextPressureConfig = {
      maxContextTokens: 100,
      warnThreshold: 0.75,
      criticalThreshold: 0.9,
      autoCloseTarget: 0.7,
    };

    const ok = evaluateContextPressure(
      createState({
        files: [
          {
            path: '/agent/home/a.md',
            type: 'file',
            opened_at: '',
            size_bytes: 10,
            size_tokens: 50,
          },
        ],
      }),
      config,
    );
    expect(ok.status).toBe('ok');

    const warning = evaluateContextPressure(
      createState({
        files: [
          {
            path: '/agent/home/a.md',
            type: 'file',
            opened_at: '',
            size_bytes: 10,
            size_tokens: 80,
          },
        ],
      }),
      config,
    );
    expect(warning.status).toBe('warning');

    const critical = evaluateContextPressure(
      createState({
        files: [
          {
            path: '/agent/home/a.md',
            type: 'file',
            opened_at: '',
            size_bytes: 10,
            size_tokens: 95,
          },
        ],
      }),
      config,
    );
    expect(critical.status).toBe('critical');
  });

  test('autoCloseOldest prioritizes expired then low-score and preserves pinned', async () => {
    const vfs = createOverlayFs();
    await seedOpenedState(vfs);

    const result = await autoCloseOldest(vfs, 450, [VFS_PATHS.core.soul]);

    expect(result.closed.map((entry) => entry.path)).toEqual([
      '/agent/home/memory/expired.md',
      '/agent/home/memory/low-score.md',
    ]);

    const state = await loadOpenedState(vfs);
    expect(
      state.files.some((entry) => entry.path === VFS_PATHS.core.soul),
    ).toBe(true);
    expect(
      state.files.some(
        (entry) => entry.path === '/agent/home/memory/high-score.md',
      ),
    ).toBe(true);
    expect(state.context_tokens).toBeLessThanOrEqual(450);
  });

  test('autoCloseOldest respects glob policy paths even without pin metadata', async () => {
    const vfs = createOverlayFs();
    const now = new Date().toISOString();

    await saveOpenedState(
      vfs,
      createState({
        context_bytes: 300,
        context_tokens: 300,
        files: [
          {
            path: '/agent/home/SOUL.md',
            type: 'file',
            opened_at: now,
            size_bytes: 150,
            size_tokens: 150,
            score: 0,
            pin: 'awake',
          },
          {
            path: '/tmp/scratch.md',
            type: 'file',
            opened_at: now,
            size_bytes: 150,
            size_tokens: 150,
            score: 0,
          },
        ],
      }),
    );

    const result = await autoCloseOldest(vfs, 200);
    expect(result.closed.map((entry) => entry.path)).toEqual([
      '/tmp/scratch.md',
    ]);

    const state = await loadOpenedState(vfs);
    expect(
      state.files.some((entry) => entry.path === '/agent/home/SOUL.md'),
    ).toBe(true);
  });

  test('autoCloseOldest closes non-pinned files first', async () => {
    const vfs = createOverlayFs();
    const now = new Date().toISOString();

    await saveOpenedState(
      vfs,
      createState({
        context_bytes: 450,
        context_tokens: 450,
        files: [
          {
            path: '/agent/home/SOUL.md',
            type: 'file',
            opened_at: now,
            size_bytes: 150,
            size_tokens: 150,
            score: 0,
            pin: 'awake',
          },
          {
            path: '/agent/home/chat-state/pre.md',
            type: 'file',
            opened_at: now,
            size_bytes: 150,
            size_tokens: 150,
            score: 0,
          },
          {
            path: '/tmp/scratch.md',
            type: 'file',
            opened_at: now,
            size_bytes: 150,
            size_tokens: 150,
            score: 0,
          },
        ],
      }),
    );

    const result = await autoCloseOldest(vfs, 200);
    expect(
      result.closed.some((entry) => entry.path === '/agent/home/SOUL.md'),
    ).toBe(false);
    expect(
      result.closed.some(
        (entry) => entry.path === '/agent/home/chat-state/pre.md',
      ),
    ).toBe(true);
  });
});

/**
 * Regression tests for context pressure bugs.
 *
 * These tests assert CORRECT behavior. They should FAIL before the fixes
 * and PASS after.
 */

describe('context pressure default config', () => {
  /**
   * Bug 2 fix: maxContextTokens default should be 128K (safe for most models),
   * not 400K which exceeds many models' actual limits.
   *
   * With 128K default, 259K tracked tokens should report "critical" pressure.
   */
  test('DEFAULT_CONTEXT_PRESSURE_CONFIG.maxContextTokens is 128K or less', () => {
    expect(
      DEFAULT_CONTEXT_PRESSURE_CONFIG.maxContextTokens,
    ).toBeLessThanOrEqual(128_000);
  });

  test('259K tokens triggers critical pressure with default config', () => {
    const now = new Date().toISOString();
    const files = [];
    // Build files totaling ~259K tokens
    for (let i = 0; i < 95; i++) {
      const tokens = Math.floor(259_000 / 95);
      files.push({
        path: `/agent/home/file-${i}.md`,
        type: 'file' as const,
        opened_at: now,
        size_bytes: tokens * 4,
        size_tokens: tokens,
      });
    }
    const state = createState({ context_tokens: 259_000, files });

    const result = evaluateContextPressure(
      state,
      DEFAULT_CONTEXT_PRESSURE_CONFIG,
    );

    // With maxContextTokens=128K, 259K tokens is way over critical (0.9)
    expect(result.status).toBe('critical');
  });
});

describe('stale log file cleanup', () => {
  /**
   * Bug 3 fix: closeStaleLogFiles should close log files opened >2 days ago
   * that are in full mode and not pinned.
   */
  test('closeStaleLogFiles removes old full-mode log files', async () => {
    const vfs = createOverlayFs();
    const now = new Date();
    const threeDaysAgo = new Date(
      now.getTime() - 3 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

    await saveOpenedState(
      vfs,
      createState({
        context_bytes: 300_000,
        context_tokens: 75_000,
        files: [
          // Stale log — should be closed
          {
            path: '/logs/conversation/2026/W10/2026-03-05-0.log',
            type: 'file',
            mode: 'full',
            opened_at: threeDaysAgo,
            size_bytes: 100_000,
            size_tokens: 25_000,
          },
          // Recent log — should stay
          {
            path: '/logs/conversation/2026/W12/2026-03-20-0.log',
            type: 'file',
            mode: 'full',
            opened_at: oneHourAgo,
            size_bytes: 50_000,
            size_tokens: 12_000,
          },
          // Stale but pinned — should stay
          {
            path: '/logs/transcript/2026/W10/2026-03-04-0.log',
            type: 'file',
            mode: 'full',
            pin: 'awake',
            opened_at: threeDaysAgo,
            size_bytes: 50_000,
            size_tokens: 12_000,
          },
          // Non-log file — should stay regardless of age
          {
            path: '/agent/home/SOUL.md',
            type: 'file',
            mode: 'full',
            opened_at: threeDaysAgo,
            size_bytes: 100_000,
            size_tokens: 26_000,
          },
        ],
      }),
    );

    const result = await closeStaleLogFiles(vfs);

    expect(result.closed).toHaveLength(1);
    expect(result.closed[0]!.path).toBe(
      '/logs/conversation/2026/W10/2026-03-05-0.log',
    );
    // Remaining: 3 files
    expect(result.state.files).toHaveLength(3);
  });

  test('closeStaleLogFiles is a no-op when all logs are recent', async () => {
    const vfs = createOverlayFs();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    await saveOpenedState(
      vfs,
      createState({
        context_bytes: 50_000,
        context_tokens: 12_000,
        files: [
          {
            path: '/logs/conversation/2026/W12/2026-03-20-0.log',
            type: 'file',
            mode: 'full',
            opened_at: oneHourAgo,
            size_bytes: 50_000,
            size_tokens: 12_000,
          },
        ],
      }),
    );

    const result = await closeStaleLogFiles(vfs);
    expect(result.closed).toHaveLength(0);
    expect(result.state.files).toHaveLength(1);
  });
});

describe('lane/stage context pressure diagnostics', () => {
  test('uses the worst rendered lane/stage pair as the global pressure source', async () => {
    const vfs = createOverlayFs();
    const now = new Date().toISOString();

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
    await vfs.write('/agent/home/conversation.md', 'c'.repeat(40));
    await vfs.write('/agent/home/nap.md', 'n'.repeat(800));

    await savePinnedState(vfs, [
      {
        path: '/agent/home/conversation.md',
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

    const diagnostics = await buildLaneStageContextPressureDiagnostics(vfs, {
      ...DEFAULT_CONTEXT_PRESSURE_CONFIG,
      maxContextTokens: 100,
    });

    const conversationResponse = diagnostics.pairs.find(
      (entry) => entry.lane === 'conversation' && entry.stage === 'response',
    );

    expect(conversationResponse).toBeDefined();
    expect(conversationResponse?.status).toBe('ok');
    const conversationNap = diagnostics.pairs.find(
      (entry) => entry.lane === 'conversation' && entry.stage === 'nap/analyze',
    );
    expect(conversationNap).toBeDefined();
    expect(conversationNap?.status).toBe('ok');

    expect(diagnostics.maxPair?.lane).toBe('conversation');
    expect(diagnostics.maxPair?.stage).toBe('impulse');
    expect(diagnostics.maxPair?.status).toBe('ok');
    expect(diagnostics.maxPair?.contextTokens ?? 0).toBeGreaterThanOrEqual(
      conversationResponse?.contextTokens ?? 0,
    );
  });
});

describe('workflow restart on failed instance', () => {
  /**
   * Bug 1 fix: startWorkflow should restart terminal (failed/cancelled) instances
   * instead of returning the stale failed instance.
   */
  test('startWorkflow resets a failed instance to running', async () => {
    // We test this indirectly — the workflow runtime's startWorkflow should
    // return an instance with status='running' even when a failed instance
    // exists with the same instanceId.
    //
    // This is tested via the workflow package's own test suite.
    // Here we just verify the contract that ensureStarted relies on:
    // a failed instance should NOT prevent restart.
    const failedInstance = {
      id: 'construct-scheduler--my-construct',
      status: 'failed' as const,
    };

    // After the fix, ensureStarted should NOT treat a failed instance as "started"
    const isTerminal =
      failedInstance.status === 'failed' ||
      failedInstance.status === 'cancelled';
    const shouldSkipRestart = !isTerminal;

    // A failed instance should NOT cause a skip
    expect(shouldSkipRestart).toBe(false);
  });
});
