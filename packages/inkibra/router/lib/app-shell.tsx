/** @jsxImportSource react */
/**
 * App Shell - Server-Side Render and Client Hydration
 *
 * Provides SSR with shell element support, meta tag emission,
 * and client-side hydration with SPA navigation.
 *
 * Uses the fluent builder route tree API (createAppRouteTree).
 */

import type React from 'react';
import type { ReactElement } from 'react';
import { createContext, useContext } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import type { AnyApiRouteHandler } from './api-route-handler';
import type { ApiRouteImplementations } from './app-route';
import type {
  EventStreamImplementations,
  EventStreamsFromTree,
} from './app-routes';
import type { AnyContextCodec, ContextResult } from './context-codec';
import type { PreparedAppConfig } from './create-app';
import { getMetaProperties } from './create-app-shared';
import { connectHmr, initReactRefresh } from './hmr-client';
import type { LocationSource } from './location-source';
import { QueryClient } from './query-client';
import { renderMatchTree } from './render';
import {
  filterQueryParamsForNavigation,
  getActiveOutletPaths,
  type MatchedBranch,
  type MatchResult,
  matchAppRoute,
} from './route-matcher';
import type { ReadContextFn } from './router';
import { loadMatchedBranches } from './runtime';
import {
  getImportPath,
  isStaticComponent,
  isStrategyComponent,
  isSyncStrategyComponent,
  preloadComponent,
  type StrategyComponentRef,
} from './strategy';

// ============================================================================
// Types
// ============================================================================

import type { SerializableResult } from './result';

/** Loader data stored by key (pattern::outletPath) - directly stores SerializableResult */
export type InitialLoaderData = Record<
  string,
  SerializableResult<unknown, unknown>
>;

// Use a structural type for the constraint to avoid type narrowing issues

type AnyAppRouteNode = {
  readonly __kind: 'appRoute';
  // biome-ignore lint/suspicious/noExplicitAny: base constraint for route trees
  readonly __ctx: any;
  // biome-ignore lint/suspicious/noExplicitAny: base constraint for route trees
  readonly __outlets: any;
  // biome-ignore lint/suspicious/noExplicitAny: base constraint for route trees
  readonly __page: any;
  // biome-ignore lint/suspicious/noExplicitAny: base constraint for route trees
  readonly $paths: any;
  // biome-ignore lint/suspicious/noExplicitAny: base constraint for route trees
  readonly $pages: any;
  readonly __contextCodecs: Record<string, AnyContextCodec>;
  readonly __contextCodecNames: string[];
};

type RequiredApi<TTree extends AnyAppRouteNode> = TTree extends AnyAppRouteNode
  ? Record<string, AnyApiRouteHandler>
  : never;
type RequiredEventStreams<TTree extends AnyAppRouteNode> =
  EventStreamImplementations<EventStreamsFromTree<TTree>>;

// ============================================================================
// Render Context (for shell rendering)
// ============================================================================

export type RenderContextValue = {
  /** Prepared app config (includes app name, config values) */
  // biome-ignore lint/suspicious/noExplicitAny: Generic config type
  appConfig: PreparedAppConfig<any, any>;
  /** Mount point element ID for React hydration */
  mountPointId: string;
  /** Loader data from running server loaders */
  loaderData: InitialLoaderData;
  /** Session-scoped context values (for meta tag serialization) */
  sessionContext: Record<string, unknown>;
  /** Device-scoped context values (for meta tag serialization) */
  deviceContext: Record<string, unknown>;
  /**
   * Chunk URLs for sync strategy components that should be preloaded.
   * These are injected as <link rel="modulepreload"> tags in the head.
   */
  syncChunkUrls?: string[];
};

const RenderContext = createContext<RenderContextValue | null>(null);

/**
 * Hook to read render context in shell components
 */
export function useRenderContext(): RenderContextValue {
  const ctx = useContext(RenderContext);
  if (!ctx) {
    throw new Error(
      'Shell components must be used within runServerSideRender (which provides RenderContext)',
    );
  }
  return ctx;
}

/**
 * Provider for render context (used internally by runServerSideRender)
 */
export function RenderContextProvider({
  value,
  children,
}: {
  value: RenderContextValue;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <RenderContext.Provider value={value}>{children}</RenderContext.Provider>
  );
}

// ============================================================================
// Shell Components
// ============================================================================

type AppShellContextValue = {
  clientScript: React.ReactNode;
};

const AppShellContext = createContext<AppShellContextValue | null>(null);

function useAppShellContext(): AppShellContextValue {
  const ctx = useContext(AppShellContext);
  if (!ctx) {
    throw new Error(
      'AppShell.Head/Body/MountPoint must be used within AppShell',
    );
  }
  return ctx;
}

type AppShellProps = {
  lang?: string;
  clientScript: React.ReactNode;
  children: React.ReactNode;
};

type AppShellHeadProps = {
  children?: React.ReactNode;
};

type AppShellBodyProps = React.HTMLAttributes<HTMLBodyElement> & {
  children: React.ReactNode;
};

type AppShellMountPointProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'id'>;

/**
 * AppShell.Head - Renders the <head> element with meta tags
 */
function AppShellHead({ children }: AppShellHeadProps): React.ReactNode {
  const shellCtx = useAppShellContext();
  const renderCtx = useRenderContext();

  const props = getMetaProperties(renderCtx.appConfig.app.appId);

  // Build loader data meta tags
  const loaderMetaTags = Object.entries(renderCtx.loaderData).map(
    ([key, value]) => (
      <meta
        key={key}
        property={`${props.loaderPrefix}${key}`}
        content={JSON.stringify(value)}
      />
    ),
  );

  // Build modulepreload links for sync strategy chunks
  const preloadLinks = (renderCtx.syncChunkUrls || []).map((url) => (
    <link key={url} rel="modulepreload" href={url} />
  ));

  return (
    <head>
      {/* 1. Meta charset */}
      <meta charSet="utf-8" />

      {/* 2. App config meta tag */}
      <meta
        property={props.config}
        content={JSON.stringify(renderCtx.appConfig.config)}
      />

      {/* 3. Context meta tags (for client hydration) */}
      <meta
        property={`${renderCtx.appConfig.app.appId}:session`}
        content={JSON.stringify(renderCtx.sessionContext)}
      />
      <meta
        property={`${renderCtx.appConfig.app.appId}:device`}
        content={JSON.stringify(renderCtx.deviceContext)}
      />

      {/* 4. Loader data meta tags */}
      {loaderMetaTags}

      {/* 5. Mount point ID meta tag */}
      <meta
        property={props.mountPointId}
        content={JSON.stringify(renderCtx.mountPointId)}
      />

      {/* 6. Modulepreload links for sync strategy chunks */}
      {preloadLinks}

      {/* 7. User-provided head content */}
      {children}

      {/* 8. HMR Preamble - Smart delegating stubs for React Refresh
          These are required because chunks load during module evaluation,
          before the HMR client can initialize. The stubs delegate to the
          real RefreshRuntime once it's set by initReactRefresh(). */}
      {process.env.NODE_ENV !== 'production' && (
        <script
          dangerouslySetInnerHTML={{
            __html: `// Delegating stubs for React Refresh - will forward to real runtime when ready
window.$RefreshReg$ = function(type, id) {
  // The HMR client will set window.RefreshRuntime when it initializes
  if (window.RefreshRuntime?.register) {
    window.RefreshRuntime.register(type, id);
  }
};
window.$RefreshSig$ = function() {
  if (window.RefreshRuntime?.createSignatureFunctionForTransform) {
    return window.RefreshRuntime.createSignatureFunctionForTransform();
  }
  return function(type) { return type; };
};`,
          }}
        />
      )}

      {/* 9. Client script (always last in head) */}
      {shellCtx.clientScript}
    </head>
  );
}

/**
 * AppShell.Body - Renders the <body> element
 */
function AppShellBody({
  children,
  ...rest
}: AppShellBodyProps): React.ReactNode {
  return <body {...rest}>{children}</body>;
}

/**
 * AppShell.MountPoint - Renders the mount point div for React hydration
 */
function AppShellMountPoint(props: AppShellMountPointProps): React.ReactNode {
  const renderCtx = useRenderContext();
  return <div id={renderCtx.mountPointId} {...props} />;
}

/**
 * AppShell - SSR Document Shell
 *
 * Usage:
 * ```tsx
 * <AppShell lang="en" clientScript={clientScript}>
 *   <AppShell.Head>...</AppShell.Head>
 *   <AppShell.Body>
 *     <AppShell.MountPoint />
 *   </AppShell.Body>
 * </AppShell>
 * ```
 */
function AppShellRoot({
  lang = 'en',
  clientScript,
  children,
}: AppShellProps): React.ReactNode {
  return (
    <AppShellContext.Provider value={{ clientScript }}>
      <html lang={lang}>{children}</html>
    </AppShellContext.Provider>
  );
}

export const AppShell = Object.assign(AppShellRoot, {
  Head: AppShellHead,
  Body: AppShellBody,
  MountPoint: AppShellMountPoint,
});

// ============================================================================
// Server-Side Render
// ============================================================================

export type RunServerSideRenderOptions<
  TConfig,
  TTree extends AnyAppRouteNode,
> = {
  /** Prepared app config from prepare() */
  preparedApp: PreparedAppConfig<TConfig, TTree>;
  /** Location source (SegmentSource or VirtualSource) */
  source: LocationSource;
  /** API implementations - MUST include handlers for ALL API routes declared in routes */
  apiImplementations: RequiredApi<TTree>;
  /** Context reader function */
  readContext?: ReadContextFn;
  /** Mount point ID for React hydration */
  mountPointId: string;
  /** Pre-deserialized context values for session scope */
  sessionContext?: Record<string, unknown>;
  /** Pre-deserialized context values for device scope */
  deviceContext?: Record<string, unknown>;
  /** Base path prefix (optional) */
  basePath?: string;
  /**
   * Chunk map from import path to chunk URL.
   * Used to inject modulepreload links for sync strategy components.
   * Note: getClientAssetTags() includes modulepreload links automatically.
   */
  chunkMap?: Record<string, string>;
};

export type RunServerSideRenderResult = {
  /** Complete HTML string (includes <!DOCTYPE html>) */
  html: string;
  /** Initial loader data (for reference) */
  initialLoaderData: InitialLoaderData;
  /** Context changes from loaders (empty for now - future enhancement) */
  contextChanges: Record<string, unknown>;
};

/**
 * Server-side render function
 *
 * 1. Matches URL against route tree
 * 2. Runs loaders in parallel
 * 3. Renders Router content
 * 4. Renders Shell with meta tags
 * 5. Injects Router HTML into MountPoint via HTMLRewriter
 * 6. Returns complete HTML with DOCTYPE
 */
export async function runServerSideRender<
  TConfig,
  TTree extends AnyAppRouteNode,
>(
  options: RunServerSideRenderOptions<TConfig, TTree>,
  shellElement: ReactElement,
): Promise<RunServerSideRenderResult> {
  const {
    preparedApp,
    source,
    apiImplementations,
    readContext,
    mountPointId,
    sessionContext = {},
    deviceContext = {},
    basePath,
    chunkMap = {},
  } = options;

  const app = preparedApp.app;

  // Build the properly structured context object
  // Extract codec values using the codec names declared in the route tree
  const codecNames = app.routes.__contextCodecNames ?? [];
  const ctx: Record<string, unknown> = {};
  const ctxResult: Record<
    string,
    ContextResult<unknown, unknown, unknown>
  > = {};
  for (const codecName of codecNames) {
    // Look for the codec value in session scope first, then device scope.
    // Preserve explicit null values (auth: logged-out) instead of dropping them.
    if (sessionContext && Object.hasOwn(sessionContext, codecName)) {
      ctx[codecName] = (sessionContext as Record<string, unknown>)[codecName];
      ctxResult[codecName] = {
        type: 'Ok',
        value: ctx[codecName],
        decodeWarnings: [],
        warnings: [],
      };
      continue;
    }
    if (deviceContext && Object.hasOwn(deviceContext, codecName)) {
      ctx[codecName] = (deviceContext as Record<string, unknown>)[codecName];
      ctxResult[codecName] = {
        type: 'Ok',
        value: ctx[codecName],
        decodeWarnings: [],
        warnings: [],
      };
      continue;
    }
    const codec = app.routes.__contextCodecs?.[codecName];
    const defaultValue = codec?.defaultValue;
    ctx[codecName] = defaultValue;
    ctxResult[codecName] = {
      type: 'Ok',
      value: defaultValue,
      decodeWarnings: [{ type: 'ContextNotFound' }],
      warnings: [],
    };
  }

  // Create readContext function for loaders (use provided or build from session/device)
  const effectiveReadContext: ReadContextFn = readContext ?? (() => ctx);

  // 1. Build URL from source
  const resolvedUrl = `${source.getPath()}${
    Object.keys(source.getQuery()).length
      ? `?${new URLSearchParams(source.getQuery()).toString()}`
      : ''
  }`;
  const parsedUrl = new URL(resolvedUrl, 'http://localhost');

  // 2. Match URL against route tree
  const match = matchAppRoute(app.routes, parsedUrl, basePath ?? app.mountPath);

  // 3. Run loaders in parallel
  const loaderResults = await loadMatchedBranches(match, {
    apiImplementations: apiImplementations as ApiRouteImplementations<any>,
    readContext: effectiveReadContext,
    readContextResult: () => ctxResult,
  });

  // 4. Build initial loader data (full data for SSR rendering)
  const initialLoaderData: InitialLoaderData = {};
  for (const res of loaderResults) {
    initialLoaderData[res.key] = res.result;
  }

  // 5. Filter loader data for meta tags - skip static routes
  // Static routes preserve their SSR HTML on the client, so they don't need
  // loader data transferred to the client via meta tags.
  const loaderDataForMetaTags: InitialLoaderData = {};
  for (const [key, value] of Object.entries(initialLoaderData)) {
    // Check if this loader key corresponds to a static component
    // For now, include all - we can refine this later
    const isStatic = checkIfStaticByKey(match, key);
    if (!isStatic) {
      loaderDataForMetaTags[key] = value;
    }
  }

  // 6. Preload all matched components before rendering
  await preloadMatchedComponents(match);

  // 7. Create QueryClient for SSR (fresh instance per request)
  const queryClient = new QueryClient();

  // 8. Render Router content
  const { element: routerElement } = renderMatchTree(
    match,
    initialLoaderData,
    app.appId,
    () => {}, // No navigation on server
    new Map(),
    parsedUrl.pathname,
    ctx, // Properly structured: { session: ..., device: ... }
    ctxResult,
    apiImplementations as Record<string, unknown>, // apiImplementations
    {}, // eventStreamImplementations - empty for SSR (no-op)
    queryClient, // queryClient
    basePath ?? app.mountPath ?? '', // mountPath for Link href resolution
  );
  const routerHtml = renderToString(routerElement);

  // 9. Collect sync chunk URLs for modulepreload links
  const syncChunkUrls = collectSyncChunkUrls(match, chunkMap);

  // 10. Render Shell wrapped in RenderContextProvider
  const shellHtml = renderToString(
    <RenderContextProvider
      value={{
        appConfig: preparedApp,
        mountPointId,
        loaderData: loaderDataForMetaTags,
        sessionContext,
        deviceContext,
        syncChunkUrls,
      }}
    >
      {shellElement}
    </RenderContextProvider>,
  );

  // 9. Use HTMLRewriter to inject Router HTML into MountPoint
  const rewriter = new HTMLRewriter().on(`#${mountPointId}`, {
    element(el) {
      el.setInnerContent(routerHtml, { html: true });
    },
  });

  const html = rewriter.transform(shellHtml);

  // 10. Return complete HTML with DOCTYPE
  return {
    html: `<!DOCTYPE html>${html}`,
    initialLoaderData,
    contextChanges: {},
  };
}

// ============================================================================
// Component Preloading
// ============================================================================

/**
 * Collect all strategy components from a match result
 */
function collectComponentsFromMatch(
  match: MatchResult,
): StrategyComponentRef[] {
  const components: StrategyComponentRef[] = [];

  // Check root page
  if (match.root) {
    const rootPage = (match.root.node as { __page?: { component?: unknown } })
      .__page;
    if (rootPage?.component && isStrategyComponent(rootPage.component)) {
      components.push(rootPage.component);
    }
  }

  function visitBranch(branch: MatchedBranch) {
    const page = (branch.node as { __page?: { component?: unknown } }).__page;
    if (page?.component && isStrategyComponent(page.component)) {
      components.push(page.component);
    }
    if (branch.kind === 'segment') {
      // Must include both string keys AND symbol keys (for [PARENT])
      const stringValues = Object.values(branch.outlets);
      const symbolValues = Object.getOwnPropertySymbols(branch.outlets).map(
        (s) => branch.outlets[s],
      );
      for (const child of [...stringValues, ...symbolValues]) {
        if (child) visitBranch(child);
      }
    }
  }

  // Must include both string keys AND symbol keys
  const stringValues = Object.values(match.outlets);
  const symbolValues = Object.getOwnPropertySymbols(match.outlets).map(
    (s) => match.outlets[s],
  );
  for (const branch of [...stringValues, ...symbolValues]) {
    if (branch) visitBranch(branch);
  }

  return components;
}

/**
 * Preload all components from a match result
 */
async function preloadMatchedComponents(match: MatchResult): Promise<void> {
  const components = collectComponentsFromMatch(match);
  if (components.length > 0) {
    await Promise.all(components.map(preloadComponent));
  }
}

/**
 * Collect chunk URLs for sync strategy components from a match result.
 * These URLs should be included as <link rel="modulepreload"> in the head.
 *
 * Note: getClientAssetTags() includes modulepreload links for all chunks automatically.
 * This function is used when you need to add route-specific modulepreload links.
 *
 * @param match - The matched route result
 * @param chunkMap - Map from import path to chunk URL
 * @returns Array of chunk URLs for sync components
 */
export function collectSyncChunkUrls(
  match: MatchResult,
  chunkMap: Record<string, string>,
): string[] {
  const components = collectComponentsFromMatch(match);
  const urls: string[] = [];

  for (const component of components) {
    // Only include sync strategy components
    if (!isSyncStrategyComponent(component)) {
      continue;
    }

    const importPath = getImportPath(component);
    if (importPath && chunkMap[importPath]) {
      urls.push(chunkMap[importPath]);
    }
  }

  return urls;
}

/**
 * Check if a loader key corresponds to a static component
 * Key format: "pattern::outletPath" or just "pattern"
 */
function checkIfStaticByKey(match: MatchResult, key: string): boolean {
  // Walk the match tree to find the branch that matches this key
  for (const branch of Object.values(match.outlets)) {
    if (branch && branchMatchesKey(branch, key)) {
      const page = (branch.node as { __page?: unknown }).__page as
        | {
            component?: unknown;
          }
        | undefined;
      if (page?.component && isStaticComponent(page.component)) {
        return true;
      }
    }
  }
  return false;
}

function branchMatchesKey(branch: MatchedBranch, key: string): boolean {
  const outletPart = branch.outletPath.length
    ? `::${branch.outletPath.join('.')}`
    : '';
  const branchKey = `${branch.pattern}${outletPart}`;
  if (branchKey === key) return true;
  if (branch.kind === 'segment') {
    for (const child of Object.values(branch.outlets)) {
      if (child && branchMatchesKey(child, key)) return true;
    }
  }
  return false;
}

// ============================================================================
// Client Hydration
// ============================================================================

// HMR Registry - tracks hydrated apps to prevent duplicate roots
// Key: appId, Value: { root, navigate }
const hmrHydratedApps = new Map<
  string,
  {
    root: ReturnType<typeof hydrateRoot>;
    navigate: (to: string, options?: { replace?: boolean }) => void;
  }
>();

/**
 * Check if an app is already hydrated (for HMR awareness)
 */
export function isAppHydrated(appId: string): boolean {
  return hmrHydratedApps.has(appId);
}

/**
 * Get the hydrated app info for HMR (internal use)
 */
export function getHydratedApp(appId: string) {
  return hmrHydratedApps.get(appId);
}

export type HydrateOptions<TConfig, TTree extends AnyAppRouteNode> = {
  preparedApp: PreparedAppConfig<TConfig, TTree>;
  source: LocationSource;
  apiImplementations: RequiredApi<TTree>;
  readContext?: ReadContextFn;
  eventStreamImplementations?: RequiredEventStreams<TTree>;
};

// HMR auto-initialization state (runs once)
let hmrInitialized = false;

export async function hydrate<TConfig, TTree extends AnyAppRouteNode>({
  preparedApp,
  source,
  apiImplementations,
  readContext,
  eventStreamImplementations = {} as RequiredEventStreams<TTree>,
}: HydrateOptions<TConfig, TTree>) {
  // Auto-initialize HMR in development (runs once globally)
  if (
    !hmrInitialized &&
    typeof window !== 'undefined' &&
    import.meta.env?.DEV
  ) {
    hmrInitialized = true;
    try {
      await initReactRefresh();
      await connectHmr();
      console.log('[HMR] Auto-initialized');
    } catch (err) {
      console.warn('[HMR] Auto-initialization failed:', err);
    }
  }

  const appId = preparedApp.app.appId;

  // HMR Check: If app is already hydrated, skip re-hydration
  // This prevents the "createRoot on already-passed container" error
  // when HMR imports a new bundle that re-runs the entry point
  const existingApp = hmrHydratedApps.get(appId);
  if (existingApp) {
    console.log(`[HMR] App "${appId}" already hydrated, skipping re-hydration`);
    // Return the existing navigate function so the app can still work
    return {
      navigate: existingApp.navigate,
    };
  }

  const mountNodeId = preparedApp.mountPointId ?? 'app-root';
  const target =
    document.getElementById(mountNodeId) ?? document.getElementById('app-root');
  if (!target) {
    throw new Error(`hydrate: cannot find mount node for appId "${appId}"`);
  }

  const initialLoaderData = (preparedApp.loaderData ?? {}) as InitialLoaderData;

  const resolvedUrl = `${source.getPath()}${
    Object.keys(source.getQuery()).length
      ? `?${new URLSearchParams(source.getQuery()).toString()}`
      : ''
  }`;
  const parsedUrl = new URL(
    resolvedUrl,
    typeof window !== 'undefined' ? window.location.href : undefined,
  );
  const savedStaticHtml = new Map<string, string>();
  const match = matchAppRoute(
    preparedApp.app.routes,
    parsedUrl,
    preparedApp.app.mountPath,
  );

  // Preload all matched components before hydration
  await preloadMatchedComponents(match);

  // Create QueryClient for client-side (singleton for app lifetime)
  const queryClient = new QueryClient();

  let loaderData = { ...initialLoaderData };

  const navigate = (
    to: string,
    options?: {
      replace?: boolean;
      params?: Record<string, string | null>;
      clearParams?: boolean;
    },
  ) => {
    // Prepend mountPath for mount-relative paths (e.g. '/boards' → '/app/boards').
    // Paths that already include the mountPath pass through unchanged, preserving
    // backwards compatibility with existing navigate('/app/boards') call sites.
    const mountPath = preparedApp.app.mountPath ?? '';
    const resolvedTo =
      mountPath && to.startsWith('/') && !to.startsWith(mountPath)
        ? mountPath + to
        : to;
    const nextUrl = new URL(resolvedTo, window.location.href);

    // Schema-based query param persistence:
    // 1. Match the target URL to find active outlets
    // 2. Filter current params based on which outlets are still active
    // 3. Merge with explicit overrides from options.params
    // 4. Apply explicit clears (null values)

    if (!options?.clearParams) {
      // Match the new route to get active outlet paths
      const nextMatch = matchAppRoute(
        preparedApp.app.routes,
        nextUrl,
        preparedApp.app.mountPath,
      );
      const activeOutletPaths = getActiveOutletPaths(nextMatch);

      // Filter current params - keep only those whose outlet is still active
      const currentParams = new URL(window.location.href).searchParams;
      const persistedParams = filterQueryParamsForNavigation(
        currentParams,
        activeOutletPaths,
      );

      // Apply persisted params to the new URL (if not already set)
      for (const [key, value] of persistedParams.entries()) {
        if (!nextUrl.searchParams.has(key)) {
          nextUrl.searchParams.set(key, value);
        }
      }
    }

    // Apply explicit param overrides from options
    if (options?.params) {
      for (const [key, value] of Object.entries(options.params)) {
        if (value === null) {
          nextUrl.searchParams.delete(key);
        } else {
          nextUrl.searchParams.set(key, value);
        }
      }
    }

    if (options?.replace) {
      window.history.replaceState({}, '', nextUrl.toString());
    } else {
      window.history.pushState({}, '', nextUrl.toString());
    }
    void performNavigation(nextUrl, false);
  };

  // Current context - extract codec values using the codec names declared in the route tree
  const codecNames = preparedApp.app.routes.__contextCodecNames ?? [];
  const sessionData =
    (preparedApp.initialSessionStorage as Record<string, unknown>) ?? {};
  const deviceData =
    (preparedApp.initialDeviceStorage as Record<string, unknown>) ?? {};
  let currentCtx: Record<string, unknown> = {};
  let currentCtxResult: Record<
    string,
    ContextResult<unknown, unknown, unknown>
  > = {};
  for (const codecName of codecNames) {
    if (sessionData && Object.hasOwn(sessionData, codecName)) {
      currentCtx[codecName] = (sessionData as Record<string, unknown>)[
        codecName
      ];
      currentCtxResult[codecName] = {
        type: 'Ok',
        value: currentCtx[codecName],
        decodeWarnings: [],
        warnings: [],
      };
      continue;
    }
    if (deviceData && Object.hasOwn(deviceData, codecName)) {
      currentCtx[codecName] = (deviceData as Record<string, unknown>)[
        codecName
      ];
      currentCtxResult[codecName] = {
        type: 'Ok',
        value: currentCtx[codecName],
        decodeWarnings: [],
        warnings: [],
      };
      continue;
    }

    const codec = preparedApp.app.routes.__contextCodecs?.[codecName];
    const defaultValue = codec?.defaultValue;
    currentCtx[codecName] = defaultValue;
    currentCtxResult[codecName] = {
      type: 'Ok',
      value: defaultValue,
      decodeWarnings: [{ type: 'ContextNotFound' }],
      warnings: [],
    };
  }

  // Create readContext function for client-side loader execution
  // Uses the provided readContext to fetch codec values and builds a flattened ctx object
  const appName = preparedApp.app.appId;
  const buildCtxFromReadContext = (): {
    ctx: Record<string, unknown>;
    ctxResult: Record<string, ContextResult<unknown, unknown, unknown>>;
  } => {
    if (!readContext) {
      return {
        ctx: currentCtx,
        ctxResult: currentCtxResult,
      };
    }

    const ctx: Record<string, unknown> = {};
    const ctxResult: Record<
      string,
      ContextResult<unknown, unknown, unknown>
    > = {};

    for (const codecName of codecNames) {
      const sessionRaw = readContext('session', appName, codecName);
      const deviceRaw = readContext('device', appName, codecName);
      const raw = sessionRaw !== undefined ? sessionRaw : deviceRaw;

      if (
        raw &&
        typeof raw === 'object' &&
        'type' in raw &&
        (raw as { type: string }).type === 'Ok' &&
        'value' in raw
      ) {
        const value = (raw as { value: unknown }).value;
        ctx[codecName] = value;
        ctxResult[codecName] = {
          type: 'Ok',
          value,
          decodeWarnings: [],
          warnings: [],
        };
        continue;
      }

      if (
        raw &&
        typeof raw === 'object' &&
        'type' in raw &&
        (raw as { type: string }).type === 'Err'
      ) {
        const codec = preparedApp.app.routes.__contextCodecs?.[codecName];
        const defaultValue = codec?.defaultValue;
        ctx[codecName] = defaultValue;
        ctxResult[codecName] = {
          type: 'Ok',
          value: defaultValue,
          decodeWarnings: [{ type: 'ContextNotFound' }],
          warnings: [],
        };
        continue;
      }

      if (raw === undefined) {
        const codec = preparedApp.app.routes.__contextCodecs?.[codecName];
        const defaultValue = codec?.defaultValue;
        ctx[codecName] = defaultValue;
        ctxResult[codecName] = {
          type: 'Ok',
          value: defaultValue,
          decodeWarnings: [{ type: 'ContextNotFound' }],
          warnings: [],
        };
        continue;
      }

      ctx[codecName] = raw;
      ctxResult[codecName] = {
        type: 'Ok',
        value: raw,
        decodeWarnings: [],
        warnings: [],
      };
    }

    return { ctx, ctxResult };
  };

  // Effective readContext for loaders - returns flattened ctx
  // Note: V2 runtime expects () => ctx, not the V1 (scope, app, codec) signature
  // Build once and close over both values to avoid double storage reads.
  const builtCtx = readContext ? buildCtxFromReadContext() : null;
  const effectiveReadContext = builtCtx ? () => builtCtx.ctx : () => currentCtx;
  const effectiveReadContextResult = builtCtx
    ? () => builtCtx.ctxResult
    : () => currentCtxResult;

  const render = (
    nextMatch: ReturnType<typeof matchAppRoute>,
    path: string,
    ctx: Record<string, unknown>,
    ctxResult: Record<string, ContextResult<unknown, unknown, unknown>>,
  ) => {
    const { element } = renderMatchTree(
      nextMatch,
      loaderData,
      appId,
      navigate,
      savedStaticHtml,
      path,
      ctx,
      ctxResult,
      apiImplementations as Record<string, unknown>,
      eventStreamImplementations as Record<string, unknown>,
      queryClient,
      preparedApp.app.mountPath ?? '', // mountPath for Link href resolution
    );
    return element;
  };

  const root = hydrateRoot(
    target,
    render(match, parsedUrl.pathname, currentCtx, currentCtxResult),
  );

  // Store root for HMR - prevents duplicate hydration on bundle reload
  hmrHydratedApps.set(appId, { root, navigate });
  console.log(`[Hydrate] App "${appId}" hydrated and registered for HMR`);

  async function performNavigation(nextUrl: URL, fromPopState: boolean) {
    void fromPopState;

    const nextMatch = matchAppRoute(
      preparedApp.app.routes,
      nextUrl,
      preparedApp.app.mountPath,
    );

    if (matchHasStaticLoader(nextMatch)) {
      // Fall back to full reload for static routes with loaders
      window.location.assign(nextUrl.toString());
      return;
    }

    // Preload components for the new route
    await preloadMatchedComponents(nextMatch);

    // Build fresh context from storage - this ensures we get any context
    // that was just written (e.g., after login stores session)
    const { ctx: freshCtx, ctxResult: freshCtxResult } =
      buildCtxFromReadContext();

    const loaderResults = await loadMatchedBranches(nextMatch, {
      apiImplementations: apiImplementations as ApiRouteImplementations<any>,
      readContext: effectiveReadContext,
      readContextResult: effectiveReadContextResult,
    });
    loaderData = { ...loaderData };
    for (const res of loaderResults) {
      loaderData[res.key] = res.result;
    }

    // Update currentCtx for future navigations
    currentCtx = freshCtx;
    currentCtxResult = freshCtxResult;

    // Render with fresh context from storage
    root.render(render(nextMatch, nextUrl.pathname, freshCtx, freshCtxResult));
  }

  window.addEventListener('popstate', () => {
    void performNavigation(new URL(window.location.href), true);
  });

  return {
    navigate,
  };
}

function matchHasStaticLoader(match: MatchResult): boolean {
  for (const branch of Object.values(match.outlets)) {
    if (branch && branchContainsStaticLoader(branch)) return true;
  }
  return false;
}

function branchContainsStaticLoader(branch: MatchedBranch): boolean {
  const page = (branch.node as { __page?: unknown }).__page as
    | {
        loader?: { load?: unknown };
        component?: unknown;
      }
    | undefined;
  const hasLoader = !!page?.loader?.load;
  const isStatic = isStaticComponent(page?.component);
  if (hasLoader && isStatic) return true;
  if (branch.kind === 'segment') {
    return Object.values(branch.outlets).some(
      (child) => child && branchContainsStaticLoader(child),
    );
  }
  return false;
}
