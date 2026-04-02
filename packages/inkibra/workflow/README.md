# @inkibra/workflow

Typesafe, explicit, resumable workflow system for long-running processes with event-driven coordination.

## Overview

Build durable workflows that can pause/resume across machines, wait for external events, and persist state in durable storage. The package supports both staged workflows (`defineWorkflow`) and function workflows (`workflow`) with BullMQ-based coordination.

## Core Design Principles

1. **Explicit boundaries**: Each stage is a separate function; serialization points are visible via return values
2. **Lexical scoping prevents errors**: Variables from prior stages aren't accessible unless explicitly passed in snapshots
3. **Type-safe snapshots**: Only JSON-serializable data crosses boundaries (enforced at compile time)
4. **No string directives**: No "use workflow" or hidden macros that change semantics; everything is standard TypeScript
5. **Event-driven coordination**: Workflows can wait for external events with typed routing tokens

## Installation

```bash
bun add @inkibra/workflow bullmq ioredis
```

**Note**: As of v1.1.0, the workflow system uses BullMQ for job coordination instead of polling. This provides better resource efficiency and horizontal scalability.

## Quick Start

### Recommended Modern Setup (Function DX + Concurrency + Cron)

```typescript
import initLogger from '@inkibra/logger';
import {
  createWorkflowSystem,
  DalWorkflowStorage,
  createRedisWorkflowConcurrencyManager,
  event,
  workflow,
} from '@inkibra/workflow';
import { createDriver } from '@inkibra/dal-connection';
import Redis from 'ioredis';

const logger = initLogger('workflow-service');
const redis = new Redis(process.env.REDIS_URL);
const driver = await createDriver({
  databaseUrl: process.env.DATABASE_URL,
});
const storage = new DalWorkflowStorage(driver, logger);
await storage.initialize();

const system = await createWorkflowSystem({
  storage,
  logger,
  redis,
  queueName: 'workflow-jobs',
  workerConcurrency: 20,
  startWorker: true,
  runtimeOptions: {
    concurrency: {
      manager: createRedisWorkflowConcurrencyManager(redis),
      leaseMs: 30_000,
      retryDelayMs: 1_000,
      workflows: {
        userSignup: 50,
      },
      resources: {
        'send-email': 10,
      },
    },
  },
});

await system.queue.setGlobalConcurrency(100);

export const userSignup = workflow(
  {
    name: 'userSignup',
    version: '2.0.0',
    events: {
      welcomeOpened: event<{ userId: string }>(
        (snap) => `welcome:${snap.userId}:opened`,
      ),
    },
  },
  async ({ input, step, events }) => {
    const user = await step.run({ name: 'create-user' }, async () => {
      return await createUser(input.email);
    });

    await step.run(
      { name: 'send-welcome-email', resource: 'send-email' },
      async () => {
        await sendWelcomeEmail(user.email);
        return { sent: true };
      },
    );

    const wait = await step.waitForAny({
      name: 'wait-open',
      tokens: [events.welcomeOpened.token({ userId: user.id })],
      timeout: '7 days',
    });

    if (wait.timedOut) {
      await step.run(
        { name: 'send-followup', resource: 'send-email' },
        async () => {
          await sendFollowupEmail(user.email);
          return { followup: true };
        },
      );
    }

    return { status: 'done', userId: user.id };
  },
);

await system.queue.scheduleStart(userSignup.name, userSignup.version, {
  email: 'user@example.com',
});

await system.scheduler.upsert({
  id: 'daily-user-signup-reminder',
  workflow: userSignup,
  input: { email: 'batch@example.com' },
  pattern: '0 9 * * *',
  tz: 'America/New_York',
  misfirePolicy: 'skip_to_latest',
});
```

This setup enforces concurrency only for actively executing work (not sleeping/waiting instances).

### Basic Workflow

```typescript
import { defineWorkflow, stage, sleep, complete } from '@inkibra/workflow';
import type { Snapshot } from '@inkibra/workflow/types';

export const userSignup = defineWorkflow('userSignup', {
  start: stage(async (input: { email: string }) => {
    const userId = await createUser(input.email);
    const createdAt = new Date().toISOString();

    return {
      snapshot: { userId, createdAt } as Snapshot<{ userId: string; createdAt: string }>,
      next: 'sendWelcome',
    };
  }),

  sendWelcome: stage(async (snap: Snapshot<{ userId: string; createdAt: string }>) => {
    await sendWelcomeEmail(snap.userId);

    return sleep('7 days', {
      snapshot: snap,
      next: 'sendCheckIn',
    });
  }),

  sendCheckIn: stage(async (snap: Snapshot<{ userId: string; createdAt: string }>) => {
    await sendCheckInEmail(snap.userId, snap.createdAt);

    return complete({ result: { status: 'done' } });
  }),
});
```

### Initialize Runtime with BullMQ (Recommended)

```typescript
import { DalWorkflowStorage } from '@inkibra/workflow/storage-dal';
import { createDriver } from '@inkibra/dal-connection';
import { createWorkflowSystem } from '@inkibra/workflow/system';
import Redis from 'ioredis';

// Initialize Redis connection
const redis = new Redis({
  host: 'localhost',
  port: 6379,
});

// Initialize storage via DAL collections
const driver = await createDriver({ databaseUrl: process.env.DATABASE_URL });
const storage = new DalWorkflowStorage(driver, logger);
await storage.initialize();

const system = await createWorkflowSystem({
  storage,
  logger,
  redis,
  queueName: 'workflow-jobs',
  workerConcurrency: 10,
  startWorker: true,
});

// Start a workflow (automatically schedules first execution job)
const instance = await system.runtime.startWorkflow(userSignup, {
  email: 'user@example.com',
});
```

**Architecture**: Jobs are the coordination primitive. When a stage completes with `sleep()` or `waitFor()`, the runtime creates a BullMQ job. The worker processes these jobs by calling back into the runtime to execute the next stage. DAL collections store workflow state while BullMQ coordinates execution.

## Event-Driven Workflows

Declare events in the workflow definition; stages can wait for them with typed tokens:

```typescript
import { defineWorkflow, stage, waitFor, withCapture, complete } from '@inkibra/workflow';
import type { Snapshot } from '@inkibra/workflow/types';

export const userSignup = defineWorkflow(
  'userSignup',
  
  // Declare events
  {
    events: {
      welcomeOpened: withCapture<Snapshot<{ userId: string }>>(
        (snap) => `welcome:${snap.userId}:opened`,
      ),
      billingSettled: withCapture<Snapshot<{ invoiceId: string }>>(
        (snap) => `billing:${snap.invoiceId}:settled`,
      ),
    },
  },
  
  // Stages
  {
    start: stage(async (input: { email: string }) => {
      const userId = await createUser(input.email);
      return { snapshot: { userId }, next: 'sendWelcome' };
    }),

    sendWelcome: stage(async (snap, runtime) => {
      await sendWelcomeEmail(snap.userId);

      return waitFor({
        token: runtime.events.welcomeOpened.capture(snap),
        snapshot: snap,
        timeout: sleep('7 days', { snapshot: snap, next: 'sendCheckIn' }),
      });
    }),

    sendCheckIn: stage(async (snap, runtime) => {
      const openedEvents = runtime.events.welcomeOpened.received();
      const openedAt = openedEvents.at(-1)?.payload.openedAt ?? snap.createdAt;

      await sendCheckInEmail(snap.userId, openedAt);
      return complete({ result: { status: 'done' } });
    }),
  },
);
```

### Emitting Events

Emit events from anywhere in the codebase:

```typescript
await runtime.emitEvent({
  workflowName: 'userSignup',
  eventName: 'welcomeOpened',
  token: `welcome:${userId}:opened`,
  payload: { openedAt: new Date().toISOString() },
});
```

### Waiting for Multiple Events

```typescript
// Resume when any event arrives
return waitFor.any(
  [
    runtime.events.welcomeOpened.capture(snap),
    runtime.events.billingSettled.capture(snap),
  ],
  {
    snapshot: snap,
    timeout: sleep('7 days', { snapshot: snap, next: 'escalate' }),
  },
);

// Resume only after all events arrive
return waitFor.all(
  [
    runtime.events.docSigned.capture(snap),
    runtime.events.paymentSettled.capture(snap),
  ],
  {
    snapshot: snap,
    timeout: sleep('14 days', { snapshot: snap, next: 'cancel' }),
  },
);
```

## API Reference

### Core Functions

#### `defineWorkflow(name, options?, stages)`

Define a workflow with stages and optional events.

```typescript
defineWorkflow<TInput, TSnapshot, TResult>(
  name: string,
  options?: { events?: EventsConfig, version?: string },
  stages: StagesMap<TSnapshot>
): WorkflowDefinition<TInput, TSnapshot, TResult>
```

#### `stage(fn)`

Define a workflow stage function.

```typescript
stage<TSnapshot>(
  fn: (snapshot: Snapshot<TSnapshot>, runtime?: RuntimeContext<TSnapshot>) 
    => Promise<StageResult<TSnapshot>>
): StageDefinition<TSnapshot>
```

#### `sleep(duration, options)`

Schedule a timed delay before continuing to next stage.

```typescript
sleep<TSnapshot>(
  duration: string | number,
  options: { snapshot: Snapshot<TSnapshot>, next: string }
): SleepResult<TSnapshot>
```

Duration can be:
- Milliseconds: `5000`
- Human-readable: `"7 days"`, `"2 hours"`, `"30 minutes"`

#### `complete(options)`

Mark workflow as completed with result.

```typescript
complete<TResult>(options: { result: TResult }): CompleteResult<TResult>
```

#### `failure(options)`

Mark workflow as failed with optional retry.

```typescript
failure<TData>(options: {
  reason: string,
  data?: TData,
  retry?: { maxAttempts?: number, backoffMs?: number }
}): FailureResult<TData>
```

#### `waitFor(options)` / `waitFor.any()` / `waitFor.all()`

Wait for event(s) to arrive.

```typescript
waitFor<TSnapshot>(options: {
  token: string,
  snapshot: Snapshot<TSnapshot>,
  timeout?: SleepResult<TSnapshot>
}): WaitForResult<TSnapshot>

waitFor.any<TSnapshot>(
  tokens: string[],
  options: { snapshot: Snapshot<TSnapshot>, timeout?: SleepResult<TSnapshot> }
): WaitForResult<TSnapshot>

waitFor.all<TSnapshot>(
  tokens: string[],
  options: { snapshot: Snapshot<TSnapshot>, timeout?: SleepResult<TSnapshot> }
): WaitForResult<TSnapshot>
```

#### `withCapture(fn)`

Create an event definition with typed capture function.

```typescript
withCapture<TSnapshot>(
  fn: (snapshot: Snapshot<TSnapshot>) => string
): EventCaptureFunction<TSnapshot>
```

### Runtime Context

The optional second parameter to stage functions provides:

```typescript
type RuntimeContext<TSnapshot> = {
  events: EventsMap;           // Event definitions with .capture(), .emit(), .received()
  storage: {                   // Stage-local storage
    get: (key: string) => Promise<JsonValue | undefined>;
    set: (key: string, value: JsonValue) => Promise<void>;
  };
  trace: {                     // Structured timeline events
    add: (event: { type: string; data: JsonValue }) => void;
  };
  effects: {                   // Deterministic side effects
    now: () => string;
    randomUUID: () => string;
  };
};
```

## Storage Schema

### Workflow Instances

```typescript
{
  id: string;
  type: 'workflow_instance';
  workflowName: string;
  version: string;
  status: 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
  currentStage: string;
  snapshot: JsonValue;
  eventTokens: string[];
  lock?: { ownerId: string; leaseExpiresAt: string };
  created: string;
  modified: string;
}
```

### Workflow Events

```typescript
{
  id: string;
  type: 'workflow_event';
  instanceId: string;
  eventType: 'started' | 'stage_completed' | 'sleep_scheduled' | 'event_received' | 'completed' | 'failed';
  stageName?: string;
  payload: JsonValue;
  timestamp: string;
}
```

### Workflow Timers

```typescript
{
  id: string;
  type: 'workflow_timer';
  instanceId: string;
  dueAt: string;
  nextStage: string;
  pickedAt?: string;
  pickedBy?: string;
}
```

## Benefits Over Alternatives

| Approach | Explicit Boundaries | Type Safety | No Magic Rules | Linear Flow |
|----------|-------------------|-------------|----------------|-------------|
| Vercel "use workflow" | ❌ (hidden awaits) | ❌ (runtime) | ❌ (many) | ✅ |
| Raw job queues | ✅ | ❌ | ✅ | ❌ (split jobs) |
| **This design** | ✅ (visible returns) | ✅ (compile-time) | ✅ | ✅ (staged) |

## Testing

The package includes unit tests for the core API functions. Run tests with:

```bash
bun test
```

Tests cover:
- Workflow and stage definition
- Sleep, complete, and failure result creation
- Event capture functions
- Type safety enforcement

## Known Limitations

1. **Verbosity for complex branching**: Many conditional paths require many small stages
2. **Manual snapshot management**: Must explicitly pass data in snapshots
3. **Event token design**: Requires careful token namespacing to avoid collisions
4. **Testing requires mocking**: Stages call real functions; consider passing `deps` object
5. **No built-in saga/compensation**: Must manually code rollback stages
6. **Migration discipline**: Code changes can break in-flight workflows

## License

SEE LICENSE
