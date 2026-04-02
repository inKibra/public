import type { AIDeps } from '../flow';

export type AiFlowReasoningPrimitive = {
  kind: 'reasoning';
  text: string;
};

export type AiFlowTextPrimitive = {
  kind: 'text';
  text: string;
  chunkSize?: number;
};

export type AiFlowJsonPrimitive = {
  kind: 'json';
  value: unknown;
  chunkSize?: number;
};

export type AiFlowToolCallPrimitive = {
  kind: 'tool_call';
  name: string;
  arguments: Record<string, unknown> | string;
  callId?: string;
  itemId?: string;
  chunkSize?: number;
};

export type AiFlowPrimitive =
  | AiFlowReasoningPrimitive
  | AiFlowTextPrimitive
  | AiFlowJsonPrimitive
  | AiFlowToolCallPrimitive;

export type AiFlowStreamTurn = {
  primitives: AiFlowPrimitive[];
  responseId?: string;
  error?: {
    message: string;
    afterEvents?: number;
  };
};

export type AiFlowCreateTurn = {
  kind?: 'text' | 'json';
  text?: string;
  value?: unknown;
};

export type AiFlowScenario = {
  stream: AiFlowStreamTurn[];
  create?: AiFlowCreateTurn[];
  strict?: boolean;
};

export type AiFlowTestDepsInspector = {
  streamCallCount: () => number;
  createCallCount: () => number;
  streamRequests: () => unknown[];
  createRequests: () => unknown[];
  remainingStreamTurns: () => number;
  remainingCreateTurns: () => number;
  assertConsumed: () => void;
};

export type AiFlowTestDepsResult = {
  deps: AIDeps;
  inspector: AiFlowTestDepsInspector;
};
