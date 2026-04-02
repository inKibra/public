// AppRouteNode is the structural type returned by createAppRouteTree
// We use a structural constraint (AnyAppRouteNode below) rather than importing
import type { InitialLoaderData } from './app-shell';
import type { AnyContextCodec } from './context-codec';
import type { AppConfigSchema } from './create-app-shared';
import {
  getMetaProperties,
  parseMetaTag,
  readLoaderDataFromMeta,
} from './create-app-shared';

// Structural constraint for route trees (minimal required shape)
type AnyAppRouteNode = {
  readonly __kind: 'appRoute';
  readonly __ctx: unknown;
  readonly __outlets: unknown;
  readonly __page: unknown;
  readonly $paths: unknown;
  readonly $pages: unknown;
  readonly __contextCodecs: Record<string, AnyContextCodec>;
  readonly __contextCodecNames: string[];
};

export type AppDefinition<TConfig, TTree extends AnyAppRouteNode> = {
  appId: string;
  mountPath: string;
  schema: AppConfigSchema<TConfig>;
  routes: TTree;
  defaultConfig: TConfig;
};

export type PreparedAppConfig<TConfig, TTree extends AnyAppRouteNode> = {
  app: AppDefinition<TConfig, TTree>;
  config: TConfig;
  loaderData?: InitialLoaderData;
  initialSessionStorage?: Record<string, unknown>;
  initialDeviceStorage?: Record<string, unknown>;
  mountPointId?: string;
};

export type PrepareOptions<TConfig> = {
  config?: Partial<TConfig>;
};

export function createApp<TConfig, TTree extends AnyAppRouteNode>(config: {
  appId: string;
  mountPath: string;
  schema: AppConfigSchema<TConfig>;
  routes: TTree;
  defaultConfig: TConfig;
}): AppDefinition<TConfig, TTree> {
  return {
    appId: config.appId,
    mountPath: config.mountPath,
    routes: config.routes,
    schema: config.schema,
    defaultConfig: config.defaultConfig,
  };
}

export function prepare<TConfig, TTree extends AnyAppRouteNode>(
  app: AppDefinition<TConfig, TTree>,
  options?: PrepareOptions<TConfig>,
): PreparedAppConfig<TConfig, TTree> {
  // Client: read from meta tags
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const props = getMetaProperties(app.appId);

    const rawConfig = parseMetaTag<unknown>(props.config);
    if (!rawConfig) {
      throw new Error(`Missing meta tag: ${props.config}`);
    }

    const validation = app.schema.config(rawConfig);
    if (!validation.success) {
      throw new Error(
        `Invalid app config from meta tag: ${JSON.stringify(validation.errors)}`,
      );
    }

    // Loader data is now stored directly as SerializableResult (no conversion needed)
    const loaderData = readLoaderDataFromMeta(app.appId) as InitialLoaderData;

    // Read session/device context from meta tags
    // SSR emits these as {appId}:session and {appId}:device
    const initialSessionStorage =
      parseMetaTag<Record<string, unknown>>(`${app.appId}:session`) ?? {};
    const initialDeviceStorage =
      parseMetaTag<Record<string, unknown>>(`${app.appId}:device`) ?? {};

    const mountPointId = parseMetaTag<string>(props.mountPointId);

    return {
      app,
      config: validation.data,
      initialSessionStorage,
      initialDeviceStorage,
      loaderData,
      mountPointId,
    };
  }

  // Server: merge defaultConfig with overrides
  const mergedConfig = options?.config
    ? { ...app.defaultConfig, ...options.config }
    : app.defaultConfig;

  const validation = app.schema.config(mergedConfig);
  if (!validation.success) {
    throw new Error(`Invalid app config: ${JSON.stringify(validation.errors)}`);
  }

  return {
    app,
    config: validation.data,
    // loaderData, storage, mountPointId set by runServerSideRender
  };
}
