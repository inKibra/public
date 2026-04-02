/**
 * Board Handlers
 *
 * Implementation of board API routes using createApiRouteHandlerProvider
 *
 * Context codecs are now on the routes - no need to pass them to handlers.
 */

import {
  createApiRouteHandlerProvider,
  createEventStreamHandlerProvider,
} from '@inkibra/denzel-bun';
import {
  createApiRouteHandler,
  createEventStreamHandler,
  Err,
  Ok,
  SerializableResult,
  StatusCode,
} from '@inkibra/router';
import type { RedisClient } from 'bun';
import {
  createBoardRoute,
  createCardRoute,
  createListRoute,
  deleteCardRoute,
  getBoardRoute,
  listBoardsRoute,
  moveCardRoute,
  updateCardRoute,
} from '../../api/routes/boards';
import {
  createTaskRoute,
  deleteTaskRoute,
  getTaskRoute,
  listAllTasksRoute,
  listTasksRoute,
  updateTaskRoute,
} from '../../api/routes/tasks';
import { boardUpdatesRoute } from '../../api/streams/board-updates';
import type {
  Board,
  BoardList,
  Card,
  SessionData,
  Task,
} from '../../shared/types';
import { createBoardsDal } from '../dal/boards-dal';

// ============================================================================
// Dependencies
// ============================================================================

export type BoardDeps = {
  redis: RedisClient;
};

// ============================================================================
// Helper Functions
// ============================================================================

function generateId(): string {
  return crypto.randomUUID();
}

function getAuthenticatedSession(ctx: {
  session: { type: 'Ok' | 'Err'; value: SessionData | null };
}): SessionData | null {
  if (ctx.session.type === 'Err') {
    return null;
  }

  return ctx.session.value;
}

// ============================================================================
// Handlers
// ============================================================================

export const listBoardsHandlerProvider = createApiRouteHandlerProvider(
  (deps: BoardDeps) =>
    createApiRouteHandler({
      route: listBoardsRoute,
      handler: async (_args, ctx) => {
        // Handle unauthenticated requests
        const session = getAuthenticatedSession(ctx);
        if (!session) {
          return SerializableResult.toErr(
            { type: 'Unauthorized' as const },
            StatusCode.NOT_AUTHENTICATED,
          );
        }

        const dal = createBoardsDal(deps.redis);
        const boards = await dal.listBoards(session.userId);
        return SerializableResult.toOk(boards, StatusCode.OK);
      },
    }),
);

export const getBoardHandlerProvider = createApiRouteHandlerProvider(
  (deps: BoardDeps) =>
    createApiRouteHandler({
      route: getBoardRoute,
      handler: async (args) => {
        const dal = createBoardsDal(deps.redis);
        const board = await dal.getBoardWithContents(args.pathParams.boardId);

        if (!board) {
          return SerializableResult.toErr(
            { type: 'BoardNotFound' as const },
            StatusCode.NOT_FOUND,
          );
        }

        return SerializableResult.toOk(board, StatusCode.OK);
      },
    }),
);

export const createBoardHandlerProvider = createApiRouteHandlerProvider(
  (deps: BoardDeps) =>
    createApiRouteHandler({
      route: createBoardRoute,
      handler: async (args, ctx) => {
        const session = getAuthenticatedSession(ctx);
        if (!session) {
          return SerializableResult.toErr(
            { type: 'Unauthorized' as const },
            StatusCode.NOT_AUTHENTICATED,
          );
        }

        const dal = createBoardsDal(deps.redis);

        const board: Board = {
          id: generateId(),
          name: args.body.name,
          description: args.body.description,
          ownerId: session.userId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        await dal.createBoard(board);
        return SerializableResult.toOk(board, StatusCode.CREATED);
      },
    }),
);

export const createListHandlerProvider = createApiRouteHandlerProvider(
  (deps: BoardDeps) =>
    createApiRouteHandler({
      route: createListRoute,
      handler: async (args) => {
        const dal = createBoardsDal(deps.redis);

        // Check board exists
        const board = await dal.getBoard(args.pathParams.boardId);
        if (!board) {
          return SerializableResult.toErr(
            { type: 'BoardNotFound' as const },
            StatusCode.NOT_FOUND,
          );
        }

        // Get existing lists to determine position
        const existingLists = await dal.getLists(args.pathParams.boardId);

        const list: BoardList = {
          id: generateId(),
          boardId: args.pathParams.boardId,
          name: args.body.name,
          position: existingLists.length,
          createdAt: new Date().toISOString(),
        };

        await dal.createList(list);
        return SerializableResult.toOk(list, StatusCode.CREATED);
      },
    }),
);

export const createCardHandlerProvider = createApiRouteHandlerProvider(
  (deps: BoardDeps) =>
    createApiRouteHandler({
      route: createCardRoute,
      handler: async (args, ctx) => {
        const session = getAuthenticatedSession(ctx);
        if (!session) {
          return SerializableResult.toErr(
            { type: 'Unauthorized' as const },
            StatusCode.NOT_AUTHENTICATED,
          );
        }

        const dal = createBoardsDal(deps.redis);

        // Check list exists
        const list = await dal.getList(args.pathParams.listId);
        if (!list) {
          return SerializableResult.toErr(
            { type: 'ListNotFound' as const },
            StatusCode.NOT_FOUND,
          );
        }

        // Get existing cards to determine position
        const existingCards = await dal.getCards(args.pathParams.listId);

        const card: Card = {
          id: generateId(),
          listId: args.pathParams.listId,
          boardId: args.pathParams.boardId,
          title: args.body.title,
          description: args.body.description,
          position: existingCards.length,
          createdBy: session.userId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        await dal.createCard(card);
        return SerializableResult.toOk(card, StatusCode.CREATED);
      },
    }),
);

export const updateCardHandlerProvider = createApiRouteHandlerProvider(
  (deps: BoardDeps) =>
    createApiRouteHandler({
      route: updateCardRoute,
      handler: async (args) => {
        const dal = createBoardsDal(deps.redis);

        const updatedCard = await dal.updateCard(args.pathParams.cardId, {
          title: args.body.title,
          description: args.body.description,
        });

        if (!updatedCard) {
          return SerializableResult.toErr(
            { type: 'CardNotFound' as const },
            StatusCode.NOT_FOUND,
          );
        }

        return SerializableResult.toOk(updatedCard, StatusCode.OK);
      },
    }),
);

export const moveCardHandlerProvider = createApiRouteHandlerProvider(
  (deps: BoardDeps) =>
    createApiRouteHandler({
      route: moveCardRoute,
      handler: async (args) => {
        const dal = createBoardsDal(deps.redis);

        // Check target list exists
        const targetList = await dal.getList(args.body.toListId);
        if (!targetList) {
          return SerializableResult.toErr(
            { type: 'ListNotFound' as const },
            StatusCode.NOT_FOUND,
          );
        }

        const movedCard = await dal.moveCard(
          args.pathParams.cardId,
          args.body.toListId,
          args.body.position,
        );

        if (!movedCard) {
          return SerializableResult.toErr(
            { type: 'CardNotFound' as const },
            StatusCode.NOT_FOUND,
          );
        }

        return SerializableResult.toOk(movedCard, StatusCode.OK);
      },
    }),
);

export const deleteCardHandlerProvider = createApiRouteHandlerProvider(
  (deps: BoardDeps) =>
    createApiRouteHandler({
      route: deleteCardRoute,
      handler: async (args) => {
        const dal = createBoardsDal(deps.redis);

        const deleted = await dal.deleteCard(args.pathParams.cardId);
        if (!deleted) {
          return SerializableResult.toErr(
            { type: 'CardNotFound' as const },
            StatusCode.NOT_FOUND,
          );
        }

        return SerializableResult.toOk(
          { success: true as const },
          StatusCode.OK,
        );
      },
    }),
);

// ============================================================================
// Stream Handlers
// ============================================================================

export const boardUpdatesHandlerProvider = createEventStreamHandlerProvider(
  (deps: BoardDeps) =>
    createEventStreamHandler({
      route: boardUpdatesRoute,
      handler: async function* (args, _ctx, channelFactory) {
        if (!channelFactory) {
          return Err({ type: 'BoardNotFound' as const });
        }
        const dal = createBoardsDal(deps.redis);

        // Check board exists and user has access
        const board = await dal.getBoard(args.pathParams.boardId);
        if (!board) {
          return Err({ type: 'BoardNotFound' as const });
        }

        // Subscribe to channel for board updates
        await using channel = channelFactory.get(boardUpdatesRoute, args);

        // Listen for events
        for await (const event of channel) {
          yield event;
        }

        return Ok({ reason: 'disconnected' as const });
      },
    }),
);

// ============================================================================
// Task Handlers
// ============================================================================

export const listTasksHandlerProvider = createApiRouteHandlerProvider(
  (deps: BoardDeps) =>
    createApiRouteHandler({
      route: listTasksRoute,
      handler: async (args, ctx) => {
        const session = getAuthenticatedSession(ctx);
        if (!session) {
          return SerializableResult.toErr(
            { type: 'Unauthorized' as const },
            StatusCode.NOT_AUTHENTICATED,
          );
        }

        const dal = createBoardsDal(deps.redis);
        const tasks = await dal.getTasks(
          args.pathParams.boardId,
          args.pathQuery.listId,
        );

        // Filter by status if provided
        const filteredTasks = args.pathQuery.status
          ? tasks.filter((t) => t.status === args.pathQuery.status)
          : tasks;

        return SerializableResult.toOk(filteredTasks, StatusCode.OK);
      },
    }),
);

export const listAllTasksHandlerProvider = createApiRouteHandlerProvider(
  (deps: BoardDeps) =>
    createApiRouteHandler({
      route: listAllTasksRoute,
      handler: async (args, ctx) => {
        const session = getAuthenticatedSession(ctx);
        if (!session) {
          return SerializableResult.toErr(
            { type: 'Unauthorized' as const },
            StatusCode.NOT_AUTHENTICATED,
          );
        }

        const dal = createBoardsDal(deps.redis);
        const tasks = await dal.getAllTasks(args.pathQuery.limit);
        return SerializableResult.toOk(tasks, StatusCode.OK);
      },
    }),
);

export const getTaskHandlerProvider = createApiRouteHandlerProvider(
  (deps: BoardDeps) =>
    createApiRouteHandler({
      route: getTaskRoute,
      handler: async (args, ctx) => {
        const session = getAuthenticatedSession(ctx);
        if (!session) {
          return SerializableResult.toErr(
            { type: 'Unauthorized' as const },
            StatusCode.NOT_AUTHENTICATED,
          );
        }

        const dal = createBoardsDal(deps.redis);
        const task = await dal.getTask(args.pathParams.taskId);
        if (!task) {
          return SerializableResult.toErr(
            { type: 'TaskNotFound' as const },
            StatusCode.NOT_FOUND,
          );
        }

        return SerializableResult.toOk(task, StatusCode.OK);
      },
    }),
);

export const createTaskHandlerProvider = createApiRouteHandlerProvider(
  (deps: BoardDeps) =>
    createApiRouteHandler({
      route: createTaskRoute,
      handler: async (args, ctx) => {
        const session = getAuthenticatedSession(ctx);
        if (!session) {
          return SerializableResult.toErr(
            { type: 'Unauthorized' as const },
            StatusCode.NOT_AUTHENTICATED,
          );
        }

        const dal = createBoardsDal(deps.redis);

        // Check board exists
        const board = await dal.getBoard(args.pathParams.boardId);
        if (!board) {
          return SerializableResult.toErr(
            { type: 'BoardNotFound' as const },
            StatusCode.NOT_FOUND,
          );
        }

        // Get existing tasks to determine position
        const existingTasks = await dal.getTasks(
          args.pathParams.boardId,
          args.body.listId,
        );

        const task: Task = {
          type: 'Task',
          id: generateId(),
          boardId: args.pathParams.boardId,
          listId: args.body.listId,
          title: args.body.title,
          description: args.body.description,
          status: args.body.status ?? 'todo',
          priority: args.body.priority ?? 'medium',
          position: existingTasks.length,
          createdBy: session.userId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        await dal.createTask(task);
        return SerializableResult.toOk(task, StatusCode.CREATED);
      },
    }),
);

export const updateTaskHandlerProvider = createApiRouteHandlerProvider(
  (deps: BoardDeps) =>
    createApiRouteHandler({
      route: updateTaskRoute,
      handler: async (args) => {
        const dal = createBoardsDal(deps.redis);

        const updatedTask = await dal.updateTask(args.pathParams.taskId, {
          title: args.body.title,
          description: args.body.description,
          listId: args.body.listId,
          status: args.body.status,
          priority: args.body.priority,
          position: args.body.position,
          type: 'Task',
        });

        if (!updatedTask) {
          return SerializableResult.toErr(
            { type: 'TaskNotFound' as const },
            StatusCode.NOT_FOUND,
          );
        }

        return SerializableResult.toOk(updatedTask, StatusCode.OK);
      },
    }),
);

export const deleteTaskHandlerProvider = createApiRouteHandlerProvider(
  (deps: BoardDeps) =>
    createApiRouteHandler({
      route: deleteTaskRoute,
      handler: async (args) => {
        const dal = createBoardsDal(deps.redis);

        const deleted = await dal.deleteTask(args.pathParams.taskId);
        if (!deleted) {
          return SerializableResult.toErr(
            { type: 'TaskNotFound' as const },
            StatusCode.NOT_FOUND,
          );
        }

        return SerializableResult.toOk(
          { success: true as const },
          StatusCode.OK,
        );
      },
    }),
);
