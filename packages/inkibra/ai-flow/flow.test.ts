import { describe, expect, test } from 'bun:test';
import type { Logger } from '@inkibra/logger';
import { stub } from '@inkibra/test-support/stub';
import type OpenAI from 'openai';
import {
  createAiContext,
  createAiFlow,
  createAiInput,
  createAiOutput,
  createAiOutputStage,
  createAiPrompt,
  createAiTextStage,
  createAiTool,
  type Validation,
} from './flow';

// Simple test types
type TestContext = {
  message: string;
  result: TestOutput | null;
};

type TestOutput = {
  length: number;
};

describe('ai-flow', () => {
  describe('createAiTool', () => {
    test('creates a tool with correct properties', () => {
      const tool = createAiTool<{}, { value: string }, { result: number }, {}>(
        'test-tool',
        {
          description: 'A test tool',
          parameterSchema: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
          },
          parseParameters: (args: string): Validation<{ value: string }> => {
            const parsed = JSON.parse(args);
            return { success: true, data: parsed };
          },
          execute: async (params) => {
            return { success: true, data: { result: params.value.length } };
          },
          render: (data) => `Result: ${data.result}`,
        },
      );

      expect(tool.name).toBe('test-tool');
      expect(tool.description).toBe('A test tool');
      expect(tool.parameterSchema).toBeDefined();
    });

    test('executes tool correctly', async () => {
      const tool = createAiTool<{}, { value: string }, { result: number }, {}>(
        'test-tool',
        {
          description: 'A test tool',
          parameterSchema: {},
          parseParameters: (args: string): Validation<{ value: string }> => {
            const parsed = JSON.parse(args);
            return { success: true, data: parsed };
          },
          execute: async (params) => {
            return { success: true, data: { result: params.value.length } };
          },
          render: (data) => `Result: ${data.result}`,
        },
      );

      const result = await tool.execute({ value: 'hello' }, {}, {});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.result).toBe(5);
      }
    });
  });

  describe('createAiInput', () => {
    test('creates an input with correct properties', () => {
      const input = createAiInput<TestContext>('test-input', {
        render: (ctx) => [
          { role: 'user', type: 'message', content: ctx.message },
        ],
      });

      expect(input.key).toBe('test-input');
      expect(input.render).toBeDefined();
    });

    test('renders messages correctly', async () => {
      const input = createAiInput<TestContext>('test-input', {
        render: (ctx) => [
          { role: 'user', type: 'message', content: ctx.message },
        ],
      });

      const messages = await input.render({ message: 'Hello', result: null });
      expect(messages).toHaveLength(1);
      expect(messages[0]?.content).toBe('Hello');
    });
  });

  describe('createAiContext', () => {
    test('creates context with correct properties', () => {
      const context = createAiContext<TestContext>('test-context', {
        render: (ctx) => `Message: ${ctx.message}`,
      });

      expect(context.key).toBe('test-context');
      expect(context.render).toBeDefined();
    });

    test('renders context correctly', async () => {
      const context = createAiContext<TestContext>('test-context', {
        render: (ctx) => `Message: ${ctx.message}`,
      });

      const rendered = await context.render({ message: 'Hello', result: null });
      expect(rendered).toBe('Message: Hello');
    });
  });

  describe('createAiPrompt', () => {
    test('creates prompt with correct properties', () => {
      const prompt = createAiPrompt<TestContext>('test-prompt', {
        render: () => 'Test instructions',
      });

      expect(prompt.key).toBe('test-prompt');
      expect(prompt.render).toBeDefined();
    });
  });

  describe('createAiOutput', () => {
    test('creates output with correct properties', () => {
      const output = createAiOutput<'result', TestContext, TestOutput>(
        'result',
        {
          schema: {
            type: 'object',
            properties: { length: { type: 'number' } },
            required: ['length'],
          },
          validate: (raw: string): Validation<TestOutput> => {
            const parsed = JSON.parse(raw);
            return { success: true, data: parsed };
          },
          render: (_ctx, data) => `Length: ${data?.length}`,
        },
      );

      expect(output.key).toBe('result');
      expect(output.schema).toBeDefined();
      expect(output.validate).toBeDefined();
    });

    test('validates output correctly', () => {
      const output = createAiOutput<'result', TestContext, TestOutput>(
        'result',
        {
          schema: {},
          validate: (raw: string): Validation<TestOutput> => {
            const parsed = JSON.parse(raw);
            return { success: true, data: parsed };
          },
          render: () => '',
        },
      );

      const result = output.validate('{"length": 5}');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBe(5);
      }
    });
  });

  describe('createAiFlow', () => {
    test('creates a flow with stages', () => {
      const output = createAiOutput<'result', TestContext, TestOutput>(
        'result',
        {
          schema: {},
          validate: (raw: string): Validation<TestOutput> => ({
            success: true,
            data: JSON.parse(raw),
          }),
          render: () => '',
        },
      );

      const stage = createAiOutputStage<
        'test',
        TestContext,
        {},
        TestOutput,
        'result',
        {}
      >('test', {
        model: 'test-model',
        maxSteps: 10,
        tools: {},
        context: {},
        instructions: createAiPrompt<TestContext>('instructions', {
          render: () => 'Test',
        }),
        inputs: {},
        output,
        storage: () => ({}),
      });

      const flow = createAiFlow<TestContext, { test: typeof stage }>(
        'test-flow',
        {
          stages: { test: stage },
        },
      );

      expect(flow.onStep).toBeDefined();
      expect(flow.start).toBeDefined();
      expect(flow.resume).toBeDefined();
    });

    test('throws when stage defines execute tool with codeExecution enabled', async () => {
      const output = createAiOutput<'result', TestContext, TestOutput>(
        'result',
        {
          schema: {},
          validate: (raw: string): Validation<TestOutput> => ({
            success: true,
            data: JSON.parse(raw),
          }),
          render: () => '',
        },
      );

      const executeTool = createAiTool<
        TestContext,
        { value: string },
        { ok: boolean },
        {}
      >('execute', {
        description: 'Conflicting execute tool',
        parameterSchema: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
          additionalProperties: false,
        },
        parseParameters: (args: string): Validation<{ value: string }> => {
          const parsed = JSON.parse(args);
          return { success: true, data: parsed };
        },
        execute: async () => ({ success: true, data: { ok: true } }),
        render: () => 'ok',
      });

      const stage = createAiOutputStage<
        'test',
        TestContext,
        {},
        TestOutput,
        'result',
        { execute: typeof executeTool }
      >('test', {
        model: 'test-model',
        maxSteps: 10,
        tools: { execute: executeTool },
        context: {},
        instructions: createAiPrompt<TestContext>('instructions', {
          render: () => 'Test',
        }),
        inputs: {},
        output,
        storage: () => ({}),
        codeExecution: {
          functions: {},
          mount: () => ({}),
          output: () => ({}),
        },
      });

      const flow = createAiFlow<TestContext, { test: typeof stage }>(
        'test-flow',
        {
          stages: { test: stage },
        },
      ).onStep('test', async ({ step }) => {
        if (step.kind === 'reasoning') return step.next();
        if (step.kind === 'tool') return step.next();
        return step.to('test');
      });

      const run = flow.start({
        flow: { message: 'Hello', result: null },
        firstStage: 'test',
        deps: {
          openAI: stub<OpenAI>(),
          logger: stub<Logger>(),
        },
      });

      await expect(run.step()).rejects.toThrow(
        'defines a tool named "execute" while codeExecution is enabled',
      );
    });

    test('throws for text stage when execute tool conflicts with codeExecution', async () => {
      const executeTool = createAiTool<
        TestContext,
        { value: string },
        { ok: boolean },
        {}
      >('execute', {
        description: 'Conflicting execute tool',
        parameterSchema: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
          additionalProperties: false,
        },
        parseParameters: (args: string): Validation<{ value: string }> => {
          const parsed = JSON.parse(args);
          return { success: true, data: parsed };
        },
        execute: async () => ({ success: true, data: { ok: true } }),
        render: () => 'ok',
      });

      const stage = createAiTextStage<
        'text',
        TestContext,
        { execute: typeof executeTool }
      >('text', {
        model: 'test-model',
        tools: { execute: executeTool },
        context: {},
        instructions: createAiPrompt<TestContext>('instructions', {
          render: () => 'Test',
        }),
        inputs: {},
        codeExecution: {
          functions: {},
          mount: () => ({}),
          output: () => ({}),
        },
      });

      const flow = createAiFlow<TestContext, { text: typeof stage }>(
        'test-flow',
        {
          stages: { text: stage },
        },
      ).onStep('text', async ({ step }) => {
        if (step.kind === 'reasoning') return step.next();
        if (step.kind === 'tool') return step.next();
        return step.to('text');
      });

      const run = flow.start({
        flow: { message: 'Hello', result: null },
        firstStage: 'text',
        deps: {
          openAI: stub<OpenAI>(),
          logger: stub<Logger>(),
        },
      });

      await expect(run.step()).rejects.toThrow(
        'defines a tool named "execute" while codeExecution is enabled',
      );
    });
  });

  describe('createAiTextStage', () => {
    test('creates a text stage', () => {
      const stage = createAiTextStage<'text', TestContext>('text', {
        model: 'test-model',
        context: {},
        instructions: createAiPrompt<TestContext>('instructions', {
          render: () => 'Test',
        }),
        inputs: {},
      });

      expect(stage.kind).toBe('text-stream');
      expect(stage.name).toBe('text');
      expect(stage.model).toBe('test-model');
    });
  });

  describe('createAiOutputStage', () => {
    test('creates an output stage', () => {
      const output = createAiOutput<'result', TestContext, TestOutput>(
        'result',
        {
          schema: {},
          validate: (raw: string): Validation<TestOutput> => ({
            success: true,
            data: JSON.parse(raw),
          }),
          render: () => '',
        },
      );

      const stage = createAiOutputStage<
        'output',
        TestContext,
        {},
        TestOutput,
        'result',
        {}
      >('output', {
        model: 'test-model',
        maxSteps: 10,
        tools: {},
        context: {},
        instructions: createAiPrompt<TestContext>('instructions', {
          render: () => 'Test',
        }),
        inputs: {},
        output,
        storage: () => ({}),
      });

      expect(stage.kind).toBe('output');
      expect(stage.name).toBe('output');
      expect(stage.model).toBe('test-model');
      expect(stage.maxSteps).toBe(10);
    });
  });
});
