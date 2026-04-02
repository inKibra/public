import { describe, expect, test } from 'bun:test';
import initLogger from '@inkibra/logger';
import {
  createAiFlow,
  createAiOutput,
  createAiOutputStage,
  createAiPrompt,
  createAiTextStage,
  createAiTool,
  createEvaluationStage,
} from '../index';
import {
  createAiFlowScenario,
  createAiFlowTestDeps,
  jsonPrimitive,
  textPrimitive,
} from './index';

describe('ai-flow testing deps', () => {
  function parseSingleStringField<TField extends string>(
    raw: string,
    field: TField,
  ) {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed[field];
    if (typeof value !== 'string') {
      return {
        success: false as const,
        errors: [{ path: field, expected: 'string', value }],
      };
    }

    return {
      success: true as const,
      data: { [field]: value } as Record<TField, string>,
    };
  }
  test('drives a text stage with scripted text primitives', async () => {
    const stage = createAiTextStage<'talk', { reply: string }, {}>('talk', {
      model: 'gpt-5.2',
      context: {},
      instructions: createAiPrompt<{ reply: string }>('instructions', {
        render: () => 'Reply with a short sentence.',
      }),
      inputs: {},
    });

    const flow = createAiFlow<{ reply: string }, { talk: typeof stage }>(
      'test',
      {
        stages: { talk: stage },
      },
    ).onStep('talk', async ({ step }) => {
      if (step.kind === 'reasoning') {
        return step.next();
      }
      if (step.kind === 'chunk') {
        return step.next();
      }
      if (step.kind === 'text') {
        return step.output.accept((output, ctx) => ({
          ctx: { ...ctx, reply: output },
        }));
      }
      return step.next();
    });

    const scenario = createAiFlowScenario({
      stream: [
        {
          primitives: [textPrimitive('hello from ai-flow/testing', 5)],
        },
      ],
    });

    const testDeps = createAiFlowTestDeps({
      logger: initLogger('ai-flow-testing-deps-text-test'),
      scenario,
    });

    const result = await flow
      .start({
        flow: { reply: '' },
        firstStage: 'talk',
        deps: testDeps.deps,
      })
      .complete();

    expect(result.status).toBe('completed');
    expect(result.snapshot.flowContext.reply).toBe(
      'hello from ai-flow/testing',
    );
    expect(testDeps.inspector.streamCallCount()).toBe(1);
    testDeps.inspector.assertConsumed();
  });

  test('retries recoverable stream failures before any stream state exists', async () => {
    const stage = createAiTextStage<'talk', { reply: string }, {}>('talk', {
      model: 'gpt-5.2',
      context: {},
      instructions: createAiPrompt<{ reply: string }>('instructions', {
        render: () => 'Reply with a short sentence.',
      }),
      inputs: {},
    });

    const flow = createAiFlow<{ reply: string }, { talk: typeof stage }>(
      'test-retry',
      {
        stages: { talk: stage },
      },
    ).onStep('talk', async ({ step }) => {
      if (step.kind === 'reasoning' || step.kind === 'chunk') {
        return step.next();
      }
      if (step.kind === 'text') {
        return step.output.accept((output, ctx) => ({
          ctx: { ...ctx, reply: output },
        }));
      }
      return step.next();
    });

    const scenario = createAiFlowScenario({
      stream: [
        {
          primitives: [],
          error: {
            message:
              'Error reading stream: read tcp 172.19.0.3:49026->104.18.3.115:443: i/o timeout',
          },
        },
        {
          primitives: [textPrimitive('retried successfully', 8)],
        },
      ],
    });

    const testDeps = createAiFlowTestDeps({
      logger: initLogger('ai-flow-testing-deps-retry-test'),
      scenario,
    });

    const result = await flow
      .start({
        flow: { reply: '' },
        firstStage: 'talk',
        deps: testDeps.deps,
      })
      .complete();

    expect(result.status).toBe('completed');
    expect(result.snapshot.flowContext.reply).toBe('retried successfully');
    expect(testDeps.inspector.streamCallCount()).toBe(2);
    testDeps.inspector.assertConsumed();
  });

  test('does not retry recoverable failures after useful stream state exists', async () => {
    const stage = createAiTextStage<'talk', { reply: string }, {}>('talk', {
      model: 'gpt-5.2',
      context: {},
      instructions: createAiPrompt<{ reply: string }>('instructions', {
        render: () => 'Reply with a short sentence.',
      }),
      inputs: {},
    });

    const flow = createAiFlow<{ reply: string }, { talk: typeof stage }>(
      'test-salvage',
      {
        stages: { talk: stage },
      },
    ).onStep('talk', async ({ step }) => {
      if (step.kind === 'reasoning' || step.kind === 'chunk') {
        return step.next();
      }
      if (step.kind === 'text') {
        return step.output.accept((output, ctx) => ({
          ctx: { ...ctx, reply: output },
        }));
      }
      return step.next();
    });

    const scenario = createAiFlowScenario({
      stream: [
        {
          primitives: [textPrimitive('partial salvage', 7)],
          error: {
            message: 'failed to drain streaming response body before release',
            afterEvents: 1,
          },
        },
      ],
    });

    const testDeps = createAiFlowTestDeps({
      logger: initLogger('ai-flow-testing-deps-salvage-test'),
      scenario,
    });

    const result = await flow
      .start({
        flow: { reply: '' },
        firstStage: 'talk',
        deps: testDeps.deps,
      })
      .complete();

    expect(result.status).toBe('completed');
    expect(result.snapshot.flowContext.reply).toBe('partial');
    expect(testDeps.inspector.streamCallCount()).toBe(1);
    testDeps.inspector.assertConsumed();
  });

  test('supports output-stage evaluation through scripted create turns', async () => {
    const output = createAiOutput<
      'draft',
      { accepted: boolean; draft: { value: string } | null },
      { value: string }
    >('draft', {
      schema: {
        type: 'object',
        properties: {
          value: { type: 'string' },
        },
        required: ['value'],
        additionalProperties: false,
      },
      validate: (raw) => {
        try {
          const parsed = JSON.parse(raw) as { value?: unknown };
          if (typeof parsed.value !== 'string') {
            return {
              success: false as const,
              errors: [
                {
                  path: 'value',
                  expected: 'string',
                  value: parsed.value,
                  message: 'value must be a string',
                },
              ],
            };
          }
          return {
            success: true as const,
            data: { value: parsed.value },
          };
        } catch (error) {
          return {
            success: false as const,
            errors: [
              {
                path: '',
                expected: 'valid JSON',
                value: raw,
                message:
                  error instanceof Error ? error.message : 'invalid JSON',
              },
            ],
          };
        }
      },
      render: () => '',
    });

    const stage = createAiOutputStage<
      'decide',
      { accepted: boolean; draft: { value: string } | null },
      {},
      { value: string },
      'draft',
      {}
    >('decide', {
      model: 'gpt-5.2',
      maxSteps: 2,
      tools: {},
      context: {},
      instructions: createAiPrompt<{
        accepted: boolean;
        draft: { value: string } | null;
      }>('instructions', {
        render: () => 'Return JSON with {"value":"ok"}.',
      }),
      inputs: {},
      output,
      storage: () => ({}),
    });

    let evalVerdict: boolean | null = null;

    const evaluation = createEvaluationStage<
      { accepted: boolean; draft: { value: string } | null },
      { pass: boolean }
    >('eval-pass', {
      model: 'gpt-5.2',
      instructions: 'Decide if candidate passes.',
      inputs: async () => [],
      schema: {
        type: 'object',
        properties: { pass: { type: 'boolean' } },
        required: ['pass'],
        additionalProperties: false,
      },
      validate: (raw) => {
        const parsed = JSON.parse(raw) as { pass?: unknown };
        if (typeof parsed.pass !== 'boolean') {
          return {
            success: false as const,
            errors: [
              {
                path: 'pass',
                expected: 'boolean',
                value: parsed.pass,
              },
            ],
          };
        }
        return {
          success: true as const,
          data: { pass: parsed.pass },
        };
      },
    });

    const flow = createAiFlow<
      { accepted: boolean; draft: { value: string } | null },
      {
        decide: typeof stage;
      }
    >('test-output', {
      stages: {
        decide: stage,
      },
    }).onStep('decide', async ({ step }) => {
      if (step.kind === 'reasoning') {
        return step.next();
      }

      if (step.kind === 'output') {
        const evalResult = await step.output.evaluate(evaluation);
        evalVerdict = evalResult?.pass ?? null;
        return step.output.accept((_out, ctx) => ({
          ctx: { ...ctx, accepted: Boolean(evalResult?.pass) },
        }));
      }

      return step.next();
    });

    const scenario = createAiFlowScenario({
      stream: [
        {
          primitives: [jsonPrimitive({ value: 'ok' })],
        },
      ],
      create: [{ kind: 'json', value: { pass: true } }],
    });

    const testDeps = createAiFlowTestDeps({
      logger: initLogger('ai-flow-testing-deps-output-test'),
      scenario,
    });

    const result = await flow
      .start({
        flow: { accepted: false, draft: null },
        firstStage: 'decide',
        deps: testDeps.deps,
      })
      .complete();

    expect(result.status).toBe('completed');
    expect(result.snapshot.flowContext.accepted).toBe(true);
    expect(evalVerdict === true).toBe(true);
    expect(testDeps.inspector.streamCallCount()).toBe(1);
    expect(testDeps.inspector.createCallCount()).toBe(1);
    testDeps.inspector.assertConsumed();
  });

  test('retries recoverable stream failures for output stages before any stream state exists', async () => {
    const output = createAiOutput<
      'draft',
      { accepted: boolean; draft: { value: string } | null },
      { value: string }
    >('draft', {
      schema: {
        type: 'object',
        properties: {
          value: { type: 'string' },
        },
        required: ['value'],
        additionalProperties: false,
      },
      validate: (raw) => {
        const parsed = JSON.parse(raw) as { value?: unknown };
        if (typeof parsed.value !== 'string') {
          return {
            success: false as const,
            errors: [
              { path: 'value', expected: 'string', value: parsed.value },
            ],
          };
        }
        return {
          success: true as const,
          data: { value: parsed.value },
        };
      },
      render: () => '',
    });

    const stage = createAiOutputStage<
      'decide',
      { accepted: boolean; draft: { value: string } | null },
      {},
      { value: string },
      'draft',
      {}
    >('decide', {
      model: 'gpt-5.2',
      maxSteps: 2,
      tools: {},
      context: {},
      instructions: createAiPrompt<{
        accepted: boolean;
        draft: { value: string } | null;
      }>('instructions', {
        render: () => 'Return JSON with {"value":"ok"}.',
      }),
      inputs: {},
      output,
      storage: () => ({}),
    });

    const flow = createAiFlow<
      { accepted: boolean; draft: { value: string } | null },
      { decide: typeof stage }
    >('test-output-retry', {
      stages: { decide: stage },
    }).onStep('decide', async ({ step }) => {
      if (step.kind === 'reasoning') {
        return step.next();
      }
      if (step.kind === 'output') {
        return step.output.accept((_out, ctx) => ({
          ctx: { ...ctx, accepted: true },
        }));
      }
      return step.next();
    });

    const scenario = createAiFlowScenario({
      stream: [
        {
          primitives: [],
          error: {
            message: 'connection reset by peer while reading stream',
          },
        },
        {
          primitives: [jsonPrimitive({ value: 'ok' })],
        },
      ],
    });

    const testDeps = createAiFlowTestDeps({
      logger: initLogger('ai-flow-testing-deps-output-retry-test'),
      scenario,
    });

    const result = await flow
      .start({
        flow: { accepted: false, draft: null },
        firstStage: 'decide',
        deps: testDeps.deps,
      })
      .complete();

    expect(result.status).toBe('completed');
    expect(result.snapshot.flowContext.accepted).toBe(true);
    expect(testDeps.inspector.streamCallCount()).toBe(2);
    testDeps.inspector.assertConsumed();
  });

  test('accepts fenced json output before typia-style validation', async () => {
    const output = createAiOutput<
      'draft',
      { accepted: boolean; draft: { value: string } | null },
      { value: string }
    >('draft', {
      schema: {
        type: 'object',
        properties: {
          value: { type: 'string' },
        },
        required: ['value'],
        additionalProperties: false,
      },
      validate: (raw) => {
        const parsed = JSON.parse(raw) as { value?: unknown };
        if (typeof parsed.value !== 'string') {
          return {
            success: false as const,
            errors: [
              { path: 'value', expected: 'string', value: parsed.value },
            ],
          };
        }
        return {
          success: true as const,
          data: { value: parsed.value },
        };
      },
      render: () => '',
    });

    const stage = createAiOutputStage<
      'decide',
      { accepted: boolean; draft: { value: string } | null },
      {},
      { value: string },
      'draft',
      {}
    >('decide', {
      model: 'gpt-5.2',
      maxSteps: 2,
      tools: {},
      context: {},
      instructions: createAiPrompt<{
        accepted: boolean;
        draft: { value: string } | null;
      }>('instructions', {
        render: () => 'Return JSON with {"value":"ok"}.',
      }),
      inputs: {
        frame: {
          key: 'frame',
          render: async () => [
            {
              role: 'system' as const,
              type: 'message' as const,
              content: 'Return only structured JSON.',
            },
          ],
        },
      },
      output,
      storage: () => ({}),
    });

    const flow = createAiFlow<
      { accepted: boolean; draft: { value: string } | null },
      { decide: typeof stage }
    >('test-output-fenced-json', {
      stages: { decide: stage },
    }).onStep('decide', async ({ step }) => {
      if (step.kind === 'reasoning') {
        return step.next();
      }
      if (step.kind === 'output') {
        return step.output.accept((_out, ctx) => ({
          ctx: { ...ctx, accepted: true },
        }));
      }
      return step.next();
    });

    const scenario = createAiFlowScenario({
      stream: [
        {
          primitives: [textPrimitive('```json\n{"value":"ok"}\n```', 10)],
        },
      ],
    });

    const testDeps = createAiFlowTestDeps({
      logger: initLogger('ai-flow-testing-deps-fenced-json-test'),
      scenario,
    });

    const result = await flow
      .start({
        flow: { accepted: false, draft: null },
        firstStage: 'decide',
        deps: testDeps.deps,
      })
      .complete();

    expect(result.status).toBe('completed');
    expect(result.snapshot.flowContext.accepted).toBe(true);
    testDeps.inspector.assertConsumed();
  });

  test('continues from replay history on follow-up output turns with no tool outputs', async () => {
    const output = createAiOutput<
      'draft',
      { accepted: boolean; draft: { value: string } | null },
      { value: string }
    >('draft', {
      schema: {
        type: 'object',
        properties: {
          value: { type: 'string' },
        },
        required: ['value'],
        additionalProperties: false,
      },
      validate: (raw) => {
        const parsed = JSON.parse(raw) as { value?: unknown };
        if (typeof parsed.value !== 'string') {
          return {
            success: false as const,
            errors: [
              { path: 'value', expected: 'string', value: parsed.value },
            ],
          };
        }
        return {
          success: true as const,
          data: { value: parsed.value },
        };
      },
      render: () => '',
    });

    const stage = createAiOutputStage<
      'decide',
      { accepted: boolean; draft: { value: string } | null },
      {},
      { value: string },
      'draft',
      {}
    >('decide', {
      model: 'gpt-5.2',
      maxSteps: 2,
      tools: {},
      context: {},
      instructions: createAiPrompt<{
        accepted: boolean;
        draft: { value: string } | null;
      }>('instructions', {
        render: () => 'Return JSON with {"value":"ok"}.',
      }),
      inputs: {
        frame: {
          key: 'frame',
          render: async () => [
            {
              role: 'system' as const,
              type: 'message' as const,
              content: 'Evaluate the draft and return JSON.',
            },
          ],
        },
      },
      output,
      storage: () => ({}),
    });

    const flow = createAiFlow<
      { accepted: boolean; draft: { value: string } | null },
      { decide: typeof stage }
    >('test-output-follow-up-input', {
      stages: { decide: stage },
    }).onStep('decide', async ({ step }) => {
      if (step.kind === 'reasoning') {
        return step.next();
      }
      if (step.kind === 'output') {
        return step.output.accept((_out, ctx) => ({
          ctx: { ...ctx, accepted: true },
        }));
      }
      return step.next();
    });

    const scenario = createAiFlowScenario({
      stream: [
        { primitives: [] },
        { primitives: [jsonPrimitive({ value: 'ok' })] },
      ],
    });

    const testDeps = createAiFlowTestDeps({
      logger: initLogger('ai-flow-testing-deps-follow-up-input-test'),
      scenario,
    });

    const result = await flow
      .start({
        flow: { accepted: false, draft: null },
        firstStage: 'decide',
        deps: testDeps.deps,
      })
      .complete();

    expect(result.status).toBe('completed');
    expect(testDeps.inspector.streamCallCount()).toBe(2);

    const requests = testDeps.inspector.streamRequests() as Array<{
      input?: Array<unknown>;
      previous_response_id?: string;
    }>;
    expect(Object.hasOwn(requests[1] ?? {}, 'previous_response_id')).toBe(
      false,
    );
    expect(Array.isArray(requests[1]?.input)).toBe(true);
    expect(requests[1]?.input?.length).toBeGreaterThan(0);
    const secondInputSerialized = JSON.stringify(requests[1]?.input ?? []);
    expect(secondInputSerialized).toContain(
      'Your previous turn produced no structured JSON. Return ONLY valid JSON matching the required schema.',
    );
    testDeps.inspector.assertConsumed();
  });

  test('uses durable tool output for continuation and expires ephemeral tool context after one turn', async () => {
    const lookupTool = createAiTool<
      { reply: string },
      { query: string },
      { summary: string; details: string },
      {}
    >('lookup', {
      description: 'Loads file context for the current task.',
      parameterSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false,
      },
      parseParameters: (raw) => parseSingleStringField(raw, 'query'),
      execute: async ({ query }) => ({
        success: true as const,
        data: {
          summary: `Lookup summary: ${query}`,
          details: `Detailed file contents for ${query}`,
        },
      }),
      render: ({ summary, details }) => ({
        renderedOutput: summary,
        ephemeralOutput: details,
      }),
    });

    const stage = createAiTextStage<
      'talk',
      { reply: string },
      { lookup: typeof lookupTool }
    >('talk', {
      model: 'gpt-5.2',
      tools: { lookup: lookupTool },
      context: {},
      instructions: createAiPrompt<{ reply: string }>('instructions', {
        render: () => 'Use tools when needed, then reply with a final answer.',
      }),
      inputs: {},
    });

    const flow = createAiFlow<{ reply: string }, { talk: typeof stage }>(
      'test-tool-ephemeral-history',
      {
        stages: { talk: stage },
      },
    ).onStep('talk', async ({ step }) => {
      if (
        step.kind === 'reasoning' ||
        step.kind === 'chunk' ||
        step.kind === 'tool'
      ) {
        return step.next();
      }

      if (step.kind === 'text') {
        if (step.response.text === 'draft one') {
          return step.output.reject({ text: 'Need the final answer only.' });
        }

        return step.output.accept((output, ctx) => ({
          ctx: { ...ctx, reply: output },
        }));
      }

      throw new Error('Unhandled step kind');
    });

    const scenario = createAiFlowScenario({
      stream: [
        {
          primitives: [
            {
              kind: 'tool_call',
              name: 'lookup',
              arguments: { query: 'deep file' },
            },
          ],
        },
        { primitives: [textPrimitive('draft one')] },
        { primitives: [textPrimitive('final answer')] },
      ],
    });

    const testDeps = createAiFlowTestDeps({
      logger: initLogger('ai-flow-testing-deps-tool-ephemeral-test'),
      scenario,
    });

    const result = await flow
      .start({
        flow: { reply: '' },
        firstStage: 'talk',
        deps: testDeps.deps,
      })
      .complete();

    expect(result.status).toBe('completed');
    expect(result.snapshot.flowContext.reply).toBe('final answer');
    expect(testDeps.inspector.streamCallCount()).toBe(3);

    const requests = testDeps.inspector.streamRequests() as Array<{
      input?: Array<Record<string, unknown>>;
      previous_response_id?: string;
    }>;
    expect(Object.hasOwn(requests[1] ?? {}, 'previous_response_id')).toBe(
      false,
    );

    const secondInput = requests[1]?.input ?? [];
    const secondOutputs = secondInput
      .filter((item) => item.type === 'function_call_output')
      .map((item) => item.output);
    expect(secondOutputs).toEqual(['Lookup summary: deep file']);
    const secondEphemeralMessage = secondInput.find(
      (item) =>
        item.type === 'message' &&
        item.role === 'user' &&
        typeof item.content === 'string' &&
        item.content.includes('Immediate tool context for this turn only.'),
    );
    expect(secondEphemeralMessage?.content).toContain(
      'Detailed file contents for deep file',
    );

    const thirdInput = requests[2]?.input ?? [];
    expect(
      thirdInput.some(
        (item) =>
          item.type === 'function_call_output' &&
          item.output === 'Lookup summary: deep file',
      ),
    ).toBe(true);
    expect(
      thirdInput.some(
        (item) =>
          item.type === 'message' &&
          typeof item.content === 'string' &&
          item.content.includes('Detailed file contents for deep file'),
      ),
    ).toBe(false);
    expect(
      thirdInput.some(
        (item) =>
          item.type === 'message' &&
          typeof item.content === 'string' &&
          item.content.includes('Feedback: Need the final answer only.'),
      ),
    ).toBe(true);

    testDeps.inspector.assertConsumed();
  });

  test('preserves model tool-call order when tool executions resolve out of order', async () => {
    const slowTool = createAiTool<
      { reply: string },
      { label: string },
      { summary: string; details: string },
      {}
    >('slowLookup', {
      description: 'Returns a delayed result.',
      parameterSchema: {
        type: 'object',
        properties: { label: { type: 'string' } },
        required: ['label'],
        additionalProperties: false,
      },
      parseParameters: (raw) => parseSingleStringField(raw, 'label'),
      execute: async ({ label }) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          success: true as const,
          data: {
            summary: `Lookup summary: ${label}`,
            details: `Detailed file contents for ${label}`,
          },
        };
      },
      render: ({ summary, details }) => ({
        renderedOutput: summary,
        ephemeralOutput: details,
      }),
    });

    const fastTool = createAiTool<
      { reply: string },
      { label: string },
      { summary: string; details: string },
      {}
    >('fastLookup', {
      description: 'Returns a fast result.',
      parameterSchema: {
        type: 'object',
        properties: { label: { type: 'string' } },
        required: ['label'],
        additionalProperties: false,
      },
      parseParameters: (raw) => parseSingleStringField(raw, 'label'),
      execute: async ({ label }) => ({
        success: true as const,
        data: {
          summary: `Lookup summary: ${label}`,
          details: `Detailed file contents for ${label}`,
        },
      }),
      render: ({ summary, details }) => ({
        renderedOutput: summary,
        ephemeralOutput: details,
      }),
    });

    const stage = createAiTextStage<
      'talk',
      { reply: string },
      { slowLookup: typeof slowTool; fastLookup: typeof fastTool }
    >('talk', {
      model: 'gpt-5.2',
      tools: {
        slowLookup: slowTool,
        fastLookup: fastTool,
      },
      context: {},
      instructions: createAiPrompt<{ reply: string }>('instructions', {
        render: () => 'Use both tools before responding.',
      }),
      inputs: {},
    });

    const flow = createAiFlow<{ reply: string }, { talk: typeof stage }>(
      'test-tool-ordering',
      {
        stages: { talk: stage },
      },
    ).onStep('talk', async ({ step }) => {
      if (
        step.kind === 'reasoning' ||
        step.kind === 'chunk' ||
        step.kind === 'tool'
      ) {
        return step.next();
      }

      if (step.kind === 'text') {
        return step.output.accept((output, ctx) => ({
          ctx: { ...ctx, reply: output },
        }));
      }

      throw new Error('Unhandled step kind');
    });

    const scenario = createAiFlowScenario({
      stream: [
        {
          primitives: [
            {
              kind: 'tool_call',
              name: 'slowLookup',
              arguments: { label: 'slow' },
            },
            {
              kind: 'tool_call',
              name: 'fastLookup',
              arguments: { label: 'fast' },
            },
          ],
        },
        { primitives: [textPrimitive('ordered final answer')] },
      ],
    });

    const testDeps = createAiFlowTestDeps({
      logger: initLogger('ai-flow-testing-deps-tool-order-test'),
      scenario,
    });

    const result = await flow
      .start({
        flow: { reply: '' },
        firstStage: 'talk',
        deps: testDeps.deps,
      })
      .complete();

    expect(result.status).toBe('completed');
    expect(result.snapshot.flowContext.reply).toBe('ordered final answer');

    const requests = testDeps.inspector.streamRequests() as Array<{
      input?: Array<Record<string, unknown>>;
    }>;
    const secondInput = requests[1]?.input ?? [];
    const secondOutputs = secondInput
      .filter((item) => item.type === 'function_call_output')
      .map((item) => item.output);
    expect(secondOutputs).toEqual([
      'Lookup summary: slow',
      'Lookup summary: fast',
    ]);

    const ephemeralMessage = secondInput.find(
      (item) =>
        item.type === 'message' &&
        item.role === 'user' &&
        typeof item.content === 'string' &&
        item.content.includes('Immediate tool context for this turn only.'),
    ) as { content?: string } | undefined;
    expect(
      ephemeralMessage?.content?.indexOf('Detailed file contents for slow') ??
        -1,
    ).toBeLessThan(
      ephemeralMessage?.content?.indexOf('Detailed file contents for fast') ??
        -1,
    );

    testDeps.inspector.assertConsumed();
  });
});
