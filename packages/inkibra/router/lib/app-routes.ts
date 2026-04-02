/**
 * App Routes V2 - Fluent Builder API
 *
 * Solves type inference by splitting definition steps:
 * 1. Define structure (segment/leaf)
 * 2. Define API dependencies (.api()) -> locks in TApi type
 * 3. Define page config (.page()) -> uses locked TApi for loader
 * 4. Define children (.outlets())
 *
 * Pattern:
 * createAppRouteTree(contextCodec)
 *   .page({...})
 *   .outlets(o => ({
 *     main: o.outlet('main').segments(s => ({
 *       boards: s.segment('boards')
 *         .api({ listBoards })
 *         .page({ loader: (api) => ... }) // api is typed!
 *         .outlets(o => ({...}))
 *     }))
 *   }))
 */

import type { IValidation } from 'typia/lib';
import type { AnyApiRoute } from './api-route';
import type {
  ApiRouteImplementations,
  ApiRouteMap as BaseApiRouteMap,
  InheritedContextCodecsFromApiRoutes,
  RouteContextFromCodecs,
} from './app-route';
import type {
  CapabilityDefinition,
  CapabilityDefinitionMap,
} from './capability';
import type {
  AnyContextCodec,
  ContextCodecMap,
  ContextCodecMapDataTypes,
  ContextResult,
} from './context-codec';
import type { Mutation } from './create-mutation';
import type { Query } from './create-query';
import type {
  AnyEventStreamRoute,
  EventStreamRoute,
  EventStreamRouteNamedTypes,
} from './event-stream-route';
import type {
  ApiImplementationsMap,
  BoundMutation,
  MutationBindOptions,
  QueryResultTuple,
  RunQueryOptions,
  WithQueryRuntime,
} from './query-runtime';
import type { SerializableResult } from './result';
import type {
  LazyComponentRef,
  StaticComponentRef,
  SyncComponentRef,
} from './strategy';
import type { EventStreamHandler } from './use-event-stream-hooks';

// Symbol for parent outlet (replacement routes)
export const PARENT = Symbol.for('inkibra.router.parent');
export type PARENT = typeof PARENT;

// ---------------------------------------------------------------------------
// Basic helper types
// ---------------------------------------------------------------------------

type Validator<T> = (input: unknown) => IValidation<T>;

// Re-use ApiRouteMap from app-route.ts
type ApiRouteMap = BaseApiRouteMap;

// Empty context type - represents "no context requirements"
// Must be {} not Record<string, never> because Record<string, never> creates
// an index signature requiring all values to be never
type EmptyContext = {};

type ContextResultMap<TContext> = {
  [K in keyof TContext]: ContextResult<TContext[K], unknown, unknown>;
};

// Handle the case where InheritedContextCodecsFromApiRoutes returns never (no context required)
// Use [X] extends [never] trick because never extends everything, but [never] only extends [never]
type ApiContextCodecs<T extends ApiRouteMap> = [
  InheritedContextCodecsFromApiRoutes<T>,
] extends [never]
  ? EmptyContext
  : InheritedContextCodecsFromApiRoutes<T> extends ContextCodecMap
    ? InheritedContextCodecsFromApiRoutes<T>
    : EmptyContext;

// Extract the context data type from API routes
// For routes with no context, this returns {} (empty object)
// For routes with context, this returns the context data type map
type ApiContextFromMap<T extends ApiRouteMap> = [
  InheritedContextCodecsFromApiRoutes<T>,
] extends [never]
  ? EmptyContext
  : RouteContextFromCodecs<ApiContextCodecs<T>>;

type EventStreamMap = Record<string, AnyEventStreamRoute>;

// ---------------------------------------------------------------------------
// Mixed Route Map - allows API routes and EventStream routes in same object
// ---------------------------------------------------------------------------

/**
 * A map that can contain both API routes and EventStream routes.
 * Users can pass: { getChannel, sendMessage, chatMessages }
 * where some are API routes and some are event streams.
 */
type MixedRouteMap = Record<string, AnyApiRoute | AnyEventStreamRoute>;

/**
 * Extract only the API routes from a mixed map.
 * Discriminates by checking for `method` property (only ApiRoute has it).
 */
type ExtractApiFromMixed<T extends MixedRouteMap> = {
  [K in keyof T as T[K] extends AnyApiRoute
    ? K
    : never]: T[K] extends AnyApiRoute ? T[K] : never;
};

/**
 * Extract only the EventStream routes from a mixed map.
 * Discriminates by checking for absence of `method` property.
 */
type ExtractStreamsFromMixed<T extends MixedRouteMap> = {
  [K in keyof T as T[K] extends AnyEventStreamRoute
    ? T[K] extends AnyApiRoute
      ? never // Exclude if it's also an ApiRoute (shouldn't happen, but safe)
      : K
    : never]: T[K] extends AnyEventStreamRoute ? T[K] : never;
};

// ---------------------------------------------------------------------------
// Event stream extraction from page/tree
// ---------------------------------------------------------------------------

type ExtractEventStreams<T> = T extends { __page: infer Page }
  ? Page extends { eventStreams: infer Streams extends EventStreamMap }
    ? Streams
    : {}
  : T extends { eventStreams: infer Streams extends EventStreamMap }
    ? Streams
    : {};
type EventStreamImplementations<T> = {
  [K in keyof T]: T[K] extends EventStreamRoute<infer TPath, infer Types>
    ? EventStreamHandler<
        TPath extends string ? TPath : string,
        Types extends EventStreamRouteNamedTypes<any>
          ? Types
          : EventStreamRouteNamedTypes<string>
      >
    : EventStreamHandler<string, any>;
};

type LoaderSchema<TData, TError> = {
  response: Validator<TData>;
  error: Validator<TError>;
};
type LoaderSchemaData<T> = T extends LoaderSchema<infer D, any> ? D : unknown;
type LoaderSchemaError<T> = T extends LoaderSchema<any, infer E> ? E : unknown;

type QuerySchema = Record<string, Validator<unknown>>;

type InferValidatorType<V> = V extends Validator<infer T> ? T : never;
type TypeFromQuerySchema<S extends QuerySchema> = {
  [K in keyof S]?: InferValidatorType<S[K]>;
};

// Path parameter extraction
type ExtractParamName<T extends string> = T extends `:${infer Name}`
  ? Name
  : never;
type IsParam<T extends string> = T extends `:${string}` ? true : false;
type AddParam<
  TPath extends string,
  P extends Record<string, string>,
> = IsParam<TPath> extends true
  ? P & Record<ExtractParamName<TPath>, string>
  : P;

// Union to Intersection helper for flattening $paths
// biome-ignore lint/suspicious/noExplicitAny: utility type
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never;

// Component types
// biome-ignore lint/suspicious/noExplicitAny: props vary by component
type AnyRouteComponent =
  | SyncComponentRef<any>
  | LazyComponentRef<any>
  | StaticComponentRef<any>;

// ---------------------------------------------------------------------------
// Accumulated context flowing through the tree
// ---------------------------------------------------------------------------

type AccCtx<
  TRootCtx,
  P extends Record<string, string>,
  Q extends Record<string, Record<string, unknown>>,
  C extends CapabilityDefinitionMap,
> = { rootCtx: TRootCtx; params: P; query: Q; capabilities: C };

type EmptyCtx<TRootCtx> = AccCtx<
  TRootCtx,
  {},
  Record<string, never>,
  Record<string, never>
>;

type MergeCaps<
  Parent extends CapabilityDefinitionMap,
  Child extends CapabilityDefinitionMap,
> = Parent & Child;

// ---------------------------------------------------------------------------
// Page config - with typed apiRoutes and eventStreams
// ---------------------------------------------------------------------------

/**
 * PageConfigInput - what users pass to .page()
 * Does not include apiRoutes or eventStreams (added by builder from .api())
 */
type PageConfigInput<
  TRootCtx,
  TParams extends Record<string, string>,
  TQuery extends Record<string, Record<string, unknown>>,
  TCaps extends CapabilityDefinitionMap,
  TApi extends ApiRouteMap,
  TLoaderSchema extends LoaderSchema<any, any> | undefined = LoaderSchema<
    unknown,
    unknown
  >,
> = {
  loader?: {
    schema: TLoaderSchema;
    load: (
      api: ApiRouteImplementations<TApi>,
      args: {
        params: TParams;
        query: TQuery;
        // ctx receives the global root context
        ctx: TRootCtx & { capabilities: TCaps };
        // ctxResult provides decode/enforcement outcomes side-by-side
        ctxResult: ContextResultMap<TRootCtx>;
      },
    ) => Promise<
      SerializableResult<
        LoaderSchemaData<TLoaderSchema>,
        LoaderSchemaError<TLoaderSchema>
      >
    >;
  };
  component: AnyRouteComponent;
  skeleton?: AnyRouteComponent;
  errorBoundary?: AnyRouteComponent;
};

/**
 * PageConfig - stored configuration with apiRoutes and eventStreams
 * NOTE: apiRoutes and eventStreams are included so tree extractors can find them
 */
type PageConfig<
  TRootCtx,
  TParams extends Record<string, string>,
  TQuery extends Record<string, Record<string, unknown>>,
  TCaps extends CapabilityDefinitionMap,
  TApi extends ApiRouteMap,
  TStreams extends EventStreamMap = Record<string, never>,
  TLoaderSchema extends LoaderSchema<any, any> | undefined = LoaderSchema<
    unknown,
    unknown
  >,
> = PageConfigInput<TRootCtx, TParams, TQuery, TCaps, TApi, TLoaderSchema> & {
  // API routes used by this page - enables structural extraction via ApiRoutesFromTree
  apiRoutes: TApi;
  // Event streams used by this page - enables structural extraction and typed props
  eventStreams: TStreams;
};

// ---------------------------------------------------------------------------
// Node shapes
// ---------------------------------------------------------------------------

type LeafNode<
  TPath extends string,
  TCtx extends AccCtx<any, any, any, any>,
  TPage,
> = {
  readonly __kind: 'leaf';
  readonly path: TPath;
  readonly __ctx: TCtx;
  readonly __page: TPage;
};

type SegmentNode<
  TPath extends string,
  TCtx extends AccCtx<any, any, any, any>,
  TOutlets extends OutletsMap,
  TPage,
> = {
  readonly __kind: 'segment';
  readonly path: TPath;
  readonly __ctx: TCtx;
  readonly __outlets: TOutlets;
  readonly __page: TPage;
};

type OutletNode<
  TChildCtx extends AccCtx<any, any, any, any>,
  TCaps extends CapabilityDefinitionMap,
  TQuery extends QuerySchema,
  TSegments extends SegmentsMap,
> = {
  readonly __kind: 'outlet';
  readonly __childCtx: TChildCtx;
  readonly __config: { providesCapabilities?: TCaps; querySchema?: TQuery };
  readonly __segments: TSegments;
};

type AppRouteNode<
  TRootCtx,
  TOutlets extends OutletsMap,
  TRootPage = unknown,
> = {
  readonly __kind: 'appRoute';
  readonly __ctx: EmptyCtx<TRootCtx>;
  readonly __outlets: TOutlets;
  readonly __page: TRootPage;
  readonly $paths: PathsFromOutlets<TOutlets>;
  /** Pages accessor - preserves outlet structure for component typing */
  readonly $pages: PagesFromOutlets<TOutlets>;
  /** Runtime access to context codecs for context-result resolution */
  readonly __contextCodecs: Record<string, AnyContextCodec>;
  /** Runtime access to context codec names for extraction */
  readonly __contextCodecNames: string[];
};

type PageApiRoutes<TPage> = TPage extends { apiRoutes: infer A } ? A : {};

type ApiRoutesFromLeaf<T> = T extends LeafNode<any, any, infer P>
  ? PageApiRoutes<P>
  : {};

type ApiRoutesFromSegment<T> = T extends SegmentNode<any, any, infer O, infer P>
  ? PageApiRoutes<P> & ApiRoutesFromOutlets<O>
  : {};

type ApiRoutesFromSegments<TSegments> = UnionToIntersection<
  {
    [K in keyof TSegments]: TSegments[K] extends { __kind: infer KKind }
      ? KKind extends 'leaf'
        ? ApiRoutesFromLeaf<TSegments[K]>
        : KKind extends 'segment'
          ? ApiRoutesFromSegment<TSegments[K]>
          : {}
      : {};
  }[keyof TSegments]
>;

type ApiRoutesFromOutlets<TOutlets extends OutletsMap> = UnionToIntersection<
  {
    [K in keyof TOutlets]: TOutlets[K] extends OutletNode<
      any,
      any,
      any,
      infer Segs
    >
      ? ApiRoutesFromSegments<Segs>
      : {};
  }[keyof TOutlets]
>;

export type ApiRoutesFromTree<TTree extends AppRouteNode<any, any, any>> =
  TTree extends AppRouteNode<any, infer O, infer P>
    ? PageApiRoutes<P> & ApiRoutesFromOutlets<O>
    : {};

type EventStreamsFromSegments<TSegments extends SegmentsMap> = {
  [K in keyof TSegments]: TSegments[K] extends LeafNode<any, any, infer P>
    ? P extends { eventStreams: infer Streams extends EventStreamMap }
      ? Streams
      : {}
    : TSegments[K] extends SegmentNode<any, any, infer O, infer P>
      ?
          | (P extends { eventStreams: infer Streams extends EventStreamMap }
              ? Streams
              : {})
          | EventStreamsFromOutlets<O>
      : {};
}[keyof TSegments];

type EventStreamsFromOutlets<TOutlets extends OutletsMap> = UnionToIntersection<
  {
    [K in keyof TOutlets]: TOutlets[K] extends OutletNode<
      any,
      any,
      any,
      infer Segs
    >
      ? EventStreamsFromSegments<Segs>
      : {};
  }[keyof TOutlets]
>;

type PageEventStreams<TPage> = TPage extends {
  eventStreams: infer S extends EventStreamMap;
}
  ? S
  : {};

export type EventStreamsFromTree<TTree extends AppRouteNode<any, any, any>> =
  TTree extends AppRouteNode<any, infer O, infer P>
    ? PageEventStreams<P> & EventStreamsFromOutlets<O>
    : {};

export type OutletsMap = {
  [key: string]: OutletNode<any, any, any, any>;
} & {
  [PARENT]?: OutletNode<any, any, any, any>;
};

type SegmentsMap = Record<
  string,
  LeafNode<any, any, any> | SegmentNode<any, any, any, any>
>;

// ---------------------------------------------------------------------------
// Fluent Builders
// ---------------------------------------------------------------------------

/**
 * SegmentBuilder - entry point for defining a segment/leaf
 * 1. .api() - optional, sets TApi and TStreams (accepts mixed routes)
 * 2. .page() - required, uses TApi
 * 3. .outlets() - optional (only for segments)
 */
type SegmentDefinitionBuilder<TCtx extends AccCtx<any, any, any, any>> = {
  // Start defining a leaf
  leaf<TPath extends string>(
    path: TPath,
  ): RouteConfigBuilder<
    'leaf',
    TCtx['rootCtx'],
    TPath,
    AddParam<TPath, TCtx['params']>,
    TCtx['query'],
    TCtx['capabilities'],
    Record<string, never>,
    Record<string, never>
  >;

  // Start defining a segment
  segment<TPath extends string>(
    path: TPath,
  ): RouteConfigBuilder<
    'segment',
    TCtx['rootCtx'],
    TPath,
    AddParam<TPath, TCtx['params']>,
    TCtx['query'],
    TCtx['capabilities'],
    Record<string, never>,
    Record<string, never>
  >;
};

// Builder state for constructing a route
interface RouteConfigBuilder<
  Kind extends 'leaf' | 'segment',
  TRootCtx,
  TPath extends string,
  TParams extends Record<string, string>,
  TQuery extends Record<string, Record<string, unknown>>,
  TCaps extends CapabilityDefinitionMap,
  TApi extends ApiRouteMap,
  TStreams extends EventStreamMap = Record<string, never>,
> {
  /**
   * Define API routes and/or event streams for this route.
   * Accepts a mixed object containing both API routes and event stream routes.
   *
   * @example
   * ```typescript
   * // API routes only (legacy style still works)
   * .api({ getChannel, sendMessage })
   *
   * // Mixed API routes and event streams
   * .api({ getChannel, sendMessage, chatMessages })
   * ```
   */
  api<TMixed extends MixedRouteMap>(
    routes: TRootCtx extends ApiContextFromMap<ExtractApiFromMixed<TMixed>>
      ? TMixed
      : never,
  ): RouteConfigBuilder<
    Kind,
    TRootCtx,
    TPath,
    TParams,
    TQuery,
    TCaps,
    ExtractApiFromMixed<TMixed>,
    ExtractStreamsFromMixed<TMixed>
  >;

  // 2. Define page config (loader uses TApi and TRootCtx)
  // TSchema is inferred from config.loader.schema - this is the key fix!
  // Input: PageConfigInput (no apiRoutes/eventStreams), Output: PageConfig (with both)
  page<TSchema extends LoaderSchema<any, any> | undefined = undefined>(
    config: PageConfigInput<TRootCtx, TParams, TQuery, TCaps, TApi, TSchema>,
  ): Kind extends 'leaf'
    ? LeafNode<
        TPath,
        AccCtx<TRootCtx, TParams, TQuery, TCaps>,
        PageConfig<TRootCtx, TParams, TQuery, TCaps, TApi, TStreams, TSchema>
      >
    : SegmentOutletsBuilder<
        TRootCtx,
        TPath,
        TParams,
        TQuery,
        TCaps,
        PageConfig<TRootCtx, TParams, TQuery, TCaps, TApi, TStreams, TSchema>
      >;
}

// Builder for adding outlets to a segment
interface SegmentOutletsBuilder<
  TRootCtx,
  TPath extends string,
  TParams extends Record<string, string>,
  TQuery extends Record<string, Record<string, unknown>>,
  TCaps extends CapabilityDefinitionMap,
  TPage,
> {
  outlets<TOutlets extends OutletsMap>(
    build: (
      b: OutletContainerBuilder<AccCtx<TRootCtx, TParams, TQuery, TCaps>>,
    ) => TOutlets,
  ): SegmentNode<
    TPath,
    AccCtx<TRootCtx, TParams, TQuery, TCaps>,
    TOutlets,
    TPage
  >;
}

// Builder for creating outlets
type OutletContainerBuilder<TParentCtx extends AccCtx<any, any, any, any>> = {
  outlet<
    TName extends string,
    TCaps extends CapabilityDefinitionMap = Record<string, never>,
    TQuery extends QuerySchema = Record<string, never>,
  >(
    name: TName,
    config?: { providesCapabilities?: TCaps; querySchema?: TQuery },
  ): OutletContentBuilder<
    AccCtx<
      TParentCtx['rootCtx'],
      TParentCtx['params'],
      TParentCtx['query'] & { [K in TName]: TypeFromQuerySchema<TQuery> },
      MergeCaps<TParentCtx['capabilities'], TCaps>
    >,
    TCaps,
    TQuery
  >;

  // Replacement outlet (renders in parent slot)
  replacement<TSegments extends SegmentsMap>(
    buildSegments: (
      b: SegmentDefinitionBuilder<TParentCtx>,
    ) => TSegments & EnforceKeyPathMatch<TSegments>,
  ): OutletNode<
    TParentCtx,
    Record<string, never>,
    Record<string, never>,
    TSegments
  >;
};

// Builder for filling an outlet with segments
type OutletContentBuilder<
  TChildCtx extends AccCtx<any, any, any, any>,
  TCaps extends CapabilityDefinitionMap,
  TQuery extends QuerySchema,
> = {
  segments<TSegments extends SegmentsMap>(
    build: (
      b: SegmentDefinitionBuilder<TChildCtx>,
    ) => TSegments & EnforceKeyPathMatch<TSegments>,
  ): OutletNode<TChildCtx, TCaps, TQuery, TSegments>;
};

// ---------------------------------------------------------------------------
// Key === Path enforcement
// ---------------------------------------------------------------------------

type EnforceKeyPathMatch<TMap extends SegmentsMap> = {
  [K in keyof TMap]: K extends string
    ? TMap[K] extends LeafNode<infer P, any, any>
      ? P extends K
        ? TMap[K]
        : `Error: path '${P & string}' must match key '${K}'`
      : TMap[K] extends SegmentNode<infer P, any, any, any>
        ? P extends K
          ? TMap[K]
          : `Error: path '${P & string}' must match key '${K}'`
        : TMap[K]
    : TMap[K];
};

// ---------------------------------------------------------------------------
// Implementations - Fully Generic
// ---------------------------------------------------------------------------

/**
 * Runtime helper to partition a mixed route map into API routes and event streams.
 * ApiRoute has a `method` property, EventStreamRoute does not.
 */
function partitionMixedRoutes(mixed: MixedRouteMap): {
  api: ApiRouteMap;
  streams: EventStreamMap;
} {
  const api: ApiRouteMap = {};
  const streams: EventStreamMap = {};

  for (const [key, route] of Object.entries(mixed)) {
    // ApiRoute has a `method` getter, EventStreamRoute does not
    if ('method' in route && typeof route.method === 'string') {
      api[key] = route as AnyApiRoute;
    } else {
      streams[key] = route as AnyEventStreamRoute;
    }
  }

  return { api, streams };
}

class RouteConfigBuilderImpl<
  Kind extends 'leaf' | 'segment',
  TRootCtx,
  TPath extends string,
  TParams extends Record<string, string>,
  TQuery extends Record<string, Record<string, unknown>>,
  TCaps extends CapabilityDefinitionMap,
  TApi extends ApiRouteMap,
  TStreams extends EventStreamMap = Record<string, never>,
> implements
    RouteConfigBuilder<
      Kind,
      TRootCtx,
      TPath,
      TParams,
      TQuery,
      TCaps,
      TApi,
      TStreams
    >
{
  constructor(
    private kind: Kind,
    private path: TPath,
    private apiRoutes: TApi,
    private eventStreams: TStreams = {} as TStreams,
  ) {}

  api<TMixed extends MixedRouteMap>(
    routes: TRootCtx extends ApiContextFromMap<ExtractApiFromMixed<TMixed>>
      ? TMixed
      : never,
  ): RouteConfigBuilder<
    Kind,
    TRootCtx,
    TPath,
    TParams,
    TQuery,
    TCaps,
    ExtractApiFromMixed<TMixed>,
    ExtractStreamsFromMixed<TMixed>
  > {
    const { api, streams } = partitionMixedRoutes(routes as MixedRouteMap);
    return new RouteConfigBuilderImpl<
      Kind,
      TRootCtx,
      TPath,
      TParams,
      TQuery,
      TCaps,
      ExtractApiFromMixed<TMixed>,
      ExtractStreamsFromMixed<TMixed>
    >(
      this.kind,
      this.path,
      api as ExtractApiFromMixed<TMixed>,
      streams as ExtractStreamsFromMixed<TMixed>,
    );
  }

  // biome-ignore lint/suspicious/noExplicitAny: Return type conditional is hard to satisfy in impl
  page<TSchema extends LoaderSchema<any, any> | undefined>(
    config: PageConfigInput<TRootCtx, TParams, TQuery, TCaps, TApi, TSchema>,
  ): any {
    const fullConfig = {
      ...config,
      apiRoutes: this.apiRoutes,
      eventStreams: this.eventStreams,
    };

    if (this.kind === 'leaf') {
      return {
        __kind: 'leaf',
        path: this.path,
        __ctx: {} as any,
        __page: fullConfig as PageConfig<
          TRootCtx,
          TParams,
          TQuery,
          TCaps,
          TApi,
          TStreams,
          TSchema
        >,
      };
    }

    return new SegmentOutletsBuilderImpl<
      TRootCtx,
      TPath,
      TParams,
      TQuery,
      TCaps,
      PageConfig<TRootCtx, TParams, TQuery, TCaps, TApi, TStreams, TSchema>
    >(this.path, fullConfig);
  }
}

class SegmentOutletsBuilderImpl<
  TRootCtx,
  TPath extends string,
  TParams extends Record<string, string>,
  TQuery extends Record<string, Record<string, unknown>>,
  TCaps extends CapabilityDefinitionMap,
  TPage,
> implements
    SegmentOutletsBuilder<TRootCtx, TPath, TParams, TQuery, TCaps, TPage>
{
  constructor(
    private path: TPath,
    // biome-ignore lint/suspicious/noExplicitAny: config storage
    private pageConfig: TPage,
  ) {}

  outlets<TOutlets extends OutletsMap>(
    build: (
      b: OutletContainerBuilder<AccCtx<TRootCtx, TParams, TQuery, TCaps>>,
    ) => TOutlets,
  ): SegmentNode<
    TPath,
    AccCtx<TRootCtx, TParams, TQuery, TCaps>,
    TOutlets,
    TPage
  > {
    const outletBuilder = new OutletContainerBuilderImpl<
      AccCtx<TRootCtx, TParams, TQuery, TCaps>
    >();
    const outlets = build(outletBuilder);
    return {
      __kind: 'segment',
      path: this.path,
      __ctx: {} as any,
      __page: this.pageConfig,
      __outlets: outlets,
    };
  }
}

class OutletContainerBuilderImpl<TParentCtx extends AccCtx<any, any, any, any>>
  implements OutletContainerBuilder<TParentCtx>
{
  outlet<
    TName extends string,
    TCaps extends CapabilityDefinitionMap = Record<string, never>,
    TQuery extends QuerySchema = Record<string, never>,
  >(
    name: TName,
    config?: { providesCapabilities?: TCaps; querySchema?: TQuery },
  ): OutletContentBuilder<
    AccCtx<
      TParentCtx['rootCtx'],
      TParentCtx['params'],
      TParentCtx['query'] & { [K in TName]: TypeFromQuerySchema<TQuery> },
      MergeCaps<TParentCtx['capabilities'], TCaps>
    >,
    TCaps,
    TQuery
  > {
    return new OutletContentBuilderImpl(name, config);
  }

  replacement<TSegments extends SegmentsMap>(
    buildSegments: (
      b: SegmentDefinitionBuilder<TParentCtx>,
    ) => TSegments & EnforceKeyPathMatch<TSegments>,
  ): OutletNode<
    TParentCtx,
    Record<string, never>,
    Record<string, never>,
    TSegments
  > {
    const segmentBuilder = new SegmentDefinitionBuilderImpl<TParentCtx>();
    const segments = buildSegments(segmentBuilder);
    return {
      __kind: 'outlet',
      __childCtx: {} as TParentCtx,
      __config: {},
      __segments: segments,
    };
  }
}

class OutletContentBuilderImpl<
  TChildCtx extends AccCtx<any, any, any, any>,
  TCaps extends CapabilityDefinitionMap,
  TQuery extends QuerySchema,
> implements OutletContentBuilder<TChildCtx, TCaps, TQuery>
{
  constructor(
    // biome-ignore lint/suspicious/noExplicitAny: runtime storage
    _name: string,
    // biome-ignore lint/suspicious/noExplicitAny: runtime storage
    private config: any,
  ) {}

  segments<TSegments extends SegmentsMap>(
    build: (
      b: SegmentDefinitionBuilder<TChildCtx>,
    ) => TSegments & EnforceKeyPathMatch<TSegments>,
  ): OutletNode<TChildCtx, TCaps, TQuery, TSegments> {
    const segmentBuilder = new SegmentDefinitionBuilderImpl<TChildCtx>();
    const segments = build(segmentBuilder);
    return {
      __kind: 'outlet',
      __childCtx: {} as TChildCtx,
      __config: this.config ?? {},
      __segments: segments,
    };
  }
}

class SegmentDefinitionBuilderImpl<TCtx extends AccCtx<any, any, any, any>>
  implements SegmentDefinitionBuilder<TCtx>
{
  leaf<TPath extends string>(
    path: TPath,
  ): RouteConfigBuilder<
    'leaf',
    TCtx['rootCtx'],
    TPath,
    AddParam<TPath, TCtx['params']>,
    TCtx['query'],
    TCtx['capabilities'],
    Record<string, never>,
    Record<string, never>
  > {
    return new RouteConfigBuilderImpl<
      'leaf',
      TCtx['rootCtx'],
      TPath,
      AddParam<TPath, TCtx['params']>,
      TCtx['query'],
      TCtx['capabilities'],
      Record<string, never>,
      Record<string, never>
    >('leaf', path, {} as Record<string, never>, {} as Record<string, never>);
  }

  segment<TPath extends string>(
    path: TPath,
  ): RouteConfigBuilder<
    'segment',
    TCtx['rootCtx'],
    TPath,
    AddParam<TPath, TCtx['params']>,
    TCtx['query'],
    TCtx['capabilities'],
    Record<string, never>,
    Record<string, never>
  > {
    return new RouteConfigBuilderImpl<
      'segment',
      TCtx['rootCtx'],
      TPath,
      AddParam<TPath, TCtx['params']>,
      TCtx['query'],
      TCtx['capabilities'],
      Record<string, never>,
      Record<string, never>
    >(
      'segment',
      path,
      {} as Record<string, never>,
      {} as Record<string, never>,
    );
  }
}

// ---------------------------------------------------------------------------
// Root Builder
// ---------------------------------------------------------------------------

export function createAppRouteTree<TCodecMap extends ContextCodecMap>(
  contextCodecs: TCodecMap,
) {
  // contextCodecs is required so TRootCtx is explicit and enforced
  return new AppRouteBuilderImpl<ContextCodecMapDataTypes<TCodecMap>>(
    contextCodecs,
  );
}

class AppRouteBuilderImpl<
  TRootCtx,
  TApi extends ApiRouteMap = Record<string, never>,
  TStreams extends EventStreamMap = Record<string, never>,
> {
  // biome-ignore lint/suspicious/noExplicitAny: runtime impl
  constructor(
    private readonly _contextCodecs: any,
    private readonly _apiRoutes: TApi = {} as TApi,
    private readonly _eventStreams: TStreams = {} as TStreams,
  ) {
    void this._contextCodecs;
  }

  api<TMixed extends MixedRouteMap>(
    routes: TRootCtx extends ApiContextFromMap<ExtractApiFromMixed<TMixed>>
      ? TMixed
      : never,
  ): AppRouteBuilderImpl<
    TRootCtx,
    ExtractApiFromMixed<TMixed>,
    ExtractStreamsFromMixed<TMixed>
  > {
    const { api, streams } = partitionMixedRoutes(routes as MixedRouteMap);
    return new AppRouteBuilderImpl<
      TRootCtx,
      ExtractApiFromMixed<TMixed>,
      ExtractStreamsFromMixed<TMixed>
    >(
      this._contextCodecs,
      api as ExtractApiFromMixed<TMixed>,
      streams as ExtractStreamsFromMixed<TMixed>,
    );
  }

  // biome-ignore lint/suspicious/noExplicitAny: runtime impl
  page(config: any) {
    const fullConfig = {
      ...config,
      apiRoutes: this._apiRoutes,
      eventStreams: this._eventStreams,
    };
    return new AppRouteOutletsBuilderImpl<
      TRootCtx,
      PageConfig<
        TRootCtx,
        Record<string, never>,
        Record<string, never>,
        Record<string, never>,
        TApi,
        TStreams,
        // biome-ignore lint/suspicious/noExplicitAny: runtime impl
        any
      >
    >(fullConfig, this._contextCodecs);
  }
}

class AppRouteOutletsBuilderImpl<TRootCtx, TPage> {
  constructor(
    private pageConfig: TPage,
    // biome-ignore lint/suspicious/noExplicitAny: runtime impl
    private _contextCodecs: any,
  ) {}

  outlets<TOutlets extends OutletsMap>(
    build: (
      b: OutletContainerBuilder<
        AccCtx<TRootCtx, {}, Record<string, never>, Record<string, never>>
      >,
    ) => TOutlets,
  ): AppRouteNode<TRootCtx, TOutlets, TPage> {
    const outletBuilder = new OutletContainerBuilderImpl<
      AccCtx<TRootCtx, {}, Record<string, never>, Record<string, never>>
    >();
    const outlets = build(outletBuilder);
    const $paths = buildPathsAccessor(outlets) as PathsFromOutlets<TOutlets>;
    const $pages = buildPagesAccessor(outlets) as PagesFromOutlets<TOutlets>;
    return {
      __kind: 'appRoute',
      __ctx: {} as any,
      __page: this.pageConfig,
      __outlets: outlets,
      $paths,
      $pages,
      __contextCodecs: (this._contextCodecs ?? {}) as Record<
        string,
        AnyContextCodec
      >,
      __contextCodecNames: Object.keys(this._contextCodecs ?? {}),
    };
  }
}

// ---------------------------------------------------------------------------
// $pages helper types - preserves outlet structure for component typing
// ---------------------------------------------------------------------------

/**
 * PageRef - carries full context and page config for RoutePageProps extraction
 */
type PageRef<TCtx extends AccCtx<any, any, any, any>, TPage> = {
  readonly __kind: 'pageRef';
  readonly __nodeCtx: TCtx;
  readonly __page: TPage;
};

/**
 * Pages from outlets - preserves the outlet hierarchy
 * Each named outlet becomes a key, [PARENT] segments are merged at same level
 */
type PagesFromOutlets<T extends OutletsMap> = {
  [K in keyof T as K extends string ? K : never]: T[K] extends OutletNode<
    any,
    any,
    any,
    infer Segs
  >
    ? PagesFromSegments<Segs>
    : never;
} & (T[PARENT] extends OutletNode<any, any, any, infer Segs>
  ? PagesFromSegments<Segs>
  : {});

/**
 * Pages from segments - each segment key maps to PageRef
 * Segments with child outlets include both page ref and child pages
 */
type PagesFromSegments<T extends SegmentsMap> = {
  [K in keyof T]: T[K] extends LeafNode<infer _P, infer Ctx, infer Page>
    ? PageRef<Ctx, Page>
    : T[K] extends SegmentNode<infer _P, infer Ctx, infer Outlets, infer Page>
      ? PageRef<Ctx, Page> & PagesFromOutlets<Outlets>
      : never;
};

// ---------------------------------------------------------------------------
// $paths helper types
// ---------------------------------------------------------------------------

type PathsFromOutlets<T extends OutletsMap> = UnionToIntersection<
  | (T[keyof T] extends OutletNode<any, any, any, infer Segs>
      ? PathsFromSegments<Segs>
      : never)
  | (T[PARENT] extends OutletNode<any, any, any, infer Segs>
      ? PathsFromSegments<Segs>
      : never)
>;

type PathsFromSegments<T extends SegmentsMap> = {
  [K in keyof T]: T[K] extends LeafNode<infer _P, infer Ctx, infer Page>
    ? PathLeaf<Ctx, Page>
    : T[K] extends SegmentNode<infer _P, infer Ctx, infer Outlets, infer Page>
      ? PathSegment<Ctx, Outlets, Page>
      : never;
};

type PathLeaf<TCtx extends AccCtx<any, any, any, any>, TPage> = {
  readonly __nodeCtx: TCtx;
  readonly pattern: string;
  getPath(
    params: TCtx['params'],
    query?: Partial<TCtx['query']> & Record<string, Record<string, unknown>>,
  ): string;
  makeLink(
    params: TCtx['params'],
    query?: Partial<TCtx['query']> & Record<string, Record<string, unknown>>,
  ): string;
  __page: TPage;
};

type PathSegment<
  TCtx extends AccCtx<any, any, any, any>,
  TOutlets extends OutletsMap,
  TPage,
> = {
  readonly __nodeCtx: TCtx;
  readonly pattern: string;
  getPath(
    params: TCtx['params'],
    query?: Partial<TCtx['query']> & Record<string, Record<string, unknown>>,
  ): string;
  makeLink(
    params: TCtx['params'],
    query?: Partial<TCtx['query']> & Record<string, Record<string, unknown>>,
  ): string;
  __page: TPage;
} & PathsFromOutlets<TOutlets>;

type OutletNames<T extends OutletsMap> = Extract<keyof T, string>;

// ---------------------------------------------------------------------------
// RoutePageProps helper
// ---------------------------------------------------------------------------

/**
 * Extract API routes from a page config or path node
 */
type ExtractApiRoutes<T> = T extends { __page: infer Page }
  ? Page extends { apiRoutes: infer Api extends ApiRouteMap }
    ? Api
    : Record<string, AnyApiRoute>
  : T extends { apiRoutes: infer Api extends ApiRouteMap }
    ? Api
    : Record<string, AnyApiRoute>;

/**
 * runQuery helper type - constrained to queries using available routes
 */
export type RunQueryFn<TCtx, TAvailableRoutes extends ApiRouteMap> = <
  TArgs,
  TResult,
  TRoutes extends Record<string, AnyApiRoute>,
>(
  query: Query<TArgs, TResult, TCtx, TRoutes> &
    (keyof TRoutes extends keyof TAvailableRoutes ? unknown : never),
  args: TArgs,
  options?: RunQueryOptions,
) => QueryResultTuple<TResult>;

/**
 * mutation helper type - constrained to mutations using available routes
 */
export type MutationFn<TCtx, TAvailableRoutes extends ApiRouteMap> = <
  TArgs,
  TResult,
  TRoutes extends Record<string, AnyApiRoute>,
>(
  mutationPlan: Mutation<TArgs, TResult, TCtx, TRoutes> &
    (keyof TRoutes extends keyof TAvailableRoutes ? unknown : never),
  options?: MutationBindOptions,
) => BoundMutation<TArgs, TResult>;

/**
 * RoutePageProps - derives component props from route definition.
 *
 * Accepts:
 * - AppRouteNode from createAppRouteTree (for root layouts)
 * - PageRef from $pages (recommended - preserves full type info)
 * - PathLeaf from $paths (fallback - may lose loader type info)
 * - PathSegment from $paths (fallback - may lose loader type info)
 */
export type RoutePageProps<T> =
  // AppRouteNode from createAppRouteTree - for root layouts
  T extends AppRouteNode<infer TRootCtx, infer Outlets, infer Page>
    ? RoutePagePropsBase<EmptyCtx<TRootCtx>, Page, Outlets>
    : // PageRef from $pages - preferred, full type info
      T extends PageRef<infer Ctx, infer Page>
      ? RoutePagePropsBase<Ctx, Page, ExtractOutletsFromPage<T>>
      : // PathLeaf from $paths - fallback
        T extends PathLeaf<infer Ctx, infer Page>
        ? RoutePagePropsBase<Ctx, Page, Record<string, never>>
        : // PathSegment from $paths - fallback
          T extends PathSegment<infer Ctx, infer Outlets, infer Page>
          ? RoutePagePropsBase<Ctx, Page, Outlets>
          : never;

// Helper to extract outlets from a PageRef that might have child pages
type ExtractOutletsFromPage<T> = T extends PageRef<any, any> & infer Children
  ? Children extends { [K: string]: unknown }
    ? OutletsMapFromChildren<Children>
    : Record<string, never>
  : Record<string, never>;

// Convert $pages children to outlet names
type OutletsMapFromChildren<T> = {
  [K in keyof T as K extends '__kind' | '__nodeCtx' | '__page'
    ? never
    : K]: OutletNode<any, any, any, any>;
};

// Shared props structure
type RoutePagePropsBase<
  Ctx extends AccCtx<any, any, any, any>,
  Page,
  Outlets,
> = {
  /** Path parameters */
  params: Ctx['params'];
  /** Query parameters */
  query: Ctx['query'];
  /** Capabilities provided by parent outlets */
  capabilities: ExtractCapabilityArgs<Ctx['capabilities']>;
  /** Data from loader (wrapped in SerializableResult) */
  loaderData: LoaderResultFromPage<Page>;
  /** Get an outlet component by name */
  getOutlet: Outlets extends OutletsMap
    ? OutletNames<Outlets> extends never
      ? (name: string) => React.FC<{ capabilities?: unknown }>
      : <K extends OutletNames<Outlets>>(
          name: K,
        ) => React.FC<{ capabilities?: unknown }>
    : (name: string) => React.FC<{ capabilities?: unknown }>;
  /** Root context (session, etc.) with query runtime attached via symbol */
  ctx: WithQueryRuntime<Ctx['rootCtx'], ApiImplementationsMap>;
  /** Root context results (decode/enforcement outcomes) */
  ctxResult: ContextResultMap<Ctx['rootCtx']>;
  /** API route definitions */
  apiRoutes: ExtractApiRoutes<Page>;
  /** API route implementations (handlers) */
  apiImplementations: ApiRouteImplementations<ExtractApiRoutes<Page>>;
  /** EventStream implementations available to this page */
  eventStreams: EventStreamImplementations<ExtractEventStreams<Page>>;
  /** Navigation function */
  navigate: NavigateFn;
  /** Outlet names that have no matched content for current URL */
  emptyOutlets: string[];
  /**
   * Run a query - type-safe, only allows queries using available routes.
   *
   * **Must be called at component render time (top-level, not in callbacks).**
   * Uses `useSyncExternalStore` internally for live optimistic updates.
   */
  runQuery: RunQueryFn<Ctx['rootCtx'], ExtractApiRoutes<Page>>;
  /**
   * Bind a mutation - type-safe, only allows mutations using available routes
   */
  mutation: MutationFn<Ctx['rootCtx'], ExtractApiRoutes<Page>>;
};

type ExtractCapabilityArgs<T extends CapabilityDefinitionMap> = {
  [K in keyof T]: T[K] extends CapabilityDefinition<infer Args, infer Ret>
    ? (args: Args) => Ret
    : never;
};

// Loader result type - wraps data in SerializableResult
type LoaderResultFromPage<TPage> = 'loader' extends keyof TPage
  ? NonNullable<TPage['loader']> extends {
      schema: LoaderSchema<infer D, infer E>;
    }
    ? SerializableResult<D, E> | undefined
    : unknown
  : undefined;

// ---------------------------------------------------------------------------
// Runtime $paths builder
// ---------------------------------------------------------------------------

function buildPathsAccessor(
  outlets: OutletsMap,
  basePath = '',
): Record<string, unknown> {
  const paths: Record<string, unknown> = {};

  // Process regular outlets
  for (const [outletName, outletNode] of Object.entries(outlets)) {
    if (typeof outletName === 'symbol') continue;
    if (outletNode.__kind !== 'outlet') continue;
    Object.assign(paths, buildSegmentPaths(outletNode.__segments, basePath));
  }

  // Process [PARENT] outlet replacement segments
  if (outlets[PARENT] && outlets[PARENT].__kind === 'outlet') {
    Object.assign(
      paths,
      buildSegmentPaths(outlets[PARENT].__segments, basePath),
    );
  }

  return paths;
}

function buildSegmentPaths(
  segments: SegmentsMap,
  basePath: string,
): Record<string, unknown> {
  const paths: Record<string, unknown> = {};

  for (const [key, node] of Object.entries(segments)) {
    const typedNode = node as
      | LeafNode<string, any, any>
      | SegmentNode<string, any, any, any>;
    const segmentPath = `${basePath}/${typedNode.path}`;

    const accessor = {
      pattern: segmentPath,
      getPath: (
        params: Record<string, string>,
        query?: Record<string, Record<string, unknown>>,
      ) => {
        let path = segmentPath;
        for (const [paramName, value] of Object.entries(params)) {
          path = path.replace(`:${paramName}`, value);
        }
        if (query && Object.keys(query).length > 0) {
          const searchParams = new URLSearchParams();
          for (const [namespace, values] of Object.entries(query)) {
            for (const [qKey, value] of Object.entries(values)) {
              searchParams.set(`${namespace}.${qKey}`, JSON.stringify(value));
            }
          }
          path += `?${searchParams.toString()}`;
        }
        return path;
      },
      makeLink: (
        params: Record<string, string>,
        query?: Record<string, Record<string, unknown>>,
      ) => {
        let path = segmentPath;
        for (const [paramName, value] of Object.entries(params)) {
          path = path.replace(`:${paramName}`, value);
        }
        if (query && Object.keys(query).length > 0) {
          const searchParams = new URLSearchParams();
          for (const [namespace, values] of Object.entries(query)) {
            for (const [qKey, value] of Object.entries(values)) {
              searchParams.set(`${namespace}.${qKey}`, JSON.stringify(value));
            }
          }
          path += `?${searchParams.toString()}`;
        }
        return path;
      },
    };

    if (typedNode.__kind === 'segment') {
      paths[key] = {
        ...accessor,
        ...buildPathsAccessor(typedNode.__outlets, segmentPath),
      };
    } else {
      paths[key] = accessor;
    }
  }

  return paths;
}

// ---------------------------------------------------------------------------
// Runtime $pages builder - preserves outlet structure
// ---------------------------------------------------------------------------

function buildPagesAccessor(outlets: OutletsMap): Record<string, unknown> {
  const pages: Record<string, unknown> = {};

  // Process named outlets (string keys)
  for (const [outletName, outletNode] of Object.entries(outlets)) {
    if (typeof outletName === 'symbol') continue;
    if (outletNode.__kind !== 'outlet') continue;
    pages[outletName] = buildSegmentPages(outletNode.__segments);
  }

  // Process [PARENT] outlet - merge segments at same level
  if (outlets[PARENT] && outlets[PARENT].__kind === 'outlet') {
    Object.assign(pages, buildSegmentPages(outlets[PARENT].__segments));
  }

  return pages;
}

function buildSegmentPages(segments: SegmentsMap): Record<string, unknown> {
  const pages: Record<string, unknown> = {};

  for (const [key, node] of Object.entries(segments)) {
    const typedNode = node as
      | LeafNode<string, any, any>
      | SegmentNode<string, any, any, any>;

    // Create PageRef with context and page config
    const pageRef = {
      __kind: 'pageRef' as const,
      __nodeCtx: typedNode.__ctx,
      __page: typedNode.__page,
    };

    if (typedNode.__kind === 'segment') {
      // Segment: merge PageRef with child outlet pages
      pages[key] = {
        ...pageRef,
        ...buildPagesAccessor(typedNode.__outlets),
      };
    } else {
      // Leaf: just the PageRef
      pages[key] = pageRef;
    }
  }

  return pages;
}

// ---------------------------------------------------------------------------
// Query param helpers
// ---------------------------------------------------------------------------

export function parseNamespacedQuery(
  searchParams: URLSearchParams,
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};

  for (const [key, value] of searchParams.entries()) {
    const dotIndex = key.indexOf('.');
    if (dotIndex === -1) continue;

    const namespace = key.slice(0, dotIndex);
    const paramName = key.slice(dotIndex + 1);

    if (!result[namespace]) {
      result[namespace] = {};
    }

    try {
      result[namespace][paramName] = JSON.parse(value);
    } catch {
      result[namespace][paramName] = value;
    }
  }

  return result;
}

export function serializeNamespacedQuery(
  query: Record<string, Record<string, unknown>>,
): URLSearchParams {
  const params = new URLSearchParams();

  for (const [namespace, values] of Object.entries(query)) {
    for (const [key, value] of Object.entries(values)) {
      params.set(`${namespace}.${key}`, JSON.stringify(value));
    }
  }

  return params;
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { createCapabilityDefinition } from './capability';
export { getImportPath, strategy } from './strategy';

/**
 * Navigate function type for V2 router.
 *
 * Options:
 * - `replace`: Use replaceState instead of pushState
 * - `params`: Explicit param overrides (set value) or clears (null)
 * - `clearParams`: Drop all params (don't persist any)
 */
export type NavigateFn = (
  to: string,
  options?: {
    replace?: boolean;
    params?: Record<string, string | null>;
    clearParams?: boolean;
  },
) => void;

export type {
  AccCtx,
  EmptyCtx,
  PageConfig,
  LeafNode,
  SegmentNode,
  OutletNode,
  AppRouteNode,
  PathLeaf,
  PathSegment,
  PageRef,
  PagesFromOutlets,
  PagesFromSegments,
  EventStreamImplementations,
  LoaderSchema,
  QuerySchema,
  CapabilityDefinition,
  CapabilityDefinitionMap,
  ApiRouteMap,
  ApiRouteImplementations,
};
