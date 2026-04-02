import type { AIDeps } from '@inkibra/ai-flow';
import OpenAI from 'openai';

type JsonSchema = {
  $defs?: Record<string, JsonSchema>;
  $ref?: string;
  additionalProperties?: boolean | JsonSchema;
  allOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  const?: unknown;
  enum?: unknown[];
  items?: JsonSchema | JsonSchema[];
  oneOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  type?: string | string[];
};

type StreamEvent = {
  type: string;
  [key: string]: unknown;
};

type ChaosAiFlowDepsArgs = {
  logger: AIDeps['logger'];
  seed: number;
};

type ChaosResponsesRequest = {
  input?: Array<{
    role?: string;
    type?: string;
    content?: string;
    output?: string;
  }>;
  text?: {
    format?: {
      type?: string;
      schema?: JsonSchema;
    };
  };
};

export function createChaosAiFlowDeps(args: ChaosAiFlowDepsArgs): {
  deps: AIDeps;
  inspector: {
    streamCallCount: () => number;
    createCallCount: () => number;
  };
} {
  let streamCalls = 0;
  let createCalls = 0;
  let jsonCalls = 0;
  let textCalls = 0;

  const openAI = new OpenAI({ apiKey: 'test' });
  Object.assign(openAI.responses, {
    stream: (request: unknown) => {
      streamCalls += 1;

      const response = buildChaosResponse({
        request,
        seed: args.seed,
        callIndex: streamCalls,
        nextJsonCall: () => {
          jsonCalls += 1;
          return jsonCalls;
        },
        nextTextCall: () => {
          textCalls += 1;
          return textCalls;
        },
      });

      return createMockResponseStream(response.events);
    },

    create: async (request: unknown) => {
      createCalls += 1;

      const response = buildChaosResponse({
        request,
        seed: args.seed,
        callIndex: createCalls,
        nextJsonCall: () => {
          jsonCalls += 1;
          return jsonCalls;
        },
        nextTextCall: () => {
          textCalls += 1;
          return textCalls;
        },
      });

      return {
        id: `chaos-create-${createCalls}`,
        output_text: response.outputText,
      };
    },
  });

  return {
    deps: {
      openAI,
      logger: args.logger,
    },
    inspector: {
      streamCallCount: () => streamCalls,
      createCallCount: () => createCalls,
    },
  };
}

function buildChaosResponse(input: {
  request: unknown;
  seed: number;
  callIndex: number;
  nextJsonCall: () => number;
  nextTextCall: () => number;
}): {
  outputText: string;
  events: StreamEvent[];
} {
  const request = asResponsesRequest(input.request);
  const format = request.text?.format;

  if (format?.type === 'json_schema' && format.schema) {
    const jsonCall = input.nextJsonCall();
    const payload = buildSchemaValue(format.schema, format.schema, '', {
      seed: input.seed,
      jsonCall,
    });
    const outputText = JSON.stringify(payload);
    return {
      outputText,
      events: buildTextEvents(outputText, input.callIndex),
    };
  }

  const textCall = input.nextTextCall();
  const outputText = buildTextResponse({
    request,
    seed: input.seed,
    textCall,
  });
  return {
    outputText,
    events: buildTextEvents(outputText, input.callIndex),
  };
}

function asResponsesRequest(request: unknown): ChaosResponsesRequest {
  if (!request || typeof request !== 'object') {
    return {};
  }
  return request as ChaosResponsesRequest;
}

function buildTextResponse(input: {
  request: ChaosResponsesRequest;
  seed: number;
  textCall: number;
}): string {
  const prompt = extractPromptText(input.request);

  if (
    prompt.includes('Generation Frame') ||
    prompt.includes('Write as a short text-message thread')
  ) {
    return [
      'MESSAGE 1:',
      `Chaos reply seed=${input.seed} call=${input.textCall}.`,
      '---',
      'MESSAGE 2:',
      'Keeping the thread moving with one concrete next step.',
    ].join('\n');
  }

  if (prompt.includes('Nap') || prompt.includes('hypno')) {
    return `Nap log: chaos seed=${input.seed} call=${input.textCall} committed cleanly.`;
  }

  return [
    `Observation: chaos seed=${input.seed} call=${input.textCall}.`,
    'Interpretation: maintain durable order and keep processing steady.',
    'Impact on the user: no immediate risk.',
    'Feeling: focused.',
    'Curiosity / learn more: whether newer facts supersede older ones.',
    'Remember? no (stress-test traffic only).',
    'Next step: continue processing.',
  ].join('\n');
}

function extractPromptText(request: ChaosResponsesRequest): string {
  const input = Array.isArray(request.input) ? request.input : [];
  return input
    .map((entry) => {
      if (typeof entry.content === 'string') {
        return entry.content;
      }
      if (typeof entry.output === 'string') {
        return entry.output;
      }
      return '';
    })
    .filter((entry) => entry.length > 0)
    .join('\n');
}

function buildTextEvents(text: string, callIndex: number): StreamEvent[] {
  const events: StreamEvent[] = [];
  for (const chunk of chunkText(text, 64)) {
    events.push({
      type: 'response.output_text.delta',
      delta: chunk,
    });
  }

  events.push({
    type: 'response.completed',
    response: {
      id: `chaos-response-${callIndex}`,
    },
  });

  return events;
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

function createMockResponseStream(events: StreamEvent[]): {
  controller: { abort: () => void };
  [Symbol.asyncIterator]: () => AsyncGenerator<StreamEvent, void, unknown>;
} {
  let aborted = false;

  return {
    controller: {
      abort: () => {
        aborted = true;
      },
    },
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        if (aborted) {
          return;
        }
        yield event;
      }
    },
  };
}

function buildSchemaValue(
  rootSchema: JsonSchema,
  schema: JsonSchema,
  path: string,
  input: { seed: number; jsonCall: number },
): unknown {
  const resolved = resolveSchema(rootSchema, schema);
  const selected =
    resolved.const !== undefined
      ? resolved
      : (resolved.oneOf?.[0] ??
        resolved.anyOf?.[0] ??
        resolved.allOf?.[0] ??
        resolved);

  if (selected.const !== undefined) {
    return selected.const;
  }

  if (selected.enum && selected.enum.length > 0) {
    return chooseEnumValue(path, selected.enum, input);
  }

  if (
    selected.type === 'object' ||
    selected.properties ||
    selected.required ||
    typeof selected.additionalProperties === 'object'
  ) {
    const out: Record<string, unknown> = {};
    const properties = selected.properties ?? {};
    const keys = new Set([
      ...Object.keys(properties),
      ...(selected.required ?? []),
    ]);

    for (const key of keys) {
      const propertySchema = properties[key];
      if (!propertySchema) {
        continue;
      }
      out[key] = buildSchemaValue(
        rootSchema,
        propertySchema,
        path ? `${path}.${key}` : key,
        input,
      );
    }

    if (typeof out.urgency === 'string') {
      if (out.urgency === 'none') {
        out.intent = '';
      } else if (typeof out.intent !== 'string' || out.intent.length === 0) {
        out.intent = 'chaos follow-up';
      }
      if (typeof out.thinking !== 'string' || out.thinking.length === 0) {
        out.thinking = 'chaos fixture thinking';
      }
    }

    if (typeof out.decision === 'string') {
      out.reason = 'chaos fixture';
    }

    if (typeof out.verdict === 'string') {
      out.reason =
        out.verdict === 'ok' ? 'chaos fixture ok' : 'chaos fixture mismatch';
    }

    return out;
  }

  if (selected.type === 'array') {
    if (Array.isArray(selected.items)) {
      return selected.items.map((item, index) =>
        buildSchemaValue(rootSchema, item, `${path}[${index}]`, input),
      );
    }

    return selected.items
      ? [buildSchemaValue(rootSchema, selected.items, `${path}[0]`, input)]
      : [];
  }

  const scalarType = Array.isArray(selected.type)
    ? (selected.type.find((value) => value !== 'null') ?? selected.type[0])
    : selected.type;

  switch (scalarType) {
    case 'boolean':
      return chooseBooleanValue(path, input);
    case 'integer':
    case 'number':
      return 1;
    case 'string':
    default:
      return chooseStringValue(path, input);
  }
}

function resolveSchema(rootSchema: JsonSchema, schema: JsonSchema): JsonSchema {
  if (!schema.$ref) {
    return schema;
  }

  if (!schema.$ref.startsWith('#/$defs/')) {
    return schema;
  }

  const key = schema.$ref.slice('#/$defs/'.length);
  return rootSchema.$defs?.[key] ?? schema;
}

function chooseEnumValue(
  path: string,
  values: unknown[],
  input: { seed: number; jsonCall: number },
): unknown {
  if (path.endsWith('decision')) {
    return values.includes('respond') ? 'respond' : values[0];
  }

  if (path.endsWith('urgency')) {
    return values.includes('none') ? 'none' : values[0];
  }

  if (path.endsWith('verdict')) {
    return values.includes('ok') ? 'ok' : values[0];
  }

  return values[(input.seed + input.jsonCall) % values.length] ?? values[0];
}

function chooseBooleanValue(
  _path: string,
  _input: { seed: number; jsonCall: number },
): boolean {
  return true;
}

function chooseStringValue(
  path: string,
  input: { seed: number; jsonCall: number },
): string {
  if (path.endsWith('intent')) {
    return 'chaos follow-up';
  }

  if (path.endsWith('thinking')) {
    return 'chaos fixture thinking';
  }

  if (path.endsWith('reason')) {
    return 'chaos fixture';
  }

  return `chaos-${input.seed}-${input.jsonCall}`;
}
