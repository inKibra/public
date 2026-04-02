import { defineCodeBinding } from '../../codemode';
import type { FunctionContext } from '../../codemode/types';

type FlowCtx = { userId: string };
type RoutineDeps = { db: unknown; logger: { log: (msg: string) => void } };
type OutputAcc = { result: string | null };

/**
 * Function using FunctionContext generic
 */
export const withFunctionContext = defineCodeBinding(
  async function withFunctionContext(
    { value }: { value: string },
    context: FunctionContext<FlowCtx, RoutineDeps, OutputAcc>,
  ): Promise<string> {
    context.deps.logger.log(value);
    return 'done';
  },
);

/**
 * Function using inline object type
 */
export const withInlineType = defineCodeBinding(async function withInlineType(
  { id }: { id: number },
  { deps }: { deps: RoutineDeps },
): Promise<void> {
  deps.logger.log(`Processing id: ${id}`);
});

/**
 * Function with nested generics in deps
 */
export const withNestedGenerics = defineCodeBinding(
  async function withNestedGenerics(
    params: { key: string },
    { deps }: { deps: Record<string, Map<string, unknown>> },
  ): Promise<void> {
    void deps[params.key];
  },
);

/**
 * Function with union type deps
 */
export const withUnionDeps = defineCodeBinding(async function withUnionDeps(
  params: unknown,
  { deps }: { deps: RoutineDeps | undefined },
): Promise<void> {
  if (deps && params) {
    deps.logger.log('Processing');
  }
});
