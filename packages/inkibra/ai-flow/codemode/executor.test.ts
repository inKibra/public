import { describe, expect, test } from 'bun:test';
import {
  type CodeFunction,
  type CodeFunctionValidation,
  codeFunction,
  executeCode,
} from './index';

// Helper to create a simple validator
function createValidator<T>(): (input: unknown) => CodeFunctionValidation<T> {
  return (input: unknown) => ({ success: true, data: input as T });
}

// Test deps type
type TestDeps = {
  db: { getUser: (id: string) => Promise<{ id: string; name: string }> };
  logger: { debug: (...args: unknown[]) => void };
};

// Test output type
type TestOutput = {
  user: { id: string; name: string } | null;
  processedAt: string | null;
};

describe('executeCode', () => {
  describe('basic execution', () => {
    test('executes simple code successfully', async () => {
      const result = await executeCode(
        `
          console.log('Hello from sandbox');
        `,
        { functions: {} },
        {},
        {},
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.logs).toContain('[LOG] Hello from sandbox');
        expect(result.duration).toBeGreaterThan(0);
      }
    });

    test('provides ctx to code', async () => {
      const result = await executeCode(
        `
          console.log('User ID:', ctx.userId);
        `,
        { functions: {} },
        { userId: 'user-123' },
        {},
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.logs).toContain('[LOG] User ID: user-123');
      }
    });

    test('ctx is writable', async () => {
      const result = await executeCode(
        `
          ctx.counter = ctx.counter + 10;
          console.log('Counter:', ctx.counter);
        `,
        { functions: {} },
        { counter: 5 },
        {},
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.ctx.counter).toBe(15);
        expect(result.logs).toContain('[LOG] Counter: 15');
      }
    });

    test('handles code errors', async () => {
      const result = await executeCode(
        `
          throw new Error('Test error');
        `,
        { functions: {} },
        {},
        {},
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('Test error');
      }
    });

    test('handles syntax errors', async () => {
      const result = await executeCode(
        `
          const x = {
        `, // Unclosed brace
        { functions: {} },
        {},
        {},
      );

      expect(result.success).toBe(false);
    });
  });

  describe('filesystem operations', () => {
    test('fs.write and fs.read work', async () => {
      const result = await executeCode(
        `
          await fs.write('/test.txt', 'Hello World');
          const content = await fs.read('/test.txt');
          console.log('Content:', content);
        `,
        { functions: {} },
        {},
        {},
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.files['/test.txt']).toBe('Hello World');
        expect(result.logs).toContain('[LOG] Content: Hello World');
      }
    });

    test('fs.exists works', async () => {
      const result = await executeCode(
        `
          const before = await fs.exists('/test.txt');
          await fs.write('/test.txt', 'data');
          const after = await fs.exists('/test.txt');
          console.log('Before:', before, 'After:', after);
        `,
        { functions: {} },
        {},
        {},
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.logs).toContain('[LOG] Before: false After: true');
      }
    });

    test('fs.list works', async () => {
      const result = await executeCode(
        `
          await fs.write('/data/file1.txt', 'a');
          await fs.write('/data/file2.txt', 'b');
          const files = await fs.list('/data');
          console.log('Files:', files.sort().join(', '));
        `,
        { functions: {} },
        {},
        {},
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.logs).toContain('[LOG] Files: file1.txt, file2.txt');
      }
    });

    test('mount pre-populates filesystem', async () => {
      const result = await executeCode(
        `
          const data = await fs.read('/input/config.json');
          console.log('Config:', data);
        `,
        {
          functions: {},
          mount: (ctx: { username: string }) => ({
            '/input/config.json': JSON.stringify({ user: ctx.username }),
          }),
        },
        { username: 'Alice' },
        {},
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.logs).toContain('[LOG] Config: {"user":"Alice"}');
      }
    });

    test('rejects relative paths', async () => {
      const result = await executeCode(
        `
          await fs.write('relative/path.txt', 'data');
        `,
        { functions: {} },
        {},
        {},
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('Path must be absolute');
      }
    });

    test('enforces file size limits', async () => {
      const result = await executeCode(
        `
          await fs.write('/large.txt', 'x'.repeat(200));
        `,
        {
          functions: {},
          sandbox: { maxFileSize: 100 },
        },
        {},
        {},
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('File too large');
      }
    });
  });

  describe('function calls', () => {
    test('calls function with validation', async () => {
      const fetchUser = codeFunction<
        { userId: string },
        { id: string; name: string }
      >({
        description: 'Fetches a user by ID',
        declaration:
          '(params: { userId: string }) => Promise<{ id: string; name: string }>',
        validate: (
          input: unknown,
        ): CodeFunctionValidation<{ userId: string }> => {
          const obj = input as { userId?: string };
          if (typeof obj?.userId === 'string') {
            return { success: true, data: { userId: obj.userId } };
          }
          return {
            success: false,
            errors: [
              { path: 'userId', expected: 'string', value: obj?.userId },
            ],
          };
        },
        fn: async ({ userId }) => ({ id: userId, name: `User ${userId}` }),
      });

      const result = await executeCode(
        `
          const user = await fetchUser({ userId: 'user-123' });
          console.log('User:', user.name);
        `,
        { functions: { fetchUser } },
        {},
        {},
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.logs).toContain('[LOG] User: User user-123');
        expect(result.calls.length).toBe(1);
        expect(result.calls[0]?.name).toBe('fetchUser');
        expect(result.calls[0]?.result).toEqual({
          id: 'user-123',
          name: 'User user-123',
        });
      }
    });

    test('validates function parameters', async () => {
      const strictFn = codeFunction<{ value: string }, void>({
        description: 'Requires a string value',
        validate: (
          input: unknown,
        ): CodeFunctionValidation<{ value: string }> => {
          const obj = input as { value?: unknown };
          if (typeof obj?.value === 'string') {
            return { success: true, data: { value: obj.value } };
          }
          return {
            success: false,
            errors: [{ path: 'value', expected: 'string', value: obj?.value }],
          };
        },
        fn: async () => {},
      });

      const result = await executeCode(
        `
          await strictFn({ value: 123 }); // Wrong type
        `,
        { functions: { strictFn } },
        {},
        {},
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('validation failed');
        expect(result.calls.length).toBe(1);
        expect(result.calls[0]?.error).toContain('validation failed');
      }
    });

    test('function receives FunctionContext with deps', async () => {
      let receivedDeps: TestDeps | undefined;

      const fetchUser: CodeFunction<
        { userId: string },
        { id: string; name: string },
        TestDeps
      > = {
        description: 'Fetches a user',
        declaration:
          '(params: { userId: string }) => Promise<{ id: string; name: string }>',
        validate: createValidator<{ userId: string }>(),
        fn: async ({ userId }, { deps }) => {
          receivedDeps = deps;
          return deps.db.getUser(userId);
        },
      };

      const mockDb = {
        getUser: async (id: string) => ({ id, name: 'Mock User' }),
      };
      const mockLogger = {
        debug: () => {},
      };

      const result = await executeCode(
        `
          const user = await fetchUser({ userId: 'user-123' });
          console.log('Got user:', user.name);
        `,
        { functions: { fetchUser } },
        {},
        { db: mockDb, logger: mockLogger },
      );

      expect(result.success).toBe(true);
      expect(receivedDeps).toBeDefined();
      expect(receivedDeps?.db).toBe(mockDb);
      expect(receivedDeps?.logger).toBe(mockLogger);
    });

    test('function receives FunctionContext with output accumulator', async () => {
      const commitUser: CodeFunction<
        { user: { id: string; name: string } },
        { saved: boolean },
        unknown
      > = {
        description: 'Commits a user to output',
        declaration:
          '(params: { user: { id: string; name: string } }) => Promise<{ saved: boolean }>',
        validate: createValidator<{ user: { id: string; name: string } }>(),
        fn: async ({ user }, { output }) => {
          // Cast to expected output type for this test
          const typedOutput = output as TestOutput;
          typedOutput.user = user;
          typedOutput.processedAt = new Date().toISOString();
          return { saved: true };
        },
      };

      const result = await executeCode<
        Record<string, unknown>,
        unknown,
        TestOutput,
        { commitUser: typeof commitUser }
      >(
        `
          const saved = await commitUser({ user: { id: 'u1', name: 'Alice' } });
          console.log('Saved:', saved.saved);
        `,
        {
          functions: { commitUser },
          output: () => ({ user: null, processedAt: null }),
        },
        {},
        {},
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.output.user).toEqual({ id: 'u1', name: 'Alice' });
        expect(result.output.processedAt).toBeTruthy();
      }
    });

    test('function receives FunctionContext with fs', async () => {
      let filesWritten = false;

      const saveToFile: CodeFunction<{ content: string }, void, unknown> = {
        description: 'Saves content to file',
        declaration: '(params: { content: string }) => Promise<void>',
        validate: createValidator<{ content: string }>(),
        fn: async ({ content }, { fs }) => {
          await fs.write('/function-output.txt', content);
          filesWritten = true;
        },
      };

      const result = await executeCode(
        `
          await saveToFile({ content: 'Written by function' });
        `,
        { functions: { saveToFile } },
        {},
        {},
      );

      expect(result.success).toBe(true);
      expect(filesWritten).toBe(true);
      if (result.success) {
        expect(result.files['/function-output.txt']).toBe(
          'Written by function',
        );
      }
    });

    test('function can modify ctx', async () => {
      const incrementCounter: CodeFunction<
        { amount: number },
        number,
        unknown
      > = {
        description: 'Increments counter in ctx',
        declaration: '(params: { amount: number }) => Promise<number>',
        validate: createValidator<{ amount: number }>(),
        fn: async ({ amount }, { ctx }) => {
          // Cast ctx to access counter property
          const typedCtx = ctx as { counter?: number };
          const current = typedCtx.counter || 0;
          typedCtx.counter = current + amount;
          return typedCtx.counter;
        },
      };

      const result = await executeCode(
        `
          const newValue = await incrementCounter({ amount: 5 });
          console.log('New counter:', newValue);
        `,
        { functions: { incrementCounter } },
        { counter: 10 },
        {},
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.ctx.counter).toBe(15);
        expect(result.logs).toContain('[LOG] New counter: 15');
      }
    });
  });

  describe('console logging', () => {
    test('captures console.log with prefix', async () => {
      const result = await executeCode(
        `console.log('Info message');`,
        { functions: {} },
        {},
        {},
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.logs).toContain('[LOG] Info message');
      }
    });

    test('captures console.warn with prefix', async () => {
      const result = await executeCode(
        `console.warn('Warning message');`,
        { functions: {} },
        {},
        {},
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.logs).toContain('[WARN] Warning message');
      }
    });

    test('captures console.error with prefix', async () => {
      const result = await executeCode(
        `console.error('Error message');`,
        { functions: {} },
        {},
        {},
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.logs).toContain('[ERROR] Error message');
      }
    });

    test('formats objects in console output', async () => {
      const result = await executeCode(
        `console.log('Object:', { foo: 'bar' });`,
        { functions: {} },
        {},
        {},
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.logs[0]).toContain('{"foo":"bar"}');
      }
    });
  });

  describe('error handling', () => {
    test('non-cloneable context returns helpful error', async () => {
      const result = await executeCode(
        `console.log('test');`,
        { functions: {} },
        { fn: () => {} } as Record<string, unknown>, // Functions can't be cloned
        {},
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('Context cannot be cloned');
      }
    });

    test('function throwing returns error with logs', async () => {
      const throwingFn = codeFunction({
        description: 'Throws an error',
        validate: createValidator<{}>(),
        fn: async () => {
          throw new Error('Function failed');
        },
      });

      const result = await executeCode(
        `
          console.log('Before call');
          await throwingFn({});
          console.log('After call'); // Should not reach here
        `,
        { functions: { throwingFn } },
        {},
        {},
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('Function failed');
        expect(result.logs).toContain('[LOG] Before call');
        expect(result.logs).not.toContain('[LOG] After call');
      }
    });
  });
});
