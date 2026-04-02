# The ai-construct Computer

> For developers integrating ai-construct, and for the AI running on it.

---

## What is this?

An ai-construct is an AI persona with its own computer. The computer has a
persistent filesystem, a package manager, a scheduler, and access to your
product through typed APIs. The AI writes TypeScript to do everything: read
files, call product APIs, build tools for itself, schedule work, and grow its
capabilities over time.

The AI has **one tool: `preview_exec`**. It writes TypeScript. The code runs in
a preview world first. Filesystem changes go through a forked VFS. DB-backed
product API calls run inside a real transaction cycle that rolls back at the
end of preview.

---

## The core idea

There are three layers:

1. **Commands** for computer operations like reading files, listing
   directories, opening context, and package management.
2. **Typed product bindings** for your application's APIs.
3. **One top-level transaction cycle** for request/invocation-scoped DB access
   and staged effects.

The AI writes code against commands and bindings. It does not see your raw DB
driver, secrets, or internal services.

---

## For the developer: what your AI can do

### Your AI reads and writes files

The AI has a persistent Linux-like filesystem. It remembers things by writing
them down.

```typescript
const notes = await command('read', '/home/user/context/goals.md');
await command(
  'write',
  '/home/user/context/state/progress.json',
  JSON.stringify({ week: 12, streak: 5 }),
);
```

### Your AI calls your product APIs

> Product capabilities are exposed as static `defineCodeBinding(...)` bindings.
> Per-invocation deps, cross-module calls, and staged effects are wired by the
> AI computer module at runtime.

```typescript
export const notificationEffects = createEffectModule({
  namespace: 'notifications',
  effects: {
    send: effect<{ target: string; message: string }>({
      preview: ({ message }) => `Would send notification: ${message}`
    }),
  },
});

export const notificationsModule = defineAiComputerModule({
  name: 'notifications',
  bindings: { sendNotification },
});

export type TrainerDeps = {
  handlers: {
    searchExercises: ReturnType<typeof searchExercisesHandlerProvider>;
  };
  executeContext: Record<string, unknown>;
  notifications: AiModuleBindings<typeof notificationsModule>;
  notificationEffects: EffectModuleApi<typeof notificationEffects>;
};

export const createTrainerDeps = createAiModuleDeps<TrainerDeps>()
  .depends({ notifications: notificationsModule })
  .factory(({ driver, effects, modules, ctx, logger }) => ({
    handlers: {
      searchExercises: searchExercisesHandlerProvider(
        createTrainerHandlerDeps({ driver, effects, logger }),
      ),
    },
    executeContext: ctx,
    notifications: modules.notifications,
    notificationEffects: notificationEffects.bind(effects),
  }));

export const searchExercises = defineCodeBinding(
  async function searchExercises(input: SearchExercisesInput, { deps }) {
    return deps.handlers.searchExercises.execute(
      { body: input, pathParams: {}, pathQuery: {} },
      deps.executeContext,
    );
  },
);
```

The AI uses module bindings like a normal library import. Commands are separate
ergonomic adapters over those same bindings.

### Your AI builds its own tools

The AI can write, publish, and install command packages. Over time, it builds a
toolbox of reusable operations tailored to the user.

```typescript
await command('pm', 'init', '@commands/weekly-report');
await command('write', '/home/user/scripts/@commands/weekly-report/index.ts', `
import { defineCommand } from 'sys';
import { getWorkouts } from 'workout-api';

export default defineCommand({
  name: 'weekly-report',
  description: 'Generate a weekly workout summary',
  args: {
    weeks: { type: 'number', flag: '--weeks', default: 1 },
  },
  fn: async (parsed) => {
    const workouts = await getWorkouts({ since: parsed.weeks + 'w' });
    return { total: workouts.length };
  },
  render: (result) => `${result.total} workouts`,
});
`);
await command('pm', 'publish', '@commands/weekly-report');
await command('pm', 'add', '@commands/weekly-report');
```

### Your AI can call LLMs inside its code

A lightweight AI SDK is available for structured extraction, web search, and
text generation — with the budget and models you configure.

```typescript
import { ai } from 'sys/ai';
import { z } from 'zod';

const parsed = await ai.extract(userMessage, z.object({
  exercise: z.string(),
  sets: z.number(),
  reps: z.number(),
}), { model: 'fast' });
```

### Your AI manages its own context window

The AI decides what to keep in attention by opening and pinning files.

```typescript
await command('open', '/home/user/context/state/streak.json');
await command(
  'pin',
  '/home/user/context/goals.md',
  '--phase',
  'awake',
  '--reason',
  'daily reference',
);
```

---

## For the developer: how to integrate

### 1. Write shared handlers/providers

> Use `@inkibra/router`-style handlers/providers. Provider `deps` receive
> invocation-scoped DALs, effects, and logger. Handler `ctx` stays auth/request
> context.

```typescript
export const logWorkoutHandlerProvider = createApiRouteHandlerProvider(
  (deps: { workoutDal: WorkoutDal; effects: EffectContext; logger: Logger }) =>
    createApiRouteHandler({
      route: logWorkoutRoute,
      handler: async (args, ctx) => {
        const auth = requireTrainerAuth(ctx);
        const workout = {
          id: crypto.randomUUID(),
          trainerId: auth.trainerId,
          ...args.body,
        };

        await deps.workoutDal.insert(deps.logger, workout);
        await deps.effects.call({
          kind: 'trainer.workoutLogged',
          payload: { workoutId: workout.id },
          preview: 'Would notify the user that their workout was logged.',
        });

        return SerializableResult.toOk(
          { id: workout.id, logged: true },
          StatusCode.OK,
        );
      },
    }),
);
```

### 2. Define effect contracts and module deps

> Effects are declared once. The host implements them when it creates the
> `TransactionRuntime`; bindings emit them through typed helpers.

```typescript
export const trainerEffects = createEffectModule({
  namespace: 'trainer',
  effects: {
    workoutLogged: effect<{ workoutId: string }>({
      preview: ({ workoutId }) =>
        `Would notify the user about workout ${workoutId}.`,
    }),
  },
});

export type TrainerDeps = {
  handlers: {
    logWorkout: ReturnType<typeof logWorkoutHandlerProvider>;
  };
  executeContext: Record<string, unknown>;
  trainerEffects: EffectModuleApi<typeof trainerEffects>;
};

export const createTrainerDeps = createAiModuleDeps<TrainerDeps>()
  .factory(({ driver, effects, ctx, logger }) => ({
    handlers: {
      logWorkout: logWorkoutHandlerProvider(
        createTrainerHandlerDeps({ driver, effects, logger }),
      ),
    },
    executeContext: ctx,
    trainerEffects: trainerEffects.bind(effects),
  }));
```

### 3. Wrap handlers as bindings and group them into a module

> `defineCodeBinding(...)` stays static in `.tool.ts`. `defineAiComputerModule(...)`
> composes those bindings with typed deps, dependencies, and command adapters.

```typescript
export const logWorkout = defineCodeBinding(
  async function logWorkout(input: LogWorkoutInput, { deps }) {
    const result = await deps.handlers.logWorkout.execute(
      { body: input, pathParams: {}, pathQuery: {} },
      deps.executeContext,
    );

    await deps.trainerEffects.workoutLogged({
      workoutId: result.value.id,
    });

    return result.value;
  },
);

export const trainerModule = defineAiComputerModule({
  name: 'trainer',
  deps: createTrainerDeps,
  bindings: { logWorkout, searchExercises },
  commands: ({ self }) => [
    defineCommand({
      name: 'log-workout',
      description: 'Log a workout through the trainer API',
      args: {
        exercise: { type: 'string', position: 0, required: true },
      },
      async fn(parsed) {
        return self.logWorkout({ exercise: parsed.exercise as string });
      },
      render(result) {
        return `Logged workout ${result.id}`;
      },
    }),
  ],
});
```

### 4. Configure the construct and transaction runtime

> The same `TransactionRuntime` contract is used by AI preview/commit and by
> `@inkibra/denzel-bun` HTTP requests. Preview rolls back; commit/HTTP flush
> staged effects after commit.

```typescript
const transactionRuntime = createDriverTransactionRuntime({
  driver,
  logger,
  effectHandlers: {
    ...trainerEffects.implement({
      workoutLogged: async ({ workoutId }) => {
        await notifier.send({ kind: 'trainer.workoutLogged', workoutId });
      },
    }),
  },
});

const construct = createConstruct({
  computer: {
    modules: [trainerModule],
    commands: [deployCommand],
    transactionRuntime,
    preinstalled: ['zod', 'date-fns'],
    createExecuteContext: async ({ construct, impulse }) => ({
      auth: {
        trainerId: construct.ownerId,
        workspaceId: construct.workspaceId,
      },
      requestMeta: {
        constructId: construct.id,
        impulseId: impulse.id,
      },
    }),
  },
});
```

---

## For the AI: how to use your computer

### You have one tool: `preview_exec`

Write TypeScript. Use `command()` for file and system operations. Commands
auto-show a readable start line and rendered result. Use imports for product
APIs and libraries. Use `show()` when you want to explicitly surface an
existing value while continuing to work with it.

### Quick reference

```typescript
const content = await command('read', '/home/user/notes.md');
await command('write', '/home/user/output.md', reportText);
const entries = await command('list', '/home/user/context/');
show(entries);

import { getWorkouts, logWorkout } from 'workout-api';
const workouts = await getWorkouts({ since: '7d' });
await logWorkout({ exercise: 'squat', sets: 3, reps: 10, weight: 135 });

import { ai } from 'sys/ai';
import { z } from 'zod';
const parsed = await ai.extract(text, z.object({ value: z.string() }), {
  model: 'fast',
});
```

### `show()`

`show()` explicitly pretty-prints a value for the model to read and returns the
raw value to your code. If the value came from a command, `show()` uses that
command's `render`.

```typescript
const entries = await command('list', '/home/user/context/');
show(entries);
const recent = entries.filter((e) => e.modified > lastWeek);
```

---

## Transaction and effect model

DB-backed product APIs run inside one top-level transaction cycle per request or
AI invocation.

- **Preview:** run real code, then roll back
- **Commit / HTTP:** run real code, commit, then flush effects

Effects are fire-and-forget. They can return preview text during execution, but
they do not return business data to handlers. Real delivery happens only after a
successful commit. Starting a workflow is one kind of effect.

This gives the AI a real preview of database behavior without committing state.

---

## Why this architecture

**One tool, not many.** The AI never wastes tokens choosing between tools.

**Commands, not a shell.** `command('read', path)` is precise and avoids shell
syntax confusion.

**Commands auto-show.** The AI sees when a command starts and what it rendered
when it completes.

**`show()` and `console.log` serve different purposes.** `show()` uses command
rendering when available; `console.log` uses normal JS inspection.

**Shared handlers across HTTP and AI.** The same router handler/provider can back
your web APIs and your AI computer.

**Preview is real execution with rollback.** DB-backed previews use a real
transaction cycle; filesystem previews use `OverlayFs.fork()`.

**Effects are staged.** Side effects are explicit, fire-and-forget, and only
flush after commit.

**The AI builds its own tools.** Commands plus `pm` let capability accumulate as
code instead of staying trapped in the prompt window.
