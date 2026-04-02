/**
 * Error codes for workflow system
 */

import type { ErrorDescriptor } from '@inkibra/error-base';

/**
 * Workflow error descriptor types
 */
export type WorkflowInstanceNotFoundError = ErrorDescriptor<
  'WORKFLOW_INSTANCE_NOT_FOUND',
  'Workflow instance not found',
  { instanceId: string }
>;

export type WorkflowStageNotFoundError = ErrorDescriptor<
  'WORKFLOW_STAGE_NOT_FOUND',
  'Stage not found in workflow definition',
  { stageName: string; workflowName: string }
>;

export type WorkflowLockFailedError = ErrorDescriptor<
  'WORKFLOW_LOCK_FAILED',
  'Failed to acquire workflow instance lock',
  { instanceId: string; executionId?: string }
>;

export type WorkflowInvalidTransitionError = ErrorDescriptor<
  'WORKFLOW_INVALID_TRANSITION',
  'Invalid workflow state transition',
  { fromStatus: string; toStatus: string; instanceId: string }
>;

export type WorkflowExecutionFailedError = ErrorDescriptor<
  'WORKFLOW_EXECUTION_FAILED',
  'Workflow stage execution failed',
  { instanceId: string; stageName: string; error: unknown }
>;

export type WorkflowStorageError = ErrorDescriptor<
  'WORKFLOW_STORAGE_ERROR',
  'Workflow storage operation failed',
  { operation: string; error: unknown }
>;

export type WorkflowEventNotFoundError = ErrorDescriptor<
  'WORKFLOW_EVENT_NOT_FOUND',
  'Event definition not found',
  { eventName: string; workflowName: string }
>;

export type WorkflowInvalidSnapshotError = ErrorDescriptor<
  'WORKFLOW_INVALID_SNAPSHOT',
  'Snapshot contains non-JSON-serializable data',
  { instanceId: string; stageName: string }
>;

export type WorkflowTimeoutError = ErrorDescriptor<
  'WORKFLOW_TIMEOUT',
  'Workflow operation timed out',
  { instanceId: string; operation: string }
>;

/**
 * Union type of all workflow errors
 */
export type WorkflowError =
  | WorkflowInstanceNotFoundError
  | WorkflowStageNotFoundError
  | WorkflowLockFailedError
  | WorkflowInvalidTransitionError
  | WorkflowExecutionFailedError
  | WorkflowStorageError
  | WorkflowEventNotFoundError
  | WorkflowInvalidSnapshotError
  | WorkflowTimeoutError;

/**
 * Error code constants with HTTP status codes
 */
export const WorkflowErrorCodes = {
  INSTANCE_NOT_FOUND: {
    code: 'WORKFLOW_INSTANCE_NOT_FOUND' as const,
    httpStatus: 404,
    message: 'Workflow instance not found' as const,
  },
  STAGE_NOT_FOUND: {
    code: 'WORKFLOW_STAGE_NOT_FOUND' as const,
    httpStatus: 500,
    message: 'Stage not found in workflow definition' as const,
  },
  LOCK_FAILED: {
    code: 'WORKFLOW_LOCK_FAILED' as const,
    httpStatus: 409,
    message: 'Failed to acquire workflow instance lock' as const,
  },
  INVALID_TRANSITION: {
    code: 'WORKFLOW_INVALID_TRANSITION' as const,
    httpStatus: 400,
    message: 'Invalid workflow state transition' as const,
  },
  EXECUTION_FAILED: {
    code: 'WORKFLOW_EXECUTION_FAILED' as const,
    httpStatus: 500,
    message: 'Workflow stage execution failed' as const,
  },
  STORAGE_ERROR: {
    code: 'WORKFLOW_STORAGE_ERROR' as const,
    httpStatus: 500,
    message: 'Workflow storage operation failed' as const,
  },
  EVENT_NOT_FOUND: {
    code: 'WORKFLOW_EVENT_NOT_FOUND' as const,
    httpStatus: 404,
    message: 'Event definition not found' as const,
  },
  INVALID_SNAPSHOT: {
    code: 'WORKFLOW_INVALID_SNAPSHOT' as const,
    httpStatus: 400,
    message: 'Snapshot contains non-JSON-serializable data' as const,
  },
  TIMEOUT: {
    code: 'WORKFLOW_TIMEOUT' as const,
    httpStatus: 408,
    message: 'Workflow operation timed out' as const,
  },
} as const;
