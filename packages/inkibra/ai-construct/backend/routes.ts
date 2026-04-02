import { HttpMethod } from '@inkibra/router/constants/http-method';
import type { StatusCode } from '@inkibra/router/constants/status-code';
import { createAPIRoute } from '@inkibra/router/lib/api-route';
import type { AnyContextCodec } from '@inkibra/router/lib/context-codec';
import type { SerializableResult } from '@inkibra/router/lib/result';
import type {
  ConstructLabAction,
  ConstructLabActionAccepted,
  ConstructLabActionRejected,
  ConstructLabSnapshot,
  ConstructRuntimeFullSnapshot,
  ConstructStudioContextFile,
} from '../index';
import {
  applyConstructLabActionSchema,
  deleteConstructFileSchema,
  enterConstructEditModeSchema,
  exitConstructEditModeSchema,
  getConstructContextTraceSchema,
  getConstructLabSnapshotSchema,
  getConstructLanesSchema,
  getConstructRuntimeSnapshotSchema,
  listConstructFilesSchema,
  readConstructFileSchema,
  writeConstructFileSchema,
} from './routes.schemas';

export type ConstructBackendRouteErrors =
  | { type: 'ConstructNotFound' }
  | { type: 'Unauthenticated' }
  | { type: 'Forbidden' }
  | { type: 'EditModeRequired' }
  | { type: 'FileNotFound' }
  | { type: 'RuntimeEventStreamUnavailable' };

export namespace GetConstructLabSnapshot {
  export type PathParams = { constructId: string };
  export type PathQuery = Record<string, never>;
  export type Body = Record<string, never>;
  export type Response =
    | SerializableResult.OkWithStatusCode<ConstructLabSnapshot, StatusCode.OK>
    | SerializableResult.ErrWithStatusCode<
        Extract<
          ConstructBackendRouteErrors,
          { type: 'ConstructNotFound' | 'Unauthenticated' | 'Forbidden' }
        >,
        | StatusCode.NOT_FOUND
        | StatusCode.NOT_AUTHENTICATED
        | StatusCode.FORBIDDEN
      >;
}

export namespace ApplyConstructLabAction {
  export type PathParams = { constructId: string };
  export type PathQuery = Record<string, never>;
  export type Body = ConstructLabAction;
  export type Response =
    | SerializableResult.OkWithStatusCode<ConstructLabSnapshot, StatusCode.OK>
    | SerializableResult.OkWithStatusCode<
        ConstructLabActionAccepted,
        StatusCode.ACCEPTED
      >
    | SerializableResult.ErrWithStatusCode<
        | ConstructLabActionRejected
        | Extract<
            ConstructBackendRouteErrors,
            { type: 'ConstructNotFound' | 'Unauthenticated' | 'Forbidden' }
          >,
        | StatusCode.CONFLICT
        | StatusCode.NOT_FOUND
        | StatusCode.NOT_AUTHENTICATED
        | StatusCode.FORBIDDEN
      >;
}

export namespace GetConstructRuntimeSnapshot {
  export type PathParams = { constructId: string };
  export type PathQuery = Record<string, never>;
  export type Body = Record<string, never>;
  export type Response =
    | SerializableResult.OkWithStatusCode<
        ConstructRuntimeFullSnapshot,
        StatusCode.OK
      >
    | SerializableResult.ErrWithStatusCode<
        Extract<
          ConstructBackendRouteErrors,
          { type: 'ConstructNotFound' | 'Unauthenticated' | 'Forbidden' }
        >,
        | StatusCode.NOT_FOUND
        | StatusCode.NOT_AUTHENTICATED
        | StatusCode.FORBIDDEN
      >;
}

export namespace EnterConstructEditMode {
  export type PathParams = { constructId: string };
  export type PathQuery = Record<string, never>;
  export type Body = Record<string, never>;
  export type Response =
    | SerializableResult.OkWithStatusCode<
        {
          contextFiles: ConstructStudioContextFile[];
          activeContextFilePath?: string;
          lastSavedAt?: string;
        },
        StatusCode.OK
      >
    | SerializableResult.ErrWithStatusCode<
        Extract<
          ConstructBackendRouteErrors,
          { type: 'ConstructNotFound' | 'Unauthenticated' | 'Forbidden' }
        >,
        | StatusCode.NOT_FOUND
        | StatusCode.NOT_AUTHENTICATED
        | StatusCode.FORBIDDEN
      >;
}

export namespace ExitConstructEditMode {
  export type PathParams = { constructId: string };
  export type PathQuery = Record<string, never>;
  export type Body = Record<string, never>;
  export type Response =
    | SerializableResult.OkWithStatusCode<{ ok: true }, StatusCode.OK>
    | SerializableResult.ErrWithStatusCode<
        Extract<
          ConstructBackendRouteErrors,
          { type: 'ConstructNotFound' | 'Unauthenticated' | 'Forbidden' }
        >,
        | StatusCode.NOT_FOUND
        | StatusCode.NOT_AUTHENTICATED
        | StatusCode.FORBIDDEN
      >;
}

export namespace ListConstructFiles {
  export type PathParams = { constructId: string };
  export type PathQuery = Record<string, never>;
  export type Body = Record<string, never>;
  export type Response =
    | SerializableResult.OkWithStatusCode<
        {
          contextFiles: ConstructStudioContextFile[];
          activeContextFilePath?: string;
        },
        StatusCode.OK
      >
    | SerializableResult.ErrWithStatusCode<
        Extract<
          ConstructBackendRouteErrors,
          {
            type:
              | 'ConstructNotFound'
              | 'Unauthenticated'
              | 'Forbidden'
              | 'EditModeRequired';
          }
        >,
        | StatusCode.NOT_FOUND
        | StatusCode.NOT_AUTHENTICATED
        | StatusCode.FORBIDDEN
        | StatusCode.CONFLICT
      >;
}

export namespace ReadConstructFile {
  export type PathParams = { constructId: string };
  export type PathQuery = Record<string, never>;
  export type Body = { path: string };
  export type Response =
    | SerializableResult.OkWithStatusCode<
        { path: string; content: string },
        StatusCode.OK
      >
    | SerializableResult.ErrWithStatusCode<
        Extract<
          ConstructBackendRouteErrors,
          {
            type:
              | 'ConstructNotFound'
              | 'Unauthenticated'
              | 'Forbidden'
              | 'EditModeRequired'
              | 'FileNotFound';
          }
        >,
        | StatusCode.NOT_FOUND
        | StatusCode.NOT_AUTHENTICATED
        | StatusCode.FORBIDDEN
        | StatusCode.CONFLICT
      >;
}

export namespace WriteConstructFile {
  export type PathParams = { constructId: string };
  export type PathQuery = Record<string, never>;
  export type Body = { path: string; content: string };
  export type Response =
    | SerializableResult.OkWithStatusCode<{ ok: true }, StatusCode.OK>
    | SerializableResult.ErrWithStatusCode<
        Extract<
          ConstructBackendRouteErrors,
          {
            type:
              | 'ConstructNotFound'
              | 'Unauthenticated'
              | 'Forbidden'
              | 'EditModeRequired';
          }
        >,
        | StatusCode.NOT_FOUND
        | StatusCode.NOT_AUTHENTICATED
        | StatusCode.FORBIDDEN
        | StatusCode.CONFLICT
      >;
}

export namespace DeleteConstructFile {
  export type PathParams = { constructId: string };
  export type PathQuery = Record<string, never>;
  export type Body = { path: string };
  export type Response =
    | SerializableResult.OkWithStatusCode<{ ok: true }, StatusCode.OK>
    | SerializableResult.ErrWithStatusCode<
        Extract<
          ConstructBackendRouteErrors,
          {
            type:
              | 'ConstructNotFound'
              | 'Unauthenticated'
              | 'Forbidden'
              | 'EditModeRequired';
          }
        >,
        | StatusCode.NOT_FOUND
        | StatusCode.NOT_AUTHENTICATED
        | StatusCode.FORBIDDEN
        | StatusCode.CONFLICT
      >;
}

export namespace GetConstructLanes {
  export type PathParams = { constructId: string };
  export type PathQuery = Record<string, never>;
  export type Body = Record<string, never>;
  export type Response =
    | SerializableResult.OkWithStatusCode<unknown, StatusCode.OK>
    | SerializableResult.ErrWithStatusCode<
        Extract<
          ConstructBackendRouteErrors,
          { type: 'ConstructNotFound' | 'Unauthenticated' | 'Forbidden' }
        >,
        | StatusCode.NOT_FOUND
        | StatusCode.NOT_AUTHENTICATED
        | StatusCode.FORBIDDEN
      >;
}

export namespace GetConstructContextTrace {
  export type PathParams = { constructId: string };
  export type PathQuery = { stage?: string; lane?: string };
  export type Body = Record<string, never>;
  export type Response =
    | SerializableResult.OkWithStatusCode<unknown, StatusCode.OK>
    | SerializableResult.ErrWithStatusCode<
        Extract<
          ConstructBackendRouteErrors,
          { type: 'ConstructNotFound' | 'Unauthenticated' | 'Forbidden' }
        >,
        | StatusCode.NOT_FOUND
        | StatusCode.NOT_AUTHENTICATED
        | StatusCode.FORBIDDEN
      >;
}

export type CreateConstructBackendRoutesOptions = {
  authCodec: AnyContextCodec;
  basePath?: string;
};

export function createConstructBackendRoutes(
  options: CreateConstructBackendRoutesOptions,
) {
  const basePath = options.basePath ?? '/api/inkibra/ai-construct/constructs';
  const contextCodec = { auth: options.authCodec };

  return {
    getConstructLabSnapshot: createAPIRoute({
      name: 'getConstructLabSnapshot',
      method: HttpMethod.GET,
      path: `${basePath}/:constructId/lab`,
      schema: getConstructLabSnapshotSchema,
      contextCodec,
    }),
    applyConstructLabAction: createAPIRoute({
      name: 'applyConstructLabAction',
      method: HttpMethod.POST,
      path: `${basePath}/:constructId/lab/actions`,
      schema: applyConstructLabActionSchema,
      contextCodec,
    }),
    getConstructRuntimeSnapshot: createAPIRoute({
      name: 'getConstructRuntimeSnapshot',
      method: HttpMethod.GET,
      path: `${basePath}/:constructId/runtime`,
      schema: getConstructRuntimeSnapshotSchema,
      contextCodec,
    }),
    enterConstructEditMode: createAPIRoute({
      name: 'enterConstructEditMode',
      method: HttpMethod.POST,
      path: `${basePath}/:constructId/edit-mode/enter`,
      schema: enterConstructEditModeSchema,
      contextCodec,
    }),
    exitConstructEditMode: createAPIRoute({
      name: 'exitConstructEditMode',
      method: HttpMethod.POST,
      path: `${basePath}/:constructId/edit-mode/exit`,
      schema: exitConstructEditModeSchema,
      contextCodec,
    }),
    listConstructFiles: createAPIRoute({
      name: 'listConstructFiles',
      method: HttpMethod.GET,
      path: `${basePath}/:constructId/files`,
      schema: listConstructFilesSchema,
      contextCodec,
    }),
    readConstructFile: createAPIRoute({
      name: 'readConstructFile',
      method: HttpMethod.POST,
      path: `${basePath}/:constructId/files/read`,
      schema: readConstructFileSchema,
      contextCodec,
    }),
    writeConstructFile: createAPIRoute({
      name: 'writeConstructFile',
      method: HttpMethod.POST,
      path: `${basePath}/:constructId/files/write`,
      schema: writeConstructFileSchema,
      contextCodec,
    }),
    deleteConstructFile: createAPIRoute({
      name: 'deleteConstructFile',
      method: HttpMethod.POST,
      path: `${basePath}/:constructId/files/delete`,
      schema: deleteConstructFileSchema,
      contextCodec,
    }),
    getConstructLanes: createAPIRoute({
      name: 'getConstructLanes',
      method: HttpMethod.GET,
      path: `${basePath}/:constructId/lanes`,
      schema: getConstructLanesSchema,
      contextCodec,
    }),
    getConstructContextTrace: createAPIRoute({
      name: 'getConstructContextTrace',
      method: HttpMethod.GET,
      path: `${basePath}/:constructId/context-trace`,
      schema: getConstructContextTraceSchema,
      contextCodec,
    }),
  };
}

export type ConstructBackendRoutes = ReturnType<
  typeof createConstructBackendRoutes
>;
