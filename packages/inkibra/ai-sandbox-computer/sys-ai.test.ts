import { describe, expect, test } from 'bun:test';
import { createAiSdk } from './sys-ai';

describe('sys/ai SDK', () => {
  test('throws without provider', async () => {
    const ai = createAiSdk();
    await expect(ai.generate('hello')).rejects.toThrow('no LLM provider');
  });

  test('generate calls provider', async () => {
    const ai = createAiSdk({
      provider: {
        generate: async ({ prompt }) => `Response to: ${prompt}`,
      },
    });
    const result = await ai.generate('test prompt');
    expect(result).toContain('test prompt');
  });

  test('extract parses JSON from provider', async () => {
    const ai = createAiSdk({
      provider: {
        generate: async () => '{"name": "John", "age": 30}',
      },
    });
    const result = await ai.extract<{ name: string; age: number }>(
      'John is 30',
      {
        type: 'object',
        properties: { name: { type: 'string' }, age: { type: 'number' } },
      },
    );
    expect(result.name).toBe('John');
    expect(result.age).toBe(30);
  });

  test('extract throws on invalid JSON', async () => {
    const ai = createAiSdk({
      provider: { generate: async () => 'not json' },
    });
    await expect(ai.extract('test', {})).rejects.toThrow('failed to parse');
  });

  test('search calls provider', async () => {
    const ai = createAiSdk({
      provider: {
        generate: async ({ prompt }) => `Research: ${prompt}`,
      },
    });
    const result = await ai.search('progressive overload');
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]!.snippet).toContain('progressive overload');
  });

  test('budget enforcement', async () => {
    const ai = createAiSdk({
      budgetPerImpulse: 100,
      provider: {
        generate: async () => 'ok',
      },
    });
    // First call should work (default 500 tokens estimated, but budget is 100)
    await expect(ai.generate('test')).rejects.toThrow('budget exceeded');
  });

  test('model preset resolution', async () => {
    let calledModel = '';
    const ai = createAiSdk({
      models: {
        fast: 'custom-fast',
        thinking: 'custom-think',
        default: 'custom-default',
      },
      provider: {
        generate: async ({ model }) => {
          calledModel = model;
          return 'ok';
        },
      },
    });
    await ai.generate('test', { model: 'fast' });
    expect(calledModel).toBe('custom-fast');
  });
});
