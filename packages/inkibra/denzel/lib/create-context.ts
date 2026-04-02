import type { RequestHandler } from 'express';
import type { InkibraDenzel } from '../index';
import type {
  Context,
  ContextDataBase,
  ContextErrorBase,
  ContextHandler,
} from './context';

/**
 * Creates a context factory that can be used to initialize a context later.
 * This allows context definitions to be created without needing a denzelApp instance upfront.
 *
 * @param name - Unique name for this context
 * @param middlewares - Array of Express middlewares to apply
 * @param handler - Context handler function that creates the context data
 * @returns Factory function that accepts denzelApp and returns the Context instance
 *
 * @example
 * ```ts
 * const contextFactory = createContext(
 *   'myContext',
 *   [],
 *   async (logger, req, res) => {
 *     return ok({ logger, hostname: req.hostname });
 *   }
 * );
 *
 * // Later, when you have denzelApp:
 * const context = contextFactory(denzelApp);
 * ```
 */
export function createContext<
  ContextData extends ContextDataBase,
  ContextError extends ContextErrorBase,
>(
  name: string,
  middlewares: RequestHandler[],
  handler: ContextHandler<ContextData, ContextError>,
): (
  denzelApp: InkibraDenzel<ContextData>,
) => Context<ContextData, ContextError> {
  return (denzelApp) =>
    denzelApp.getNewRouteContext(name, middlewares, handler);
}
