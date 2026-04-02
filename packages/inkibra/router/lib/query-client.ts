import type { FilterExpression } from '@inkibra/query-cache';
import { createQueryCache, type QueryCache } from '@inkibra/query-cache';
import type { AnyApiRoute, RouteHandlerArgs, RouteResponse } from './api-route';
import {
  type ApiRouteHandler,
  unwrapApiHandlerResult,
} from './api-route-handler';
import type { Selection } from './create-query';
import {
  Err,
  isSerializableResultErr,
  isSerializableResultOk,
  Ok,
  type Result,
} from './result';
import type { TransportLevelError } from './transport';

// ============================================================================
// Types
// ============================================================================

export type QueryPhase =
  | 'idle'
  | 'loading'
  | 'optimistic'
  | 'success'
  | 'revalidating'
  | 'revalidationError'
  | 'error';

export type QueryKey = string;

export type QueryState<TData = unknown, TError = unknown> = {
  data: TData | undefined;
  last: TData | undefined;
  error: TError | undefined;
  phase: QueryPhase;
  updatedAt: number;
};

export type QueryObserver<TData = unknown, TError = unknown> = {
  onStateChange: (state: QueryState<TData, TError>) => void;
};

export type QueryOptions = {
  staleTime?: number;
  optimisticScopes?: Array<string> | 'global' | false;
};

type QueryEntry<TData = unknown, TError = unknown> = {
  state: QueryState<TData, TError>;
  observers: Set<QueryObserver<TData, TError>>;
  promise: Promise<Result<TData, TError>> | null;
  selection?: Selection;
};

type Overlay<T = unknown> = {
  data: T;
  scope: string | 'global';
  appliedAt: number;
  last: T | undefined;
  selection: Selection;
  selectionHash: string;
};

// ============================================================================
// Helpers
// ============================================================================

function hashSelection(selection?: Selection): string {
  if (!selection) return '';
  const hasFilter = 'filter' in selection && selection.filter;
  const sortedFilter = hasFilter
    ? Object.fromEntries(
        Object.entries(
          selection.filter as Record<string, FilterExpression>,
        ).sort(([a], [b]) => a.localeCompare(b)),
      )
    : undefined;

  // Create a safe copy for stringify without undefined filter if it wasn't present
  const safeSelection = { ...selection };
  if (hasFilter) {
    (safeSelection as { filter: unknown }).filter = sortedFilter;
  }

  return JSON.stringify(safeSelection);
}

function buildQueryKey(
  name: string,
  selection?: Selection,
  args?: unknown,
  scopes?: QueryOptions['optimisticScopes'],
): QueryKey {
  return JSON.stringify({
    name,
    selection: selection ? hashSelection(selection) : undefined,
    args,
    scopes,
  });
}

function isCacheableEntity(
  value: unknown,
): value is { id: string; type: string } {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as { id?: unknown }).id &&
      (value as { type?: unknown }).type,
  );
}

export { buildQueryKey, hashSelection };

function overlayKey(selection: Selection, scope: string | 'global'): string {
  return `${selection.type}::${scope}`;
}

function matchesFilter(
  filter: Record<string, FilterExpression> | undefined,
  data: Record<string, unknown>,
): boolean {
  if (!filter) return true;
  for (const [field, expr] of Object.entries(filter)) {
    const value = data[field];
    if (expr && typeof expr === 'object' && 'op' in expr) {
      if (expr.op === 'eq' && value !== expr.value) return false;
      if (expr.op !== 'eq') return false;
    } else if (value !== expr) {
      return false;
    }
  }
  return true;
}

function matchesSelection(selection: Selection, overlay: Overlay): boolean {
  if (overlay.selection.type !== selection.type) return false;

  if ('id' in selection && selection.id !== undefined) {
    const targetId = selection.id;
    const overlayId =
      (overlay.data as { id?: unknown })?.id ??
      ('id' in overlay.selection ? overlay.selection.id : undefined);
    if (overlayId !== targetId) return false;
  }

  const selFilter =
    'filter' in selection && selection.filter
      ? (selection.filter as Record<string, FilterExpression>)
      : undefined;

  if (selFilter) {
    if (Array.isArray(overlay.data)) {
      return overlay.data.some(
        (item) =>
          item &&
          typeof item === 'object' &&
          matchesFilter(selFilter, item as Record<string, unknown>),
      );
    }
    if (
      overlay.data &&
      typeof overlay.data === 'object' &&
      matchesFilter(selFilter, overlay.data as Record<string, unknown>)
    ) {
      return true;
    }
    return false;
  }

  return true;
}

function pushToCache(cache: QueryCache, value: unknown) {
  if (isCacheableEntity(value)) {
    cache.set(value.type, value.id, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isCacheableEntity(item)) {
        cache.set(item.type, item.id, item);
      }
    }
  }
}

// ============================================================================
// QueryClient
// ============================================================================

/** Observer for selection+scope changes (overlay and cache updates) */
export type SelectionObserver<TData = unknown> = {
  onDataChange: (data: TData | undefined) => void;
};

export class QueryClient {
  #cache: QueryCache;
  #queries = new Map<QueryKey, QueryEntry>();
  // Keyed by `${selection.type}::${scope}` so overlays can be shared across compatible selections
  #overlays = new Map<string, Overlay[]>();
  // Subscription keyed by `${type}::${scopesHash}` for selection+scope reactive updates
  #selectionObservers = new Map<string, Set<SelectionObserver>>();
  // Snapshot cache for useSyncExternalStore stability (keyed by subscription key)
  #snapshotCache = new Map<string, { data: unknown; hash: string }>();

  constructor(cache?: QueryCache) {
    this.#cache = cache ?? createQueryCache();
  }

  /**
   * Subscribe to data changes for a selection+scopes combination.
   * This is used by runQuery to get live updates when overlays or cache change.
   *
   * Must be called at component render time (hook-safe).
   */
  subscribeToSelection<TData>(
    selection: Selection,
    scopes: QueryOptions['optimisticScopes'],
    observer: SelectionObserver<TData>,
  ): () => void {
    const subKey = this.#selectionSubscriptionKey(selection, scopes);
    let observers = this.#selectionObservers.get(subKey);
    if (!observers) {
      observers = new Set();
      this.#selectionObservers.set(subKey, observers);
    }
    observers.add(observer as SelectionObserver);
    return () => {
      observers?.delete(observer as SelectionObserver);
      if (observers?.size === 0) {
        this.#selectionObservers.delete(subKey);
      }
    };
  }

  /**
   * Get current snapshot of data for a selection+scopes (for useSyncExternalStore).
   * Returns stable references when data hasn't changed to prevent infinite render loops.
   */
  getSelectionSnapshot<TData>(
    selection: Selection,
    scopes: QueryOptions['optimisticScopes'],
  ): TData | undefined {
    const subKey = this.#selectionSubscriptionKey(selection, scopes);
    const newData = this.#resolveData<TData>(selection, scopes);
    const newHash = JSON.stringify(newData);

    const cached = this.#snapshotCache.get(subKey);
    if (cached && cached.hash === newHash) {
      // Data hasn't changed, return stable reference
      return cached.data as TData | undefined;
    }

    // Data changed, cache and return new reference
    this.#snapshotCache.set(subKey, { data: newData, hash: newHash });
    return newData;
  }

  #selectionSubscriptionKey(
    selection: Selection,
    scopes: QueryOptions['optimisticScopes'],
  ): string {
    const scopesPart =
      scopes === 'global'
        ? 'global'
        : scopes === false
          ? 'none'
          : Array.isArray(scopes)
            ? scopes.sort().join(',')
            : 'all';
    return `${selection.type}::${scopesPart}::${hashSelection(selection)}`;
  }

  #notifySelectionObservers(selection: Selection) {
    // Notify all subscriptions that involve this selection's type
    for (const [key, observers] of this.#selectionObservers.entries()) {
      if (!key.startsWith(`${selection.type}::`)) continue;

      // Invalidate snapshot cache for this subscription key so next getSnapshot recomputes
      this.#snapshotCache.delete(key);

      // Notify observers - they will call getSnapshot to get fresh data
      for (const observer of observers) {
        observer.onDataChange(undefined); // Signal change, component will re-snapshot
      }
    }
  }

  getQueryState<TData, TError>(
    key: QueryKey,
  ): QueryState<TData, TError> | undefined {
    return this.#queries.get(key)?.state as
      | QueryState<TData, TError>
      | undefined;
  }

  subscribe<TData, TError>(
    key: QueryKey,
    observer: QueryObserver<TData, TError>,
  ): () => void {
    let entry = this.#queries.get(key);
    if (!entry) {
      entry = {
        state: {
          data: undefined,
          last: undefined,
          error: undefined,
          phase: 'idle',
          updatedAt: 0,
        },
        observers: new Set(),
        promise: null,
      };
      this.#queries.set(key, entry);
    }
    // Cast needed because Map stores unknown/unknown
    (entry.observers as unknown as Set<QueryObserver<TData, TError>>).add(
      observer,
    );
    return () =>
      (entry?.observers as unknown as Set<QueryObserver<TData, TError>>).delete(
        observer,
      );
  }

  applyOptimistic<TData>(
    key: QueryKey,
    selection: Selection | undefined,
    data: TData,
    scope: string | 'global',
  ) {
    if (!selection) return;
    const entry = this.#ensureEntry<TData, TransportLevelError>(key, selection);
    const last = entry.state.data;
    const selHash = hashSelection(selection);
    const oKey = overlayKey(selection, scope);
    const overlays = this.#overlays.get(oKey) ?? [];
    this.#overlays.set(oKey, [
      ...overlays,
      {
        data,
        scope,
        appliedAt: Date.now(),
        last,
        selection,
        selectionHash: selHash,
      },
    ]);
    entry.state = {
      ...entry.state,
      phase: 'optimistic',
      last,
      data: this.#resolveData(
        selection,
        scope === 'global' ? 'global' : [scope],
      ),
    };
    this.#notify(key);
    // Notify selection-based subscribers so runQuery re-renders
    this.#notifySelectionObservers(selection);
  }

  clearOptimistic(selection: Selection | undefined, scope?: string | 'global') {
    if (!selection) return;
    const selHash = hashSelection(selection);
    const scopesToClear =
      scope === undefined
        ? Array.from(this.#overlays.keys())
        : Array.from(this.#overlays.keys()).filter((k) =>
            k.endsWith(`::${scope}`),
          );

    for (const key of scopesToClear) {
      const remaining =
        this.#overlays.get(key)?.filter((o) => o.selectionHash !== selHash) ??
        [];
      if (remaining.length === 0) this.#overlays.delete(key);
      else this.#overlays.set(key, remaining);
    }
    // Notify selection-based subscribers so runQuery re-renders
    this.#notifySelectionObservers(selection);
  }

  invalidateBySelection(selection: Selection) {
    for (const [key, entry] of Array.from(this.#queries.entries())) {
      if (entry.selection && entry.selection.type === selection.type) {
        entry.state = { ...entry.state, updatedAt: 0 };
        this.#notify(key);
      }
    }

    // Also drop overlays that match the selection hash for this type
    const selHash = hashSelection(selection);
    for (const [key, list] of Array.from(this.#overlays.entries())) {
      if (!key.startsWith(`${selection.type}::`)) continue;
      const remaining = list.filter((o) => o.selectionHash !== selHash);
      if (remaining.length === 0) this.#overlays.delete(key);
      else this.#overlays.set(key, remaining);
    }
    // Notify selection-based subscribers so runQuery re-renders
    this.#notifySelectionObservers(selection);
  }

  async fetchQuery<R extends AnyApiRoute, TContext = unknown>(
    handler: ApiRouteHandler<R, TContext, unknown>,
    args: RouteHandlerArgs<R>,
    options?: QueryOptions & {
      selection?: Selection;
      queryName?: string;
      context?: TContext;
    },
  ): Promise<Result<RouteResponse<R>, TransportLevelError>> {
    const key = buildQueryKey(
      options?.queryName ?? handler.route.path,
      options?.selection,
      args,
      options?.optimisticScopes,
    );
    const entry = this.#ensureEntry<RouteResponse<R>, TransportLevelError>(
      key,
      options?.selection,
    );

    const isStale =
      Date.now() - entry.state.updatedAt > (options?.staleTime ?? 0);
    if (
      !isStale &&
      entry.state.data !== undefined &&
      entry.state.phase !== 'error'
    ) {
      return Ok(entry.state.data);
    }

    if (entry.promise) return entry.promise;

    const nextPhase =
      entry.state.data !== undefined ? 'revalidating' : 'loading';
    entry.state = { ...entry.state, phase: nextPhase };
    this.#notify(key);

    const promise = (async () => {
      try {
        const handlerResult = await handler.execute(
          args,
          (options?.context ?? {}) as TContext,
        );

        const routeResponse =
          unwrapApiHandlerResult<RouteResponse<R>>(handlerResult);

        if (isSerializableResultOk(routeResponse)) {
          pushToCache(this.#cache, routeResponse.value);
        } else if (!isSerializableResultErr(routeResponse)) {
          pushToCache(this.#cache, routeResponse);
        }

        entry.state = {
          ...entry.state,
          data: routeResponse,
          last: entry.state.last ?? entry.state.data,
          error: undefined,
          phase: 'success',
          updatedAt: Date.now(),
        };
        this.#notify(key);
        return Ok(routeResponse);
      } catch (err) {
        const error: TransportLevelError = {
          type: 'NetworkError',
          message: err instanceof Error ? err.message : 'Unknown error',
          cause: err,
        };
        entry.state = {
          ...entry.state,
          error,
          phase: entry.state.data ? 'revalidationError' : 'error',
          updatedAt: Date.now(),
        };
        this.#notify(key);
        return Err(error);
      } finally {
        entry.promise = null;
      }
    })();

    entry.promise = promise;
    return promise;
  }

  getData<T>(selection: Selection, scopes?: QueryOptions['optimisticScopes']) {
    return this.#resolveData<T>(selection, scopes);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  #ensureEntry<TData, TError>(
    key: QueryKey,
    selection?: Selection,
  ): QueryEntry<TData, TError> {
    let entry = this.#queries.get(key) as QueryEntry<TData, TError> | undefined;
    if (!entry) {
      entry = {
        state: {
          data: undefined,
          last: undefined,
          error: undefined,
          phase: 'idle',
          updatedAt: 0,
        },
        observers: new Set(),
        promise: null,
        selection,
      };
      // Cast to unknown needed for Map type compatibility
      this.#queries.set(key, entry as unknown as QueryEntry<unknown, unknown>);
    } else if (selection && !entry.selection) {
      entry.selection = selection;
    }
    return entry;
  }

  #notify(key: QueryKey) {
    const entry = this.#queries.get(key);
    if (!entry) return;
    for (const observer of entry.observers) {
      observer.onStateChange(entry.state);
    }
  }

  #resolveData<T>(
    selection: Selection | undefined,
    scopes: QueryOptions['optimisticScopes'],
  ): T | undefined {
    if (!selection) return undefined;

    const isList = !('id' in selection) || selection.id === undefined;
    const hasId = 'id' in selection && selection.id !== undefined;

    const baseEntry = hasId
      ? this.#cache.get(selection.type, selection.id as string)
      : undefined;

    const listEntries = isList
      ? this.#cache.query<Record<string, unknown>>(selection.type, {
          filter:
            'filter' in selection
              ? (selection.filter as Record<string, FilterExpression>)
              : undefined,
          sort: 'sort' in selection ? selection.sort : undefined,
          sortKey: 'sortKey' in selection ? selection.sortKey : undefined,
          after: 'after' in selection ? selection.after : undefined,
          before: 'before' in selection ? selection.before : undefined,
          limit: 'limit' in selection ? selection.limit : undefined,
        })
      : undefined;

    // Collect overlays for relevant scopes and filter them against the current selection
    const allowedScopes =
      scopes === 'global'
        ? ['global']
        : scopes === false
          ? []
          : Array.isArray(scopes)
            ? ['global', ...scopes]
            : undefined;

    const overlayCandidates: Overlay[] = [];
    for (const [key, entries] of this.#overlays.entries()) {
      const [type, scope] = key.split('::');
      if (type !== selection.type) continue;
      if (!scope) continue;
      if (allowedScopes && !allowedScopes.includes(scope)) continue;
      overlayCandidates.push(...entries);
    }
    const visibleOverlays = overlayCandidates.filter((o) =>
      matchesSelection(selection, o),
    );

    if (Array.isArray(listEntries)) {
      const entities = listEntries
        .map((entry) => (entry as { data?: unknown }).data)
        .filter(
          (value): value is Record<string, unknown> =>
            Boolean(value) && typeof value === 'object',
        );

      // Merge overlays into entities by id when present, otherwise append
      const merged = [...entities];
      const byId = new Map(
        entities
          .map((e) => [e.id as string | undefined, e] as const)
          .filter(([id]) => !!id),
      );

      const sortedOverlays = [...visibleOverlays].sort(
        (a, b) => a.appliedAt - b.appliedAt,
      );

      for (const overlay of sortedOverlays) {
        const ovData = overlay.data;
        if (!ovData || typeof ovData !== 'object') continue;
        const ovId = (ovData as { id?: unknown }).id as string | undefined;
        if (ovId && byId.has(ovId)) {
          const current = byId.get(ovId) as Record<string, unknown>;
          Object.assign(current, ovData);
        } else if (ovId) {
          merged.push(ovData as Record<string, unknown>);
          byId.set(ovId, ovData as Record<string, unknown>);
        } else {
          merged.push(ovData as Record<string, unknown>);
        }
      }

      const selFilter =
        'filter' in selection
          ? (selection.filter as Record<string, FilterExpression>)
          : undefined;
      const filtered = selFilter
        ? merged.filter((e) => matchesFilter(selFilter, e))
        : merged;

      // Optionally sort if selection provided sort keys
      if ('sort' in selection || 'sortKey' in selection) {
        const sortKey =
          'sortKey' in selection ? (selection.sortKey as string) : undefined;
        const sortDir =
          'sort' in selection && selection.sort === 'asc' ? 'asc' : 'desc';
        if (sortKey) {
          filtered.sort((a, b) => {
            const av = a[sortKey] as number | string | undefined;
            const bv = b[sortKey] as number | string | undefined;
            if (av === bv) return 0;
            if (av === undefined) return 1;
            if (bv === undefined) return -1;
            return sortDir === 'asc'
              ? (av as number) > (bv as number)
                ? 1
                : -1
              : (av as number) > (bv as number)
                ? -1
                : 1;
          });
        }
      }

      return filtered as T;
    }

    const baseData = baseEntry?.data as Record<string, unknown> | undefined;

    if (!baseData) {
      if (visibleOverlays.length > 0) {
        const latest = visibleOverlays
          .sort((a, b) => a.appliedAt - b.appliedAt)
          .at(-1);
        return latest?.data as T;
      }
      return undefined;
    }

    if (visibleOverlays.length === 0) return baseData as T;
    return visibleOverlays
      .sort((a, b) => a.appliedAt - b.appliedAt)
      .reduce(
        (acc, overlay) => {
          return Object.assign(acc, overlay.data);
        },
        { ...baseData },
      ) as T;
  }
}
