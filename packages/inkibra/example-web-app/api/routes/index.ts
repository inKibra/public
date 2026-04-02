/**
 * API Routes Index
 *
 * Export all route definitions
 */

export * from './auth';
export * from './boards';
export * from './chat';
export * from './tasks';

import { authRoutes, SessionCodec } from './auth';
import { boardRoutes } from './boards';
import { chatRoutes } from './chat';
import { taskRoutes } from './tasks';

/**
 * All API routes grouped by domain
 */
export const apiRoutes = {
  ...authRoutes,
  ...boardRoutes,
  ...chatRoutes,
  ...taskRoutes,
};

/**
 * Context codecs used by routes
 */
export const contextCodecs = {
  session: SessionCodec,
};
