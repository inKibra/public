import React, { createContext, useContext, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { PARENT } from './app-routes';
import type { InitialLoaderData } from './app-shell';
import type { ContextResult } from './context-codec';
import type { Mutation } from './create-mutation';
import type { Query } from './create-query';
import type { QueryClient } from './query-client';
import {
  type BoundMutation,
  createQueryRuntime,
  QUERY_RUNTIME,
  type QueryResultTuple,
} from './query-runtime';
import type { MatchedBranch, MatchedRoot, MatchResult } from './route-matcher';
import { RouterContext, type RouterContextValue } from './router';

import {
  isPlainComponent,
  isStaticComponent,
  isStrategyComponent,
  resolveComponent,
  type StrategyComponentRef,
} from './strategy';

// ---------------------------------------------------------------------------
// Static HTML preservation (from legacy router)
// ---------------------------------------------------------------------------

type SavedStaticHtmlMap = Map<string, string>;
const SavedStaticHtmlContext = createContext<SavedStaticHtmlMap>(new Map());

function StaticRouteWrapper({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}): React.ReactNode {
  const isServer = typeof window === 'undefined';
  const savedStaticHtml = useContext(SavedStaticHtmlContext);

  const memoizedHtml = useMemo(() => {
    if (isServer) return { __html: '' };
    const savedHtml = savedStaticHtml.get(id);
    if (savedHtml !== undefined) return { __html: savedHtml };
    const existingHtml = document.getElementById(id)?.innerHTML ?? '';
    return { __html: existingHtml };
  }, [id, isServer, savedStaticHtml]);

  if (isServer) {
    return (
      <div id={id} data-static-on-client="true">
        {children}
      </div>
    );
  }

  return (
    <div
      id={id}
      data-static-on-client="true"
      suppressHydrationWarning={true}
      dangerouslySetInnerHTML={memoizedHtml}
    />
  );
}

// ---------------------------------------------------------------------------
// Outlet registry
// ---------------------------------------------------------------------------

type RegisteredCapabilities = Record<string, (...args: unknown[]) => unknown>;

type OutletRegistryValue = {
  childElements: Map<string, React.ReactNode>;
  registerCapabilities: (
    name: string,
    capabilities: RegisteredCapabilities,
  ) => void;
};

const OutletRegistryContext = createContext<OutletRegistryValue>({
  childElements: new Map(),
  registerCapabilities: () => {},
});

const OutletContext = createContext<{
  element: React.ReactNode;
  capabilities: RegisteredCapabilities;
}>({
  element: null,
  capabilities: {},
});

type StaticParentContextValue = {
  isStatic: boolean;
  appId: string;
  routePath: string;
};

const StaticParentContext = createContext<StaticParentContextValue>({
  isStatic: false,
  appId: '',
  routePath: '',
});

function createStableOutletComponent(name: string) {
  const StableOutlet: React.FC<{ capabilities?: RegisteredCapabilities }> = ({
    capabilities = {},
  }) => {
    const registry = useContext(OutletRegistryContext);
    const staticParent = useContext(StaticParentContext);
    const childElement = registry.childElements.get(name) ?? null;

    registry.registerCapabilities(name, capabilities);

    const outletValue = useMemo(
      () => ({
        element: childElement,
        capabilities,
      }),
      [childElement, capabilities],
    );

    if (staticParent.isStatic) {
      const outletId = generateOutletId(
        staticParent.appId,
        staticParent.routePath,
        name,
      );
      return (
        <div data-outlet-id={outletId} id={outletId}>
          <OutletContext.Provider value={outletValue}>
            {childElement}
          </OutletContext.Provider>
        </div>
      );
    }

    return (
      <OutletContext.Provider value={outletValue}>
        {childElement}
      </OutletContext.Provider>
    );
  };
  StableOutlet.displayName = `Outlet(${name})`;
  return StableOutlet;
}

// ---------------------------------------------------------------------------
// Portal renderer (for dynamic children of static parents)
// ---------------------------------------------------------------------------

function PortalRenderer({
  portals,
}: {
  portals: Map<string, React.ReactNode>;
}) {
  if (typeof window === 'undefined') return null;

  const portalElements: React.ReactNode[] = [];
  portals.forEach((element, outletId) => {
    const target = document.getElementById(outletId);
    if (target) {
      portalElements.push(createPortal(element, target, outletId));
    }
  });
  return <>{portalElements}</>;
}

// ---------------------------------------------------------------------------
// Error boundary
// ---------------------------------------------------------------------------

type ErrorBoundaryWrapperProps = {
  ErrorBoundary: (props: {
    error: unknown;
    reset: () => void;
  }) => React.ReactElement | null;
  children: React.ReactNode;
};

type ErrorBoundaryState = { error: unknown | null };

class ErrorBoundaryWrapper extends React.Component<
  ErrorBoundaryWrapperProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryWrapperProps) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error };
  }
  reset = () => this.setState({ error: null });
  render() {
    const { ErrorBoundary, children } = this.props;
    const { error } = this.state;
    if (error !== null) {
      return <ErrorBoundary error={error} reset={this.reset} />;
    }
    return children;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateOutletId(
  appId: string,
  routePath: string,
  outletName: string,
) {
  return `${appId}:outlet:${routePath}:${outletName}`;
}

function buildLoaderKey(pattern: string, outletPath: string[]): string {
  const outletPart = outletPath.length ? `::${outletPath.join('.')}` : '';
  return `${pattern}${outletPart}`;
}

// ---------------------------------------------------------------------------
// Render tree from MatchResult
// ---------------------------------------------------------------------------

type RenderResult = {
  element: React.ReactNode;
  portals: Map<string, React.ReactNode>;
};

type NavigateFn = (
  to: string,
  options?: {
    replace?: boolean;
    params?: Record<string, string | null>;
    clearParams?: boolean;
  },
) => void;

// biome-ignore lint/suspicious/noExplicitAny: Context type varies by app
type ContextValue = Record<string, any>;
// biome-ignore lint/suspicious/noExplicitAny: Context result typing is dynamic at runtime
type ContextResultValue = Record<string, ContextResult<any, any, any>>;
// biome-ignore lint/suspicious/noExplicitAny: API implementations vary by route
type ApiImplementations = Record<string, any>;
// biome-ignore lint/suspicious/noExplicitAny: EventStream implementations vary by route
type EventStreamImplementations = Record<string, any>;

/** Query helper type for pages */
export type RunQueryFn = <TArgs, TResult, TCtx>(
  query: Query<TArgs, TResult, TCtx>,
  args: TArgs,
  options?: { staleTime?: number; globalOptimistic?: boolean },
) => QueryResultTuple<TResult>;

/** Mutation helper type for pages */
export type MutationFn = <TArgs, TResult, TCtx>(
  mutationPlan: Mutation<TArgs, TResult, TCtx>,
  options?: { defaultScope?: 'global' | string },
) => BoundMutation<TArgs, TResult>;

/** Props added to page components by the router */
export type RouterInjectedProps = {
  runQuery: RunQueryFn;
  mutation: MutationFn;
};

export function renderMatchTree(
  match: MatchResult,
  initialLoaderData: InitialLoaderData,
  appId: string,
  navigate: NavigateFn,
  savedStaticHtml: SavedStaticHtmlMap = new Map(),
  currentPath = '',
  ctx: ContextValue = {},
  ctxResult: ContextResultValue = {},
  apiImplementations: ApiImplementations = {},
  eventStreamImplementations: EventStreamImplementations = {},
  queryClient?: QueryClient,
  mountPath = '',
): RenderResult {
  const portals = new Map<string, React.ReactNode>();

  // Router context value for V1 compatibility (so V1's useNavigate/useCurrentPath work)
  const routerContextValue: RouterContextValue = {
    navigate,
    currentPath,
    checkpoint: () => currentPath,
    isPending: false,
    mountPath,
  };

  // If there's a root page, render it with its outlets as children
  if (match.root) {
    return {
      element: (
        <RouterContext.Provider value={routerContextValue}>
          <SavedStaticHtmlContext.Provider value={savedStaticHtml}>
            <RootRenderer
              root={match.root}
              outlets={match.outlets}
              appId={appId}
              initialLoaderData={initialLoaderData}
              portals={portals}
              navigate={navigate}
              ctx={ctx}
              ctxResult={ctxResult}
              apiImplementations={apiImplementations}
              eventStreamImplementations={eventStreamImplementations}
              queryClient={queryClient}
            />
            <PortalRenderer portals={portals} />
          </SavedStaticHtmlContext.Provider>
        </RouterContext.Provider>
      ),
      portals,
    };
  }

  // Fallback: no root page, render outlets directly
  const rendered: React.ReactNode[] = [];

  for (const [name, branch] of Object.entries(match.outlets)) {
    if (!branch) continue;
    rendered.push(
      <BranchRenderer
        key={buildLoaderKey(branch.pattern, branch.outletPath)}
        branch={branch}
        outletName={String(name)}
        parentIsStatic={false}
        parentRoutePath=""
        appId={appId}
        initialLoaderData={initialLoaderData}
        portals={portals}
        navigate={navigate}
        ctx={ctx}
        ctxResult={ctxResult}
        apiImplementations={apiImplementations}
        eventStreamImplementations={eventStreamImplementations}
        queryClient={queryClient}
      />,
    );
  }

  return {
    element: (
      <RouterContext.Provider value={routerContextValue}>
        <SavedStaticHtmlContext.Provider value={savedStaticHtml}>
          {rendered}
          <PortalRenderer portals={portals} />
        </SavedStaticHtmlContext.Provider>
      </RouterContext.Provider>
    ),
    portals,
  };
}

// ---------------------------------------------------------------------------
// Root renderer component
// ---------------------------------------------------------------------------

type RootRendererProps = {
  root: MatchedRoot;
  outlets: Record<string | symbol, MatchedBranch | null>;
  appId: string;
  initialLoaderData: InitialLoaderData;
  portals: Map<string, React.ReactNode>;
  navigate: NavigateFn;
  ctx: ContextValue;
  ctxResult: ContextResultValue;
  apiImplementations: ApiImplementations;
  eventStreamImplementations: EventStreamImplementations;
  queryClient?: QueryClient;
};

function RootRenderer({
  root,
  outlets,
  appId,
  initialLoaderData,
  portals,
  navigate,
  ctx,
  ctxResult,
  apiImplementations,
  eventStreamImplementations,
  queryClient,
}: RootRendererProps): React.ReactNode {
  const page = (root.node.__page as any) ?? {};
  if (!page?.component) {
    return null;
  }

  const componentRef = page.component as
    | StrategyComponentRef
    | React.ComponentType<unknown>;

  // biome-ignore lint/suspicious/noExplicitAny: Component props vary by route
  // biome-ignore lint/suspicious/noExplicitAny: Component props vary by route
  let Component: (props: any) => React.ReactElement | null;
  if (isStrategyComponent(componentRef)) {
    // biome-ignore lint/suspicious/noExplicitAny: Component props vary by route
    Component = resolveComponent(componentRef) as (
      props: any,
    ) => React.ReactElement | null;
  } else if (isPlainComponent(componentRef)) {
    // biome-ignore lint/suspicious/noExplicitAny: Component props vary by route
    Component = componentRef as (props: any) => React.ReactElement | null;
  } else {
    throw new Error('Invalid component for root route');
  }

  const isStatic = isStaticComponent(componentRef);
  const loaderKey = buildLoaderKey(root.pattern, root.outletPath);
  const loaderDataEntry = initialLoaderData[loaderKey];

  // Build outlet children
  const outletChildren: Record<string, React.ReactNode> = {};
  for (const [name, branch] of Object.entries(outlets)) {
    if (!branch) continue;
    outletChildren[name] = (
      <BranchRenderer
        key={buildLoaderKey(branch.pattern, branch.outletPath)}
        branch={branch}
        outletName={String(name)}
        parentIsStatic={isStatic}
        parentRoutePath={root.pattern}
        appId={appId}
        initialLoaderData={initialLoaderData}
        portals={portals}
        navigate={navigate}
        ctx={ctx}
        ctxResult={ctxResult}
        apiImplementations={apiImplementations}
        eventStreamImplementations={eventStreamImplementations}
        queryClient={queryClient}
      />
    );
  }

  // Compute empty outlets (declared but not matched)
  const declaredOutlets = Object.keys(root.node.__outlets ?? {}).filter(
    (n) => n !== '[PARENT]',
  );
  const emptyOutlets = declaredOutlets.filter((n) => !outlets[n]);

  // getOutlet function for this root
  const getOutlet = (name = 'main') => {
    return createStableOutletComponent(name);
  };

  // Get apiRoutes from page config
  // biome-ignore lint/suspicious/noExplicitAny: page config structure varies
  const pageApiRoutes = (root.node.__page as any)?.apiRoutes ?? {};
  const apiRoutes = pageApiRoutes as Record<string, unknown>;
  // Merge page-defined routes with implementation handlers
  const apiImplementationsForPage: Record<string, unknown> = {};
  for (const routeName of Object.keys(pageApiRoutes)) {
    if (apiImplementations[routeName]) {
      apiImplementationsForPage[routeName] = apiImplementations[routeName];
    }
  }

  // Event streams from page config
  const pageEventStreams =
    (root.node.__page as Record<string, unknown>)?.eventStreams ?? {};
  const eventStreams: Record<string, unknown> = {};
  for (const streamName of Object.keys(pageEventStreams)) {
    if (eventStreamImplementations[streamName]) {
      eventStreams[streamName] = eventStreamImplementations[streamName];
    } else if (
      typeof window !== 'undefined' &&
      process.env.NODE_ENV !== 'production'
    ) {
      console.warn(
        `[render] Missing event stream implementation for "${streamName}"`,
      );
    }
  }

  // Create query runtime helpers (page-scoped)
  const pageScope = `root:${root.pattern}`;
  const { runQuery, mutation, client } = createQueryRuntime(
    {
      ctx,
      pageScope,
      apiImplementations,
    },
    queryClient, // Pass shared QueryClient for optimistic update visibility
  );

  // Augment ctx with query runtime (via symbol for cleanliness)
  const ctxWithRuntime = {
    ...ctx,
    [QUERY_RUNTIME]: {
      client,
      apiImplementations,
      pageScope,
      ctx,
    },
  };

  const props = {
    params: {},
    query: {},
    capabilities: {},
    loaderData: loaderDataEntry, // Now directly the SerializableResult
    getOutlet,
    navigate,
    emptyOutlets,
    ctx: ctxWithRuntime,
    ctxResult,
    apiRoutes,
    apiImplementations: apiImplementationsForPage,
    eventStreams,
    runQuery,
    mutation,
  };

  // Build outlet registry value for children
  const registryValue: OutletRegistryValue = {
    childElements: new Map(Object.entries(outletChildren)),
    registerCapabilities: () => {},
  };

  const staticParentValue: StaticParentContextValue = {
    isStatic,
    appId,
    routePath: root.pattern,
  };

  const content = (
    <OutletRegistryContext.Provider value={registryValue}>
      <StaticParentContext.Provider value={staticParentValue}>
        <Component {...props} />
      </StaticParentContext.Provider>
    </OutletRegistryContext.Provider>
  );

  if (isStatic) {
    const outletId = generateOutletId(appId, root.pattern, 'root');
    return <StaticRouteWrapper id={outletId}>{content}</StaticRouteWrapper>;
  }

  return content;
}

// ---------------------------------------------------------------------------
// Branch renderer component (uses hooks safely)
// ---------------------------------------------------------------------------

type BranchRendererProps = {
  branch: MatchedBranch;
  outletName: string;
  parentIsStatic: boolean;
  parentRoutePath: string;
  appId: string;
  initialLoaderData: InitialLoaderData;
  portals: Map<string, React.ReactNode>;
  navigate: NavigateFn;
  ctx: ContextValue;
  ctxResult: ContextResultValue;
  apiImplementations: ApiImplementations;
  eventStreamImplementations: EventStreamImplementations;
  queryClient?: QueryClient;
};

function BranchRenderer({
  branch,
  outletName,
  parentIsStatic,
  parentRoutePath,
  appId,
  initialLoaderData,
  portals,
  navigate,
  ctx,
  ctxResult,
  apiImplementations,
  eventStreamImplementations,
  queryClient,
}: BranchRendererProps): React.ReactNode {
  // Check if this segment has a [PARENT] match - if so, render that INSTEAD
  // This is the "replacement" semantic: [PARENT] content replaces the segment
  if (branch.kind === 'segment') {
    // Check for [PARENT] match using the symbol directly
    const parentBranch = branch.outlets[PARENT];

    if (parentBranch) {
      const parentBranch = branch.outlets[PARENT];
      if (parentBranch) {
        console.log(
          '[BranchRenderer] Rendering [PARENT] replacement:',
          parentBranch.pattern,
        );
        // Render the [PARENT] branch directly, skipping this segment's component
        return (
          <BranchRenderer
            branch={parentBranch}
            outletName={outletName}
            parentIsStatic={parentIsStatic}
            parentRoutePath={parentRoutePath}
            appId={appId}
            initialLoaderData={initialLoaderData}
            portals={portals}
            navigate={navigate}
            ctx={ctx}
            ctxResult={ctxResult}
            apiImplementations={apiImplementations}
            eventStreamImplementations={eventStreamImplementations}
            queryClient={queryClient}
          />
        );
      }
    }
  }

  const page =
    branch.kind === 'leaf'
      ? ((branch.node.__page as any) ?? {})
      : ((branch.node.__page as any) ?? {});
  const componentRef = page.component as
    | StrategyComponentRef
    | React.ComponentType<any>;

  // biome-ignore lint/suspicious/noExplicitAny: Component props vary by route
  let Component: (props: any) => React.ReactElement | null;
  if (isStrategyComponent(componentRef)) {
    Component = resolveComponent(componentRef) as (
      props: any,
    ) => React.ReactElement | null;
  } else if (isPlainComponent(componentRef)) {
    Component = componentRef as (props: any) => React.ReactElement | null;
  } else {
    throw new Error('Invalid component for route');
  }

  const isStatic = isStaticComponent(componentRef);
  const outletId = generateOutletId(appId, branch.pattern, 'main');

  const loaderKey = buildLoaderKey(branch.pattern, branch.outletPath);
  const loaderDataEntry = initialLoaderData[loaderKey];

  const emptyOutlets: string[] =
    branch.kind === 'segment'
      ? Object.keys(branch.node.__outlets ?? {})
          .filter((name) => name !== '[PARENT]')
          .filter((name) => !branch.outlets[name])
      : [];

  const outletChildren: Record<string, React.ReactNode> = {};
  if (branch.kind === 'segment') {
    for (const [name, child] of Object.entries(branch.outlets)) {
      if (!child) continue;
      outletChildren[name] = (
        <BranchRenderer
          key={name}
          branch={child}
          outletName={String(name)}
          parentIsStatic={isStatic}
          parentRoutePath={branch.pattern}
          appId={appId}
          initialLoaderData={initialLoaderData}
          portals={portals}
          navigate={navigate}
          ctx={ctx}
          ctxResult={ctxResult}
          apiImplementations={apiImplementations}
          eventStreamImplementations={eventStreamImplementations}
          queryClient={queryClient}
        />
      );
    }
  }

  const outletComponentsRef = useRef<Map<string, React.ComponentType<any>>>(
    new Map(),
  );
  const getOutlet = (name = 'main') => {
    const existing = outletComponentsRef.current.get(name);
    if (existing) return existing;
    const created = createStableOutletComponent(name);
    outletComponentsRef.current.set(name, created);
    return created;
  };

  const outletValue = {
    element: outletChildren['main'] ?? null,
    capabilities: {},
  };
  const registryValue: OutletRegistryValue = {
    childElements: new Map(Object.entries(outletChildren)),
    registerCapabilities: () => {},
  };

  // Get apiRoutes from page config
  // biome-ignore lint/suspicious/noExplicitAny: page config structure varies
  const pageApiRoutes = (page as any)?.apiRoutes ?? {};
  const apiRoutes = pageApiRoutes as Record<string, unknown>;
  // Merge page-defined routes with implementation handlers
  const apiImplementationsForPage: Record<string, unknown> = {};
  for (const routeName of Object.keys(pageApiRoutes)) {
    if (apiImplementations[routeName]) {
      apiImplementationsForPage[routeName] = apiImplementations[routeName];
    }
  }

  // Event streams from page config
  const pageEventStreams = (page as Record<string, unknown>).eventStreams ?? {};
  const eventStreams: Record<string, unknown> = {};
  for (const streamName of Object.keys(pageEventStreams)) {
    if (eventStreamImplementations[streamName]) {
      eventStreams[streamName] = eventStreamImplementations[streamName];
    } else if (
      typeof window !== 'undefined' &&
      process.env.NODE_ENV !== 'production'
    ) {
      console.warn(
        `[render] Missing event stream implementation for "${streamName}"`,
      );
    }
  }

  // Create query runtime helpers (page-scoped)
  // Pass shared queryClient so optimistic updates are visible across pages
  const pageScope = `branch:${branch.pattern}`;
  const { runQuery, mutation, client } = createQueryRuntime(
    {
      ctx,
      pageScope,
      apiImplementations,
    },
    queryClient, // Pass shared QueryClient for optimistic update visibility
  );

  // Augment ctx with query runtime (via symbol for cleanliness)
  const ctxWithRuntime = {
    ...ctx,
    [QUERY_RUNTIME]: {
      client,
      apiImplementations,
      pageScope,
      ctx,
    },
  };

  const componentElement = (
    <Component
      params={branch.params}
      query={branch.query}
      capabilities={{}}
      loaderData={loaderDataEntry} // Now directly the SerializableResult
      getOutlet={getOutlet}
      navigate={navigate}
      emptyOutlets={emptyOutlets}
      ctx={ctxWithRuntime}
      ctxResult={ctxResult}
      apiRoutes={apiRoutes}
      apiImplementations={apiImplementationsForPage}
      eventStreams={eventStreams}
      runQuery={runQuery}
      mutation={mutation}
    />
  );

  const wrapped = page.errorBoundary ? (
    <ErrorBoundaryWrapper
      ErrorBoundary={page.errorBoundary}
      children={componentElement}
    />
  ) : (
    componentElement
  );

  const staticWrapped =
    isStatic && outletId ? (
      <StaticRouteWrapper id={outletId}>{wrapped}</StaticRouteWrapper>
    ) : (
      wrapped
    );

  if (parentIsStatic) {
    const targetId = generateOutletId(appId, parentRoutePath, outletName);
    portals.set(targetId, staticWrapped);
  }

  return (
    <StaticParentContext.Provider
      value={{ isStatic, appId, routePath: branch.pattern }}
    >
      <OutletRegistryContext.Provider value={registryValue}>
        <OutletContext.Provider value={outletValue}>
          {staticWrapped}
        </OutletContext.Provider>
      </OutletRegistryContext.Provider>
    </StaticParentContext.Provider>
  );
}
