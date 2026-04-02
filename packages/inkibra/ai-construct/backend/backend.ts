import { normalizeContextPath } from '../lab/lab-action-ops';
import type { ConstructStudioContextFile } from '../lab/types';
import {
  buildHeartbeatSystemEventOp,
  buildImpulseOp,
  buildSelfReminderOp,
  buildSystemEventOp,
  buildUserMessageOp,
} from '../runtime/ops';
import type { DurableConstructRuntime } from '../runtime/types';
import type {
  AnyCustomImpulseDefinition,
  BuiltinImpulseKey,
  BuiltinImpulsePayloadMap,
  ConstructImpulsePayload,
  ConstructImpulseRegistry,
} from './impulses';

export type MaybePromise<T> = T | Promise<T>;

export type AuthPlugin<
  TAuth,
  TCodec = unknown,
  TContext = unknown,
  TResponse = unknown,
> = {
  codec: TCodec;
  require: (ctx: TContext) => MaybePromise<
    | {
        ok: true;
        auth: TAuth;
        subjectId: string;
      }
    | {
        ok: false;
        response: TResponse;
      }
  >;
};

export type ConstructInitializationPlan = {
  files?: Array<{
    path: string;
    content: string;
  }>;
  openedPaths?: string[];
  activeContextFilePath?: string;
};

export type InitializeConstruct<TAuth> = (args: {
  constructId: string;
  auth: TAuth;
}) => MaybePromise<ConstructInitializationPlan | void>;

export type CreateConstructBackendOptions<
  TAuth,
  TImpulses extends ConstructImpulseRegistry,
  TAuthResponse = unknown,
> = {
  runtime: Pick<
    DurableConstructRuntime,
    | 'submit'
    | 'waitForRef'
    | 'enterEditMode'
    | 'exitEditMode'
    | 'readContextFile'
    | 'writeContextFile'
    | 'deleteContextFile'
    | 'listContextFiles'
  >;
  auth: AuthPlugin<TAuth, unknown, unknown, TAuthResponse>;
  impulses: TImpulses;
  getConstructId: (args: {
    pathParams: Record<string, string>;
    pathQuery: Record<string, string | undefined>;
    auth: TAuth;
  }) => MaybePromise<string>;
  initializeConstruct?: InitializeConstruct<TAuth>;
};

export type ConstructBackendSubmitWait = 'accepted' | 'committed';

export type ConstructBackendSubmitArgs<
  TImpulses extends ConstructImpulseRegistry,
  TName extends keyof TImpulses['custom'] | BuiltinImpulseKey,
> = {
  constructId: string;
  impulse: TName;
  payload: TName extends keyof BuiltinImpulsePayloadMap
    ? BuiltinImpulsePayloadMap[TName]
    : ConstructImpulsePayload<TImpulses, TName>;
  waitFor?: ConstructBackendSubmitWait;
  traceId?: string;
};

export type ConstructBackend<
  TAuth,
  TImpulses extends ConstructImpulseRegistry,
  TAuthResponse = unknown,
> = {
  runtime: CreateConstructBackendOptions<TAuth, TImpulses>['runtime'];
  auth: AuthPlugin<TAuth, unknown, unknown, TAuthResponse>;
  impulses: TImpulses;
  getConstructId: CreateConstructBackendOptions<
    TAuth,
    TImpulses,
    TAuthResponse
  >['getConstructId'];
  initializeConstruct?: InitializeConstruct<TAuth>;
  submit: <TName extends keyof TImpulses['custom'] | BuiltinImpulseKey>(
    args: ConstructBackendSubmitArgs<TImpulses, TName>,
  ) => Promise<{ accepted: true; ref?: string }>;
  editMode: {
    enter: (args: { constructId: string }) => ReturnType<TCreateEditEnter>;
    exit: (args: { constructId: string }) => Promise<void>;
  };
  files: {
    read: (args: { constructId: string; path: string }) => Promise<{
      path: string;
      content: string;
    }>;
    list: (args: { constructId: string }) => Promise<{
      contextFiles: ConstructStudioContextFile[];
      activeContextFilePath?: string;
    }>;
    write: (args: {
      constructId: string;
      path: string;
      content: string;
    }) => Promise<void>;
    delete: (args: { constructId: string; path: string }) => Promise<void>;
  };
};

type TCreateEditEnter = (args: { constructId: string }) => Promise<{
  contextFiles: ConstructStudioContextFile[];
  activeContextFilePath?: string;
  lastSavedAt?: string;
}>;

function formatValidationErrors(errors: unknown): string {
  if (!Array.isArray(errors) || errors.length === 0) {
    return 'Unknown validation error';
  }
  return errors
    .slice(0, 3)
    .map((error) => {
      if (error && typeof error === 'object') {
        const record = error as Record<string, unknown>;
        return [record.path, record.expected, record.message]
          .filter((value) => typeof value === 'string' && value.length > 0)
          .join(' ');
      }
      return String(error);
    })
    .join('; ');
}

function getCustomImpulseDefinition<TImpulses extends ConstructImpulseRegistry>(
  registry: TImpulses,
  name: string,
): AnyCustomImpulseDefinition | undefined {
  return registry.custom[name];
}

export function createConstructBackend<
  TAuth,
  TImpulses extends ConstructImpulseRegistry,
  TAuthResponse = unknown,
>(
  options: CreateConstructBackendOptions<TAuth, TImpulses, TAuthResponse>,
): ConstructBackend<TAuth, TImpulses, TAuthResponse> {
  async function submit<
    TName extends keyof TImpulses['custom'] | BuiltinImpulseKey,
  >(
    args: ConstructBackendSubmitArgs<TImpulses, TName>,
  ): Promise<{ accepted: true; ref?: string }> {
    let op: Parameters<typeof options.runtime.submit>[1];

    if (args.impulse === 'userChat') {
      op = buildUserMessageOp({
        constructId: args.constructId,
        content: (args.payload as BuiltinImpulsePayloadMap['userChat']).content,
        timestamp: (args.payload as BuiltinImpulsePayloadMap['userChat'])
          .timestamp,
        metadata: (args.payload as BuiltinImpulsePayloadMap['userChat'])
          .metadata,
        traceId: args.traceId,
      });
    } else if (args.impulse === 'heartbeat') {
      const payload = args.payload as BuiltinImpulsePayloadMap['heartbeat'];
      const dueAt = payload.dueAt ?? new Date().toISOString();
      op = buildHeartbeatSystemEventOp({
        constructId: args.constructId,
        dueAt,
        payload: payload.payload,
        traceId: args.traceId,
      });
    } else if (args.impulse === 'reminder') {
      const payload = args.payload as BuiltinImpulsePayloadMap['reminder'];
      op = buildSelfReminderOp({
        reminderId: payload.reminderId,
        message: payload.message,
        dueAt: payload.dueAt ?? new Date().toISOString(),
        context: payload.context,
        traceId: args.traceId,
      });
    } else {
      const definition = getCustomImpulseDefinition(
        options.impulses,
        String(args.impulse),
      );
      if (!definition) {
        throw new Error(`Unknown construct impulse: ${String(args.impulse)}`);
      }

      const validation = definition.payload.validate(args.payload);
      if (!validation.success) {
        throw new Error(
          `Invalid payload for impulse '${String(args.impulse)}': ${formatValidationErrors(validation.errors)}`,
        );
      }

      const route = definition.route;
      if (route?.kind === 'explicitImpulse') {
        op = buildImpulseOp({
          constructId: args.constructId,
          profile: route.profile,
          event: route.event,
          pool: route.pool,
          payload: validation.data,
          traceId: args.traceId,
        });
      } else {
        op = buildSystemEventOp({
          constructId: args.constructId,
          event: route?.event ?? String(args.impulse),
          profile: route?.profile,
          pool: route?.pool,
          payload: validation.data,
          traceId: args.traceId,
        });
      }
    }

    const result = await options.runtime.submit(args.constructId, op);
    if (args.waitFor === 'committed') {
      await options.runtime.waitForRef(args.constructId, result.ref);
    }
    return result;
  }

  return {
    runtime: options.runtime,
    auth: options.auth,
    impulses: options.impulses,
    getConstructId: options.getConstructId,
    initializeConstruct: options.initializeConstruct,
    submit,
    editMode: {
      enter: ({ constructId }) => options.runtime.enterEditMode(constructId),
      exit: ({ constructId }) => options.runtime.exitEditMode(constructId),
    },
    files: {
      read: async ({ constructId, path }) => ({
        path: normalizeContextPath(path),
        content: await options.runtime.readContextFile(
          constructId,
          normalizeContextPath(path),
        ),
      }),
      list: ({ constructId }) => options.runtime.listContextFiles(constructId),
      write: ({ constructId, path, content }) =>
        options.runtime.writeContextFile(
          constructId,
          normalizeContextPath(path),
          content,
        ),
      delete: ({ constructId, path }) =>
        options.runtime.deleteContextFile(
          constructId,
          normalizeContextPath(path),
        ),
    },
  };
}
