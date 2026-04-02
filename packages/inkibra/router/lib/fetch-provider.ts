/**
 * Fetch Provider - Client Transport Implementation
 *
 * Implements ClientTransportProvider for making HTTP requests with:
 * - Context encoding/decoding
 * - Transport-level callbacks
 * - Storage scope management
 */

import type { Logger } from '@inkibra/logger';
import { Brand } from '@inkibra/observable-cache';
import type { IValidation } from 'typia/lib';
import { MimeType } from '../constants/mime-type';
import type {
  AnyApiRoute,
  ApiRoute,
  HandlerArguments,
  RouteNamedTypes,
} from './api-route';
import type { ApiRouteHandler as RouterApiRouteHandler } from './api-route-handler';
import type { ApiRouteImplementations, ApiRouteMap } from './app-route';
import type {
  AnyContextCodec,
  ContextCodec,
  ContextCodecMap,
  ContextCodecMapDataTypes,
  ContextCodecMapResultTypes,
} from './context-codec';
import {
  createEventStreamBus,
  createEventStreamBusManager,
  type EventStreamBus,
  type EventStreamBusManager,
} from './event-stream-bus';
import type {
  AnyEventStreamRoute,
  EventStreamHandlerArguments,
  EventStreamRoute,
  EventStreamRouteNamedTypes,
} from './event-stream-route';
import { Err, Ok, type Result, SerializableResult } from './result';
import type {
  StorageScope,
  TransportCallbacks,
  TransportLevelError,
} from './transport';
import { TransportError } from './transport';
import type { ApiRouteHandler } from './use-api-hook';
import type { EventStreamHandler } from './use-event-stream-hooks';

// Type aliases for sent/received context codecs
type SentContextCodec<T> = ContextCodec<
  string,
  StorageScope,
  T,
  unknown,
  unknown
>;
type ReceivedContextCodec<T> = ContextCodec<
  string,
  StorageScope,
  T,
  unknown,
  unknown
>;

// ============================================================================
// Storage Adapters
// ============================================================================

/**
 * Storage adapter interface for persisting context by scope
 *
 * @example
 * ```typescript
 * // Custom adapter using Tauri store
 * const tauriAdapter: StorageAdapter = {
 *   get: (key) => store.get(key) ?? null,
 *   set: (key, value) => store.set(key, value),
 *   remove: (key) => store.delete(key),
 *   entries: () => [...store.entries()],
 * };
 * ```
 */
export type StorageAdapter = {
  get: (key: string) => string | null;
  set: (key: string, value: string) => void;
  remove: (key: string) => void;
  /** Get all key-value pairs (required for sending context headers) */
  entries: () => Array<[string, string]>;
};

/**
 * Initial storage data - codecName -> value (will be JSON stringified when stored)
 */
export type InitialStorageData = Record<string, unknown>;

/**
 * Create an in-memory storage adapter (useful for SSR or testing)
 *
 * @param initialData - Optional initial data to populate the storage
 */
export function createMemoryStorageAdapter(
  initialData?: InitialStorageData,
): StorageAdapter {
  // JSON stringify initial data values
  const memoryStorage: Record<string, string> = {};
  if (initialData) {
    for (const [key, value] of Object.entries(initialData)) {
      memoryStorage[key] = JSON.stringify(value);
    }
  }
  return {
    get: (key) => memoryStorage[key] ?? null,
    set: (key, value) => {
      memoryStorage[key] = value;
    },
    remove: (key) => {
      delete memoryStorage[key];
    },
    entries: () => Object.entries(memoryStorage),
  };
}

/**
 * Create browser localStorage adapter
 *
 * Note: entries() returns ALL localStorage keys, which may include non-context items.
 * Consider using a prefixed adapter if you need isolation.
 *
 * @param initialData - Optional initial data to populate the storage on creation
 */
export function createLocalStorageAdapter(
  initialData?: InitialStorageData,
): StorageAdapter {
  // Track keys we've set (since localStorage doesn't scope by default)
  const trackedKeys = new Set<string>(
    initialData ? Object.keys(initialData) : [],
  );

  // Populate initial data if provided (JSON stringify values)
  if (initialData) {
    for (const [key, value] of Object.entries(initialData)) {
      window.localStorage.setItem(key, JSON.stringify(value));
    }
  }

  return {
    get: (key) => window.localStorage.getItem(key),
    set: (key, value) => {
      trackedKeys.add(key);
      window.localStorage.setItem(key, value);
    },
    remove: (key) => {
      trackedKeys.delete(key);
      window.localStorage.removeItem(key);
    },
    entries: () => {
      const result: Array<[string, string]> = [];
      for (const key of trackedKeys) {
        const value = window.localStorage.getItem(key);
        if (value !== null) {
          result.push([key, value]);
        }
      }
      return result;
    },
  };
}

/**
 * Create browser sessionStorage adapter
 *
 * Note: entries() returns ALL sessionStorage keys, which may include non-context items.
 * Consider using a prefixed adapter if you need isolation.
 *
 * @param initialData - Optional initial data to populate the storage on creation
 */
export function createSessionStorageAdapter(
  initialData?: InitialStorageData,
): StorageAdapter {
  // Track keys we've set (since sessionStorage doesn't scope by default)
  const trackedKeys = new Set<string>(
    initialData ? Object.keys(initialData) : [],
  );

  // Populate initial data if provided (JSON stringify values)
  if (initialData) {
    for (const [key, value] of Object.entries(initialData)) {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    }
  }

  return {
    get: (key) => window.sessionStorage.getItem(key),
    set: (key, value) => {
      trackedKeys.add(key);
      window.sessionStorage.setItem(key, value);
    },
    remove: (key) => {
      trackedKeys.delete(key);
      window.sessionStorage.removeItem(key);
    },
    entries: () => {
      const result: Array<[string, string]> = [];
      for (const key of trackedKeys) {
        const value = window.sessionStorage.getItem(key);
        if (value !== null) {
          result.push([key, value]);
        }
      }
      return result;
    },
  };
}

/**
 * Create default storage adapters based on environment
 */
function createDefaultStorageAdapters(): Record<StorageScope, StorageAdapter> {
  // Check if we're in a browser environment
  const isBrowser =
    typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

  if (isBrowser) {
    return {
      session: createSessionStorageAdapter(),
      device: createLocalStorageAdapter(),
    };
  }

  // In-memory fallback for non-browser environments
  return {
    session: createMemoryStorageAdapter(),
    device: createMemoryStorageAdapter(),
  };
}

// ============================================================================
// Fetch Provider Configuration
// ============================================================================

/**
 * Configuration for FetchProvider
 */
export type FetchProviderConfig = {
  /** Base URL (e.g., 'https://api.example.com') */
  baseUrl: string;
  /** Logger instance */
  logger: Logger;
  /** Include credentials in requests */
  includeCredentials?: boolean;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  /** Transport-level callbacks */
  callbacks?: TransportCallbacks<unknown, unknown>;
  /**
   * Custom storage adapters - partial overrides merged with defaults.
   * Useful for providing custom storage (e.g., Tauri store) for specific scopes
   * while keeping browser defaults for others.
   *
   * @example
   * ```typescript
   * // Override only authentication storage with Tauri store
   * storageAdapters: {
   *   authentication: tauriStoreAdapter,
   *   // session and device will use browser storage defaults
   * }
   * ```
   */
  storageAdapters?: Partial<Record<StorageScope, StorageAdapter>>;
};

// ============================================================================
// Fetch Provider Implementation
// ============================================================================

/**
 * FetchProvider - implements ClientTransportProvider
 *
 * @example
 * ```typescript
 * const fetchProvider = new FetchProvider({
 *   baseUrl: 'https://api.example.com',
 *   logger,
 *   callbacks: {
 *     onSend: (args) => console.log('Sending:', args),
 *     onSuccess: (result) => console.log('Success:', result),
 *     onError: (error) => console.error('Error:', error),
 *   },
 * });
 *
 * // Create a route handler
 * const getProfile = fetchProvider.createRouteHandler(GetProfile.Route);
 * const result = await getProfile({ pathParams: { id: '123' }, pathQuery: {}, body: undefined });
 * ```
 */
export class FetchProvider {
  readonly #baseUrl: string;
  readonly #logger: Logger;
  readonly #includeCredentials: boolean;
  readonly #timeoutMs: number;
  readonly #callbacks: TransportCallbacks<unknown, unknown>;
  readonly #storageAdapters: Record<StorageScope, StorageAdapter>;
  // In-memory overlay so reads immediately see the latest writes.
  readonly #contextCache: Record<StorageScope, Record<string, string>>;
  readonly #subscribers: Set<() => void> = new Set();
  readonly #clientId: string;
  readonly #eventStreamBusManager: EventStreamBusManager;
  #authorizationToken: string | undefined;

  constructor(config: FetchProviderConfig) {
    this.#baseUrl = config.baseUrl;
    this.#logger = config.logger.child({ component: 'FetchProvider' });
    this.#includeCredentials = config.includeCredentials ?? false;
    this.#timeoutMs = config.timeoutMs ?? 30000;
    this.#callbacks = config.callbacks ?? {};
    // Merge custom adapters with defaults - custom overrides win
    const defaults = createDefaultStorageAdapters();
    this.#storageAdapters = {
      ...defaults,
      ...config.storageAdapters,
    };
    this.#contextCache = {
      session: Object.fromEntries(this.#storageAdapters.session.entries()),
      device: Object.fromEntries(this.#storageAdapters.device.entries()),
    };
    this.#clientId = Brand.createId2('client');
    this.#eventStreamBusManager = createEventStreamBusManager();
    this.#authorizationToken = undefined;
  }

  /** Client ID for request tracking */
  get clientId(): string {
    return this.#clientId;
  }

  // ==========================================================================
  // Context Management
  // ==========================================================================

  /**
   * Get the current value of a sent context
   * Uses JSON parsing + schema validation
   */
  getSentContext<T>(codec: SentContextCodec<T>): T | undefined {
    const key = codec.name.toLowerCase();
    const stored = this.#getStoredValue(codec.scope, key);
    if (!stored) return undefined;

    // TODO: Handle JWT for codec.secure === 'signed'
    // For now, assume plain JSON

    try {
      const parsed = JSON.parse(stored);
      const validation = codec.schema.dataValidator(parsed);
      if (validation.success) {
        return validation.data as T;
      }
      this.#logger.warn('Invalid stored context', { name: codec.name });
      return undefined;
    } catch {
      this.#logger.warn('Failed to parse stored context', { name: codec.name });
      return undefined;
    }
  }

  /**
   * Set the value of a sent context
   * Uses JSON serialization
   */
  setSentContext<T>(codec: SentContextCodec<T>, value: T | undefined): void {
    const key = codec.name.toLowerCase();
    if (value === undefined) {
      this.#setStoredValue(codec.scope, key, undefined);
    } else {
      // TODO: Handle JWT for codec.secure === 'signed'
      // For now, assume plain JSON
      try {
        this.#setStoredValue(codec.scope, key, JSON.stringify(value));
      } catch {
        this.#logger.warn('Failed to encode context', { name: codec.name });
      }
    }
    this.#notifySubscribers();
  }

  /**
   * Get the current value of a received context
   * Uses JSON parsing + schema validation
   */
  getReceivedContext<T>(codec: ReceivedContextCodec<T>): T | undefined {
    const key = codec.name.toLowerCase();
    const stored = this.#getStoredValue(codec.scope, key);
    if (!stored) return undefined;

    // TODO: Handle JWT for codec.secure === 'signed'
    // For now, assume plain JSON

    try {
      const parsed = JSON.parse(stored);
      const validation = codec.schema.dataValidator(parsed);
      if (validation.success) {
        return validation.data as T;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Subscribe to context changes
   */
  subscribe(callback: () => void): () => void {
    this.#subscribers.add(callback);
    return () => {
      this.#subscribers.delete(callback);
    };
  }

  #notifySubscribers(): void {
    for (const callback of this.#subscribers) {
      callback();
    }
  }

  #getStoredValue(scope: StorageScope, key: string): string | null {
    const cached = this.#contextCache[scope][key];
    if (cached !== undefined) return cached;
    return this.#storageAdapters[scope].get(key);
  }

  #setStoredValue(
    scope: StorageScope,
    key: string,
    encoded: string | undefined,
  ): void {
    if (encoded === undefined) {
      delete this.#contextCache[scope][key];
      this.#storageAdapters[scope].remove(key);
      return;
    }
    this.#contextCache[scope][key] = encoded;
    this.#storageAdapters[scope].set(key, encoded);
  }

  /**
   * Persist context/auth headers from an HTTP response.
   */
  captureResponseHeaders(headers: Headers): void {
    let hasContextUpdate = false;
    headers.forEach((headerValue, headerName) => {
      const lowerHeader = headerName.toLowerCase();

      if (lowerHeader.startsWith('x-session-')) {
        const contextName = lowerHeader.slice('x-session-'.length);
        this.#setStoredValue('session', contextName, headerValue);
        hasContextUpdate = true;
      } else if (lowerHeader.startsWith('x-device-')) {
        const contextName = lowerHeader.slice('x-device-'.length);
        this.#setStoredValue('device', contextName, headerValue);
        hasContextUpdate = true;
      }
    });

    if (hasContextUpdate) {
      this.#notifySubscribers();
    }

    const nextAuthorizationToken =
      headers.get('X-Use-Authorization') ?? headers.get('Authorization');
    if (nextAuthorizationToken) {
      this.#authorizationToken = nextAuthorizationToken;
    }
  }

  /**
   * Read a context value by scope and codec name
   *
   * This is the stateless context reader that hydrate/Router uses.
   *
   * @param storageScope - Where the context is stored ('session' | 'device')
   * @param _appName - Unused (kept for API compatibility)
   * @param codecName - The context codec name (will be normalized to lowercase)
   * @returns The parsed context value, or undefined if not found
   *
   * @example
   * ```typescript
   * const session = fetchTransport.readContext('session', 'example', 'session');
   * ```
   */
  readContext(
    storageScope: StorageScope,
    _appName: string,
    codecName: string,
  ): unknown {
    const key = codecName.toLowerCase();
    const stored = this.#getStoredValue(storageScope, key);
    if (!stored) return undefined;

    try {
      return JSON.parse(stored);
    } catch {
      return undefined;
    }
  }

  /**
   * Write a context value by scope and codec name
   *
   * @param storageScope - Where the context should be stored
   * @param _appName - Unused (kept for API compatibility)
   * @param codecName - The context codec name (will be normalized to lowercase)
   * @param value - The value to store (will be JSON stringified)
   */
  writeContext(
    storageScope: StorageScope,
    _appName: string,
    codecName: string,
    value: unknown,
  ): void {
    const key = codecName.toLowerCase();
    const encoded = value === undefined ? undefined : JSON.stringify(value);
    this.#setStoredValue(storageScope, key, encoded);
    this.#notifySubscribers();
  }

  /**
   * Clear a specific context
   *
   * @example
   * ```typescript
   * // On logout, clear session context
   * fetchProvider.clearContext('session', 'session');
   * ```
   */
  clearContext(scope: StorageScope, contextName: string): void {
    this.#setStoredValue(scope, contextName.toLowerCase(), undefined);
    this.#notifySubscribers();
  }

  // ==========================================================================
  // HTTP Request
  // ==========================================================================

  /**
   * Make a request with context encoding/decoding
   */
  async request<TArgs, TResponse>(config: {
    method: string;
    path: string;
    args: TArgs;
    sentContext?: ReadonlyArray<SentContextCodec<unknown>>;
    receivedContext?: ReadonlyArray<ReceivedContextCodec<unknown>>;
    validateResponse: (input: unknown) => IValidation<TResponse>;
  }): Promise<Result<TResponse, TransportLevelError>> {
    const requestId = Brand.createId2('request');
    const fullUrl = `${this.#baseUrl}${config.path}`;

    // Call onSend callback
    this.#callbacks.onSend?.(config.args);

    this.#logger.debug('Sending request', {
      requestId,
      method: config.method,
      path: config.path,
    });

    try {
      // Build headers
      const headers = new Headers();
      headers.set('Content-Type', MimeType.APPLICATION_JSON);
      headers.set('X-Inkibra-Client-ID', this.#clientId);
      headers.set('X-Request-ID', requestId);

      // Attach authorization token for non-cookie flows (cross-origin clients).
      // The token is captured from X-Use-Authorization / Authorization response
      // headers and used for both API and SSE requests.
      if (this.#authorizationToken && !this.#includeCredentials) {
        headers.set('Authorization', this.#authorizationToken);
      }

      // Send all stored context values as headers
      // X-Session-{name} for session scope, X-Device-{name} for device scope
      for (const [name, value] of Object.entries(this.#contextCache.session)) {
        headers.set(`X-Session-${name.toLowerCase()}`, value);
      }
      for (const [name, value] of Object.entries(this.#contextCache.device)) {
        headers.set(`X-Device-${name.toLowerCase()}`, value);
      }

      // Build request
      const fetchOptions: RequestInit = {
        method: config.method.toUpperCase(),
        headers,
        credentials: this.#includeCredentials ? 'include' : 'same-origin',
      };

      // Add body for non-GET requests
      const argsWithBody = config.args as { body?: unknown };
      if (
        config.method.toLowerCase() !== 'get' &&
        argsWithBody.body !== undefined
      ) {
        fetchOptions.body = JSON.stringify(argsWithBody.body);
      }

      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.#timeoutMs);
      fetchOptions.signal = controller.signal;

      // Make request
      let response: Response;
      try {
        response = await fetch(fullUrl, fetchOptions);
      } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof Error && error.name === 'AbortError') {
          const timeoutError = TransportError.timeout(
            'Request timed out',
            this.#timeoutMs,
          );
          this.#callbacks.onError?.(timeoutError, config.args);
          return Err(timeoutError);
        }
        const networkError = TransportError.network(
          'Network request failed',
          error,
        );
        this.#callbacks.onError?.(networkError, config.args);
        return Err(networkError);
      }

      clearTimeout(timeoutId);

      // Handle server errors
      if (response.status >= 500) {
        const serverError = TransportError.server(
          `Server error: ${response.status}`,
          response.status,
        );
        this.#callbacks.onError?.(serverError, config.args);
        return Err(serverError);
      }

      this.captureResponseHeaders(response.headers);

      // Parse response
      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        const parseError = TransportError.parse(
          'Failed to parse response',
          error,
        );
        this.#callbacks.onError?.(parseError, config.args);
        return Err(parseError);
      }

      // Validate response
      const validation = config.validateResponse(body);
      if (!validation.success) {
        const validationError = TransportError.validation(
          'Response validation failed',
          validation.errors,
        );
        this.#callbacks.onError?.(validationError, config.args);
        return Err(validationError);
      }

      this.#logger.debug('Request successful', {
        requestId,
        method: config.method,
        path: config.path,
      });

      this.#callbacks.onSuccess?.(validation.data, config.args);
      return Ok(validation.data);
    } catch (error) {
      const networkError = TransportError.network('Unexpected error', error);
      this.#callbacks.onError?.(networkError, config.args);
      return Err(networkError);
    }
  }

  // ==========================================================================
  // Route Handler Factory
  // ==========================================================================

  /**
   * Create a handler function for an API route
   *
   * @example
   * ```typescript
   * const getProfile = fetchProvider.createRouteHandler(GetProfile.Route);
   * const result = await getProfile({
   *   pathParams: { id: '123' },
   *   pathQuery: {},
   *   body: undefined,
   * });
   *
   * if (result.type === 'Ok') {
   *   console.log(result.value);
   * }
   * ```
   */
  createRouteHandler<
    Path extends string,
    RouteTypes extends RouteNamedTypes<Path>,
  >(
    // biome-ignore lint/suspicious/noExplicitAny: Accept routes with any context codec configuration
    route: ApiRoute<Path, RouteTypes, any, any, any, any>,
  ): (
    args: HandlerArguments<Path, RouteTypes>,
  ) => Promise<Result<RouteTypes['ResponseType'], TransportLevelError>> {
    return async (args) => {
      const path = route.constructPath({
        pathParams: args.pathParams,
        pathQuery: args.pathQuery,
      });

      // Extract context codecs from route's codec map
      const sentContext: SentContextCodec<unknown>[] = [];
      const receivedContext: ReceivedContextCodec<unknown>[] = [];

      if (route.contextCodec) {
        for (const codec of Object.values(route.contextCodec)) {
          sentContext.push(codec as SentContextCodec<unknown>);
          receivedContext.push(codec as ReceivedContextCodec<unknown>);
        }
      }

      if (route.createsContextCodec) {
        for (const codec of Object.values(route.createsContextCodec)) {
          receivedContext.push(codec as ReceivedContextCodec<unknown>);
        }
      }

      return this.request({
        method: route.method,
        path,
        args,
        sentContext,
        receivedContext,
        validateResponse: (input) =>
          route.validateResponse(input) as IValidation<
            RouteTypes['ResponseType']
          >,
      });
    };
  }

  /**
   * Create a handler object for use with apiRoutes props
   *
   * Returns an ApiRouteHandler with name, method, and fn so hooks
   * can access everything they need from a single object.
   */
  createRouteHandlerObject<
    Path extends string,
    RouteTypes extends RouteNamedTypes<Path>,
  >(
    route: ApiRoute<Path, RouteTypes, any, any, any, any>,
  ): ApiRouteHandler<Path, RouteTypes> & {
    route: ApiRoute<Path, RouteTypes, any, any, any, any>;
    execute: (
      args: HandlerArguments<Path, RouteTypes>,
      _ctx: Record<string, unknown>,
    ) => Promise<RouteTypes['ResponseType']>;
  } {
    const fn = this.createRouteHandler(route);

    return {
      route,
      execute: async (args) => {
        const result = await fn(args);
        if (result.type === 'Ok') {
          return result.value;
        }
        throw result.error;
      },
      name: route.name,
      method: route.method,
      fn,
    };
  }

  // ==========================================================================
  // EventStream Bus Management
  // ==========================================================================

  /**
   * Generate a unique key for a route + args combination
   */
  #getEventStreamKey<
    Path extends string,
    RouteTypes extends EventStreamRouteNamedTypes<Path>,
  >(
    route: AnyEventStreamRoute,
    args: EventStreamHandlerArguments<Path, RouteTypes>,
  ): string {
    const path = route.constructPath({
      pathParams: args.pathParams,
      pathQuery: args.pathQuery,
    });
    return `${route.name}:${path}`;
  }

  /**
   * Get or create an EventStream bus for a specific route + args
   *
   * Multiple subscribers to the same route+args share a single connection.
   * First subscriber opens the connection, last unsubscriber closes it.
   *
   * @example
   * ```typescript
   * const bus = fetchProvider.getEventStreamBus(renderStatusStream, {
   *   pathParams: { renderJobId: '123' },
   *   pathQuery: {},
   * });
   *
   * const unsub = bus.subscribe('progress', (data) => {
   *   console.log('Progress:', data.percent);
   * });
   *
   * // Later
   * unsub();
   * ```
   */
  getEventStreamBus<
    Path extends string,
    RouteTypes extends EventStreamRouteNamedTypes<Path>,
  >(
    route: AnyEventStreamRoute,
    args: EventStreamHandlerArguments<Path, RouteTypes>,
    options?: {
      authorization?: string;
    },
  ): EventStreamBus<
    RouteTypes['EventTypes'],
    RouteTypes['CompletionData'],
    RouteTypes['CompletionError']
  > {
    const key = this.#getEventStreamKey(route, args);
    const useCookieAuthForStream =
      this.#includeCredentials && !/^https?:\/\//i.test(this.#baseUrl);

    return this.#eventStreamBusManager.getBus(key, () => {
      let eventSource: EventSource | null = null;

      const bus = createEventStreamBus<
        RouteTypes['EventTypes'],
        RouteTypes['CompletionData'],
        RouteTypes['CompletionError']
      >({
        onConnect: () => {
          console.debug('[FetchProvider] EventStream bus onConnect', {
            route: route.name,
            key,
          });
          const path = route.constructPath({
            ...args,
            authorization: useCookieAuthForStream
              ? undefined
              : (options?.authorization ?? this.#authorizationToken),
          });
          const url = `${this.#baseUrl}${path}`;

          this.#logger.debug('Opening EventStream connection', {
            route: route.name,
            url,
          });

          eventSource = new EventSource(url);

          eventSource.onopen = () => {
            this.#logger.debug('EventStream transport connected', {
              route: route.name,
            });
            // Don't set connected yet - wait for connection event from server
          };

          eventSource.onerror = () => {
            this.#logger.warn('EventStream connection error', {
              route: route.name,
            });
            bus._setStatus('error');
            eventSource?.close();
            eventSource = null;
          };

          // Handle connection event from server (confirms SSE is working)
          eventSource.addEventListener('connection', (event) => {
            try {
              const data = JSON.parse((event as MessageEvent).data);
              this.#logger.debug('EventStream connection confirmed', {
                route: route.name,
                data,
              });
              bus._setStatus('connected');
            } catch {
              // Still mark as connected even if parse fails
              bus._setStatus('connected');
            }
          });

          // Handle heartbeat events (just log, keeps connection alive)
          eventSource.addEventListener('heartbeat', (event) => {
            try {
              const data = JSON.parse((event as MessageEvent).data);
              this.#logger.trace('EventStream heartbeat', {
                route: route.name,
                timestamp: data?.timestamp,
              });
            } catch {
              // Ignore parse errors for heartbeat
            }
          });

          // Set up event listeners for all possible events
          // The bus will route to the appropriate subscribers
          eventSource.onmessage = (event) => {
            try {
              const parsed = JSON.parse(event.data);
              if (parsed.event && parsed.data !== undefined) {
                console.debug('[FetchProvider] EventStream message received', {
                  route: route.name,
                  event: parsed.event,
                });
                bus._publish(parsed.event, parsed.data);
              }
            } catch {
              // Ignore parse errors for generic messages
            }
          };

          // Handle completion events
          eventSource.addEventListener('__complete', (event) => {
            try {
              const result = JSON.parse((event as MessageEvent).data);
              bus._complete(result);
              eventSource?.close();
              eventSource = null;
              // Remove bus from manager when completed
              this.#eventStreamBusManager.removeBus(key);
            } catch {
              this.#logger.warn('Failed to parse completion event', {
                route: route.name,
              });
            }
          });

          eventSource.addEventListener('__error', (event) => {
            try {
              const result = JSON.parse((event as MessageEvent).data);
              bus._complete(result);
              eventSource?.close();
              eventSource = null;
              // Remove bus from manager when errored
              this.#eventStreamBusManager.removeBus(key);
            } catch {
              this.#logger.warn('Failed to parse error event', {
                route: route.name,
              });
            }
          });
        },

        onDisconnect: () => {
          console.debug('[FetchProvider] EventStream bus onDisconnect', {
            route: route.name,
            key,
          });
          this.#logger.debug('Closing EventStream connection', {
            route: route.name,
          });
          eventSource?.close();
          eventSource = null;
          // Remove bus from manager when disconnected
          this.#eventStreamBusManager.removeBus(key);
        },
      });

      return bus;
    });
  }

  /**
   * Get the number of active EventStream connections
   */
  get activeEventStreamCount(): number {
    return this.#eventStreamBusManager.busCount;
  }

  /**
   * Create an EventStream handler object for use with eventStreams props
   *
   * Returns an EventStreamHandler with name and getBus so hooks
   * can get a bus for a specific route + args.
   */
  createEventStreamHandlerObject<
    Path extends string,
    RouteTypes extends EventStreamRouteNamedTypes<Path>,
  >(route: AnyEventStreamRoute): EventStreamHandler<Path, RouteTypes> {
    return {
      name: route.name as RouteTypes['Name'],
      getBus: (args, ctx) => {
        const authorization =
          ctx && typeof ctx === 'object'
            ? ((
                ctx as {
                  authorization?: string;
                  session?: { token?: string | undefined };
                }
              ).authorization ??
              (
                ctx as {
                  authorization?: string;
                  session?: { token?: string | undefined };
                }
              ).session?.token)
            : undefined;

        return this.getEventStreamBus(route, args, {
          authorization,
        });
      },
    };
  }
}

// ============================================================================
// Helper to Implement Multiple Routes
// ============================================================================

/**
 * Implement multiple API routes with a FetchProvider
 *
 * @example
 * ```typescript
 * const apiRoutes = implementApiRoutes(fetchProvider, {
 *   getProfile: GetProfile.Route,
 *   updateProfile: UpdateProfile.Route,
 * });
 *
 * // Pass to component as props
 * <ProfilePage apiRoutes={apiRoutes} />
 * ```
 */
export function implementApiRoutes<T extends ApiRouteMap>(
  provider: FetchProvider,
  routes: T,
): ApiRouteImplementations<T> {
  const result: Record<string, unknown> = {};
  for (const [key, route] of Object.entries(routes)) {
    result[key] = provider.createRouteHandlerObject(route as AnyApiRoute);
  }
  // biome-ignore lint/suspicious/noExplicitAny: Required for flexible typing
  return result as any;
}

/**
 * Implement multiple EventStream routes with a FetchProvider
 *
 * @example
 * ```typescript
 * const eventStreams = implementEventStreamRoutes(fetchProvider, {
 *   renderStatusStream: RenderStatus.Route,
 * });
 *
 * // Pass to component as props
 * <ProfilePage eventStreams={eventStreams} />
 * ```
 */
export function implementEventStreamRoutes<
  T extends Record<string, AnyEventStreamRoute>,
>(
  provider: FetchProvider,
  routes: T,
): {
  [K in keyof T]: T[K] extends EventStreamRoute<
    infer Path,
    infer Types extends EventStreamRouteNamedTypes<string>,
    // biome-ignore lint/suspicious/noExplicitAny: Required for flexible typing
    any
  >
    ? EventStreamHandler<Path, Types>
    : never;
} {
  const result: Record<string, unknown> = {};
  for (const [key, route] of Object.entries(routes)) {
    result[key] = provider.createEventStreamHandlerObject(route);
  }
  // biome-ignore lint/suspicious/noExplicitAny: Required for flexible typing
  return result as any;
}

// ============================================================================
// Create Fetch Transport (Factory Function)
// ============================================================================

/**
 * Configuration for createFetchTransport
 */
export type FetchTransportConfig = {
  /** Base URL for API requests (e.g., 'https://api.example.com'). Defaults to '' for same-origin. */
  baseUrl?: string;
  /** Logger instance */
  logger: Logger;
  /** Include credentials (cookies) in requests */
  includeCredentials?: boolean;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  /** Storage adapters for session and device contexts */
  storageAdapters: {
    session: StorageAdapter;
    device: StorageAdapter;
  };
};

/**
 * FetchTransport - the interface returned by createFetchTransport
 */
export type FetchTransport = {
  /**
   * Read a context value from storage
   *
   * @param storageScope - Where the context is stored ('session' | 'device')
   * @param appName - The app name (used as key prefix)
   * @param codecName - The context codec name
   * @returns The parsed context value, or undefined if not found
   */
  readContext: (
    storageScope: StorageScope,
    appName: string,
    codecName: string,
  ) => unknown;

  /**
   * Write a context value to storage
   */
  writeContext: (
    storageScope: StorageScope,
    appName: string,
    codecName: string,
    value: unknown,
  ) => void;

  /**
   * Create an API route handler for a specific route.
   * Returns RouterApiRouteHandler object with { route, execute }.
   * Router will build ctx from readContext and call execute(args, ctx).
   */
  createApiHandler: <TRoute extends AnyApiRoute>(
    route: TRoute,
  ) => RouterApiRouteHandler<
    TRoute,
    TRoute extends { contextCodec: infer C }
      ? C extends ContextCodecMap
        ? ContextCodecMapDataTypes<C>
        : Record<string, never>
      : Record<string, never>,
    TRoute extends { contextCodec: infer C }
      ? C extends ContextCodecMap
        ? ContextCodecMapResultTypes<C>
        : Record<string, never>
      : Record<string, never>
  >;

  /**
   * Create an EventStream route handler for a specific route
   */
  createEventStreamHandler: <
    Path extends string,
    RouteTypes extends EventStreamRouteNamedTypes<Path>,
  >(
    route: AnyEventStreamRoute,
  ) => EventStreamHandler<Path, RouteTypes>;

  /**
   * Subscribe to context changes
   */
  subscribe: (callback: () => void) => () => void;

  /** The underlying FetchProvider instance (for advanced usage) */
  provider: FetchProvider;
};

/**
 * Create a fetch transport for making API requests
 *
 * This is the preferred way to create a client transport. It returns a
 * focused interface with just the methods needed for hydration.
 *
 * @example
 * ```typescript
 * const fetchTransport = createFetchTransport({
 *   baseUrl: appConfig.apiBase,
 *   logger: createLogger(),
 *   includeCredentials: true,
 *   storageAdapters: {
 *     session: createSessionStorageAdapter(appConfig.initialSessionStorage),
 *     device: createLocalStorageAdapter(appConfig.initialDeviceStorage),
 *   },
 * });
 *
 * hydrate(ExampleApp, {
 *   exampleApp,
 *   apiImplementations: {
 *     login: fetchTransport.createApiHandler(loginRoute),
 *     getBoard: fetchTransport.createApiHandler(getBoardRoute),
 *   },
 *   readContext: fetchTransport.readContext,
 * });
 * ```
 */
export function createFetchTransport(
  config: FetchTransportConfig,
): FetchTransport {
  const provider = new FetchProvider({
    baseUrl: config.baseUrl ?? '',
    logger: config.logger,
    includeCredentials: config.includeCredentials,
    timeoutMs: config.timeoutMs,
    storageAdapters: config.storageAdapters,
  });

  return {
    readContext: (storageScope, appName, codecName) =>
      provider.readContext(storageScope, appName, codecName),

    writeContext: (storageScope, appName, codecName, value) =>
      provider.writeContext(storageScope, appName, codecName, value),

    createApiHandler: (route) => ({
      route,
      // Execute function receives ctx from loader and sends it in request headers
      execute: async (args, ctx) => {
        const path = route.constructPath({
          pathParams: args.pathParams,
          pathQuery: args.pathQuery,
        });

        // Build headers
        const headers = new Headers();
        headers.set('Content-Type', MimeType.APPLICATION_JSON);
        headers.set('X-Inkibra-Client-ID', provider.clientId);
        headers.set('X-Request-ID', Brand.createId2('request'));

        // Serialize ctx into headers based on route's context codecs
        if (ctx && route.contextCodec) {
          for (const [key, codecUntyped] of Object.entries(
            route.contextCodec,
          )) {
            const codec = codecUntyped as AnyContextCodec;
            const value = (ctx as Record<string, unknown>)[key];
            if (value !== undefined) {
              const headerPrefix =
                codec.scope === 'session' ? 'X-Session-' : 'X-Device-';
              headers.set(
                `${headerPrefix}${codec.name.toLowerCase()}`,
                JSON.stringify(value),
              );
            }
          }
        }

        // Build fetch options
        const fetchOptions: RequestInit = {
          method: route.method.toUpperCase(),
          headers,
          credentials: config.includeCredentials ? 'include' : 'same-origin',
        };

        // Add body for non-GET requests
        if (route.method.toLowerCase() !== 'get' && args.body !== undefined) {
          fetchOptions.body = JSON.stringify(args.body);
        }

        // Make request - baseUrl defaults to '' for absolute path from origin
        const fullUrl = `${config.baseUrl ?? ''}${path}`;
        let response: Response;
        try {
          response = await fetch(fullUrl, fetchOptions);
        } catch (error) {
          // Transport error - convert to SerializableResult.Err
          return SerializableResult.toErr(
            {
              type: 'TransportError',
              message:
                error instanceof Error
                  ? error.message
                  : 'Network request failed',
            },
            500,
          );
        }

        // Parse response
        let data: unknown;
        try {
          const text = await response.text();
          data = text ? JSON.parse(text) : undefined;
        } catch {
          return SerializableResult.toErr(
            { type: 'ParseError', message: 'Failed to parse response' },
            500,
          );
        }

        provider.captureResponseHeaders(response.headers);

        // Validate and return the SerializableResult
        const validation = route.validateResponse(data);
        if (!validation.success) {
          return SerializableResult.toErr(
            { type: 'ValidationError', errors: validation.errors },
            500,
          );
        }

        return validation.data;
      },
    }),

    createEventStreamHandler: (route) =>
      provider.createEventStreamHandlerObject(route),

    subscribe: (callback) => provider.subscribe(callback),

    provider,
  };
}
