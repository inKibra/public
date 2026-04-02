/**
 * Code Function Factory
 *
 * Creates CodeFunction objects for manual use cases when the .tool.ts plugin
 * is not being used. The plugin automatically generates these from typed
 * functions, but this factory allows manual creation.
 */

import type {
  CodeFunction,
  CodeFunctionOptions,
  FunctionContext,
} from './types';

type AnyToolFunction = (...args: any[]) => any;

type InferCodeBindingParams<TFn extends AnyToolFunction> =
  Parameters<TFn> extends [infer TParams, ...any[]] ? TParams : {};

type InferCodeBindingDeps<TFn extends AnyToolFunction> =
  Parameters<TFn> extends [any, infer TContext, ...any[]]
    ? TContext extends FunctionContext<any, infer TDeps, any>
      ? TDeps
      : TContext extends { deps: infer TDeps }
        ? TDeps
        : unknown
    : unknown;

type InferCodeBindingResult<TFn extends AnyToolFunction> = Awaited<
  ReturnType<TFn>
>;

/**
 * Creates a code function manually.
 *
 * Use this when you need to create code functions without the .tool.ts plugin,
 * such as when the function needs runtime configuration or when using dynamic
 * function generation.
 *
 * @example
 * ```typescript
 * import typia from 'typia';
 * import { codeFunction } from '@inkibra/ai-flow/codemode';
 *
 * type FetchUserParams = { userId: string };
 * type User = { id: string; name: string; email: string };
 * type MyDeps = { db: Database; logger: Logger };
 *
 * const fetchUser = codeFunction<FetchUserParams, User, MyDeps>({
 *   description: 'Fetches a user by ID from the database',
 *   validate: typia.createValidate<FetchUserParams>(),
 *   fn: async ({ userId }, { deps }) => {
 *     deps.logger.debug('Fetching user', { userId });
 *     return await deps.db.getUser(userId);
 *   },
 * });
 * ```
 */
export function codeFunction<TParams, TResult, TDeps = unknown>(
  options: CodeFunctionOptions<TParams, TResult, TDeps>,
): CodeFunction<TParams, TResult, TDeps> {
  const { description, declaration, validate, fn } = options;

  return {
    description,
    // If no declaration provided, use a generic fallback
    declaration: declaration ?? '(params: unknown) => Promise<unknown>',
    validate,
    fn,
  };
}

/**
 * Marker factory for codemode plugin transformation.
 *
 * This function must only be used inside `.tool.ts` files with the
 * `codeBindingPlugin` enabled. The plugin rewrites
 * `defineCodeBinding(...)` calls into
 * runtime CodeFunction objects with generated typia validators.
 */
export function defineCodeBinding<TFn extends AnyToolFunction>(
  _fn: TFn,
): CodeFunction<
  InferCodeBindingParams<TFn>,
  InferCodeBindingResult<TFn>,
  InferCodeBindingDeps<TFn>
> {
  throw new Error(
    'defineCodeBinding() is a compile-time marker. Enable the codeBindingPlugin in your build-pack preload.',
  );
}

/**
 * Type guard to check if an object is a CodeFunction
 */
export function isCodeFunction(
  obj: unknown,
): obj is CodeFunction<unknown, unknown, unknown> {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'description' in obj &&
    'declaration' in obj &&
    'validate' in obj &&
    'fn' in obj &&
    typeof (obj as CodeFunction<unknown, unknown, unknown>).description ===
      'string' &&
    typeof (obj as CodeFunction<unknown, unknown, unknown>).declaration ===
      'string' &&
    typeof (obj as CodeFunction<unknown, unknown, unknown>).validate ===
      'function' &&
    typeof (obj as CodeFunction<unknown, unknown, unknown>).fn === 'function'
  );
}

/**
 * Generates TypeScript declaration string from a CodeFunction.
 *
 * This is used to create declarations shown to the LLM.
 * Only includes the params and return type (not the context).
 */
export function getFunctionDeclaration<TParams, TResult, TDeps>(
  name: string,
  fn: CodeFunction<TParams, TResult, TDeps>,
): string {
  return `/**
 * ${fn.description}
 */
declare const ${name}: ${fn.declaration};`;
}

/**
 * Generates TypeScript declarations for multiple CodeFunctions.
 */
export function getFunctionDeclarations(
  functions: Record<string, CodeFunction<any, any, any>>,
): string {
  return Object.entries(functions)
    .map(([name, fn]) => getFunctionDeclaration(name, fn))
    .join('\n\n');
}
