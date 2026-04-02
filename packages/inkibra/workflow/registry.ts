/**
 * Workflow registry for storing and retrieving workflow definitions
 */

import type {
  AnyWorkflowDefinition,
  FunctionWorkflowDefinition,
  FunctionWorkflowEvents,
  JsonValue,
  StageWorkflowDefinition,
} from './types';

const workflowRegistry = new Map<string, unknown>();

/**
 * Register a workflow definition
 */
export function registerWorkflow<TSnapshot extends JsonValue>(
  workflow: StageWorkflowDefinition<TSnapshot>,
): void;

export function registerWorkflow<
  TInput extends JsonValue,
  TEvents extends FunctionWorkflowEvents<TInput>,
  TResult extends JsonValue,
>(workflow: FunctionWorkflowDefinition<TInput, TEvents, TResult>): void;

export function registerWorkflow(workflow: AnyWorkflowDefinition): void {
  const key = `${workflow.name}:${workflow.version}`;
  workflowRegistry.set(key, workflow);
}

/**
 * Get a workflow definition by name and version
 */
export function getWorkflow(
  name: string,
  version: string,
): AnyWorkflowDefinition | undefined {
  const key = `${name}:${version}`;
  const workflow = workflowRegistry.get(key);
  if (!workflow || !isWorkflowDefinition(workflow)) {
    return undefined;
  }

  return workflow;
}

/**
 * Clear all registered workflows (useful for testing)
 */
export function clearRegistry(): void {
  workflowRegistry.clear();
}

function isWorkflowDefinition(value: unknown): value is AnyWorkflowDefinition {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  if (!('kind' in value) || !('name' in value) || !('version' in value)) {
    return false;
  }

  if (value.kind !== 'stage' && value.kind !== 'function') {
    return false;
  }

  if (typeof value.name !== 'string' || typeof value.version !== 'string') {
    return false;
  }

  return true;
}
