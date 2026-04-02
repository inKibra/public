import { defineError, type ErrorDescriptorType } from '@inkibra/error-base';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

/**
 * Error for unhandled validation failures in FSM operations.
 */
export const UnhandledValidationFailure = defineError<
  'UNHANDLED_VALIDATION_FAILURE',
  { receivedType: string; context: string }
>('UNHANDLED_VALIDATION_FAILURE').message<'Unhandled validation failure'>();

export const UnknownInstructionMethod = defineError<
  'UNKNOWN_INSTRUCTION_METHOD',
  { method: string; index: number }
>('UNKNOWN_INSTRUCTION_METHOD').message<'Unknown instruction method'>();

export type UNHANDLED_VALIDATION_FAILURE = ErrorDescriptorType<
  typeof UnhandledValidationFailure
>;

export type UNKNOWN_INSTRUCTION_METHOD = ErrorDescriptorType<
  typeof UnknownInstructionMethod
>;

// -------------------------------------------------------------------------------------
// Readonly helpers for view-only handlers
// -------------------------------------------------------------------------------------

type DeepReadonly<T> = T extends (...a: any[]) => any
  ? T
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

function deepFreeze<T>(obj: T, seen: WeakSet<object> = new WeakSet()): T {
  if (obj && typeof obj === 'object') {
    // Cycle detection: skip if already visited
    if (seen.has(obj as object)) return obj;
    seen.add(obj as object);

    Object.freeze(obj as object);
    for (const key of Object.keys(obj as object)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const v = (obj as any)[key];
      if (v && typeof v === 'object' && !Object.isFrozen(v)) {
        deepFreeze(v, seen);
      }
    }
  }
  return obj;
}

// -------------------------------------------------------------------------------------
// Factory API (alternative to class-based approach)
// -------------------------------------------------------------------------------------

/**
 * Instruction map type - defines all valid instruction types for a domain.
 * Each instruction has params, optional context, and error type.
 */
type InstructionMap = {
  [method: string]: {
    params: unknown;
    context?: unknown;
    error?: unknown;
  };
};

/**
 * Instruction handler function signature.
 */
export type InstructionHandler<
  TData,
  TParams,
  TContext = unknown,
  TError = unknown,
> = (
  data: Readonly<TData>,
  params: TParams,
  context?: TContext,
) => Result<Readonly<TData>, TError>;

/**
 * Derive instruction union type from instruction map.
 */
export type InstructionFromMap<TInstructionMap extends InstructionMap> = {
  [K in keyof TInstructionMap]: {
    method: K;
    params: TInstructionMap[K]['params'];
  } & (TInstructionMap[K]['context'] extends undefined
    ? {}
    : { ctx?: TInstructionMap[K]['context'] });
}[keyof TInstructionMap];

// -------------------------------------------------------------------------------------
// Explicit Handlers Factory (no heavy inference; handlers provide types)
// -------------------------------------------------------------------------------------

type ParamsOf<H> = H extends (data: any, params: infer P, ctx?: any) => any
  ? P
  : never;

type ContextOf<H> = H extends (data: any, params: any, ctx?: infer C) => any
  ? C
  : undefined;

type ErrorOf<H> = H extends (...a: any[]) => Result<any, infer E> ? E : never;

type InstructionFromHandlers<
  THandlers extends Record<string, InstructionHandler<any, any, any, any>>,
> = {
  [K in keyof THandlers]: {
    method: K;
    params: ParamsOf<THandlers[K]>;
  } & (ContextOf<THandlers[K]> extends undefined
    ? {}
    : { ctx?: ContextOf<THandlers[K]> });
}[keyof THandlers];

/**
 * Core util that exposes makeInstructionHandler and wraps provided handlers at journal time.
 * Enables module-level handler definition (tree-shakeable) while preserving validation and recording.
 */
export function createUtil<
  TData = unknown,
  CreateData = unknown,
  CreateFailures = never,
  DataValidationFailures = unknown,
  Options = unknown,
>(config: {
  options: Options;
  is: (data: unknown) => data is TData;
  validate: (
    prev: Readonly<TData>,
    next: Readonly<TData>,
  ) => Result<true, DataValidationFailures | UNHANDLED_VALIDATION_FAILURE>;
  fromCreateData?: (
    data: CreateData,
  ) => Result<Readonly<TData>, CreateFailures>;
}) {
  const is = config.is;

  const validate = (
    prev: Readonly<TData>,
    next: Readonly<TData>,
  ): Result<true, DataValidationFailures | UNHANDLED_VALIDATION_FAILURE> => {
    if (!is(next)) {
      return err(
        UnhandledValidationFailure.create('Unhandled validation failure', {
          receivedType: typeof next,
          context: 'validate',
        }),
      );
    }
    return config.validate(prev, next);
  };

  const create = (
    data: CreateData,
  ): Result<
    Readonly<TData>,
    CreateFailures | DataValidationFailures | UNHANDLED_VALIDATION_FAILURE
  > => {
    if (!config.fromCreateData) {
      return err(
        UnhandledValidationFailure.create('Unhandled validation failure', {
          receivedType: 'undefined',
          context: 'create: fromCreateData not configured',
        }),
      );
    }
    const created = config.fromCreateData(data);
    if (created.isErr()) return created;
    const v = validate(created.value, created.value);
    if (v.isErr()) return err(v.error);
    return ok(created.value);
  };

  function wrapHandler<TParams, TContext = unknown, TError = unknown>(
    method: string,
    handler: InstructionHandler<TData, TParams, TContext, TError>,
    record?: (instruction: {
      method: string;
      params: unknown;
      ctx?: unknown;
    }) => void,
    validateFn: (
      prev: Readonly<TData>,
      next: Readonly<TData>,
    ) => Result<
      true,
      DataValidationFailures | UNHANDLED_VALIDATION_FAILURE
    > = validate,
  ): InstructionHandler<
    TData,
    TParams,
    TContext,
    TError | DataValidationFailures | UNHANDLED_VALIDATION_FAILURE
  > {
    return (data: Readonly<TData>, params: TParams, ctx?: TContext) => {
      const res = handler(data, params, ctx);
      if (res.isErr()) return res;
      const next = res.value;
      // Validate BEFORE recording - only record successful operations
      const v = validateFn(data, next);
      if (v.isErr()) return err(v.error);
      // Record after validation succeeds
      if (record) {
        record({ method, params, ...(ctx !== undefined ? { ctx } : {}) });
      }
      return ok(next);
    };
  }

  const makeInstructionHandler = <
    TParams,
    TContext = unknown,
    TError = unknown,
  >(
    method: string,
    handler: InstructionHandler<TData, TParams, TContext, TError>,
  ) => {
    return wrapHandler<TParams, TContext, TError>(
      method,
      handler,
      undefined,
      validate,
    );
  };

  type AssertNotData<TResult, TData2> = [TResult] extends [TData2]
    ? ['Error: view must not return TData']
    : TResult;

  type ViewHandler<TParams, TContext, TResult, TError = never> = (
    data: DeepReadonly<TData>,
    params: TParams,
    ctx?: TContext,
  ) => Result<AssertNotData<TResult, TData>, TError>;

  const makeView = <
    TParams,
    TContext = unknown,
    TResult = unknown,
    TError = never,
  >(
    name: string,
    view: ViewHandler<TParams, TContext, TResult, TError>,
    opts?: { devFreeze?: boolean },
  ) => {
    return (
      data: Readonly<TData>,
      params: TParams,
      ctx?: TContext,
    ): Result<
      AssertNotData<TResult, TData>,
      TError | UNHANDLED_VALIDATION_FAILURE
    > => {
      if (!is(data)) {
        return err(
          UnhandledValidationFailure.create('Unhandled validation failure', {
            receivedType: typeof data,
            context: `view:${name}`,
          }),
        );
      }
      const shouldFreeze = opts?.devFreeze ?? false;
      const roData = shouldFreeze
        ? (deepFreeze(structuredClone(data)) as DeepReadonly<TData>)
        : (data as DeepReadonly<TData>);
      return view(roData, params, ctx);
    };
  };

  const createJournal = <
    TJournalHandlers extends Record<
      string,
      InstructionHandler<TData, any, any, any>
    >,
  >(
    handlers: TJournalHandlers,
  ) => {
    const journalInstructions: InstructionFromHandlers<TJournalHandlers>[] = [];
    let journalIsRecording = true;

    const recordInstruction = (
      instruction: InstructionFromHandlers<TJournalHandlers>,
    ) => {
      if (journalIsRecording) {
        journalInstructions.push(structuredClone(instruction));
      }
    };

    const journalValidate = (
      prev: Readonly<TData>,
      next: Readonly<TData>,
    ): Result<true, DataValidationFailures | UNHANDLED_VALIDATION_FAILURE> => {
      if (!is(next)) {
        return err(
          UnhandledValidationFailure.create('Unhandled validation failure', {
            receivedType: typeof next,
            context: 'journal:validate',
          }),
        );
      }
      return config.validate(prev, next);
    };

    const wrappedHandlers = {} as {
      [K in keyof TJournalHandlers]: TJournalHandlers[K];
    };
    for (const method of Object.keys(handlers) as (keyof TJournalHandlers)[]) {
      const handler = handlers[method];
      if (!handler) continue;
      const wrapped = wrapHandler(
        method as string,
        handler,
        (instr) =>
          recordInstruction(instr as InstructionFromHandlers<TJournalHandlers>),
        journalValidate,
      );
      wrappedHandlers[method] = wrapped as TJournalHandlers[typeof method];
    }

    return {
      options: config.options,
      is,
      validate: journalValidate,
      ...(config.fromCreateData ? { create } : {}),
      getInstructions: () => structuredClone(journalInstructions),
      pauseRecording: () => {
        journalIsRecording = false;
      },
      resumeRecording: () => {
        journalIsRecording = true;
      },
      isRecording: () => journalIsRecording,
      clearInstructions: () => {
        journalInstructions.length = 0;
      },
      ...wrappedHandlers,
    };
  };

  const applyModifications = <
    TInstructionHandlers extends Record<
      string,
      InstructionHandler<TData, any, any, any>
    >,
  >(
    startingData: TData,
    instructions: InstructionFromHandlers<TInstructionHandlers>[],
    handlers: TInstructionHandlers,
  ): Result<
    TData,
    | ErrorOf<TInstructionHandlers[keyof TInstructionHandlers]>
    | DataValidationFailures
    | UNHANDLED_VALIDATION_FAILURE
    | UNKNOWN_INSTRUCTION_METHOD
  > => {
    const initialValidation = validate(startingData, startingData);
    if (initialValidation.isErr()) {
      return err(initialValidation.error);
    }
    let current: TData = startingData;
    for (const [index, instruction] of instructions.entries()) {
      const methodKey = instruction.method as keyof TInstructionHandlers;
      const handler = handlers[methodKey];
      if (!handler) {
        return err(
          UnknownInstructionMethod.create('Unknown instruction method', {
            method: String(instruction.method),
            index,
          }),
        );
      }
      // Extract instruction parts with proper typing
      const instructionWithCtx = instruction as {
        method: keyof TInstructionHandlers;
        params: ParamsOf<TInstructionHandlers[typeof methodKey]>;
        ctx?: ContextOf<TInstructionHandlers[typeof methodKey]>;
      };
      const res = handler(
        current,
        instructionWithCtx.params,
        instructionWithCtx.ctx,
      );
      if (res.isErr()) {
        return err(
          res.error as ErrorOf<
            TInstructionHandlers[keyof TInstructionHandlers]
          >,
        );
      }
      // Validate the new state after each instruction
      const validationResult = validate(current, res.value);
      if (validationResult.isErr()) {
        return err(validationResult.error);
      }
      current = res.value;
    }
    return ok(current);
  };

  return {
    options: config.options,
    is,
    validate,
    ...(config.fromCreateData ? { create } : {}),
    makeInstructionHandler,
    makeView,
    createJournal,
    applyModifications,
  };
}
