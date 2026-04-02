/**
 * Factory that creates ConstructLabCallbacks from typed apiImplementations.
 * Binds pathParams and ctx — returns simple domain-level callbacks.
 */

import type { ApiRouteImplementations } from '@inkibra/router/lib/app-route';
import type { createConstructBackendRoutes } from '../backend/routes';
import type { ConstructLabCallbacks } from './use-construct-lab';

/** Full typed construct route implementations */
type ConstructRouteImpls = ApiRouteImplementations<
  ReturnType<typeof createConstructBackendRoutes>
>;

/**
 * Named route implementations required for the lab.
 */
export type LabRouteImplementations = {
  submitAction: ConstructRouteImpls['applyConstructLabAction'];
  enterEditMode: ConstructRouteImpls['enterConstructEditMode'];
  exitEditMode: ConstructRouteImpls['exitConstructEditMode'];
  readFile: ConstructRouteImpls['readConstructFile'];
  writeFile: ConstructRouteImpls['writeConstructFile'];
  deleteFile: ConstructRouteImpls['deleteConstructFile'];
  listFiles: ConstructRouteImpls['listConstructFiles'];
};

export function createLabCallbacksFromApi(
  routes: LabRouteImplementations,
  constructId: string,
  ctx: Parameters<LabRouteImplementations['submitAction']['execute']>[1],
): ConstructLabCallbacks {
  const std = <TBody>(body: TBody) => ({
    pathParams: { constructId },
    pathQuery: {} as Record<string, never>,
    body,
    files: undefined as undefined,
  });

  return {
    submitAction: (action) => routes.submitAction.execute(std(action), ctx),
    enterEditMode: () => routes.enterEditMode.execute(std({}), ctx),
    exitEditMode: () => routes.exitEditMode.execute(std({}), ctx),
    readFile: (path) => routes.readFile.execute(std({ path }), ctx),
    writeFile: (path, content) =>
      routes.writeFile.execute(std({ path, content }), ctx),
    deleteFile: (path) => routes.deleteFile.execute(std({ path }), ctx),
    listFiles: () => routes.listFiles.execute(std({}), ctx),
  };
}
