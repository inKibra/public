/**
 * API Index
 *
 * Export all route and stream definitions
 */

export * from './routes';
export * from './streams';

import { apiRoutes, contextCodecs } from './routes';
import { eventStreamRoutes } from './streams';

/**
 * All routes (API and EventStream)
 */
export const routes = {
  api: apiRoutes,
  streams: eventStreamRoutes,
  contextCodecs,
};
