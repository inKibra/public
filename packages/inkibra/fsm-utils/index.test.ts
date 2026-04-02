import { describe, expect, test } from 'bun:test';
import type { ErrorDescriptor } from '@inkibra/error-base';
import { err, ok } from 'neverthrow';
import { createUtil } from './index';

// -------------------------------------------------------------------------------------
// Test Types and Data Structures
// -------------------------------------------------------------------------------------

type CounterData = {
  count: number;
  name: string;
};

type CounterCreateData = {
  initialCount?: number;
  name: string;
};

type CounterValidationError = ErrorDescriptor<
  'INVALID_COUNTER',
  'Counter value is invalid',
  { value: number }
>;

type CounterCreateError = ErrorDescriptor<
  'INVALID_NAME',
  'Name cannot be empty',
  {}
>;

// -------------------------------------------------------------------------------------
// createUtil Tests
// -------------------------------------------------------------------------------------

describe('createUtil', () => {
  const counterUtil = createUtil<
    CounterData,
    CounterCreateData,
    CounterCreateError,
    CounterValidationError,
    { maxValue: number }
  >({
    options: { maxValue: 100 },
    is: (data: unknown): data is CounterData => {
      return (
        typeof data === 'object' &&
        data !== null &&
        'count' in data &&
        'name' in data &&
        typeof (data as CounterData).count === 'number' &&
        typeof (data as CounterData).name === 'string'
      );
    },
    validate: (_prev, next) => {
      if (next.count < 0) {
        return err({
          code: 'INVALID_COUNTER',
          message: 'Counter value is invalid',
          data: { value: next.count },
        });
      }
      if (next.count > 100) {
        return err({
          code: 'INVALID_COUNTER',
          message: 'Counter value is invalid',
          data: { value: next.count },
        });
      }
      return ok(true);
    },
    fromCreateData: (data) => {
      if (!data.name || data.name.trim() === '') {
        return err({
          code: 'INVALID_NAME',
          message: 'Name cannot be empty',
          data: {},
        });
      }
      return ok({
        count: data.initialCount ?? 0,
        name: data.name,
      });
    },
  });

  // Helper to assert create exists (it does because we provided fromCreateData)
  const create = counterUtil.create!;

  test('createUtil returns correct structure', () => {
    expect(counterUtil).toHaveProperty('options');
    expect(counterUtil.options).toEqual({ maxValue: 100 });
    expect(counterUtil).toHaveProperty('is');
    expect(counterUtil).toHaveProperty('validate');
    expect(counterUtil).toHaveProperty('create');
    expect(counterUtil).toHaveProperty('makeInstructionHandler');
    expect(counterUtil).toHaveProperty('makeView');
    expect(counterUtil).toHaveProperty('createJournal');
    expect(counterUtil).toHaveProperty('applyModifications');
  });

  test('is validates correct data', () => {
    const validData: CounterData = { count: 5, name: 'test' };
    expect(counterUtil.is(validData)).toBe(true);
  });

  test('is rejects invalid data', () => {
    expect(counterUtil.is({ count: 5 })).toBe(false);
    expect(counterUtil.is({ name: 'test' })).toBe(false);
    expect(counterUtil.is(null)).toBe(false);
    expect(counterUtil.is(undefined)).toBe(false);
    expect(counterUtil.is('string')).toBe(false);
  });

  test('validate accepts valid state transition', () => {
    const prev: CounterData = { count: 5, name: 'test' };
    const next: CounterData = { count: 10, name: 'test' };
    const result = counterUtil.validate(prev, next);
    expect(result.isOk()).toBe(true);
  });

  test('validate rejects negative values', () => {
    const prev: CounterData = { count: 5, name: 'test' };
    const next: CounterData = { count: -1, name: 'test' };
    const result = counterUtil.validate(prev, next);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('INVALID_COUNTER');
      if ('value' in result.error.data) {
        expect(result.error.data.value).toBe(-1);
      }
    }
  });

  test('validate rejects values exceeding max', () => {
    const prev: CounterData = { count: 5, name: 'test' };
    const next: CounterData = { count: 101, name: 'test' };
    const result = counterUtil.validate(prev, next);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('INVALID_COUNTER');
      if ('value' in result.error.data) {
        expect(result.error.data.value).toBe(101);
      }
    }
  });

  test('create generates valid data from create data', () => {
    const result = create({ name: 'test-counter' });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.name).toBe('test-counter');
      expect(result.value.count).toBe(0);
    }
  });

  test('create uses initialCount when provided', () => {
    const result = create({
      name: 'test-counter',
      initialCount: 10,
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.count).toBe(10);
    }
  });

  test('create rejects empty name', () => {
    const result = create({ name: '' });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('INVALID_NAME');
    }
  });

  test('create validates result data', () => {
    const result = create({ name: 'test', initialCount: 101 });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('INVALID_COUNTER');
    }
  });
});

// -------------------------------------------------------------------------------------
// makeInstructionHandler Tests
// -------------------------------------------------------------------------------------

describe('makeInstructionHandler', () => {
  const counterUtil = createUtil<
    CounterData,
    CounterCreateData,
    CounterCreateError,
    CounterValidationError,
    { maxValue: number }
  >({
    options: { maxValue: 100 },
    is: (data: unknown): data is CounterData => {
      return (
        typeof data === 'object' &&
        data !== null &&
        'count' in data &&
        'name' in data &&
        typeof (data as CounterData).count === 'number' &&
        typeof (data as CounterData).name === 'string'
      );
    },
    validate: (_prev, next) => {
      if (next.count < 0 || next.count > 100) {
        return err({
          code: 'INVALID_COUNTER',
          message: 'Counter value is invalid',
          data: { value: next.count },
        });
      }
      return ok(true);
    },
  });

  const incrementHandler = counterUtil.makeInstructionHandler<{
    amount: number;
  }>('increment', (data, params) => {
    return ok({ ...data, count: data.count + params.amount });
  });

  test('instruction handler successfully modifies data', () => {
    const data: CounterData = { count: 5, name: 'test' };
    const result = incrementHandler(data, { amount: 3 });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.count).toBe(8);
    }
  });

  test('instruction handler validates result', () => {
    const data: CounterData = { count: 5, name: 'test' };
    const result = incrementHandler(data, { amount: 100 });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect((result.error as any).code).toBe('INVALID_COUNTER');
    }
  });
});

// -------------------------------------------------------------------------------------
// makeView Tests
// -------------------------------------------------------------------------------------

describe('makeView', () => {
  const counterUtil = createUtil<
    CounterData,
    CounterCreateData,
    CounterCreateError,
    CounterValidationError,
    { maxValue: number }
  >({
    options: { maxValue: 100 },
    is: (data: unknown): data is CounterData => {
      return (
        typeof data === 'object' &&
        data !== null &&
        'count' in data &&
        'name' in data &&
        typeof (data as CounterData).count === 'number' &&
        typeof (data as CounterData).name === 'string'
      );
    },
    validate: (_prev, _next) => {
      return ok(true);
    },
  });

  const getDoubleView = counterUtil.makeView<
    {},
    undefined,
    { doubledCount: number }
  >('getDouble', (data, _params) => {
    return ok({ doubledCount: data.count * 2 });
  });

  test('view returns transformed data', () => {
    const data: CounterData = { count: 5, name: 'test' };
    const result = getDoubleView(data, {});
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.doubledCount).toBe(10);
    }
  });

  test('view does not mutate original data', () => {
    const data: CounterData = { count: 5, name: 'test' };
    const originalCount = data.count;
    getDoubleView(data, {}); // Call view but don't need result
    expect(data.count).toBe(originalCount);
  });

  test('view validates input data', () => {
    const invalidData = { count: 'invalid' } as unknown as CounterData;
    const result = getDoubleView(invalidData, {});
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('UNHANDLED_VALIDATION_FAILURE');
    }
  });
});

// -------------------------------------------------------------------------------------
// createJournal Tests
// -------------------------------------------------------------------------------------

describe('createJournal', () => {
  const counterUtil = createUtil<
    CounterData,
    CounterCreateData,
    CounterCreateError,
    CounterValidationError,
    { maxValue: number }
  >({
    options: { maxValue: 100 },
    is: (data: unknown): data is CounterData => {
      return (
        typeof data === 'object' &&
        data !== null &&
        'count' in data &&
        'name' in data &&
        typeof (data as CounterData).count === 'number' &&
        typeof (data as CounterData).name === 'string'
      );
    },
    validate: (_prev, next) => {
      if (next.count < 0 || next.count > 100) {
        return err({
          code: 'INVALID_COUNTER',
          message: 'Counter value is invalid',
          data: { value: next.count },
        });
      }
      return ok(true);
    },
  });

  const handlers = {
    increment: (data: Readonly<CounterData>, params: { amount: number }) => {
      return ok({ ...data, count: data.count + params.amount });
    },
    decrement: (data: Readonly<CounterData>, params: { amount: number }) => {
      return ok({ ...data, count: data.count - params.amount });
    },
    setName: (data: Readonly<CounterData>, params: { name: string }) => {
      return ok({ ...data, name: params.name });
    },
  };

  test('journal records instructions', () => {
    const journal = counterUtil.createJournal(handlers);
    let data: CounterData = { count: 0, name: 'test' };

    const result1 = journal.increment(data, { amount: 5 });
    expect(result1.isOk()).toBe(true);
    if (result1.isOk()) {
      data = result1.value;
    }

    const result2 = journal.increment(data, { amount: 3 });
    expect(result2.isOk()).toBe(true);

    const instructions = journal.getInstructions();
    expect(instructions.length).toBe(2);
    expect(instructions[0]?.method).toBe('increment');
    expect(instructions[0]?.params).toEqual({ amount: 5 });
    expect(instructions[1]?.method).toBe('increment');
    expect(instructions[1]?.params).toEqual({ amount: 3 });
  });

  test('journal validates handler results', () => {
    const journal = counterUtil.createJournal(handlers);
    const data: CounterData = { count: 50, name: 'test' };

    const result = journal.increment(data, { amount: 60 });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect((result.error as any).code).toBe('INVALID_COUNTER');
    }
  });

  test('journal has access to utility methods', () => {
    const journal = counterUtil.createJournal(handlers);
    expect(journal).toHaveProperty('options');
    expect(journal).toHaveProperty('is');
    expect(journal).toHaveProperty('validate');
    expect(journal).toHaveProperty('getInstructions');
  });

  test('journal instructions are cloned (not referenced)', () => {
    const journal = counterUtil.createJournal(handlers);
    const data: CounterData = { count: 0, name: 'test' };
    const params = { amount: 5 };

    journal.increment(data, params);
    params.amount = 100; // Mutate the original params

    const instructions = journal.getInstructions();
    expect(instructions[0]?.params).toEqual({ amount: 5 }); // Should still be 5
  });

  test('getInstructions returns independent array snapshot', () => {
    const journal = counterUtil.createJournal(handlers);
    const data: CounterData = { count: 0, name: 'test' };

    journal.increment(data, { amount: 5 });
    const snapshot1 = journal.getInstructions();
    expect(snapshot1.length).toBe(1);

    journal.increment(data, { amount: 3 });
    expect(snapshot1.length).toBe(1); // Snapshot should be unchanged
    expect(journal.getInstructions().length).toBe(2); // Current state should be updated

    journal.clearInstructions();
    expect(snapshot1.length).toBe(1); // Snapshot should still be intact
    expect(journal.getInstructions().length).toBe(0); // Current state should be cleared
  });

  test('journal propagates handler error and does not record instruction', () => {
    const journal = counterUtil.createJournal({
      fail: (_data: Readonly<CounterData>, params: { reason: string }) => {
        return err({
          code: 'FAIL',
          message: 'Forced failure',
          data: { reason: params.reason },
        });
      },
    });
    const data: CounterData = { count: 0, name: 'test' };

    const result = journal.fail(data, { reason: 'boom' });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('FAIL');
      expect(result.error.data).toEqual({ reason: 'boom' });
    }
    expect(journal.getInstructions().length).toBe(0);
  });

  test('journal validates next-state shape before recording', () => {
    const journal = counterUtil.createJournal({
      corrupt: (data: Readonly<CounterData>, _params: {}) => {
        return ok({ ...data, count: 'invalid' as unknown as number });
      },
    });
    const data: CounterData = { count: 1, name: 'test' };

    const result = journal.corrupt(data, {});
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('UNHANDLED_VALIDATION_FAILURE');
      expect(result.error.data.context).toBe('journal:validate');
      expect(result.error.data.receivedType).toBe('object');
    }
    expect(journal.getInstructions().length).toBe(0);
  });
});

// -------------------------------------------------------------------------------------
// applyModifications Tests
// -------------------------------------------------------------------------------------

describe('applyModifications', () => {
  const counterUtil = createUtil<
    CounterData,
    CounterCreateData,
    CounterCreateError,
    CounterValidationError,
    { maxValue: number }
  >({
    options: { maxValue: 100 },
    is: (data: unknown): data is CounterData => {
      return (
        typeof data === 'object' &&
        data !== null &&
        'count' in data &&
        'name' in data &&
        typeof (data as CounterData).count === 'number' &&
        typeof (data as CounterData).name === 'string'
      );
    },
    validate: (_prev, next) => {
      if (next.count < 0 || next.count > 100) {
        return err({
          code: 'INVALID_COUNTER',
          message: 'Counter value is invalid',
          data: { value: next.count },
        });
      }
      return ok(true);
    },
  });

  const handlers = {
    increment: (data: Readonly<CounterData>, params: { amount: number }) => {
      return ok({ ...data, count: data.count + params.amount });
    },
    decrement: (data: Readonly<CounterData>, params: { amount: number }) => {
      return ok({ ...data, count: data.count - params.amount });
    },
  };

  test('applyModifications applies all instructions in sequence', () => {
    const startData: CounterData = { count: 10, name: 'test' };
    const instructions = [
      { method: 'increment' as const, params: { amount: 5 } },
      { method: 'increment' as const, params: { amount: 3 } },
      { method: 'decrement' as const, params: { amount: 2 } },
    ];

    const result = counterUtil.applyModifications(
      startData,
      instructions,
      handlers,
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.count).toBe(16); // 10 + 5 + 3 - 2
    }
  });

  test('applyModifications errors on unknown instruction method', () => {
    const startData: CounterData = { count: 10, name: 'test' };
    let incrementCalled = false;
    const handlersWithSpy = {
      increment: (data: Readonly<CounterData>, params: { amount: number }) => {
        incrementCalled = true;
        return ok({ ...data, count: data.count + params.amount });
      },
    };
    const instructions = [
      { method: 'unknown', params: { amount: 1 } },
      { method: 'increment', params: { amount: 2 } },
    ] as unknown as { method: 'increment'; params: { amount: number } }[];

    const result = counterUtil.applyModifications(
      startData,
      instructions,
      handlersWithSpy,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('UNKNOWN_INSTRUCTION_METHOD');
      expect(result.error.data).toEqual({ method: 'unknown', index: 0 });
    }
    expect(incrementCalled).toBe(false);
  });

  test('applyModifications passes instruction context to handlers', () => {
    const startData: CounterData = { count: 0, name: 'base' };
    const instructions = [
      {
        method: 'setName' as const,
        params: { name: 'counter' },
        ctx: { suffix: '-ctx' },
      },
    ];
    const handlersWithCtx = {
      setName: (
        data: Readonly<CounterData>,
        params: { name: string },
        ctx?: { suffix: string },
      ) => {
        return ok({
          ...data,
          name: `${params.name}${ctx?.suffix ?? ''}`,
        });
      },
    };

    const result = counterUtil.applyModifications(
      startData,
      instructions,
      handlersWithCtx,
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.name).toBe('counter-ctx');
    }
  });

  test('applyModifications stops on first error', () => {
    const startData: CounterData = { count: 10, name: 'test' };
    const instructions = [
      { method: 'increment' as const, params: { amount: 5 } },
      { method: 'increment' as const, params: { amount: 100 } }, // This will fail validation
      { method: 'decrement' as const, params: { amount: 2 } },
    ];

    const result = counterUtil.applyModifications(
      startData,
      instructions,
      handlers,
    );

    expect(result.isErr()).toBe(true);
  });

  test('applyModifications stops on handler error', () => {
    const startData: CounterData = { count: 10, name: 'test' };
    let decrementCalled = false;
    const handlersWithError = {
      increment: (data: Readonly<CounterData>, params: { amount: number }) => {
        return ok({ ...data, count: data.count + params.amount });
      },
      fail: (_data: Readonly<CounterData>, params: { reason: string }) => {
        return err({
          code: 'FAIL',
          message: 'Forced failure',
          data: { reason: params.reason },
        });
      },
      decrement: (data: Readonly<CounterData>, params: { amount: number }) => {
        decrementCalled = true;
        return ok({ ...data, count: data.count - params.amount });
      },
    };
    const instructions = [
      { method: 'increment' as const, params: { amount: 5 } },
      { method: 'fail' as const, params: { reason: 'boom' } },
      { method: 'decrement' as const, params: { amount: 2 } },
    ];

    const result = counterUtil.applyModifications(
      startData,
      instructions,
      handlersWithError,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('FAIL');
    }
    expect(decrementCalled).toBe(false);
  });

  test('applyModifications works with empty instruction list', () => {
    const startData: CounterData = { count: 10, name: 'test' };
    const instructions: {
      method: 'increment' | 'decrement';
      params: { amount: number };
    }[] = [];

    const result = counterUtil.applyModifications(
      startData,
      instructions,
      handlers,
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.count).toBe(10); // Unchanged
    }
  });

  test('applyModifications validates starting data before replay', () => {
    const startData: CounterData = { count: 200, name: 'test' };
    const instructions: {
      method: 'increment' | 'decrement';
      params: { amount: number };
    }[] = [];

    const result = counterUtil.applyModifications(
      startData,
      instructions,
      handlers,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('INVALID_COUNTER');
      expect(result.error.data).toEqual({ value: 200 });
    }
  });
});

// -------------------------------------------------------------------------------------
// Integration Tests
// -------------------------------------------------------------------------------------

describe('integration: journal recording and replay', () => {
  const counterUtil = createUtil<
    CounterData,
    CounterCreateData,
    CounterCreateError,
    CounterValidationError,
    { maxValue: number }
  >({
    options: { maxValue: 100 },
    is: (data: unknown): data is CounterData => {
      return (
        typeof data === 'object' &&
        data !== null &&
        'count' in data &&
        'name' in data &&
        typeof (data as CounterData).count === 'number' &&
        typeof (data as CounterData).name === 'string'
      );
    },
    validate: (_prev, next) => {
      if (next.count < 0 || next.count > 100) {
        return err({
          code: 'INVALID_COUNTER',
          message: 'Counter value is invalid',
          data: { value: next.count },
        });
      }
      return ok(true);
    },
    fromCreateData: (data) => {
      if (!data.name || data.name.trim() === '') {
        return err({
          code: 'INVALID_NAME',
          message: 'Name cannot be empty',
          data: {},
        });
      }
      return ok({
        count: data.initialCount ?? 0,
        name: data.name,
      });
    },
  });

  // Helper to assert create exists
  const create = counterUtil.create!;

  const handlers = {
    increment: (data: Readonly<CounterData>, params: { amount: number }) => {
      return ok({ ...data, count: data.count + params.amount });
    },
    decrement: (data: Readonly<CounterData>, params: { amount: number }) => {
      return ok({ ...data, count: data.count - params.amount });
    },
    setName: (data: Readonly<CounterData>, params: { name: string }) => {
      return ok({ ...data, name: params.name });
    },
  };

  test('full workflow: create, journal operations, replay', () => {
    // 1. Create initial data
    const createResult = create({
      name: 'my-counter',
      initialCount: 5,
    });
    expect(createResult.isOk()).toBe(true);
    if (createResult.isErr()) return;

    let data = createResult.value;

    // 2. Start journal and perform operations
    const journal = counterUtil.createJournal(handlers);

    const result1 = journal.increment(data, { amount: 10 });
    expect(result1.isOk()).toBe(true);
    if (result1.isOk()) data = result1.value;

    const result2 = journal.decrement(data, { amount: 3 });
    expect(result2.isOk()).toBe(true);
    if (result2.isOk()) data = result2.value;

    const result3 = journal.setName(data, { name: 'updated-counter' });
    expect(result3.isOk()).toBe(true);
    if (result3.isOk()) data = result3.value;

    expect(data.count).toBe(12); // 5 + 10 - 3
    expect(data.name).toBe('updated-counter');

    // 3. Get recorded instructions
    const instructions = journal.getInstructions();
    expect(instructions.length).toBe(3);

    // 4. Replay instructions from scratch
    const replayResult = counterUtil.applyModifications(
      createResult.value,
      instructions,
      handlers,
    );

    expect(replayResult.isOk()).toBe(true);
    if (replayResult.isOk()) {
      expect(replayResult.value.count).toBe(12);
      expect(replayResult.value.name).toBe('updated-counter');
    }
  });
});

// -------------------------------------------------------------------------------------
// New Test Cases: Context Parameter
// -------------------------------------------------------------------------------------

describe('context parameter in instructions', () => {
  type UserContext = { userId: string; timestamp: number };

  const counterUtil = createUtil<
    CounterData,
    CounterCreateData,
    CounterCreateError,
    CounterValidationError,
    { maxValue: number }
  >({
    options: { maxValue: 100 },
    is: (data: unknown): data is CounterData => {
      return (
        typeof data === 'object' &&
        data !== null &&
        'count' in data &&
        'name' in data &&
        typeof (data as CounterData).count === 'number' &&
        typeof (data as CounterData).name === 'string'
      );
    },
    validate: (_prev, next) => {
      if (next.count < 0 || next.count > 100) {
        return err({
          code: 'INVALID_COUNTER',
          message: 'Counter value is invalid',
          data: { value: next.count },
        });
      }
      return ok(true);
    },
  });

  const handlers = {
    incrementWithContext: (
      data: Readonly<CounterData>,
      params: { amount: number },
      ctx?: UserContext,
    ) => {
      // Context is available for logging/auditing
      if (ctx) {
        // In real code, you might log ctx.userId, ctx.timestamp
      }
      return ok({ ...data, count: data.count + params.amount });
    },
  };

  test('instructions record context', () => {
    const journal = counterUtil.createJournal(handlers);
    const data: CounterData = { count: 0, name: 'test' };

    journal.incrementWithContext(
      data,
      { amount: 5 },
      { userId: 'alice', timestamp: 123456 },
    );

    const instructions = journal.getInstructions();
    expect(instructions.length).toBe(1);
    expect(instructions[0]?.method).toBe('incrementWithContext');
    expect(instructions[0]?.params).toEqual({ amount: 5 });
    expect((instructions[0] as { ctx?: UserContext }).ctx).toEqual({
      userId: 'alice',
      timestamp: 123456,
    });
  });

  test('instructions without context do not have ctx property', () => {
    const journal = counterUtil.createJournal(handlers);
    const data: CounterData = { count: 0, name: 'test' };

    journal.incrementWithContext(data, { amount: 5 });

    const instructions = journal.getInstructions();
    expect(instructions.length).toBe(1);
    expect('ctx' in instructions[0]!).toBe(false);
  });
});

// -------------------------------------------------------------------------------------
// New Test Cases: devFreeze Option
// -------------------------------------------------------------------------------------

describe('devFreeze option', () => {
  const counterUtil = createUtil<
    CounterData,
    CounterCreateData,
    CounterCreateError,
    CounterValidationError,
    { maxValue: number }
  >({
    options: { maxValue: 100 },
    is: (data: unknown): data is CounterData => {
      return (
        typeof data === 'object' &&
        data !== null &&
        'count' in data &&
        'name' in data &&
        typeof (data as CounterData).count === 'number' &&
        typeof (data as CounterData).name === 'string'
      );
    },
    validate: (_prev, _next) => ok(true),
  });

  test('devFreeze=true freezes the data passed to view', () => {
    const viewWithFreeze = counterUtil.makeView<
      {},
      undefined,
      { count: number }
    >(
      'getCount',
      (data) => {
        // Attempt to mutate - should throw in strict mode
        expect(() => {
          (data as { count: number }).count = 999;
        }).toThrow();
        return ok({ count: data.count });
      },
      { devFreeze: true },
    );

    const data: CounterData = { count: 5, name: 'test' };
    const result = viewWithFreeze(data, {});
    expect(result.isOk()).toBe(true);
    // Original data should be unchanged
    expect(data.count).toBe(5);
  });

  test('devFreeze deep-freezes nested structures', () => {
    type NestedData = {
      count: number;
      meta: { tags: string[]; info: { label: string } };
    };

    const nestedUtil = createUtil<NestedData, never, never, never, {}>({
      options: {},
      is: (data: unknown): data is NestedData => {
        if (typeof data !== 'object' || data === null) return false;
        if (!('count' in data) || !('meta' in data)) return false;
        const meta = (data as NestedData).meta;
        return (
          typeof (data as NestedData).count === 'number' &&
          typeof meta === 'object' &&
          meta !== null &&
          Array.isArray(meta.tags) &&
          typeof meta.info === 'object' &&
          meta.info !== null &&
          typeof meta.info.label === 'string'
        );
      },
      validate: (_prev, _next) => ok(true),
    });

    const viewWithFreeze = nestedUtil.makeView<
      {},
      undefined,
      { tagCount: number }
    >(
      'getTags',
      (data) => {
        expect(() => {
          (data.meta.tags as string[]).push('oops');
        }).toThrow();
        expect(() => {
          (data.meta.info as { label: string }).label = 'mutated';
        }).toThrow();
        return ok({ tagCount: data.meta.tags.length });
      },
      { devFreeze: true },
    );

    const data: NestedData = {
      count: 1,
      meta: { tags: ['a'], info: { label: 'x' } },
    };
    const result = viewWithFreeze(data, {});
    expect(result.isOk()).toBe(true);
    expect(data.meta.tags).toEqual(['a']);
    expect(data.meta.info.label).toBe('x');
  });

  test('devFreeze=false (default) does not freeze data', () => {
    const viewWithoutFreeze = counterUtil.makeView<
      {},
      undefined,
      { count: number }
    >(
      'getCount',
      (data) => {
        // This would not throw without freezing (but we shouldn't mutate!)
        return ok({ count: data.count });
      },
      { devFreeze: false },
    );

    const data: CounterData = { count: 5, name: 'test' };
    const result = viewWithoutFreeze(data, {});
    expect(result.isOk()).toBe(true);
  });
});

// -------------------------------------------------------------------------------------
// New Test Cases: Cycle Detection in deepFreeze
// -------------------------------------------------------------------------------------

describe('cycle detection in deepFreeze', () => {
  type NodeData = {
    value: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ref?: any;
  };

  const nodeUtil = createUtil<NodeData, { value: number }, never, never, {}>({
    options: {},
    is: (data: unknown): data is NodeData => {
      return (
        typeof data === 'object' &&
        data !== null &&
        'value' in data &&
        typeof (data as NodeData).value === 'number'
      );
    },
    validate: (_prev, _next) => ok(true),
    fromCreateData: (data) => ok({ value: data.value }),
  });

  test('handles circular references without infinite loop', () => {
    const viewWithFreeze = nodeUtil.makeView<
      {},
      undefined,
      { extractedValue: number }
    >('getValue', (data) => ok({ extractedValue: data.value }), {
      devFreeze: true,
    });

    // Create circular reference
    const circular: NodeData = { value: 42 };
    circular.ref = circular;

    // This should not hang or throw due to infinite recursion
    const result = viewWithFreeze(circular, {});
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.extractedValue).toBe(42);
    }
  });
});

// -------------------------------------------------------------------------------------
// New Test Cases: Failed Instructions Not Recorded
// -------------------------------------------------------------------------------------

describe('failed instructions are not recorded', () => {
  const counterUtil = createUtil<
    CounterData,
    CounterCreateData,
    CounterCreateError,
    CounterValidationError,
    { maxValue: number }
  >({
    options: { maxValue: 100 },
    is: (data: unknown): data is CounterData => {
      return (
        typeof data === 'object' &&
        data !== null &&
        'count' in data &&
        'name' in data &&
        typeof (data as CounterData).count === 'number' &&
        typeof (data as CounterData).name === 'string'
      );
    },
    validate: (_prev, next) => {
      if (next.count < 0 || next.count > 100) {
        return err({
          code: 'INVALID_COUNTER',
          message: 'Counter value is invalid',
          data: { value: next.count },
        });
      }
      return ok(true);
    },
  });

  const handlers = {
    increment: (data: Readonly<CounterData>, params: { amount: number }) => {
      return ok({ ...data, count: data.count + params.amount });
    },
  };

  test('failed validation does not record instruction', () => {
    const journal = counterUtil.createJournal(handlers);
    const data: CounterData = { count: 95, name: 'test' };

    // This should fail validation (95 + 10 = 105 > 100)
    const result = journal.increment(data, { amount: 10 });
    expect(result.isErr()).toBe(true);

    // No instructions should be recorded
    expect(journal.getInstructions().length).toBe(0);
  });

  test('successful instruction is recorded', () => {
    const journal = counterUtil.createJournal(handlers);
    const data: CounterData = { count: 90, name: 'test' };

    // This should succeed (90 + 5 = 95 <= 100)
    const result = journal.increment(data, { amount: 5 });
    expect(result.isOk()).toBe(true);

    // Instruction should be recorded
    expect(journal.getInstructions().length).toBe(1);
  });
});

// -------------------------------------------------------------------------------------
// New Test Cases: Journal Control (pause/resume/clear)
// -------------------------------------------------------------------------------------

describe('journal control', () => {
  const counterUtil = createUtil<
    CounterData,
    CounterCreateData,
    CounterCreateError,
    CounterValidationError,
    { maxValue: number }
  >({
    options: { maxValue: 100 },
    is: (data: unknown): data is CounterData => {
      return (
        typeof data === 'object' &&
        data !== null &&
        'count' in data &&
        'name' in data &&
        typeof (data as CounterData).count === 'number' &&
        typeof (data as CounterData).name === 'string'
      );
    },
    validate: (_prev, next) => {
      if (next.count < 0 || next.count > 100) {
        return err({
          code: 'INVALID_COUNTER',
          message: 'Counter value is invalid',
          data: { value: next.count },
        });
      }
      return ok(true);
    },
  });

  const handlers = {
    increment: (data: Readonly<CounterData>, params: { amount: number }) => {
      return ok({ ...data, count: data.count + params.amount });
    },
  };

  test('pauseRecording stops recording new instructions', () => {
    const journal = counterUtil.createJournal(handlers);
    let data: CounterData = { count: 0, name: 'test' };

    // Record first instruction
    const result1 = journal.increment(data, { amount: 5 });
    expect(result1.isOk()).toBe(true);
    if (result1.isOk()) data = result1.value;

    expect(journal.getInstructions().length).toBe(1);
    expect(journal.isRecording()).toBe(true);

    // Pause recording
    journal.pauseRecording();
    expect(journal.isRecording()).toBe(false);

    // This instruction should not be recorded
    const result2 = journal.increment(data, { amount: 3 });
    expect(result2.isOk()).toBe(true);

    // Still only 1 instruction
    expect(journal.getInstructions().length).toBe(1);
  });

  test('resumeRecording resumes recording instructions', () => {
    const journal = counterUtil.createJournal(handlers);
    let data: CounterData = { count: 0, name: 'test' };

    journal.pauseRecording();

    // This should not be recorded
    const result1 = journal.increment(data, { amount: 5 });
    if (result1.isOk()) data = result1.value;

    expect(journal.getInstructions().length).toBe(0);

    // Resume recording
    journal.resumeRecording();
    expect(journal.isRecording()).toBe(true);

    // This should be recorded
    const result2 = journal.increment(data, { amount: 3 });
    expect(result2.isOk()).toBe(true);

    expect(journal.getInstructions().length).toBe(1);
    expect(journal.getInstructions()[0]?.params).toEqual({ amount: 3 });
  });

  test('clearInstructions clears all recorded instructions', () => {
    const journal = counterUtil.createJournal(handlers);
    let data: CounterData = { count: 0, name: 'test' };

    const result1 = journal.increment(data, { amount: 5 });
    if (result1.isOk()) data = result1.value;

    const result2 = journal.increment(data, { amount: 3 });
    expect(result2.isOk()).toBe(true);

    expect(journal.getInstructions().length).toBe(2);

    // Clear instructions
    journal.clearInstructions();
    expect(journal.getInstructions().length).toBe(0);

    // Can still record new instructions
    const result3 = journal.increment(data, { amount: 1 });
    expect(result3.isOk()).toBe(true);
    expect(journal.getInstructions().length).toBe(1);
  });
});

// -------------------------------------------------------------------------------------
// New Test Cases: Instruction Serialization Round-trip
// -------------------------------------------------------------------------------------

describe('instruction serialization', () => {
  const counterUtil = createUtil<
    CounterData,
    CounterCreateData,
    CounterCreateError,
    CounterValidationError,
    { maxValue: number }
  >({
    options: { maxValue: 100 },
    is: (data: unknown): data is CounterData => {
      return (
        typeof data === 'object' &&
        data !== null &&
        'count' in data &&
        'name' in data &&
        typeof (data as CounterData).count === 'number' &&
        typeof (data as CounterData).name === 'string'
      );
    },
    validate: (_prev, next) => {
      if (next.count < 0 || next.count > 100) {
        return err({
          code: 'INVALID_COUNTER',
          message: 'Counter value is invalid',
          data: { value: next.count },
        });
      }
      return ok(true);
    },
  });

  const handlers = {
    increment: (data: Readonly<CounterData>, params: { amount: number }) => {
      return ok({ ...data, count: data.count + params.amount });
    },
    setName: (data: Readonly<CounterData>, params: { name: string }) => {
      return ok({ ...data, name: params.name });
    },
  };

  test('instructions survive JSON round-trip', () => {
    const journal = counterUtil.createJournal(handlers);
    let data: CounterData = { count: 0, name: 'test' };

    const result1 = journal.increment(data, { amount: 5 });
    if (result1.isOk()) data = result1.value;

    const result2 = journal.setName(data, { name: 'serialized' });
    expect(result2.isOk()).toBe(true);

    // Serialize to JSON and back
    const json = JSON.stringify(journal.getInstructions());
    const parsed = JSON.parse(json);

    // Replay with parsed instructions
    const initialData: CounterData = { count: 0, name: 'test' };
    const result = counterUtil.applyModifications(
      initialData,
      parsed,
      handlers,
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.count).toBe(5);
      expect(result.value.name).toBe('serialized');
    }
  });
});

// -------------------------------------------------------------------------------------
// New Test Cases: Error Context Information
// -------------------------------------------------------------------------------------

describe('error context information', () => {
  const counterUtil = createUtil<
    CounterData,
    CounterCreateData,
    CounterCreateError,
    CounterValidationError,
    { maxValue: number }
  >({
    options: { maxValue: 100 },
    is: (data: unknown): data is CounterData => {
      return (
        typeof data === 'object' &&
        data !== null &&
        'count' in data &&
        'name' in data &&
        typeof (data as CounterData).count === 'number' &&
        typeof (data as CounterData).name === 'string'
      );
    },
    validate: (_prev, _next) => ok(true),
  });

  test('view validation failure includes context', () => {
    const getDouble = counterUtil.makeView<{}, undefined, { doubled: number }>(
      'getDouble',
      (data) => ok({ doubled: data.count * 2 }),
    );

    const invalidData = { count: 'not a number' } as unknown as CounterData;
    const result = getDouble(invalidData, {});

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('UNHANDLED_VALIDATION_FAILURE');
      expect(result.error.data.context).toBe('view:getDouble');
      expect(result.error.data.receivedType).toBe('object');
    }
  });

  test('validate failure includes context', () => {
    const invalidData = 'not an object' as unknown as CounterData;
    const result = counterUtil.validate(
      { count: 0, name: 'valid' },
      invalidData,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('UNHANDLED_VALIDATION_FAILURE');
      // Type assertion for accessing error data properties
      const errorData = result.error.data as {
        context: string;
        receivedType: string;
      };
      expect(errorData.context).toBe('validate');
      expect(errorData.receivedType).toBe('string');
    }
  });
});
