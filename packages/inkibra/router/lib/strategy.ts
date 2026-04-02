/**
 * Component loading strategies for routes.
 *
 * - sync: Component in separate chunk, loaded eagerly in <head> during SSR
 * - lazy: Component in separate chunk, loaded on demand during client navigation
 * - static: Component server-only, SSR, no client JS (preserved as HTML)
 *
 * All strategies use dynamic imports for maximum code splitting.
 */

import type { ComponentType } from 'react';

// ============================================================================
// Symbols
// ============================================================================

export const SYNC_SYMBOL = Symbol.for('inkibra.strategy.sync');
export const LAZY_SYMBOL = Symbol.for('inkibra.strategy.lazy');
export const STATIC_SYMBOL = Symbol.for('inkibra.strategy.static');

// ============================================================================
// Types
// ============================================================================

/**
 * A reference to a sync-loaded component.
 * Component is in a separate chunk, loaded eagerly in <head> during SSR.
 */
export type SyncComponentRef<P = Record<string, unknown>> = {
  readonly $$typeof: typeof SYNC_SYMBOL;
  readonly importFn: () => Promise<{ default: ComponentType<P> }>;
};

/**
 * A reference to a lazily-loaded component.
 * The actual component is loaded via dynamic import when needed.
 */
export type LazyComponentRef<P = Record<string, unknown>> = {
  readonly $$typeof: typeof LAZY_SYMBOL;
  readonly importFn: () => Promise<{ default: ComponentType<P> }>;
};

/**
 * A reference to a static (server-only) component.
 * The component is rendered on the server and preserved as HTML on the client.
 */
export type StaticComponentRef<P = Record<string, unknown>> = {
  readonly $$typeof: typeof STATIC_SYMBOL;
  readonly importFn: () => Promise<{ default: ComponentType<P> }>;
};

/**
 * Any strategy component reference (sync, lazy, or static).
 */
export type StrategyComponentRef<P = Record<string, unknown>> =
  | SyncComponentRef<P>
  | LazyComponentRef<P>
  | StaticComponentRef<P>;

/**
 * A component that can be used in a route - either a regular component
 * or a strategy reference (sync, lazy, or static).
 *
 * Note: Plain ComponentType is supported for backwards compatibility,
 * but strategy references (strategy.sync, strategy.lazy, strategy.static)
 * are preferred for maximum code splitting.
 */
export type RouteComponent<P = Record<string, unknown>> =
  | ComponentType<P>
  | SyncComponentRef<P>
  | LazyComponentRef<P>
  | StaticComponentRef<P>;

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a value is a sync strategy component reference.
 */
export function isSyncStrategyComponent<P = Record<string, unknown>>(
  value: unknown,
): value is SyncComponentRef<P> {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$$typeof' in value &&
    value.$$typeof === SYNC_SYMBOL
  );
}

/**
 * Check if a value is a lazy component reference.
 */
export function isLazyComponent<P = Record<string, unknown>>(
  value: unknown,
): value is LazyComponentRef<P> {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$$typeof' in value &&
    value.$$typeof === LAZY_SYMBOL
  );
}

/**
 * Check if a value is a static component reference.
 */
export function isStaticComponent<P = Record<string, unknown>>(
  value: unknown,
): value is StaticComponentRef<P> {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$$typeof' in value &&
    value.$$typeof === STATIC_SYMBOL
  );
}

/**
 * Check if a value is any strategy component reference (sync, lazy, or static).
 */
export function isStrategyComponent<P = Record<string, unknown>>(
  value: unknown,
): value is StrategyComponentRef<P> {
  return (
    isSyncStrategyComponent(value) ||
    isLazyComponent(value) ||
    isStaticComponent(value)
  );
}

/**
 * Check if a value is a plain component (not a strategy reference).
 * These are regular React components imported directly.
 */
export function isPlainComponent<P = Record<string, unknown>>(
  value: unknown,
): value is ComponentType<P> {
  return (
    typeof value === 'function' ||
    (typeof value === 'object' && value !== null && !isStrategyComponent(value))
  );
}

// ============================================================================
// Strategy Namespace
// ============================================================================

/**
 * Create a sync component reference.
 * The component will be in a separate chunk, loaded eagerly in <head> during SSR.
 * This enables maximum code splitting while ensuring the component is available
 * for hydration.
 *
 * Note: The component type is intentionally erased to prevent circular type
 * references when components import RoutePageProps from the route tree.
 * The route defines the contract (params, loader, etc.) - components implement it.
 *
 * @example
 * ```typescript
 * import { strategy } from '@inkibra/router';
 *
 * const loginRoute = createAppRoute({
 *   path: loginPath,
 *   component: strategy.sync(() => import('./routes/login')),
 * });
 * ```
 */
function sync(
  // biome-ignore lint/suspicious/noExplicitAny: Accept any module with default export
  importFn: () => Promise<any>,
): SyncComponentRef {
  return {
    $$typeof: SYNC_SYMBOL,
    importFn,
  };
}

/**
 * Create a lazy component reference.
 * The component will be loaded via dynamic import when rendered.
 *
 * Note: The component type is intentionally erased to prevent circular type
 * references when components import RoutePageProps from the route tree.
 * The route defines the contract (params, loader, etc.) - components implement it.
 *
 * @example
 * ```typescript
 * import { strategy } from '@inkibra/router';
 *
 * const boardDetailRoute = createAppRoute({
 *   path: boardDetailPath,
 *   component: strategy.lazy(() => import('./routes/boards/board')),
 * });
 * ```
 */
function lazy(
  // biome-ignore lint/suspicious/noExplicitAny: Accept any module with default export
  importFn: () => Promise<any>,
): LazyComponentRef {
  return {
    $$typeof: LAZY_SYMBOL,
    importFn,
  };
}

/**
 * Create a static component reference.
 * The component will only be rendered on the server. On the client,
 * the SSR HTML is preserved without hydration.
 *
 * Note: The component type is intentionally erased to prevent circular type
 * references when components import RoutePageProps from the route tree.
 * The route defines the contract (params, loader, etc.) - components implement it.
 *
 * @example
 * ```typescript
 * import { strategy } from '@inkibra/router';
 *
 * const blogPostRoute = createAppRoute({
 *   path: blogPostPath,
 *   component: strategy.static(() => import('./routes/blog/post')),
 * });
 * ```
 */
function staticComponent(
  // biome-ignore lint/suspicious/noExplicitAny: Accept any module with default export
  importFn: () => Promise<any>,
): StaticComponentRef {
  return {
    $$typeof: STATIC_SYMBOL,
    importFn,
  };
}

/**
 * Strategy namespace for defining component loading strategies.
 *
 * All strategies use dynamic imports for maximum code splitting.
 * The difference is when/how the chunk is loaded:
 *
 * @example
 * ```typescript
 * import { strategy } from '@inkibra/router';
 *
 * // Sync - separate chunk, loaded in <head> during SSR
 * component: strategy.sync(() => import('./my-component'))
 *
 * // Lazy - separate chunk, loaded on demand during navigation
 * component: strategy.lazy(() => import('./my-component'))
 *
 * // Static - separate chunk, SSR-only, no client JS
 * component: strategy.static(() => import('./my-component'))
 * ```
 */
export const strategy = {
  sync,
  lazy,
  static: staticComponent,
} as const;

// ============================================================================
// Import Path Extraction
// ============================================================================

/**
 * Extract the import path from a strategy component reference.
 *
 * This is used by SSR to map strategy components to their chunk URLs.
 * The chunk URLs are included automatically in the output of getClientAssetTags()
 * as modulepreload links.
 *
 * @example
 * ```typescript
 * const Layout = strategy.sync(() => import('./routes/layout'));
 * getImportPath(Layout); // Returns './routes/layout'
 * ```
 *
 * @param ref - The strategy component reference
 * @returns The import path string, or null if it couldn't be extracted
 */
export function getImportPath(ref: StrategyComponentRef): string | null {
  // The importFn is a function like: () => import('./routes/layout')
  // When stringified, it looks like: "() => import('./routes/layout')"
  // or in minified form: "()=>import('./routes/layout')"
  const fnStr = ref.importFn.toString();

  // Match various forms of dynamic import:
  // - import('./routes/layout')
  // - import("./routes/layout")
  // - import(`./routes/layout`)
  const match = fnStr.match(/import\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/);
  return match?.[1] ?? null;
}

// ============================================================================
// Preloading Utilities
// ============================================================================

/**
 * Cache for preloaded components.
 * Maps import functions to their loaded component.
 */
const preloadCache = new Map<
  () => Promise<{ default: ComponentType<unknown> }>,
  ComponentType<unknown>
>();

/**
 * Reverse lookup cache for HMR.
 * Maps import paths (e.g., './routes/layout') to their strategy refs.
 * This allows HMR to find and invalidate components by path.
 */
const pathToRefCache = new Map<string, StrategyComponentRef>();

/**
 * Preload a strategy component (lazy or static).
 * Awaits the import function and caches the result.
 *
 * @param ref - The lazy or static component reference
 * @returns The loaded component
 */
export async function preloadComponent<P = Record<string, unknown>>(
  ref: StrategyComponentRef<P>,
): Promise<ComponentType<P>> {
  // Build reverse lookup for HMR
  // Cast to base type since getImportPath doesn't care about P
  const path = getImportPath(ref as StrategyComponentRef);
  if (path) {
    // Store in path cache for HMR lookup
    pathToRefCache.set(path, ref as StrategyComponentRef);
  }

  // Check cache first
  const cached = preloadCache.get(
    ref.importFn as () => Promise<{ default: ComponentType<unknown> }>,
  );
  if (cached) {
    return cached as ComponentType<P>;
  }

  // Load the component
  const module = await ref.importFn();
  const component = module.default;

  // Cache it
  preloadCache.set(
    ref.importFn as () => Promise<{ default: ComponentType<unknown> }>,
    component as ComponentType<unknown>,
  );

  return component;
}

/**
 * Get a preloaded component from cache.
 * Returns undefined if not preloaded.
 *
 * @param ref - The lazy or static component reference
 * @returns The loaded component or undefined
 */
export function getPreloadedComponent<P = Record<string, unknown>>(
  ref: StrategyComponentRef<P>,
): ComponentType<P> | undefined {
  const cached = preloadCache.get(
    ref.importFn as () => Promise<{ default: ComponentType<unknown> }>,
  );
  // biome-ignore lint/suspicious/noExplicitAny: Generic type coercion for cached component
  return cached as any;
}

/**
 * Resolve a route component to a renderable React component.
 * - If sync component, returns as-is
 * - If lazy/static, returns cached component (must be preloaded first)
 *
 * @param component - The route component (sync, lazy, or static)
 * @returns The resolved React component
 * @throws If lazy/static component hasn't been preloaded
 */
export function resolveComponent<P = Record<string, unknown>>(
  component: RouteComponent<P>,
): ComponentType<P> {
  if (isStrategyComponent(component)) {
    const cached = getPreloadedComponent(component);
    if (!cached) {
      throw new Error(
        'Strategy component has not been preloaded. ' +
          'Call preloadComponent() before resolving.',
      );
    }
    // biome-ignore lint/suspicious/noExplicitAny: Generic type coercion
    return cached as any;
  }

  // Sync component - return as-is
  return component as ComponentType<P>;
}

// ============================================================================
// HMR (Hot Module Replacement) Utilities
// ============================================================================

/**
 * Invalidate a cached component by its import path.
 * Called by the HMR client when a module update is received.
 *
 * @param importPath - The import path (e.g., './routes/layout')
 * @returns true if the component was found and invalidated, false otherwise
 *
 * @example
 * ```typescript
 * // In HMR client when server sends update
 * invalidateByPath('./routes/layout');
 * // Then re-import and refresh
 * ```
 */
export function invalidateByPath(importPath: string): boolean {
  const ref = pathToRefCache.get(importPath);
  if (!ref) {
    return false;
  }

  // Remove from preload cache - forces re-import on next preload
  preloadCache.delete(
    ref.importFn as () => Promise<{ default: ComponentType<unknown> }>,
  );

  return true;
}

/**
 * Get all registered import paths.
 * Useful for dev tools and debugging.
 *
 * @returns Array of import paths that have been preloaded
 */
export function getRegisteredPaths(): string[] {
  return Array.from(pathToRefCache.keys());
}

/**
 * Clear all caches. Useful for testing or full refresh scenarios.
 * @internal
 */
export function clearAllCaches(): void {
  preloadCache.clear();
  pathToRefCache.clear();
}
