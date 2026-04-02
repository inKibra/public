/**
 * Capability System
 *
 * Provides typed dependency injection for route components.
 * - Parents declare capabilities on their path tree
 * - Children request capabilities they need
 * - Parents implement via hooks with deps arrays (linter-friendly)
 * - Children receive implementations via props
 *
 * Uses Typia validators for schema-based type inference.
 */

import { type DependencyList, useCallback } from 'react';
import type { IValidation } from 'typia/lib';

// ============================================================================
// Types
// ============================================================================

/**
 * Capability definition - the type/schema for a capability
 */
export type CapabilityDefinition<TParams = unknown, TReturn = unknown> = {
  readonly __brand: 'CapabilityDefinition';
  readonly __params: TParams;
  readonly __return: TReturn;
  readonly name: string;
};

/**
 * Capability implementation - the actual function
 */
export type CapabilityImplementation<TParams, TReturn> = (
  params: TParams,
) => TReturn | Promise<TReturn>;

/**
 * Extract params type from a capability definition
 */
export type CapabilityParams<T> = T extends CapabilityDefinition<
  infer P,
  // biome-ignore lint/suspicious/noExplicitAny: Generic extraction
  any
>
  ? P
  : never;

/**
 * Extract return type from a capability definition
 */
export type CapabilityReturn<T> = T extends CapabilityDefinition<
  // biome-ignore lint/suspicious/noExplicitAny: Generic extraction
  any,
  infer R
>
  ? R
  : never;

/**
 * Map of capability definitions
 */
export type CapabilityDefinitionMap = Record<
  string,
  CapabilityDefinition<unknown, unknown>
>;

/**
 * Map of capability implementations matching a definition map
 */
export type CapabilityImplementationMap<T extends CapabilityDefinitionMap> = {
  [K in keyof T]: CapabilityImplementation<
    CapabilityParams<T[K]>,
    CapabilityReturn<T[K]>
  >;
};

/**
 * Hook type returned by createCapabilityImplementation
 */
export type UseCapabilityImplementation<TParams, TReturn> = (
  impl: (params: TParams) => TReturn | Promise<TReturn>,
  deps: DependencyList,
) => CapabilityImplementation<TParams, TReturn>;

// ============================================================================
// Counter for unique names (when not provided)
// ============================================================================

let capabilityCounter = 0;

// ============================================================================
// createCapabilityDefinition
// ============================================================================

/**
 * Creates a capability definition (type/schema).
 *
 * @example
 * ```typescript
 * // Simple capability
 * const getCurrentUser = createCapabilityDefinition<{}, User>();
 *
 * // With params
 * const showConfirmDialog = createCapabilityDefinition<
 *   { message: string },
 *   boolean
 * >();
 *
 * // Named (for debugging)
 * const closeSidebar = createCapabilityDefinition<{}, void>('closeSidebar');
 * ```
 */
export function createCapabilityDefinition<
  TParams = Record<string, never>,
  TReturn = void,
>(name?: string): CapabilityDefinition<TParams, TReturn> {
  const capName = name ?? `capability_${++capabilityCounter}`;

  return {
    __brand: 'CapabilityDefinition',
    __params: undefined as unknown as TParams,
    __return: undefined as unknown as TReturn,
    name: capName,
  };
}

// ============================================================================
// createCapabilityImplementation
// ============================================================================

/**
 * Creates a hook for implementing a capability.
 *
 * The returned hook accepts an implementation function and a deps array,
 * making it linter-friendly (exhaustive-deps rule works).
 *
 * @example
 * ```typescript
 * // Create the hook from a definition
 * const useGetCurrentUserImpl = createCapabilityImplementation(getCurrentUser);
 *
 * // Use in component
 * function DashboardLayout() {
 *   const user = useAuth();
 *
 *   // Linter checks deps array!
 *   const getCurrentUserImpl = useGetCurrentUserImpl(() => user, [user]);
 *
 *   const Outlet = getOutlet('main', {
 *     capabilities: { getCurrentUser: getCurrentUserImpl },
 *   });
 * }
 * ```
 */
export function createCapabilityImplementation<TParams, TReturn>(
  _definition: CapabilityDefinition<TParams, TReturn>,
): UseCapabilityImplementation<TParams, TReturn> {
  return function useCapabilityImplementation(
    impl: (params: TParams) => TReturn | Promise<TReturn>,
    deps: DependencyList,
  ): CapabilityImplementation<TParams, TReturn> {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return useCallback(impl, deps);
  };
}

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Check if a value is a capability definition
 */
export function isCapabilityDefinition(
  value: unknown,
): value is CapabilityDefinition {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__brand' in value &&
    value.__brand === 'CapabilityDefinition'
  );
}

/**
 * Extract capability names from an array of definitions
 */
export type CapabilityNames<T extends readonly CapabilityDefinition[]> =
  T[number]['name'];

/**
 * Build implementation map type from array of requested capabilities
 */
export type RequestedCapabilitiesMap<
  TRequested extends readonly CapabilityDefinition[],
> = {
  [K in TRequested[number] as K['name']]: CapabilityImplementation<
    CapabilityParams<K>,
    CapabilityReturn<K>
  >;
};

// ============================================================================
// Schema-Based Capability System (New)
// ============================================================================

/**
 * Validator function type (matches Typia's createValidate output)
 */
export type Validator<T> = (input: unknown) => IValidation<T>;

/**
 * Capability schema with request and response validators
 */
export type CapabilitySchema<TRequest, TResponse> = {
  /** Validator for capability request/params */
  readonly request: Validator<TRequest>;
  /** Validator for capability response/return */
  readonly response: Validator<TResponse>;
};

/**
 * Define a capability schema with typed validators.
 *
 * @example
 * ```typescript
 * // In schemas.ts
 * export const validateToastRequest = typia.createValidate<{
 *   message: string;
 *   type: 'success' | 'error' | 'info';
 * }>();
 * export const validateToastResponse = typia.createValidate<void>();
 *
 * // In capabilities.ts
 * export const showToastSchema = defineCapabilitySchema({
 *   request: validateToastRequest,
 *   response: validateToastResponse,
 * });
 * ```
 */
export function defineCapabilitySchema<TRequest, TResponse>(
  schema: CapabilitySchema<TRequest, TResponse>,
): CapabilitySchema<TRequest, TResponse>;

/**
 * Marker overload for type macro expansion.
 *
 * Usage:
 *   defineCapabilitySchema<{ request: Req; response: Res }>()
 */
export function defineCapabilitySchema<
  TContract extends {
    request: unknown;
    response: unknown;
  },
>(): CapabilitySchema<TContract['request'], TContract['response']>;

export function defineCapabilitySchema<TRequest, TResponse>(
  schema?: CapabilitySchema<TRequest, TResponse>,
): CapabilitySchema<TRequest, TResponse> {
  if (!schema) {
    throw new Error(
      'defineCapabilitySchema<T>() is a compile-time marker. Enable build-pack type-macro + typia transforms.',
    );
  }

  return schema;
}

/**
 * Configuration for creating a capability
 */
export type CapabilityConfig<TRequest, TResponse> = {
  /** Unique name for the capability */
  name: string;
  /** Schema with request/response validators */
  schema: CapabilitySchema<TRequest, TResponse>;
};

/**
 * Create a capability definition from a schema.
 *
 * Types are inferred from the schema validators, so no explicit
 * generic type parameters are needed.
 *
 * @example
 * ```typescript
 * export const showToastCapability = createCapability({
 *   name: 'showToast',
 *   schema: defineCapabilitySchema({
 *     request: validateToastRequest,
 *     response: validateToastResponse,
 *   }),
 * });
 *
 * // Type is inferred:
 * // CapabilityDefinition<{ message: string; type: 'success'|'error'|'info' }, void>
 * ```
 */
export function createCapability<TRequest, TResponse>(
  config: CapabilityConfig<TRequest, TResponse>,
): CapabilityDefinition<TRequest, TResponse> {
  return {
    __brand: 'CapabilityDefinition',
    __params: undefined as unknown as TRequest,
    __return: undefined as unknown as TResponse,
    name: config.name,
  };
}
