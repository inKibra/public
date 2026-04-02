/**
 * TransactionRuntime — Bridges dal-connection's Driver.beginTransaction()
 * with the @inkibra/router TransactionCycle interface.
 *
 * This is the concrete implementation that wraps a DB transaction + effect
 * context into the unified TransactionCycle consumed by both HTTP backends
 * (denzel-bun) and the ai-computer preview/commit engines.
 *
 * See command-computer-spec §11.2a.
 */

import type { Logger } from '@inkibra/logger';
// Import types from the router's transaction-cycle module.
// Note: dal-connection may not have @inkibra/router as a dependency.
// These types are re-defined here for portability. They must stay in sync
// with @inkibra/router/lib/transaction-cycle.ts.
import type { Driver } from './driver';

type EffectIntent = {
  kind: string;
  payload: unknown;
  preview?: string;
};

type EffectPreview = {
  text: string;
};

type EffectContext = {
  call(intent: EffectIntent): Promise<void>;
  getPreviews(): EffectPreview[];
};

type TransactionCycleMode = 'http' | 'preview' | 'commit';

type TransactionCycle = {
  driver: unknown;
  effects: EffectContext;
  commit(): Promise<void>;
  rollback(): Promise<void>;
};

type TransactionRuntime = {
  begin(args: { mode: TransactionCycleMode }): Promise<TransactionCycle>;
};

// ---------------------------------------------------------------------------
// Effect context implementation
// ---------------------------------------------------------------------------

export type {
  EffectContext,
  EffectIntent,
  EffectPreview,
  TransactionCycle,
  TransactionCycleMode,
  TransactionRuntime,
};

export type EffectHandler = (intent: EffectIntent) => Promise<void>;

/**
 * Create an effect context that stages intents and only flushes
 * them when explicitly asked (after transaction commit).
 */
export function createStagedEffectContext(
  handlers?: Record<string, EffectHandler>,
): EffectContext & { flush(): Promise<void> } {
  const staged: EffectIntent[] = [];
  const previews: EffectPreview[] = [];

  return {
    async call(intent: EffectIntent) {
      // Always record preview text
      if (intent.preview) {
        previews.push({ text: intent.preview });
      }
      // Stage the intent — don't execute yet
      staged.push(intent);
    },

    getPreviews() {
      return [...previews];
    },

    /**
     * Flush staged effects — only call after transaction commit succeeds.
     * Each intent is dispatched to its handler by kind.
     */
    async flush() {
      if (!handlers) return;
      for (const intent of staged) {
        const handler = handlers[intent.kind];
        if (handler) {
          try {
            await handler(intent);
          } catch (error) {
            // Effects are fire-and-forget — log but don't throw
            console.error(
              `[effect-flush] Error flushing effect kind=${intent.kind}:`,
              error instanceof Error ? error.message : error,
            );
          }
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// TransactionRuntime implementation
// ---------------------------------------------------------------------------

export type TransactionRuntimeConfig = {
  driver: Driver;
  logger: Logger;
  /** Effect handlers by kind (e.g., { 'workflow.start': handler }) */
  effectHandlers?: Record<string, EffectHandler>;
};

/**
 * Create a TransactionRuntime backed by a dal-connection Driver.
 *
 * Each `begin()` call:
 * 1. Opens a DB transaction via Driver.beginTransaction()
 * 2. Creates a staged effect context
 * 3. Returns a TransactionCycle with the tx-bound driver and effects
 *
 * Preview mode: transaction always rolls back, effects stay staged
 * Commit mode: transaction commits, then effects flush
 * HTTP mode: same as commit
 */
export function createDriverTransactionRuntime(
  config: TransactionRuntimeConfig,
): TransactionRuntime {
  return {
    async begin(args: {
      mode: TransactionCycleMode;
    }): Promise<TransactionCycle> {
      const tx = await config.driver.beginTransaction();
      const effects = createStagedEffectContext(config.effectHandlers);

      return {
        // The transaction IS a Driver-like interface (get, find, insert, etc.)
        // Callers use it to instantiate DAL collections
        driver: tx,

        effects,

        async commit() {
          const result = await tx.commit();
          if (result.isErr()) {
            throw new Error(
              `Transaction commit failed: ${result.error.message}`,
            );
          }
          // Flush effects only after successful commit
          if (args.mode === 'commit' || args.mode === 'http') {
            await effects.flush();
          }
        },

        async rollback() {
          const result = await tx.rollback();
          if (result.isErr()) {
            // Best-effort rollback — log but don't throw
            config.logger.warn('Transaction rollback failed', {
              error: result.error.message,
            });
          }
          // Effects are discarded on rollback — don't flush
        },
      };
    },
  };
}
