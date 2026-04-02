import { describe, expect, test } from 'bun:test';
import initLogger from '@inkibra/logger';
import { createChaosAiFlowDeps } from './chaos-ai-deps';

async function collectOutputText(stream: {
  [Symbol.asyncIterator]: () => AsyncIterator<{
    type: string;
    delta?: string;
  }>;
}): Promise<string> {
  let out = '';
  for await (const event of stream) {
    if (event.type === 'response.output_text.delta') {
      out += event.delta ?? '';
    }
  }
  return out;
}

describe('createChaosAiFlowDeps', () => {
  test('emits valid JSON for json_schema stream requests', async () => {
    const { deps } = createChaosAiFlowDeps({
      logger: initLogger('chaos-ai-deps-json-test'),
      seed: 123,
    });

    const stream = deps.openAI.responses.stream({
      text: {
        format: {
          type: 'json_schema',
          name: 'test_output',
          schema: {
            type: 'object',
            properties: {
              thinking: { type: 'string' },
              intent: { type: 'string' },
              urgency: {
                type: 'string',
                enum: ['none', 'defer', 'low', 'normal', 'urgent', 'now'],
              },
            },
            required: ['thinking', 'urgency'],
            additionalProperties: false,
          },
        },
      },
    });

    const outputText = await collectOutputText(stream);
    const parsed = JSON.parse(outputText) as {
      thinking: string;
      intent?: string;
      urgency: 'none' | 'defer' | 'low' | 'normal' | 'urgent' | 'now';
    };

    expect(typeof parsed.thinking).toBe('string');
    expect(parsed.urgency).toEqual(
      expect.stringMatching(/^(none|defer|low|normal|urgent|now)$/),
    );
    if (parsed.urgency === 'none') {
      expect(parsed.intent ?? '').toBe('');
    }
  });

  test('emits response-thread text for generation prompts', async () => {
    const { deps } = createChaosAiFlowDeps({
      logger: initLogger('chaos-ai-deps-text-test'),
      seed: 456,
    });

    const stream = deps.openAI.responses.stream({
      input: [
        {
          role: 'system',
          type: 'message',
          content: 'Generation Frame\nWrite as a short text-message thread.',
        },
      ],
      text: {
        format: {
          type: 'text',
        },
      },
    });

    const outputText = await collectOutputText(stream);

    expect(outputText).toContain('MESSAGE 1:');
    expect(outputText).toContain('MESSAGE 2:');
  });
});
