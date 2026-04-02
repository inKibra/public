import {
  createAPIRoute,
  createAppRouteTree,
  HttpMethod,
  SerializableResult,
  StatusCode,
  strategy,
} from '@inkibra/router';
import {
  createConstructBackendRoutes,
  createConstructBackendStreamRoutes,
} from '../../backend';
import { devAuthCodec } from '../auth';
import {
  createConstructSchema,
  deleteConstructSchema,
  getCombinedSnapshotSchema,
  listConstructsSchema,
  readOnlyFileSchema,
} from '../routes.schemas';
import { devLabLoaderSchema } from './schemas.schemas';

// Create route instances for the dev-server's basePath
const constructRoutes = createConstructBackendRoutes({
  authCodec: devAuthCodec,
  basePath: '/api/constructs',
});

const constructStreamRoutes = createConstructBackendStreamRoutes({
  authCodec: devAuthCodec,
  basePath: '/api/constructs',
});

// Dev-specific routes (single source of truth — backend.ts imports these)
const createConstructRoute = createAPIRoute({
  name: 'createDevConstruct',
  method: HttpMethod.POST,
  path: '/api/constructs',
  schema: createConstructSchema,
});

const listConstructsRoute = createAPIRoute({
  name: 'listDevConstructs',
  method: HttpMethod.GET,
  path: '/api/constructs',
  schema: listConstructsSchema,
});

const deleteConstructRoute = createAPIRoute({
  name: 'deleteDevConstruct',
  method: HttpMethod.DELETE,
  path: '/api/constructs/:constructId',
  schema: deleteConstructSchema,
});

const readOnlyFileRoute = createAPIRoute({
  name: 'readDevFileReadOnly',
  method: HttpMethod.POST,
  path: '/api/constructs/:constructId/files/read-only',
  schema: readOnlyFileSchema,
});

const getCombinedSnapshotRoute = createAPIRoute({
  name: 'getDevCombinedSnapshot',
  method: HttpMethod.GET,
  path: '/api/constructs/:constructId/snapshot',
  schema: getCombinedSnapshotSchema,
});

// Lazy-loaded page components
const DevLayout = strategy.sync(() => import('./routes/layout'));
const DevLabPage = strategy.sync(() => import('./routes/lab'));

export const devAppRoutes = createAppRouteTree({
  auth: devAuthCodec,
})
  .api({
    listDevConstructs: listConstructsRoute,
    createDevConstruct: createConstructRoute,
    deleteDevConstruct: deleteConstructRoute,
  })
  .page({
    component: DevLayout,
  })
  .outlets((o) => ({
    main: o.outlet('main').segments((s) => ({
      ':constructId': s
        .segment(':constructId')
        .page({ component: DevLayout })
        .outlets((o2) => ({
          main: o2.outlet('main').segments((s2) => ({
            lab: s2
              .leaf('lab')
              .api({
                getDevCombinedSnapshot: getCombinedSnapshotRoute,
                getDevContextTrace: constructRoutes.getConstructContextTrace,
                getDevLanes: constructRoutes.getConstructLanes,
                applyConstructLabAction:
                  constructRoutes.applyConstructLabAction,
                getConstructRuntimeSnapshot:
                  constructRoutes.getConstructRuntimeSnapshot,
                enterConstructEditMode: constructRoutes.enterConstructEditMode,
                exitConstructEditMode: constructRoutes.exitConstructEditMode,
                listConstructFiles: constructRoutes.listConstructFiles,
                readConstructFile: constructRoutes.readConstructFile,
                writeConstructFile: constructRoutes.writeConstructFile,
                deleteConstructFile: constructRoutes.deleteConstructFile,
                streamConstructRuntimeEvents:
                  constructStreamRoutes.streamConstructRuntimeEvents,
              })
              .page({
                loader: {
                  schema: devLabLoaderSchema,
                  load: async (api, { params }) => {
                    const constructId = params.constructId;
                    if (!constructId) {
                      return SerializableResult.toErr(
                        {
                          type: 'MissingConstructId',
                          message: 'constructId is required',
                        },
                        StatusCode.BAD_REQUEST,
                      );
                    }

                    // Fetch combined snapshot (studio + lab + runtime)
                    const result = await api.getDevCombinedSnapshot.execute(
                      {
                        pathParams: { constructId },
                        pathQuery: { view: 'lab' },
                        body: {},
                        files: undefined,
                      },
                      {},
                    );

                    if (result.type === 'Err') {
                      return result;
                    }

                    const combined = result.value;
                    if (
                      !combined.studio ||
                      !combined.lab ||
                      !combined.runtime
                    ) {
                      return SerializableResult.toErr(
                        {
                          type: 'ConstructNotFound',
                          message: 'Snapshot incomplete',
                        },
                        StatusCode.NOT_FOUND,
                      );
                    }

                    return SerializableResult.toOk(
                      {
                        cursor: combined.cursor,
                        studioSnapshot: combined.studio,
                        labSnapshot: combined.lab,
                        runtimeSnapshot: combined.runtime,
                      },
                      StatusCode.OK,
                    );
                  },
                },
                component: DevLabPage,
              }),
          })),
        })),
    })),
  }));

export {
  constructRoutes,
  constructStreamRoutes,
  createConstructRoute,
  deleteConstructRoute,
  getCombinedSnapshotRoute,
  listConstructsRoute,
  readOnlyFileRoute,
};

// Aliases matching frontend.client.tsx import names
export const getContextTraceRoute = constructRoutes.getConstructContextTrace;
export const getLanesRoute = constructRoutes.getConstructLanes;
