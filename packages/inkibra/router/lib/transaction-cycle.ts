/**
 * Transaction Cycle — Router-level interface for request/invocation lifecycles.
 *
 * Shared by HTTP backends (denzel-bun) and ai-computer preview/commit.
 * Implementations are provided by @inkibra/dal-connection for supported drivers.
 *
 * See command-computer-spec §11.2a.
 */

// ---------------------------------------------------------------------------
// Effect Context
// ---------------------------------------------------------------------------

export type EffectIntent = {
  kind: string;
  payload: unknown;
  /** Human-readable preview text shown during preview mode. */
  preview?: string;
};

export type EffectPreview = {
  text: string;
};

/**
 * Invocation-scoped effect collector.
 * - `call()` is fire-and-forget only — never returns business data.
 * - During preview: records preview text and staged intents, no real side effects.
 * - During commit/HTTP: intents staged until transaction commits, then flushed.
 */
export type EffectContext = {
  call(intent: EffectIntent): Promise<void>;
  getPreviews(): EffectPreview[];
};

// ---------------------------------------------------------------------------
// Transaction Cycle
// ---------------------------------------------------------------------------

export type TransactionCycleMode = 'http' | 'preview' | 'commit';

/**
 * One top-level request/invocation lifecycle.
 * Opens a DB transaction, provides a tx-bound driver and effect context.
 */
export type TransactionCycle = {
  /** Transaction-bound driver for DAL instantiation. */
  driver: unknown;
  /** Invocation-scoped staged effects. */
  effects: EffectContext;
  /** Commit the transaction, then allow effect flush. */
  commit(): Promise<void>;
  /** Rollback the transaction, discard staged effects. */
  rollback(): Promise<void>;
};

/**
 * Factory for opening transaction cycles.
 * Implemented by @inkibra/dal-connection.
 */
export type TransactionRuntime = {
  begin(args: { mode: TransactionCycleMode }): Promise<TransactionCycle>;
};

// ---------------------------------------------------------------------------
// In-memory effect context (no real effects — for preview/testing)
// ---------------------------------------------------------------------------

/**
 * Create a no-op effect context that only records previews.
 * Used during preview mode and testing.
 */
export function createNoopEffectContext(): EffectContext {
  const previews: EffectPreview[] = [];

  return {
    async call(intent: EffectIntent) {
      if (intent.preview) {
        previews.push({ text: intent.preview });
      }
    },
    getPreviews() {
      return [...previews];
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory TransactionRuntime (for testing and preview)
// ---------------------------------------------------------------------------

/**
 * Create an in-memory TransactionRuntime.
 *
 * For testing and preview mode: no real DB, no real effects.
 * The dal-connection package provides the real implementation
 * that wraps DrizzleDriver transactions.
 *
 * See spec §11.2a.
 */
export function createInMemoryTransactionRuntime(
  driver?: unknown,
): TransactionRuntime {
  return {
    async begin(_args: {
      mode: TransactionCycleMode;
    }): Promise<TransactionCycle> {
      const effects = createNoopEffectContext();
      let committed = false;
      let rolledBack = false;

      return {
        driver: driver ?? {},
        effects,
        async commit() {
          if (rolledBack)
            throw new Error('Cannot commit a rolled-back transaction');
          if (committed) throw new Error('Transaction already committed');
          committed = true;
          // In preview mode, commit is a no-op (effects stay staged)
          // In commit mode, a real implementation would flush effects here
        },
        async rollback() {
          if (committed)
            throw new Error('Cannot rollback a committed transaction');
          if (rolledBack) throw new Error('Transaction already rolled back');
          rolledBack = true;
          // Discard staged effects
        },
      };
    },
  };
}
