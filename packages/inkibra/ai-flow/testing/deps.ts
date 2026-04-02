import OpenAI from 'openai';
import type { AIDeps } from '../flow';
import type {
  AiFlowCreateTurn,
  AiFlowPrimitive,
  AiFlowScenario,
  AiFlowStreamTurn,
  AiFlowTestDepsResult,
} from './types';

type StreamEvent = {
  type: string;
  [key: string]: unknown;
};

type CreateAiFlowTestDepsArgs = {
  logger: AIDeps['logger'];
  scenario: AiFlowScenario;
};

export function createAiFlowTestDeps(
  args: CreateAiFlowTestDepsArgs,
): AiFlowTestDepsResult {
  const streamQueue = [...args.scenario.stream];
  const createQueue = [...(args.scenario.create ?? [])];
  const fallbackStreamTurn = args.scenario.stream.at(-1);
  const fallbackCreateTurn = args.scenario.create?.at(-1);

  let streamCalls = 0;
  let createCalls = 0;
  const streamRequests: unknown[] = [];
  const createRequests: unknown[] = [];

  const openAI = new OpenAI({ apiKey: 'test' });
  Object.assign(openAI.responses, {
    stream: (request: unknown) => {
      streamCalls += 1;
      streamRequests.push(request);
      const turn =
        streamQueue.shift() ??
        (args.scenario.strict ? undefined : fallbackStreamTurn);
      if (!turn) {
        throw new Error(
          `ai-flow/testing: missing stream turn for call #${streamCalls}`,
        );
      }

      return createMockResponseStream(toStreamEvents(turn, streamCalls));
    },

    create: async (request: unknown) => {
      createCalls += 1;
      createRequests.push(request);
      const turn =
        createQueue.shift() ??
        (args.scenario.strict ? undefined : fallbackCreateTurn);
      if (!turn) {
        throw new Error(
          `ai-flow/testing: missing create turn for call #${createCalls}`,
        );
      }

      const outputText = toCreateOutputText(turn);
      return {
        id: `mock-create-${createCalls}`,
        output_text: outputText,
      };
    },
  });

  const deps: AIDeps = {
    openAI,
    logger: args.logger,
  };

  return {
    deps,
    inspector: {
      streamCallCount: () => streamCalls,
      createCallCount: () => createCalls,
      streamRequests: () => [...streamRequests],
      createRequests: () => [...createRequests],
      remainingStreamTurns: () => streamQueue.length,
      remainingCreateTurns: () => createQueue.length,
      assertConsumed: () => {
        if (!args.scenario.strict) {
          return;
        }

        const remainingStream = streamQueue.length;
        const remainingCreate = createQueue.length;
        if (remainingStream === 0 && remainingCreate === 0) {
          return;
        }

        throw new Error(
          `ai-flow/testing: scenario not fully consumed (stream=${remainingStream}, create=${remainingCreate})`,
        );
      },
    },
  };
}

function toCreateOutputText(turn: AiFlowCreateTurn): string {
  if (turn.kind === 'text') {
    return turn.text ?? '';
  }

  if (turn.kind === 'json') {
    return JSON.stringify(turn.value ?? {});
  }

  if (turn.text !== undefined) {
    return turn.text;
  }

  return JSON.stringify(turn.value ?? {});
}

function toStreamEvents(
  turn: AiFlowStreamTurn,
  callIndex: number,
): {
  events: StreamEvent[];
  error?: { message: string; afterEvents?: number };
} {
  const events: StreamEvent[] = [];
  let toolCallCounter = 0;

  for (const primitive of turn.primitives) {
    if (primitive.kind === 'reasoning') {
      events.push({
        type: 'response.reasoning_summary_text.delta',
        delta: primitive.text,
      });
      continue;
    }

    if (primitive.kind === 'text') {
      const size = primitive.chunkSize ?? (primitive.text.length || 1);
      for (const chunk of chunkText(primitive.text, size)) {
        events.push({ type: 'response.output_text.delta', delta: chunk });
      }
      continue;
    }

    if (primitive.kind === 'json') {
      const raw = JSON.stringify(primitive.value);
      const size = primitive.chunkSize ?? (raw.length || 1);
      for (const chunk of chunkText(raw, size)) {
        events.push({ type: 'response.output_text.delta', delta: chunk });
      }
      continue;
    }

    toolCallCounter += 1;
    const callId =
      primitive.callId ?? `mock-call-${callIndex}-${toolCallCounter}`;
    const itemId =
      primitive.itemId ?? `mock-item-${callIndex}-${toolCallCounter}`;
    const rawArgs =
      typeof primitive.arguments === 'string'
        ? primitive.arguments
        : JSON.stringify(primitive.arguments);
    const size = primitive.chunkSize ?? (rawArgs.length || 1);

    events.push({
      type: 'response.output_item.added',
      item: {
        type: 'function_call',
        id: itemId,
        call_id: callId,
        name: primitive.name,
      },
    });

    for (const chunk of chunkText(rawArgs, size)) {
      events.push({
        type: 'response.function_call_arguments.delta',
        item_id: itemId,
        delta: chunk,
      });
    }

    events.push({
      type: 'response.function_call_arguments.done',
      item_id: itemId,
      arguments: rawArgs,
    });

    events.push({
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        id: itemId,
        call_id: callId,
        name: primitive.name,
        arguments: rawArgs,
      },
    });
  }

  events.push({
    type: 'response.completed',
    response: {
      id: turn.responseId ?? `mock-response-${callIndex}`,
    },
  });

  return {
    events,
    error: turn.error,
  };
}

function createMockResponseStream(args: {
  events: StreamEvent[];
  error?: { message: string; afterEvents?: number };
}): {
  controller: { abort: () => void };
  [Symbol.asyncIterator]: () => AsyncGenerator<StreamEvent, void, unknown>;
} {
  let aborted = false;
  const throwAfter = args.error
    ? Math.max(0, args.error.afterEvents ?? 0)
    : Number.POSITIVE_INFINITY;

  return {
    controller: {
      abort: () => {
        aborted = true;
      },
    },
    async *[Symbol.asyncIterator]() {
      let yielded = 0;
      for (const event of args.events) {
        if (aborted) {
          return;
        }
        if (yielded >= throwAfter && args.error) {
          throw new Error(args.error.message);
        }
        yield event;
        yielded += 1;
      }
      if (!aborted && args.error && yielded >= throwAfter) {
        throw new Error(args.error.message);
      }
    },
  };
}

function chunkText(text: string, size: number): string[] {
  if (text.length === 0) {
    return [''];
  }

  const safeSize = Math.max(1, size);
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += safeSize) {
    chunks.push(text.slice(i, i + safeSize));
  }
  return chunks;
}

export function textPrimitive(
  text: string,
  chunkSize?: number,
): AiFlowPrimitive {
  return { kind: 'text', text, chunkSize };
}

export function jsonPrimitive(
  value: unknown,
  chunkSize?: number,
): AiFlowPrimitive {
  return { kind: 'json', value, chunkSize };
}

export function reasoningPrimitive(text: string): AiFlowPrimitive {
  return { kind: 'reasoning', text };
}
