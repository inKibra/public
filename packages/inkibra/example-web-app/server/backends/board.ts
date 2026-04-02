/**
 * Board Backend
 *
 * Board API handlers with typed implementations.
 */

import { createBackend } from '@inkibra/denzel-bun';
import type { EventStreamChannelFactory } from '@inkibra/router';
import type { RedisClient } from 'bun';
import {
  boardUpdatesHandlerProvider,
  createBoardHandlerProvider,
  createCardHandlerProvider,
  createListHandlerProvider,
  createTaskHandlerProvider,
  deleteCardHandlerProvider,
  deleteTaskHandlerProvider,
  getBoardHandlerProvider,
  getTaskHandlerProvider,
  listAllTasksHandlerProvider,
  listBoardsHandlerProvider,
  listTasksHandlerProvider,
  moveCardHandlerProvider,
  updateCardHandlerProvider,
  updateTaskHandlerProvider,
} from '../handlers/board-handlers';

// ============================================================================
// Dependencies
// ============================================================================

export type BoardBackendDeps = {
  redis: RedisClient;
  channelFactory: EventStreamChannelFactory;
};

// ============================================================================
// Create Board Backend
// ============================================================================

/**
 * Create the board backend with typed handlers
 *
 * Uses explicit keys (not spread) to preserve type information.
 *
 * Usage:
 * ```typescript
 * const { listBoards } = boardBackend.apiHandlers.listBoards.with({ session });
 * const { createBoard } = boardBackend.apiHandlers.createBoard.with({ session });
 * ```
 */
export function createBoardBackend(deps: BoardBackendDeps) {
  const { redis, channelFactory } = deps;
  const handlerDeps = { redis };

  return createBackend({
    apiHandlers: {
      listBoards: listBoardsHandlerProvider(handlerDeps),
      getBoard: getBoardHandlerProvider(handlerDeps),
      createBoard: createBoardHandlerProvider(handlerDeps),
      createList: createListHandlerProvider(handlerDeps),
      createCard: createCardHandlerProvider(handlerDeps),
      updateCard: updateCardHandlerProvider(handlerDeps),
      moveCard: moveCardHandlerProvider(handlerDeps),
      deleteCard: deleteCardHandlerProvider(handlerDeps),
      // Task handlers
      listAllTasks: listAllTasksHandlerProvider(handlerDeps),
      listTasks: listTasksHandlerProvider(handlerDeps),
      getTask: getTaskHandlerProvider(handlerDeps),
      createTask: createTaskHandlerProvider(handlerDeps),
      updateTask: updateTaskHandlerProvider(handlerDeps),
      deleteTask: deleteTaskHandlerProvider(handlerDeps),
    },
    streamHandlers: {
      boardUpdates: boardUpdatesHandlerProvider(handlerDeps),
    },
    channelFactory,
  });
}

// Type for the board backend
export type BoardBackend = ReturnType<typeof createBoardBackend>;
