/**
 * Request-scoped transaction cycle via AsyncLocalStorage.
 *
 * When a TransactionRuntime is configured in createBackend, each HTTP request
 * opens a transaction cycle before handler execution. Handlers can access
 * the current tx cycle via getRequestTransactionCycle().
 *
 * See command-computer-spec §24.5a.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { TransactionCycle } from '@inkibra/router';

const txStorage = new AsyncLocalStorage<TransactionCycle>();

/**
 * Run a callback within a request transaction scope.
 * @internal Used by createBackend — not for external consumption.
 */
export function runWithTransactionCycle<T>(
  cycle: TransactionCycle,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return txStorage.run(cycle, fn);
}

/**
 * Get the current request's transaction cycle.
 *
 * Returns undefined if no transaction runtime is configured or
 * if called outside a request context.
 *
 * @example
 * ```typescript
 * const loginHandlerProvider = createApiRouteHandlerProvider(
 *   (deps) => createApiRouteHandler({
 *     route: loginRoute,
 *     handler: async (args, ctx) => {
 *       const txCycle = getRequestTransactionCycle();
 *       if (txCycle) {
 *         // Use txCycle.driver to instantiate tx-bound DAL collections
 *         // Use txCycle.effects.call() to stage side effects
 *       }
 *       return SerializableResult.toOk({ ok: true }, 200);
 *     },
 *   }),
 * );
 * ```
 */
export function getRequestTransactionCycle(): TransactionCycle | undefined {
  return txStorage.getStore();
}
