/**
 * Event routing and coordination system
 */

import type { WorkflowRuntime } from './runtime';
import type {
  EventCaptureFunction,
  EventDefinition,
  JsonObject,
  JsonValue,
  Snapshot,
} from './types';

/**
 * Create a bound event definition that can emit and query events
 */
export function createBoundEventDefinition<TSnapshot extends JsonValue>(
  workflowName: string,
  eventName: string,
  captureFunction: EventCaptureFunction<TSnapshot>,
  runtime: WorkflowRuntime,
): EventDefinition<TSnapshot> {
  return {
    capture: (snapshot: Snapshot<TSnapshot>) => {
      return captureFunction(snapshot);
    },

    emit: async (
      params: { payload: JsonValue; token?: string } & JsonObject,
    ) => {
      // Extract payload and other params
      const { payload, ...otherParams } = params;

      // Generate token - need snapshot for this
      // In practice, emit is called with explicit token or data to derive it
      const token =
        typeof otherParams.token === 'string'
          ? otherParams.token
          : captureFunction(otherParams as Snapshot<TSnapshot>);

      await runtime.emitEvent({
        workflowName,
        eventName,
        token,
        payload,
      });
    },

    received: () => {
      // This should be called from within a stage execution context
      // where we have access to the instance's event history
      throw new Error(
        'received() must be called from within stage execution context',
      );
    },
  };
}

/**
 * Helper to generate deterministic tokens from snapshots
 */
export function generateToken(parts: string[]): string {
  return parts.filter(Boolean).join(':');
}

/**
 * Helper to create event capture functions with type safety
 */
export function createEventCapture<TSnapshot extends JsonValue>(
  fn: (snapshot: Snapshot<TSnapshot>) => string,
): EventCaptureFunction<TSnapshot> {
  return fn;
}
