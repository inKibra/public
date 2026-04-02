/**
 * Board Updates EventStream
 *
 * Real-time updates for board changes (cards moved, created, etc.)
 */

import {
  createEventStreamRoute,
  defineEventStreamSchema,
} from '@inkibra/router';
import type { BoardUpdates } from '../../schemas';
import {
  validateBoardUpdatesCompletionData,
  validateBoardUpdatesCompletionError,
  validateBoardUpdatesEvents,
  validateBoardUpdatesPathParams,
  validateBoardUpdatesPathQuery,
} from '../../schemas';
import { SessionCodec } from '../routes/auth';

// ============================================================================
// Schema
// ============================================================================

export const boardUpdatesSchema = defineEventStreamSchema({
  pathParams: validateBoardUpdatesPathParams,
  pathQuery: validateBoardUpdatesPathQuery,
  eventTypes: validateBoardUpdatesEvents,
  completionData: validateBoardUpdatesCompletionData,
  completionError: validateBoardUpdatesCompletionError,
});

// ============================================================================
// Route
// ============================================================================

export const boardUpdatesRoute = createEventStreamRoute({
  name: 'boardUpdates',
  path: '/api/streams/boards/:boardId',
  schema: boardUpdatesSchema,
  contextCodec: { session: SessionCodec },
});

// ============================================================================
// Export Types
// ============================================================================

export type { BoardUpdates };
