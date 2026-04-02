/**
 * Backend assembly for the dev server.
 *
 * Wires the construct backend, routes, handlers, stream routes,
 * and management routes into a single denzel-bun Backend.
 */

import { createBackend } from '@inkibra/denzel-bun';
import type { Logger } from '@inkibra/logger';
import { createApiRouteHandler, SerializableResult } from '@inkibra/router';
import type { StreamsClient } from '@inkibra/streams';
import {
  buildConstructCombinedSnapshot,
  buildConstructLabSnapshot,
  buildConstructRuntimeSnapshot,
  createConstructBackend,
  createConstructBackendApiHandlers,
  createConstructBackendStreamHandlers,
  defineConstructImpulses,
} from '../backend';
import {
  constructRoutes,
  constructStreamRoutes,
  createConstructRoute,
  deleteConstructRoute,
  getCombinedSnapshotRoute,
  listConstructsRoute,
  readOnlyFileRoute,
} from './app/route-tree';
import { type DevAuth, devAuthPlugin } from './auth';
import {
  createConstruct,
  deleteConstruct,
  hasConstruct,
  listConstructs,
} from './construct-registry';
import type { DevRuntime } from './runtime';
import { createDevStreamRuntimeEvents } from './stream-wiring';

// ---------------------------------------------------------------------------
// Backend factory
// ---------------------------------------------------------------------------

export function createDevBackend(args: {
  runtime: DevRuntime;
  streams: StreamsClient;
  logger: Logger;
}) {
  const { runtime, streams, logger } = args;

  // 1. Construct backend (submit, edit mode, file ops)
  const constructBackend = createConstructBackend({
    runtime: {
      submit: runtime.submit,
      waitForRef: runtime.waitForRef,
      enterEditMode: async (constructId: string) =>
        runtime.enterEditMode(constructId),
      exitEditMode: async (constructId: string) =>
        runtime.exitEditMode(constructId),
      readContextFile: async (constructId: string, path: string) =>
        runtime.readContextFile(constructId, path),
      writeContextFile: async (
        constructId: string,
        path: string,
        content: string,
      ) => runtime.writeContextFile(constructId, path, content),
      deleteContextFile: async (constructId: string, path: string) =>
        runtime.deleteContextFile(constructId, path),
      listContextFiles: async (constructId: string) =>
        runtime.listContextFiles(constructId),
    },
    auth: devAuthPlugin,
    impulses: defineConstructImpulses({}),
    getConstructId: async ({
      pathParams,
    }: {
      pathParams: Record<string, string>;
      pathQuery: Record<string, string | undefined>;
      auth: DevAuth;
    }) => {
      const id = pathParams.constructId;
      if (!id) throw new Error('ConstructNotFound');
      return id;
    },
  });

  // 2. Standard construct handlers (routes imported from route-tree)
  const standardHandlers = createConstructBackendApiHandlers({
    backend: constructBackend,
    routes: constructRoutes,
    loadLabSnapshot: async ({ constructId }) => {
      const construct =
        await runtime.runtimeManager.getOrCreateReadonly(constructId);
      return buildConstructLabSnapshot(construct, {
        loadRuntimeSourceFacts: runtime.loadSourceFacts,
        loadIngressFrontier: runtime.loadIngressFrontier,
        loadQueuedMailboxPreview: runtime.loadQueuedMailboxPreview,
        logger,
      });
    },
    loadRuntimeSnapshot: async ({ constructId }) => {
      const construct =
        await runtime.runtimeManager.getOrCreateReadonly(constructId);
      return buildConstructRuntimeSnapshot(construct, {
        loadRuntimeSourceFacts: runtime.loadSourceFacts,
        logger,
      });
    },
    getReadonlyVfs: async ({ constructId }) => {
      const construct =
        await runtime.runtimeManager.getOrCreateReadonly(constructId);
      return construct.getVfs();
    },
  });

  // 3. Stream handlers (routes imported from route-tree)
  const streamRuntimeEvents = createDevStreamRuntimeEvents(streams, logger);

  const streamHandlers = createConstructBackendStreamHandlers({
    backend: constructBackend,
    routes: constructStreamRoutes,
    streamRuntimeEvents: async function* (streamArgs) {
      return yield* streamRuntimeEvents({
        constructId: streamArgs.constructId,
        cursor: streamArgs.cursor,
      });
    },
  });

  // 4. Management handlers
  const managementHandlers = {
    createDevConstruct: createApiRouteHandler({
      route: createConstructRoute,
      handler: async (routeArgs) => {
        const id = createConstruct(routeArgs.body?.id);
        logger.info('Construct created', { constructId: id });
        return SerializableResult.toOk({ constructId: id }, 201);
      },
    }),
    listDevConstructs: createApiRouteHandler({
      route: listConstructsRoute,
      handler: async () => {
        return SerializableResult.toOk({ constructs: listConstructs() }, 200);
      },
    }),
    deleteDevConstruct: createApiRouteHandler({
      route: deleteConstructRoute,
      handler: async (routeArgs) => {
        const id = routeArgs.pathParams.constructId;
        if (!hasConstruct(id)) {
          return SerializableResult.toErr(
            { type: 'ConstructNotFound' as const },
            404,
          );
        }
        try {
          await runtime.requestShutdown(id);
        } catch {
          // May not be running
        }
        deleteConstruct(id);
        logger.info('Construct deleted', { constructId: id });
        return SerializableResult.toOk({ ok: true as const }, 200);
      },
    }),
    readDevFileReadOnly: createApiRouteHandler({
      route: readOnlyFileRoute,
      handler: async (routeArgs) => {
        const id = routeArgs.pathParams.constructId;
        const filePath = routeArgs.body?.path;
        if (!filePath) {
          return SerializableResult.toErr(
            { type: 'FileNotFound' as const },
            404,
          );
        }
        try {
          const construct =
            await runtime.runtimeManager.getOrCreateReadonly(id);
          const vfs = construct.getVfs();
          const content = await vfs.read(filePath);
          return SerializableResult.toOk({ path: filePath, content }, 200);
        } catch {
          return SerializableResult.toErr(
            { type: 'FileNotFound' as const },
            404,
          );
        }
      },
    }),
    getDevCombinedSnapshot: createApiRouteHandler({
      route: getCombinedSnapshotRoute,
      handler: async (routeArgs) => {
        const id = routeArgs.pathParams.constructId;
        try {
          const construct =
            await runtime.runtimeManager.getOrCreateReadonly(id);
          const result = await buildConstructCombinedSnapshot({
            construct,
            options: {
              view: 'lab',
              loadRuntimeSourceFacts: runtime.loadSourceFacts,
              loadIngressFrontier: runtime.loadIngressFrontier,
              loadQueuedMailboxPreview: runtime.loadQueuedMailboxPreview,
              logger,
            },
          });
          return SerializableResult.toOk(result, 200);
        } catch {
          return SerializableResult.toErr(
            { type: 'ConstructNotFound' as const },
            404,
          );
        }
      },
    }),
  };

  // 5. Assemble into denzel-bun backend
  return createBackend({
    name: 'ai-construct-dev',
    logger,
    apiHandlers: {
      ...standardHandlers,
      ...managementHandlers,
    },
    streamHandlers: {
      ...streamHandlers,
    },
  });
}
