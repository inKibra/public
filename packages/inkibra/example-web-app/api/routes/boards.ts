/**
 * Boards API Routes
 *
 * CRUD operations for boards, lists, and cards
 */

import { createAPIRoute } from '@inkibra/router';
import { HttpMethod } from '@inkibra/router/constants/http-method';
import type {
  CreateBoard,
  CreateCard,
  CreateList,
  DeleteCard,
  GetBoard,
  ListBoards,
  MoveCard,
  UpdateCard,
} from '../../schemas';
import {
  createBoardSchema as createBoardRouteSchema,
  createCardSchema as createCardRouteSchema,
  createListSchema as createListRouteSchema,
  deleteCardSchema as deleteCardRouteSchema,
  getBoardSchema as getBoardRouteSchema,
  listBoardsSchema as listBoardsRouteSchema,
  moveCardSchema as moveCardRouteSchema,
  updateCardSchema as updateCardRouteSchema,
} from '../../schemas';
import { SessionCodec } from './auth';

// ============================================================================
// List Boards
// ============================================================================

export const listBoardsSchema = listBoardsRouteSchema;

export const listBoardsRoute = createAPIRoute({
  name: 'listBoards',
  method: HttpMethod.GET,
  path: '/api/boards',
  schema: listBoardsSchema,
  contextCodec: { session: SessionCodec },
});

// ============================================================================
// Get Board
// ============================================================================

export const getBoardSchema = getBoardRouteSchema;

export const getBoardRoute = createAPIRoute({
  name: 'getBoard',
  method: HttpMethod.GET,
  path: '/api/boards/:boardId',
  schema: getBoardSchema,
  contextCodec: { session: SessionCodec },
});

// ============================================================================
// Create Board
// ============================================================================

export const createBoardSchema = createBoardRouteSchema;

export const createBoardRoute = createAPIRoute({
  name: 'createBoard',
  method: HttpMethod.POST,
  path: '/api/boards',
  schema: createBoardSchema,
  contextCodec: { session: SessionCodec },
});

// ============================================================================
// Create List
// ============================================================================

export const createListSchema = createListRouteSchema;

export const createListRoute = createAPIRoute({
  name: 'createList',
  method: HttpMethod.POST,
  path: '/api/boards/:boardId/lists',
  schema: createListSchema,
  contextCodec: { session: SessionCodec },
});

// ============================================================================
// Create Card
// ============================================================================

export const createCardSchema = createCardRouteSchema;

export const createCardRoute = createAPIRoute({
  name: 'createCard',
  method: HttpMethod.POST,
  path: '/api/boards/:boardId/lists/:listId/cards',
  schema: createCardSchema,
  contextCodec: { session: SessionCodec },
});

// ============================================================================
// Update Card
// ============================================================================

export const updateCardSchema = updateCardRouteSchema;

export const updateCardRoute = createAPIRoute({
  name: 'updateCard',
  method: HttpMethod.PATCH,
  path: '/api/boards/:boardId/cards/:cardId',
  schema: updateCardSchema,
  contextCodec: { session: SessionCodec },
});

// ============================================================================
// Move Card
// ============================================================================

export const moveCardSchema = moveCardRouteSchema;

export const moveCardRoute = createAPIRoute({
  name: 'moveCard',
  method: HttpMethod.POST,
  path: '/api/boards/:boardId/cards/:cardId/move',
  schema: moveCardSchema,
  contextCodec: { session: SessionCodec },
});

// ============================================================================
// Delete Card
// ============================================================================

export const deleteCardSchema = deleteCardRouteSchema;

export const deleteCardRoute = createAPIRoute({
  name: 'deleteCard',
  method: HttpMethod.DELETE,
  path: '/api/boards/:boardId/cards/:cardId',
  schema: deleteCardSchema,
  contextCodec: { session: SessionCodec },
});

// ============================================================================
// Export Types and Routes
// ============================================================================

export type {
  ListBoards,
  GetBoard,
  CreateBoard,
  CreateList,
  CreateCard,
  UpdateCard,
  MoveCard,
  DeleteCard,
};

export const boardRoutes = {
  listBoards: listBoardsRoute,
  getBoard: getBoardRoute,
  createBoard: createBoardRoute,
  createList: createListRoute,
  createCard: createCardRoute,
  updateCard: updateCardRoute,
  moveCard: moveCardRoute,
  deleteCard: deleteCardRoute,
};
