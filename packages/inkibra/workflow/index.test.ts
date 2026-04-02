import { describe, expect, test } from 'bun:test';
import {
  complete,
  defineWorkflow,
  event,
  failure,
  sleep,
  stage,
  waitFor,
  withCapture,
  workflow,
} from './index';
import type { Snapshot } from './types';

describe('@inkibra/workflow', () => {
  describe('defineWorkflow', () => {
    test('should create a workflow with stages', () => {
      const workflow = defineWorkflow<{ value: string }>('testWorkflow', {
        start: stage(async (input: { value: string }) => {
          return {
            snapshot: { value: input.value } as Snapshot<{ value: string }>,
            next: 'process',
          };
        }),

        process: stage(async (snap) => {
          return complete({ result: { processed: snap.value } });
        }),
      });

      expect(workflow.name).toBe('testWorkflow');
      expect(workflow.kind).toBe('stage');
      expect(workflow.version).toBe('1.0.0');
      expect(workflow.stages).toBeDefined();
      expect(workflow.stages.start).toBeDefined();
      expect(workflow.stages.process).toBeDefined();
    });

    test('should create a workflow with custom version', () => {
      const workflow = defineWorkflow<{ value: string }>(
        'testWorkflow',
        { version: '2.0.0' },
        {
          start: stage(async (input: { value: string }) => {
            return complete({ result: { value: input.value } });
          }),
        },
      );

      expect(workflow.version).toBe('2.0.0');
    });

    test('should create a workflow with events', () => {
      const workflow = defineWorkflow<{ id: string }>(
        'testWorkflow',
        {
          events: {
            testEvent: withCapture<Snapshot<{ id: string }>>(
              (snap) => `test:${snap.id}`,
            ),
          },
        },
        {
          start: stage(async (input: { id: string }) => {
            return complete({ result: { id: input.id } });
          }),
        },
      );

      const testEvent = workflow.events.testEvent;
      expect(testEvent).toBeDefined();
      if (!testEvent) {
        throw new Error('testEvent not defined');
      }
      expect(testEvent.capture).toBeDefined();
    });
  });

  describe('workflow', () => {
    test('should create a function workflow definition', () => {
      const fnWorkflow = workflow<
        { id: string },
        { paymentSettled: (snapshot: { id: string }) => string }
      >(
        {
          name: 'fnWorkflow',
          events: {
            paymentSettled: event<Snapshot<{ id: string }>>(
              (snap) => `payment:${snap.id}:settled`,
            ),
          },
        },
        async ({ input, step }) => {
          await step.run({ name: 'echo-input' }, async () => input);
          return { ok: true } as const;
        },
      );

      expect(fnWorkflow.kind).toBe('function');
      expect(fnWorkflow.name).toBe('fnWorkflow');
      expect(fnWorkflow.version).toBe('1.0.0');
      const events = fnWorkflow.events;
      expect(events).toBeDefined();
      if (!events) {
        throw new Error('events not defined');
      }
      expect(events.paymentSettled).toBeDefined();
      expect(typeof fnWorkflow.handler).toBe('function');
    });
  });

  describe('stage', () => {
    test('should create a stage definition', () => {
      const stageDef = stage(async (input: { value: string }) => {
        return complete({ result: { value: input.value } });
      });

      expect(stageDef.execute).toBeDefined();
      expect(typeof stageDef.execute).toBe('function');
    });
  });

  describe('sleep', () => {
    test('should create a sleep result with duration in milliseconds', () => {
      const result = sleep(5000, {
        snapshot: { value: 'test' } as Snapshot<{ value: string }>,
        next: 'nextStage',
      });

      expect(result.type).toBe('sleep');
      expect(result.duration).toBe(5000);
      expect(result.next).toBe('nextStage');
      expect(result.snapshot).toEqual({ value: 'test' });
    });

    test('should create a sleep result with duration string', () => {
      const result = sleep('7 days', {
        snapshot: { value: 'test' } as Snapshot<{ value: string }>,
        next: 'nextStage',
      });

      expect(result.type).toBe('sleep');
      expect(result.duration).toBe('7 days');
      expect(result.next).toBe('nextStage');
    });
  });

  describe('complete', () => {
    test('should create a complete result', () => {
      const result = complete({ result: { status: 'done', value: 42 } });

      expect(result.type).toBe('complete');
      expect(result.result).toEqual({ status: 'done', value: 42 });
    });
  });

  describe('failure', () => {
    test('should create a failure result without retry', () => {
      const result = failure({
        reason: 'Something went wrong',
        data: { error: 'details' },
      });

      expect(result.type).toBe('failure');
      expect(result.reason).toBe('Something went wrong');
      expect(result.data).toEqual({ error: 'details' });
      expect(result.retry).toBeUndefined();
    });

    test('should create a failure result with retry', () => {
      const result = failure({
        reason: 'Temporary failure',
        retry: { maxAttempts: 3, backoffMs: 1000 },
      });

      expect(result.type).toBe('failure');
      expect(result.retry).toEqual({ maxAttempts: 3, backoffMs: 1000 });
    });
  });

  describe('waitFor', () => {
    test('should create a waitFor result for single token', () => {
      const result = waitFor({
        token: 'test:123',
        snapshot: { id: '123' } as Snapshot<{ id: string }>,
      });

      expect(result.type).toBe('waitFor');
      expect(result.tokens).toEqual(['test:123']);
      expect(result.mode).toBe('any');
      expect(result.snapshot).toEqual({ id: '123' });
    });

    test('should create a waitFor result with timeout', () => {
      const timeout = sleep('1 hour', {
        snapshot: { id: '123' } as Snapshot<{ id: string }>,
        next: 'timeout',
      });

      const result = waitFor({
        token: 'test:123',
        snapshot: { id: '123' } as Snapshot<{ id: string }>,
        timeout,
      });

      expect(result.timeout).toEqual(timeout);
    });

    test('should create a waitFor.any result for multiple tokens', () => {
      const result = waitFor.any(['token1', 'token2', 'token3'], {
        snapshot: { id: '123' } as Snapshot<{ id: string }>,
      });

      expect(result.type).toBe('waitFor');
      expect(result.tokens).toEqual(['token1', 'token2', 'token3']);
      expect(result.mode).toBe('any');
    });

    test('should create a waitFor.all result for multiple tokens', () => {
      const result = waitFor.all(['token1', 'token2'], {
        snapshot: { id: '123' } as Snapshot<{ id: string }>,
      });

      expect(result.type).toBe('waitFor');
      expect(result.tokens).toEqual(['token1', 'token2']);
      expect(result.mode).toBe('all');
    });
  });

  describe('withCapture', () => {
    test('should create an event capture function', () => {
      const captureFunction = withCapture<Snapshot<{ userId: string }>>(
        (snap) => `user:${snap.userId}:event`,
      );

      expect(typeof captureFunction).toBe('function');

      const token = captureFunction({ userId: '123' });
      expect(token).toBe('user:123:event');
    });
  });

  describe('type safety', () => {
    test('snapshots should only allow JSON-serializable types', () => {
      // This is a compile-time test - if it compiles, the types are working
      type ValidSnapshot = Snapshot<{
        string: string;
        number: number;
        boolean: boolean;
        null: null;
        array: string[];
        object: { nested: number };
      }>;

      const valid: ValidSnapshot = {
        string: 'test',
        number: 42,
        boolean: true,
        null: null,
        array: ['a', 'b'],
        object: { nested: 123 },
      };

      expect(valid).toBeDefined();
    });
  });
});
