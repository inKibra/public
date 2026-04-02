import { describe, expect, test } from 'bun:test';
import { createOverlayFs } from '@inkibra/ai-flow';
import { codeFunction } from '@inkibra/ai-flow/codemode';
import {
  createInMemoryTransactionRuntime,
  createNoopEffectContext,
} from '@inkibra/router';
import { fileOperationCommands } from './commands/file-ops';
import { commitPreview } from './commit-engine';
import { createComputer } from './create-computer';
import { defineAiComputerModule } from './define-module';
import { notificationsModule } from './example/notification-module';
import { todoModule } from './example/todo-module';
import { createAiModuleDeps } from './module-deps';
import { createPreviewEngine } from './preview-engine';
import type { ImpulseFlowContext } from './preview-exec-tool';
import { createPreviewExecTool } from './preview-exec-tool';
import { createCommandRegistry } from './registry';

function requirePreviewSelection(ctx: ImpulseFlowContext) {
  const execId = ctx.previewExecOrder?.[0];
  if (!execId) throw new Error('expected preview exec id');
  const selectedPreview = ctx.previewExecRuns?.[execId] ?? null;
  if (!selectedPreview) throw new Error('expected selected preview');
  return { execId, selectedPreview };
}

function createTestSetup() {
  const fs = createOverlayFs();
  const registry = createCommandRegistry();
  for (const cmd of fileOperationCommands) {
    registry.register(cmd);
  }
  const txRuntime = createInMemoryTransactionRuntime();
  return { fs, registry, txRuntime };
}

describe('transaction integration', () => {
  test('preview opens and rolls back transaction cycle', async () => {
    const { fs, registry, txRuntime } = createTestSetup();
    const engine = createPreviewEngine({
      registry,
      overlayFs: fs,
      transactionRuntime: txRuntime,
    });

    const record = await engine.preview(
      'await command("write", "/test.md", "hello")',
    );
    expect(record.error).toBeUndefined();

    // Preview should NOT affect real VFS
    await expect(fs.read('/test.md')).rejects.toThrow('ENOENT');
  });

  test('commit opens and commits transaction cycle', async () => {
    const { fs, registry, txRuntime } = createTestSetup();
    const engine = createPreviewEngine({
      registry,
      overlayFs: fs,
      transactionRuntime: txRuntime,
    });

    // Preview first
    const ctx: ImpulseFlowContext = {};
    const tool = createPreviewExecTool({ engine, registry });
    await tool.execute(
      'await command("write", "/commit-test.md", "committed!")',
      ctx,
      undefined,
    );

    const { selectedPreview } = requirePreviewSelection(ctx);
    // Commit with transaction runtime
    const result = await commitPreview(selectedPreview, {
      registry,
      overlayFs: fs,
      transactionRuntime: txRuntime,
    });

    expect(result.error).toBeUndefined();
    expect(result.effectsFlushed).toBe(true);
    expect(await fs.read('/commit-test.md')).toBe('committed!');
  });

  test('preview captures effect previews from module deps', async () => {
    const { fs, registry } = createTestSetup();

    const effectCalls: Array<{ kind: string; preview?: string }> = [];
    const customTxRuntime = {
      async begin() {
        const effects = createNoopEffectContext();
        const originalCall = effects.call.bind(effects);
        return {
          driver: {},
          effects: {
            async call(intent: {
              kind: string;
              payload: unknown;
              preview?: string;
            }) {
              effectCalls.push({ kind: intent.kind, preview: intent.preview });
              await originalCall(intent);
            },
            getPreviews: effects.getPreviews.bind(effects),
          },
          async commit() {},
          async rollback() {},
        };
      },
    };

    const testModule = defineAiComputerModule({
      name: 'test-api',
      deps: createAiModuleDeps<{
        effects: {
          call: (intent: {
            kind: string;
            payload: unknown;
            preview?: string;
          }) => Promise<void>;
        };
      }>().factory(({ effects }) => ({ effects })),
      bindings: {
        chargeCard: codeFunction({
          description: 'Charge a card',
          validate: (input: unknown) => ({
            success: true as const,
            data: input as { amount: number },
          }),
          fn: async ({ amount }, { deps }) => {
            await deps.effects.call({
              kind: 'billing.charge',
              payload: { amount },
              preview: `Would charge $${amount}`,
            });
            return { charged: amount };
          },
        }),
      },
    });

    const engine = createPreviewEngine({
      registry,
      overlayFs: fs,
      transactionRuntime: customTxRuntime,
      modules: [testModule],
    });

    const record = await engine.preview(
      'import { chargeCard } from "test-api"; await chargeCard({ amount: 42 })',
    );
    expect(record.error).toBeUndefined();
    expect(effectCalls).toEqual([
      { kind: 'billing.charge', preview: 'Would charge $42' },
    ]);
    expect(record.effectPreviews).toEqual(['Would charge $42']);
  });

  test('module deps factory receives tx driver and effects', async () => {
    const { fs, registry, txRuntime } = createTestSetup();

    let receivedDriver: unknown = null;
    let receivedEffects: unknown = null;

    const txModule = defineAiComputerModule({
      name: 'tx-api',
      deps: createAiModuleDeps<{ driver: unknown }>().factory(
        ({ driver, effects }) => {
          receivedDriver = driver;
          receivedEffects = effects;
          return { driver };
        },
      ),
      bindings: {
        doSomething: codeFunction({
          description: 'Do something with tx deps',
          validate: (input: unknown) => ({
            success: true as const,
            data: input,
          }),
          fn: async (_params, { deps }) => (deps.driver ? 'done' : 'missing'),
        }),
      },
    });

    const engine = createPreviewEngine({
      registry,
      overlayFs: fs,
      transactionRuntime: txRuntime,
      modules: [txModule],
    });

    await engine.preview(
      'import { doSomething } from "tx-api"; await doSomething(undefined)',
    );

    expect(receivedDriver).not.toBeNull();
    expect(receivedEffects).not.toBeNull();
  });

  test('commit rolls back on error', async () => {
    const { fs, registry, txRuntime } = createTestSetup();
    const engine = createPreviewEngine({
      registry,
      overlayFs: fs,
      transactionRuntime: txRuntime,
    });

    const ctx: ImpulseFlowContext = {};
    const tool = createPreviewExecTool({ engine, registry });
    await tool.execute(
      'throw new Error("intentional failure")',
      ctx,
      undefined,
    );

    const { selectedPreview } = requirePreviewSelection(ctx);
    const result = await commitPreview(selectedPreview, {
      registry,
      overlayFs: fs,
      transactionRuntime: txRuntime,
    });

    expect(result.error).toBeDefined();
    expect(result.effectsFlushed).toBe(false);
  });
});

describe('full demo modules', () => {
  test('todo bindings preview stage cross-module effects', async () => {
    const { fs, registry } = createTestSetup();
    const staged: Array<{ kind: string; preview?: string }> = [];
    const txRuntime = {
      async begin() {
        const effects = createNoopEffectContext();
        const originalCall = effects.call.bind(effects);
        return {
          driver: {},
          effects: {
            async call(intent: {
              kind: string;
              payload: unknown;
              preview?: string;
            }) {
              staged.push({ kind: intent.kind, preview: intent.preview });
              await originalCall(intent);
            },
            getPreviews: effects.getPreviews.bind(effects),
          },
          async commit() {},
          async rollback() {},
        };
      },
    };

    const engine = createPreviewEngine({
      registry,
      overlayFs: fs,
      modules: [notificationsModule, todoModule],
      transactionRuntime: txRuntime,
    });

    const record = await engine.preview(`
      import { addTodo, listTodos } from 'todo-example';
      await addTodo({ text: 'Buy milk #home' });
      const items = await listTodos({});
      console.log(JSON.stringify(items));
    `);

    expect(record.error).toBeUndefined();
    expect(record.stdout).toContain('Buy milk');
    expect(record.effectPreviews).toEqual([
      'Would emit todo-created effect for "Buy milk"',
      'Would notify user: New todo: "Buy milk"',
    ]);
    expect(staged.map((item) => item.kind)).toEqual([
      'todo.notifyCreated',
      'notification.send',
    ]);
  });

  test('todo commands delegate to the same module bindings', async () => {
    const fs = createOverlayFs();
    const computer = createComputer(fs, {
      modules: [notificationsModule, todoModule],
      transactionRuntime: createInMemoryTransactionRuntime(),
    });
    const ctx: ImpulseFlowContext = {};

    const result = await computer.tool.execute(
      `
      await command('todo-add', 'Buy tea #errands');
      await command('todo-list');
      `,
      ctx,
      undefined,
    );
    if (!result.success) throw new Error(result.message);

    expect(result.data.effectPreviews).toEqual([
      'Would emit todo-created effect for "Buy tea"',
      'Would notify user: New todo: "Buy tea"',
    ]);
    expect(result.data.stdout).toContain('Buy tea');
    await expect(fs.read('/agent/home/TODO.md')).rejects.toThrow();
  });
});
