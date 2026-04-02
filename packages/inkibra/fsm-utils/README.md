# @inkibra/fsm-utils

Utilities for creating instructions and views around data that can be safely treated like a finite state machine (FSM). This package provides a type-safe, functional approach to state management with validation, instruction recording, and replay capabilities.

## Features

- **Type-safe FSM utilities**: Create strongly-typed state machines with compile-time guarantees
- **Instruction-based state transitions**: Define and execute state transitions as discrete instructions
- **Journal recording**: Record all state transitions for replay, debugging, or persistence
- **Validation**: Built-in validation for state transitions
- **View functions**: Create read-only views of your state with deep readonly guarantees
- **Immutability**: All state transitions return new state, preserving immutability

## Installation

```bash
bun add @inkibra/fsm-utils
```

## Core Concepts

### Instruction Handlers

Instruction handlers define how your state transitions from one value to another. They take the current state and parameters, and return a new state (or an error).

### Views

Views are read-only functions that derive information from your state without modifying it. They receive deeply readonly data to prevent accidental mutations. DeepReadonly is a compile-time guarantee; use devFreeze to detect mutations at runtime during development.

### Journals

Journals record all instructions applied during their lifetime, enabling features like:
- Event sourcing
- Undo/redo
- Audit logging
- State replay

Only successful, validated instructions are recorded; handler errors or validation failures are not recorded.

## Basic Usage

### 1. Define Your Data Types

```typescript
import { createUtil, type ErrorDescriptor } from '@inkibra/fsm-utils';
import { ok, err } from 'neverthrow';

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
```

### 2. Create Your Util

```typescript
const counterUtil = createUtil<
  CounterData,                  // Data type
  CounterCreateData,            // Create data type
  CounterCreateError,           // Creation errors
  CounterValidationError,       // Validation errors
  { maxValue: number }          // Options type
>({
  options: { maxValue: 100 },
  
  // Type guard for data validation
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
  
  // Validate state transitions
  validate: (prev, next) => {
    if (next.count < 0 || next.count > 100) {
      return err({
        code: 'INVALID_COUNTER',
        message: 'Counter value is invalid',
        data: { value: next.count },
      });
    }
    return ok(true);
  },
  
  // Optional: Create initial data from creation parameters
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
```

### 3. Define Instruction Handlers

```typescript
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
```

### 4. Use the Util

#### Creating Initial Data

Note: `create` is only available when `fromCreateData` is provided in the createUtil config.

```typescript
const createResult = counterUtil.create({
  name: 'my-counter',
  initialCount: 10,
});

if (createResult.isOk()) {
  const data = createResult.value;
  console.log(data); // { count: 10, name: 'my-counter' }
}
```

#### Standalone Instruction Handlers

```typescript
// Create a wrapped handler
const incrementHandler = counterUtil.makeInstructionHandler<{ amount: number }>(
  'increment',
  handlers.increment
);

// Use it
const data: CounterData = { count: 5, name: 'test' };
const result = incrementHandler(data, { amount: 3 });

if (result.isOk()) {
  console.log(result.value.count); // 8
}
```

#### Journal with Recording

```typescript
// Start a journal (records all instructions)
const journal = counterUtil.createJournal(handlers);

let data: CounterData = { count: 0, name: 'my-counter' };

// Apply instructions
const result1 = journal.increment(data, { amount: 10 });
if (result1.isOk()) data = result1.value;

const result2 = journal.decrement(data, { amount: 3 });
if (result2.isOk()) data = result2.value;

const result3 = journal.setName(data, { name: 'updated-counter' });
if (result3.isOk()) data = result3.value;

console.log(data); // { count: 7, name: 'updated-counter' }

// Get recorded instructions
const instructions = journal.getInstructions();
console.log(instructions);
// [
//   { method: 'increment', params: { amount: 10 } },
//   { method: 'decrement', params: { amount: 3 } },
//   { method: 'setName', params: { name: 'updated-counter' } }
// ]
```

#### Replaying Instructions

```typescript
const startData: CounterData = { count: 0, name: 'my-counter' };

// Replay recorded instructions
const replayResult = counterUtil.applyModifications(
  startData,
  instructions,
  handlers
);

if (replayResult.isOk()) {
  console.log(replayResult.value); // Same final state as journal
}
```

Note: if an instruction method is missing from the handlers map, `applyModifications` returns an `UNKNOWN_INSTRUCTION_METHOD` error that includes the method name and index.

### 5. Create Views

Views provide read-only access to your state and can derive computed values:

```typescript
const getDoubleView = counterUtil.makeView<
  {},                              // Params type
  undefined,                       // Context type
  { doubledCount: number }         // Result type
>(
  'getDouble',
  (data, _params) => {
    // data is DeepReadonly<CounterData>
    return ok({ doubledCount: data.count * 2 });
  },
  { devFreeze: true }  // Optional: enable deep freezing for development
);

const data: CounterData = { count: 5, name: 'test' };
const result = getDoubleView(data, {});

if (result.isOk()) {
  console.log(result.value.doubledCount); // 10
}
```

**Note**: The `devFreeze` option (default: `false`) enables deep freezing of data passed to views. This is useful during development to catch accidental mutations, but has a performance cost. Set it to `true` explicitly when you need this guarantee.

## Advanced Features

### Context in Instructions

Instructions can optionally receive context:

```typescript
type UserContext = { userId: string };

const handlers = {
  incrementBy: (
    data: Readonly<CounterData>,
    params: { amount: number },
    ctx?: UserContext
  ) => {
    console.log(`User ${ctx?.userId} incremented by ${params.amount}`);
    return ok({ ...data, count: data.count + params.amount });
  },
};

const journal = counterUtil.createJournal(handlers);
journal.incrementBy(data, { amount: 5 }, { userId: 'user_123' });
```

### Journal Control

Journals expose helpers to manage recording without affecting state transitions:

```typescript
const journal = counterUtil.createJournal(handlers);

journal.pauseRecording();
// Calls while paused are not recorded.
journal.resumeRecording();

journal.clearInstructions();
const recording = journal.isRecording();
```

### Error Handling

All operations return `Result` types from `neverthrow` for type-safe error handling:

```typescript
const result = counterUtil.create({ name: '' });

if (result.isErr()) {
  const error = result.error;
  console.log(error.code);     // 'INVALID_NAME'
  console.log(error.message);  // 'Name cannot be empty'
  console.log(error.data);     // {}
}
```

### Validation Failures

State transitions are validated automatically:

```typescript
const data: CounterData = { count: 90, name: 'test' };
const result = journal.increment(data, { amount: 20 }); // Would exceed max

if (result.isErr()) {
  console.log(result.error.code); // 'INVALID_COUNTER'
  console.log(result.error.data.value); // 110
}
```

## Use Cases

### Event Sourcing

Store instructions in a database and replay them to reconstruct state:

```typescript
const journal = counterUtil.createJournal(handlers);

// Perform operations
journal.increment(data, { amount: 5 });
journal.decrement(data, { amount: 2 });

// Save instructions to database
const instructions = journal.getInstructions();
await db.saveInstructions(entityId, instructions);

// Later: reconstruct state
const savedInstructions = await db.loadInstructions(entityId);
const state = counterUtil.applyModifications(
  initialData,
  savedInstructions,
  handlers
);
```

### Undo/Redo

Track state changes and replay from any point:

```typescript
const history: typeof instructions[] = [];
const journal = counterUtil.createJournal(handlers);

// After each operation
history.push([...journal.getInstructions()]);

// Undo: replay all but last
const previousState = counterUtil.applyModifications(
  initialData,
  history[history.length - 2] || [],
  handlers
);
```

### Audit Logging

Record all state changes with metadata:

```typescript
const journal = counterUtil.createJournal(handlers);

// Operations with context
journal.increment(data, { amount: 5 }, { userId: 'user_123' });

// Instructions include context
const instructions = journal.getInstructions();
// [{ method: 'increment', params: { amount: 5 }, ctx: { userId: 'user_123' } }]
```

## API Reference

### `createUtil(config)`

Creates a new FSM utility with the specified configuration.

**Parameters:**
- `config.options`: Options object available to all handlers
- `config.is`: Type guard function to validate data structure
- `config.validate`: Validation function for state transitions
- `config.fromCreateData` (optional): Function to create initial data

**Returns:** Utility object with methods:
- `is(data)`: Check if data is valid
- `validate(prev, next)`: Validate state transition
- `create(data)`: Create initial state from creation data (only available when `fromCreateData` is provided)
- `makeInstructionHandler(method, handler)`: Create standalone instruction handler
- `makeView(name, view, opts?)`: Create a view function
- `createJournal(handlers)`: Start a recording journal (includes pause/resume/clear/isRecording helpers)
- `applyModifications(startData, instructions, handlers)`: Replay instructions; returns `UNKNOWN_INSTRUCTION_METHOD` if an instruction method is missing

## Type Safety

The package leverages TypeScript's type system extensively:

- **Readonly data**: All instruction handlers receive `Readonly<TData>` to prevent mutations
- **DeepReadonly views**: View functions receive `DeepReadonly<TData>` for deep immutability
- **Result types**: All fallible operations return `Result<T, E>` from `neverthrow`
- **Type inference**: Handler types are inferred from instruction maps

## Best Practices

1. **Keep handlers pure**: Instruction handlers should not have side effects
2. **Validate transitions**: Use the `validate` function to enforce invariants
3. **Use journals for recording**: When you need to track changes, use journals
4. **Create views for queries**: Don't expose raw data; create views for specific queries
5. **Handle errors explicitly**: Use `isOk()`/`isErr()` to handle all error cases
6. **Clone deep structures**: Use structuredClone or similar for nested objects

## License

SEE LICENSE
