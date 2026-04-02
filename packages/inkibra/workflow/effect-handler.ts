/**
 * Workflow Effect Handler
 *
 * Creates an effect handler for the 'workflow.start' intent kind.
 * When plugged into a TransactionRuntime's effectHandlers, it dispatches
 * workflow start intents to the WorkflowRuntime after transaction commit.
 *
 * See command-computer-spec §24.5a #4.
 *
 * @example
 * ```typescript
 * import { createDriverTransactionRuntime } from '@inkibra/dal-connection';
 * import { createWorkflowEffectHandler } from '@inkibra/workflow/effect-handler';
 *
 * const txRuntime = createDriverTransactionRuntime({
 *   driver,
 *   logger,
 *   effectHandlers: {
 *     'workflow.start': createWorkflowEffectHandler({ runtime: workflowRuntime, logger }),
 *   },
 * });
 * ```
 */

import type { Logger } from '@inkibra/logger';
import { getWorkflow } from './registry';
import type { WorkflowRuntime } from './runtime';
import type { FunctionWorkflowDefinition, JsonValue } from './types';

/**
 * Payload shape for the 'workflow.start' effect intent.
 */
export type WorkflowStartPayload = {
  /** Registered workflow name */
  workflow: string;
  /** Workflow version (defaults to '1.0.0') */
  version?: string;
  /** Input data for the workflow */
  input: JsonValue;
  /** Optional instance ID (for idempotency) */
  instanceId?: string;
};

export type WorkflowEffectHandlerConfig = {
  runtime: WorkflowRuntime;
  logger: Logger;
};

/**
 * Create an effect handler that starts workflows from staged intents.
 *
 * The handler:
 * 1. Validates the intent payload shape
 * 2. Looks up the workflow definition in the registry
 * 3. Starts a new workflow instance via WorkflowRuntime
 *
 * Errors are logged but not thrown (effects are fire-and-forget).
 */
export function createWorkflowEffectHandler(
  config: WorkflowEffectHandlerConfig,
): (intent: {
  kind: string;
  payload: unknown;
  preview?: string;
}) => Promise<void> {
  const { runtime, logger: baseLogger } = config;
  const logger = baseLogger.child({ component: 'workflow-effect' });

  return async (intent) => {
    const payload = intent.payload as WorkflowStartPayload;

    if (!payload?.workflow) {
      logger.warn('workflow.start intent missing workflow name', {
        payload: intent.payload,
      });
      return;
    }

    const version = payload.version ?? '1.0.0';
    const workflowDef = getWorkflow(payload.workflow, version);

    if (!workflowDef) {
      logger.warn('workflow.start intent references unknown workflow', {
        workflow: payload.workflow,
        version,
      });
      return;
    }

    try {
      const input = payload.input ?? {};
      const opts = payload.instanceId
        ? { instanceId: payload.instanceId }
        : undefined;

      // Discriminate workflow kind to satisfy overloaded startWorkflow
      const instance =
        workflowDef.kind === 'function'
          ? await runtime.startWorkflow(
              workflowDef as FunctionWorkflowDefinition<
                JsonValue,
                // biome-ignore lint/suspicious/noExplicitAny: required for overload resolution
                any,
                JsonValue
              >,
              input,
              opts,
            )
          : await runtime.startWorkflow(workflowDef, input, opts);

      logger.info('Workflow started via effect', {
        workflow: payload.workflow,
        version,
        instanceId: instance.id,
      });
    } catch (error) {
      logger.error('Failed to start workflow via effect', {
        workflow: payload.workflow,
        version,
        err: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
