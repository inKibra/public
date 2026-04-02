import type { OverlayFs } from '@inkibra/ai-flow';
import { StatusCode } from '@inkibra/router/constants/status-code';
import { createApiRouteHandler } from '@inkibra/router/lib/api-route-handler';
import { SerializableResult } from '@inkibra/router/lib/result';
import { buildConstructLabActionOp } from '../lab/lab-action-ops';
import { isConstructLabExclusiveCommand } from '../lab/lab-command-lock';
import type {
  ConstructLabAction,
  ConstructLabActionAccepted,
  ConstructLabActionRejected,
  ConstructLabSnapshot,
  ConstructRuntimeSnapshot as ConstructRuntimeFullSnapshot,
} from '../lab/types';
import type { ConstructBackend, MaybePromise } from './backend';
import type { ConstructImpulseRegistry } from './impulses';
import type { ConstructBackendRoutes } from './routes';

export type CreateConstructBackendApiHandlersOptions<
  TAuth,
  TImpulses extends ConstructImpulseRegistry,
  TAuthResponse extends AuthFailureResponse,
> = {
  backend: ConstructBackend<TAuth, TImpulses, TAuthResponse>;
  routes: ConstructBackendRoutes;
  loadLabSnapshot: (args: {
    constructId: string;
    auth: TAuth;
  }) => MaybePromise<ConstructLabSnapshot>;
  loadRuntimeSnapshot: (args: {
    constructId: string;
    auth: TAuth;
  }) => MaybePromise<ConstructRuntimeFullSnapshot>;
  submitLabAction?: (args: {
    constructId: string;
    action: ConstructLabAction;
    auth: TAuth;
  }) => MaybePromise<
    | { type: 'accepted'; value: ConstructLabActionAccepted }
    | { type: 'snapshot'; value: ConstructLabSnapshot }
    | { type: 'rejected'; value: ConstructLabActionRejected }
  >;
  /** Provides a readonly VFS for context introspection (lanes, trace). */
  getReadonlyVfs?: (args: {
    constructId: string;
    auth: TAuth;
  }) => MaybePromise<OverlayFs>;
};

function toNotFound() {
  return SerializableResult.toErr(
    { type: 'ConstructNotFound' as const },
    StatusCode.NOT_FOUND,
  );
}

function toForbidden() {
  return SerializableResult.toErr(
    { type: 'Forbidden' as const },
    StatusCode.FORBIDDEN,
  );
}

type AuthFailureResponse = ReturnType<
  typeof SerializableResult.toErr<
    { type: 'Unauthenticated' } | { type: 'Forbidden' },
    StatusCode.NOT_AUTHENTICATED | StatusCode.FORBIDDEN
  >
>;

function mapUnknownAccessError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/forbidden/i.test(message)) {
    return toForbidden();
  }
  return toNotFound();
}

function mapFileError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/edit mode/i.test(message)) {
    return SerializableResult.toErr(
      { type: 'EditModeRequired' as const },
      StatusCode.CONFLICT,
    );
  }
  return SerializableResult.toErr(
    { type: 'FileNotFound' as const },
    StatusCode.NOT_FOUND,
  );
}

function mapEditModeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/edit mode/i.test(message)) {
    return SerializableResult.toErr(
      { type: 'EditModeRequired' as const },
      StatusCode.CONFLICT,
    );
  }
  return mapUnknownAccessError(error);
}

async function requireAuth<
  TAuth,
  TImpulses extends ConstructImpulseRegistry,
  TAuthResponse extends AuthFailureResponse,
>(
  backend: ConstructBackend<TAuth, TImpulses, TAuthResponse>,
  ctx: { auth: unknown },
) {
  const result = await backend.auth.require(ctx);
  if (!result.ok) {
    return result;
  }
  return result;
}

async function defaultSubmitLabAction<
  TAuth,
  TImpulses extends ConstructImpulseRegistry,
  TAuthResponse extends AuthFailureResponse,
>(args: {
  backend: ConstructBackend<TAuth, TImpulses, TAuthResponse>;
  constructId: string;
  action: ConstructLabAction;
  auth: TAuth;
  loadLabSnapshot: (args: {
    constructId: string;
    auth: TAuth;
  }) => MaybePromise<ConstructLabSnapshot>;
}) {
  const op = buildConstructLabActionOp(args.constructId, args.action);
  const submitted = await args.backend.runtime.submit(args.constructId, op);

  if (isConstructLabExclusiveCommand(args.action)) {
    await args.backend.runtime.waitForRef?.(args.constructId, submitted.ref);
    return {
      type: 'snapshot' as const,
      value: await args.loadLabSnapshot({
        constructId: args.constructId,
        auth: args.auth,
      }),
    };
  }

  return {
    type: 'accepted' as const,
    value: {
      type: 'Accepted',
      action: args.action.action,
      opId: op.opId,
      ref: submitted.ref,
      queuedAt: op.createdAt,
    } satisfies ConstructLabActionAccepted,
  };
}

export function createConstructBackendApiHandlers<
  TAuth,
  TImpulses extends ConstructImpulseRegistry,
  TAuthResponse extends AuthFailureResponse,
>(
  options: CreateConstructBackendApiHandlersOptions<
    TAuth,
    TImpulses,
    TAuthResponse
  >,
) {
  const resolveConstructId = async (
    auth: TAuth,
    args: {
      pathParams: { constructId: string };
      pathQuery: Record<string, string | undefined>;
    },
  ) =>
    options.backend.getConstructId({
      pathParams: args.pathParams,
      pathQuery: args.pathQuery,
      auth,
    });

  return {
    getConstructLabSnapshot: createApiRouteHandler({
      route: options.routes.getConstructLabSnapshot,
      handler: async (args, ctx: { auth: unknown }) => {
        const authResult = await requireAuth(options.backend, ctx);
        if (!authResult.ok) {
          return authResult.response;
        }
        try {
          const constructId = await resolveConstructId(authResult.auth, args);
          return SerializableResult.toOk(
            await options.loadLabSnapshot({
              constructId,
              auth: authResult.auth,
            }),
            StatusCode.OK,
          );
        } catch (error) {
          return mapUnknownAccessError(error);
        }
      },
    }),
    applyConstructLabAction: createApiRouteHandler({
      route: options.routes.applyConstructLabAction,
      handler: async (args, ctx: { auth: unknown }) => {
        const authResult = await requireAuth(options.backend, ctx);
        if (!authResult.ok) {
          return authResult.response;
        }
        try {
          const constructId = await resolveConstructId(authResult.auth, args);
          const result = options.submitLabAction
            ? await options.submitLabAction({
                constructId,
                action: args.body,
                auth: authResult.auth,
              })
            : await defaultSubmitLabAction({
                backend: options.backend,
                constructId,
                action: args.body,
                auth: authResult.auth,
                loadLabSnapshot: options.loadLabSnapshot,
              });

          if (result.type === 'snapshot') {
            return SerializableResult.toOk(result.value, StatusCode.OK);
          }
          if (result.type === 'accepted') {
            return SerializableResult.toOk(result.value, StatusCode.ACCEPTED);
          }
          return SerializableResult.toErr(result.value, StatusCode.CONFLICT);
        } catch (error) {
          return mapUnknownAccessError(error);
        }
      },
    }),
    getConstructRuntimeSnapshot: createApiRouteHandler({
      route: options.routes.getConstructRuntimeSnapshot,
      handler: async (args, ctx: { auth: unknown }) => {
        const authResult = await requireAuth(options.backend, ctx);
        if (!authResult.ok) {
          return authResult.response;
        }
        try {
          const constructId = await resolveConstructId(authResult.auth, args);
          return SerializableResult.toOk(
            await options.loadRuntimeSnapshot({
              constructId,
              auth: authResult.auth,
            }),
            StatusCode.OK,
          );
        } catch (error) {
          return mapUnknownAccessError(error);
        }
      },
    }),
    enterConstructEditMode: createApiRouteHandler({
      route: options.routes.enterConstructEditMode,
      handler: async (args, ctx: { auth: unknown }) => {
        const authResult = await requireAuth(options.backend, ctx);
        if (!authResult.ok) {
          return authResult.response;
        }
        try {
          const constructId = await resolveConstructId(authResult.auth, args);
          return SerializableResult.toOk(
            await options.backend.editMode.enter({ constructId }),
            StatusCode.OK,
          );
        } catch (error) {
          return mapUnknownAccessError(error);
        }
      },
    }),
    exitConstructEditMode: createApiRouteHandler({
      route: options.routes.exitConstructEditMode,
      handler: async (args, ctx: { auth: unknown }) => {
        const authResult = await requireAuth(options.backend, ctx);
        if (!authResult.ok) {
          return authResult.response;
        }
        try {
          const constructId = await resolveConstructId(authResult.auth, args);
          await options.backend.editMode.exit({ constructId });
          return SerializableResult.toOk({ ok: true as const }, StatusCode.OK);
        } catch (error) {
          return mapUnknownAccessError(error);
        }
      },
    }),
    listConstructFiles: createApiRouteHandler({
      route: options.routes.listConstructFiles,
      handler: async (args, ctx: { auth: unknown }) => {
        const authResult = await requireAuth(options.backend, ctx);
        if (!authResult.ok) {
          return authResult.response;
        }
        try {
          const constructId = await resolveConstructId(authResult.auth, args);
          return SerializableResult.toOk(
            await options.backend.files.list({ constructId }),
            StatusCode.OK,
          );
        } catch (error) {
          return mapEditModeError(error);
        }
      },
    }),
    readConstructFile: createApiRouteHandler({
      route: options.routes.readConstructFile,
      handler: async (args, ctx: { auth: unknown }) => {
        const authResult = await requireAuth(options.backend, ctx);
        if (!authResult.ok) {
          return authResult.response;
        }
        try {
          const constructId = await resolveConstructId(authResult.auth, args);
          return SerializableResult.toOk(
            await options.backend.files.read({
              constructId,
              path: args.body.path,
            }),
            StatusCode.OK,
          );
        } catch (error) {
          return mapFileError(error);
        }
      },
    }),
    writeConstructFile: createApiRouteHandler({
      route: options.routes.writeConstructFile,
      handler: async (args, ctx: { auth: unknown }) => {
        const authResult = await requireAuth(options.backend, ctx);
        if (!authResult.ok) {
          return authResult.response;
        }
        try {
          const constructId = await resolveConstructId(authResult.auth, args);
          await options.backend.files.write({
            constructId,
            path: args.body.path,
            content: args.body.content,
          });
          return SerializableResult.toOk({ ok: true as const }, StatusCode.OK);
        } catch (error) {
          return mapEditModeError(error);
        }
      },
    }),
    deleteConstructFile: createApiRouteHandler({
      route: options.routes.deleteConstructFile,
      handler: async (args, ctx: { auth: unknown }) => {
        const authResult = await requireAuth(options.backend, ctx);
        if (!authResult.ok) {
          return authResult.response;
        }
        try {
          const constructId = await resolveConstructId(authResult.auth, args);
          await options.backend.files.delete({
            constructId,
            path: args.body.path,
          });
          return SerializableResult.toOk({ ok: true as const }, StatusCode.OK);
        } catch (error) {
          return mapEditModeError(error);
        }
      },
    }),
    getConstructLanes: createApiRouteHandler({
      route: options.routes.getConstructLanes,
      handler: async (args, ctx: { auth: unknown }) => {
        const authResult = await requireAuth(options.backend, ctx);
        if (!authResult.ok) return authResult.response;
        if (!options.getReadonlyVfs) return toNotFound();
        try {
          const constructId = await resolveConstructId(authResult.auth, args);
          const vfs = await options.getReadonlyVfs({
            constructId,
            auth: authResult.auth,
          });
          const { loadLanesConfig } = await import('../vfs/context-system');
          const config = await loadLanesConfig(vfs);
          return SerializableResult.toOk(config, StatusCode.OK);
        } catch (error) {
          return mapUnknownAccessError(error);
        }
      },
    }),
    getConstructContextTrace: createApiRouteHandler({
      route: options.routes.getConstructContextTrace,
      handler: async (args, ctx: { auth: unknown }) => {
        const authResult = await requireAuth(options.backend, ctx);
        if (!authResult.ok) return authResult.response;
        if (!options.getReadonlyVfs) return toNotFound();
        try {
          const constructId = await resolveConstructId(authResult.auth, {
            pathParams: args.pathParams,
            pathQuery: args.pathQuery as Record<string, string | undefined>,
          });
          const vfs = await options.getReadonlyVfs({
            constructId,
            auth: authResult.auth,
          });
          const { clearContextCache, traceStageContext } = await import(
            '../vfs/context-system'
          );
          clearContextCache(vfs);
          const trace = await traceStageContext(vfs, {
            stage: args.pathQuery?.stage ?? 'impulse',
            now: new Date(),
            lane: args.pathQuery?.lane,
          });
          return SerializableResult.toOk(trace, StatusCode.OK);
        } catch (error) {
          return mapUnknownAccessError(error);
        }
      },
    }),
  };
}
