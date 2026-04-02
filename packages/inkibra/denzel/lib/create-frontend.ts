import type { RequestHandler } from 'express';
import type { InkibraDenzel } from '../index';
import type { Context, ContextDataBase } from './context';
import type { FrontendImplementation } from './frontend';

/**
 * Context factory function that accepts denzelApp and returns a Context instance
 */
export type FrontendContextFactory<ContextData extends ContextDataBase> = (
  denzelApp: InkibraDenzel<ContextData>,
) => Context<ContextData, any>;

/**
 * Domain asset handler - either a static asset path (string) or a custom renderer (function)
 */
export type DomainAssetHandler<ContextData extends ContextDataBase> =
  | string // Import path - redirects directly to this path (e.g., '/assets/inkibra.com/favicon.ico')
  | FrontendImplementation<ContextData>; // Custom renderer with full context

/**
 * Frontend definition - configuration for a mounted frontend application
 */
export type FrontendDefinition<ContextData extends ContextDataBase> = {
  /** Unique name for logging/debugging */
  name: string;
  /** Array of allowed hostnames for this frontend */
  allowedDomains: string[];
  /** Mount path for this frontend (e.g., '/' or '/tt') */
  mountPath: string;
  /** Domain-level assets like favicon, sitemap, robots.txt */
  domainAssets?: Record<string, DomainAssetHandler<ContextData>>;
  /** Optional middlewares to apply to all routes */
  middlewares?: RequestHandler[];
  /** Context factory function */
  context: FrontendContextFactory<ContextData>;
  /** Render function that handles all paths under mountPath */
  render: FrontendImplementation<ContextData>;
};

/**
 * Creates a frontend definition.
 * This function doesn't mount the frontend - use denzelApp.mount() for that.
 *
 * @param config - Frontend configuration
 * @returns Frontend definition ready to be mounted
 *
 * @example
 * ```ts
 * const frontend = createFrontend({
 *   name: 'Inkibra',
 *   allowedDomains: ['inkibra.com', 'inkibra.dev'],
 *   mountPath: '/',
 *   domainAssets: {
 *     'favicon.ico': faviconIco, // faviconIco is '/assets/inkibra.com/favicon.ico'
 *     'sitemap.xml': createSitemapRenderer({ startPaths: ['/'] }),
 *   },
 *   context: createContext('inkibra', [], handler),
 *   render: async (path, ctx, res) => { ... },
 * });
 *
 * denzelApp.mount(frontend);
 * ```
 */
export function createFrontend<ContextData extends ContextDataBase>(
  config: FrontendDefinition<ContextData>,
): FrontendDefinition<ContextData> {
  return config;
}
