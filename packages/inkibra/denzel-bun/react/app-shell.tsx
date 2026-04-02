/** @jsxImportSource react */
/**
 * AppShell - SSR Document Shell
 *
 * Provides a structured HTML document with proper ordering:
 * 1. Config meta tag (app:config)
 * 2. Context meta tag (app:context)
 * 3. Loader data meta tags (app:loader:*)
 * 4. Mount point ID meta tag (app:mountPointId)
 * 5. Head children (description, fonts, styles)
 * 6. Client script (always last in head)
 * 7. Body content with mount point
 *
 * Usage (with runServerSideRender):
 * ```tsx
 * runServerSideRender(
 *   <Router routes={appRoutes} />,
 *   { appConfig, source, implementations, contextGetter, mountPointId, routes },
 *   <AppShell lang="en" clientScript={clientScript}>
 *     <AppShell.Head>...</AppShell.Head>
 *     <AppShell.Body>
 *       <AppShell.MountPoint />
 *     </AppShell.Body>
 *   </AppShell>
 * );
 * ```
 */

import {
  type AppRouteNode,
  getMetaProperties,
  type LoaderDataMap,
  type PreparedAppConfig,
} from '@inkibra/router';
import type React from 'react';
import { createContext, useContext } from 'react';

// ============================================================================
// Types
// ============================================================================

/**
 * AppShell props - simplified, reads appConfig and mountPointId from RenderContext
 */
type AppShellProps = {
  /** HTML lang attribute */
  lang?: string;
  /** Client script tag */
  clientScript: React.ReactNode;
  /** Children (Head and Body components) */
  children: React.ReactNode;
};

/**
 * AppShell.Head props
 */
type AppShellHeadProps = {
  /** Additional head elements (meta tags, links, styles) */
  children?: React.ReactNode;
};

/**
 * AppShell.Body props
 */
type AppShellBodyProps = React.HTMLAttributes<HTMLBodyElement> & {
  /** Body content */
  children: React.ReactNode;
};

/**
 * AppShell.MountPoint props
 */
type AppShellMountPointProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'id'>;

// ============================================================================
// Render Context (provided by runServerSideRender)
// ============================================================================

/**
 * Render context - populated by runServerSideRender before rendering
 * Contains all data needed by AppShell to render meta tags
 */
export type RenderContextValue = {
  /** Prepared app config (includes app name, config values) */
  // biome-ignore lint/suspicious/noExplicitAny: Generic config type
  appConfig: PreparedAppConfig<any, AppRouteNode<any, any, any>>;
  /** Mount point element ID for React hydration */
  mountPointId: string;
  /** Loader data from running server loaders */
  loaderData: LoaderDataMap;
  /** Session-scoped context values (for meta tag serialization) */
  sessionContext: Record<string, unknown>;
  /** Device-scoped context values (for meta tag serialization) */
  deviceContext: Record<string, unknown>;
};

const RenderContext = createContext<RenderContextValue | null>(null);

/**
 * Hook to read render context
 */
function useRenderContext(): RenderContextValue {
  const ctx = useContext(RenderContext);
  if (!ctx) {
    throw new Error(
      'AppShell must be used within runServerSideRender (which provides RenderContext)',
    );
  }
  return ctx;
}

/**
 * Provider for render context (exported for runServerSideRender)
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
// Internal Context for AppShell components
// ============================================================================

type AppShellContextValue = {
  /** Client script element */
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

// ============================================================================
// AppShell.Head
// ============================================================================

/**
 * AppShell.Head - Renders the <head> element with proper ordering
 */
function AppShellHead({ children }: AppShellHeadProps): React.ReactNode {
  const shellCtx = useAppShellContext();
  const renderCtx = useRenderContext();

  const props = getMetaProperties(renderCtx.appConfig.app.appId);

  // Build loader data meta tags
  const loaderMetaTags = Object.entries(renderCtx.loaderData).map(
    ([name, value]) => (
      <meta
        key={name}
        property={`${props.loaderPrefix}${name}`}
        content={JSON.stringify(value)}
      />
    ),
  );

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

      {/* 6. User-provided head content (description, fonts, styles) */}
      {children}

      {/* 7. Client script (always last in head) */}
      {shellCtx.clientScript}
    </head>
  );
}

// ============================================================================
// AppShell.Body
// ============================================================================

/**
 * AppShell.Body - Renders the <body> element
 */
function AppShellBody({
  children,
  ...props
}: AppShellBodyProps): React.ReactNode {
  return <body {...props}>{children}</body>;
}

// ============================================================================
// AppShell.MountPoint
// ============================================================================

/**
 * AppShell.MountPoint - Div element for React hydration
 *
 * Uses the mountPointId from RenderContext. The ID is written to a meta tag
 * so the client knows where to hydrate.
 */
function AppShellMountPoint({
  children,
  ...props
}: AppShellMountPointProps): React.ReactNode {
  const renderCtx = useRenderContext();

  return (
    <div id={renderCtx.mountPointId} {...props}>
      {children}
    </div>
  );
}

// ============================================================================
// AppShell
// ============================================================================

/**
 * AppShell - Complete HTML document wrapper for SSR
 *
 * Must be used within runServerSideRender, which provides RenderContext
 * with appConfig, mountPointId, loaderData, and context.
 *
 * @example
 * ```tsx
 * const appConfig = prepare(ExampleApp, { config: defaultConfig });
 *
 * const html = await runServerSideRender(
 *   <Router routes={appRoutes} />,
 *   { appConfig, source, implementations, contextGetter, mountPointId: 'app-root', routes },
 *   <AppShell lang="en" clientScript={await getClientAssetTags()}>
 *     <AppShell.Head>
 *       <DescriptionTags title="My App" description="..." />
 *       <GoogleFonts families={['Inter']} />
 *     </AppShell.Head>
 *     <AppShell.Body>
 *       <AppShell.MountPoint />
 *     </AppShell.Body>
 *   </AppShell>
 * );
 * ```
 */
function AppShell({
  lang = 'en',
  clientScript,
  children,
}: AppShellProps): React.ReactNode {
  const contextValue: AppShellContextValue = {
    clientScript,
  };

  return (
    <AppShellContext.Provider value={contextValue}>
      <html lang={lang}>{children}</html>
    </AppShellContext.Provider>
  );
}

// Attach sub-components
AppShell.Head = AppShellHead;
AppShell.Body = AppShellBody;
AppShell.MountPoint = AppShellMountPoint;

export {
  AppShell,
  type AppShellProps,
  type AppShellHeadProps,
  type AppShellBodyProps,
  type AppShellMountPointProps,
};
