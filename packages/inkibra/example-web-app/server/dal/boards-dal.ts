/**
 * Boards Data Access Layer
 *
 * Redis-based storage for boards, lists, and cards
 */

import type { RedisClient } from 'bun';
import type {
  Board,
  BoardList,
  BoardWithContents,
  Card,
  Task,
} from '../../shared/types';

// ============================================================================
// Redis Key Patterns
// ============================================================================

const KEYS = {
  boards: () => 'boards',
  board: (id: string) => `board:${id}`,
  boardLists: (boardId: string) => `board:${boardId}:lists`,
  boardTasks: (boardId: string) => `board:${boardId}:tasks`,
  list: (id: string) => `list:${id}`,
  listCards: (listId: string) => `list:${listId}:cards`,
  card: (id: string) => `card:${id}`,
  task: (id: string) => `task:${id}`,
  userBoards: (userId: string) => `user:${userId}:boards`,
};

// ============================================================================
// Boards DAL
// ============================================================================

export type BoardsDal = {
  // Boards
  listBoards: (userId: string) => Promise<Board[]>;
  getBoard: (boardId: string) => Promise<Board | null>;
  getBoardWithContents: (boardId: string) => Promise<BoardWithContents | null>;
  createBoard: (board: Board) => Promise<Board>;
  deleteBoard: (boardId: string) => Promise<boolean>;

  // Lists
  getLists: (boardId: string) => Promise<BoardList[]>;
  getList: (listId: string) => Promise<BoardList | null>;
  createList: (list: BoardList) => Promise<BoardList>;
  deleteList: (listId: string) => Promise<boolean>;

  // Cards
  getCards: (listId: string) => Promise<Card[]>;
  getCard: (cardId: string) => Promise<Card | null>;
  createCard: (card: Card) => Promise<Card>;
  updateCard: (cardId: string, updates: Partial<Card>) => Promise<Card | null>;
  moveCard: (
    cardId: string,
    toListId: string,
    position: number,
  ) => Promise<Card | null>;
  deleteCard: (cardId: string) => Promise<boolean>;

  // Tasks
  getTasks: (boardId: string, listId?: string) => Promise<Task[]>;
  getAllTasks: (limit?: number) => Promise<Task[]>;
  getTask: (taskId: string) => Promise<Task | null>;
  createTask: (task: Task) => Promise<Task>;
  updateTask: (taskId: string, updates: Partial<Task>) => Promise<Task | null>;
  deleteTask: (taskId: string) => Promise<boolean>;
};

export function createBoardsDal(redis: RedisClient): BoardsDal {
  return {
    // ========================================================================
    // Boards
    // ========================================================================

    async listBoards(userId: string): Promise<Board[]> {
      const boardIds = await redis.send('SMEMBERS', [KEYS.userBoards(userId)]);
      if (!Array.isArray(boardIds) || boardIds.length === 0) return [];

      const boards: Board[] = [];
      for (const id of boardIds) {
        const data = await redis.get(KEYS.board(id as string));
        if (data) {
          boards.push(JSON.parse(data) as Board);
        }
      }
      return boards.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async getBoard(boardId: string): Promise<Board | null> {
      const data = await redis.get(KEYS.board(boardId));
      return data ? (JSON.parse(data) as Board) : null;
    },

    async getBoardWithContents(
      boardId: string,
    ): Promise<BoardWithContents | null> {
      const board = await this.getBoard(boardId);
      if (!board) return null;

      const lists = await this.getLists(boardId);
      const listsWithCards = await Promise.all(
        lists.map(async (list) => ({
          ...list,
          cards: await this.getCards(list.id),
        })),
      );

      return {
        ...board,
        lists: listsWithCards.sort((a, b) => a.position - b.position),
      };
    },

    async createBoard(board: Board): Promise<Board> {
      await redis.set(KEYS.board(board.id), JSON.stringify(board));
      await redis.send('SADD', [KEYS.userBoards(board.ownerId), board.id]);
      await redis.send('SADD', [KEYS.boards(), board.id]);
      return board;
    },

    async deleteBoard(boardId: string): Promise<boolean> {
      const board = await this.getBoard(boardId);
      if (!board) return false;

      // Delete all lists and cards
      const lists = await this.getLists(boardId);
      for (const list of lists) {
        await this.deleteList(list.id);
      }

      await redis.del(KEYS.board(boardId));
      await redis.del(KEYS.boardLists(boardId));
      await redis.send('SREM', [KEYS.userBoards(board.ownerId), boardId]);
      await redis.send('SREM', [KEYS.boards(), boardId]);
      return true;
    },

    // ========================================================================
    // Lists
    // ========================================================================

    async getLists(boardId: string): Promise<BoardList[]> {
      const listIds = await redis.send('SMEMBERS', [KEYS.boardLists(boardId)]);
      if (!Array.isArray(listIds) || listIds.length === 0) return [];

      const lists: BoardList[] = [];
      for (const id of listIds) {
        const data = await redis.get(KEYS.list(id as string));
        if (data) {
          lists.push(JSON.parse(data) as BoardList);
        }
      }
      return lists.sort((a, b) => a.position - b.position);
    },

    async getList(listId: string): Promise<BoardList | null> {
      const data = await redis.get(KEYS.list(listId));
      return data ? (JSON.parse(data) as BoardList) : null;
    },

    async createList(list: BoardList): Promise<BoardList> {
      await redis.set(KEYS.list(list.id), JSON.stringify(list));
      await redis.send('SADD', [KEYS.boardLists(list.boardId), list.id]);
      return list;
    },

    async deleteList(listId: string): Promise<boolean> {
      const list = await this.getList(listId);
      if (!list) return false;

      // Delete all cards in the list
      const cards = await this.getCards(listId);
      for (const card of cards) {
        await this.deleteCard(card.id);
      }

      await redis.del(KEYS.list(listId));
      await redis.del(KEYS.listCards(listId));
      await redis.send('SREM', [KEYS.boardLists(list.boardId), listId]);
      return true;
    },

    // ========================================================================
    // Cards
    // ========================================================================

    async getCards(listId: string): Promise<Card[]> {
      const cardIds = await redis.send('SMEMBERS', [KEYS.listCards(listId)]);
      if (!Array.isArray(cardIds) || cardIds.length === 0) return [];

      const cards: Card[] = [];
      for (const id of cardIds) {
        const data = await redis.get(KEYS.card(id as string));
        if (data) {
          cards.push(JSON.parse(data) as Card);
        }
      }
      return cards.sort((a, b) => a.position - b.position);
    },

    async getCard(cardId: string): Promise<Card | null> {
      const data = await redis.get(KEYS.card(cardId));
      return data ? (JSON.parse(data) as Card) : null;
    },

    async createCard(card: Card): Promise<Card> {
      await redis.set(KEYS.card(card.id), JSON.stringify(card));
      await redis.send('SADD', [KEYS.listCards(card.listId), card.id]);
      return card;
    },

    async updateCard(
      cardId: string,
      updates: Partial<Card>,
    ): Promise<Card | null> {
      const card = await this.getCard(cardId);
      if (!card) return null;

      const updatedCard: Card = {
        ...card,
        ...updates,
        id: card.id, // Don't allow changing ID
        updatedAt: new Date().toISOString(),
      };

      await redis.set(KEYS.card(cardId), JSON.stringify(updatedCard));
      return updatedCard;
    },

    async moveCard(
      cardId: string,
      toListId: string,
      position: number,
    ): Promise<Card | null> {
      const card = await this.getCard(cardId);
      if (!card) return null;

      const fromListId = card.listId;

      // Update card
      const updatedCard: Card = {
        ...card,
        listId: toListId,
        position,
        updatedAt: new Date().toISOString(),
      };

      await redis.set(KEYS.card(cardId), JSON.stringify(updatedCard));

      // Move between lists if necessary
      if (fromListId !== toListId) {
        await redis.send('SREM', [KEYS.listCards(fromListId), cardId]);
        await redis.send('SADD', [KEYS.listCards(toListId), cardId]);
      }

      return updatedCard;
    },

    async deleteCard(cardId: string): Promise<boolean> {
      const card = await this.getCard(cardId);
      if (!card) return false;

      await redis.del(KEYS.card(cardId));
      await redis.send('SREM', [KEYS.listCards(card.listId), cardId]);
      return true;
    },

    // ========================================================================
    // Tasks
    // ========================================================================

    async getTasks(boardId: string, listId?: string): Promise<Task[]> {
      const taskIds = await redis.send('SMEMBERS', [KEYS.boardTasks(boardId)]);
      if (!Array.isArray(taskIds) || taskIds.length === 0) return [];

      const tasks: Task[] = [];
      for (const id of taskIds) {
        const data = await redis.get(KEYS.task(id as string));
        if (data) {
          const task = JSON.parse(data) as Task;
          const normalized: Task = { ...task, type: 'Task' };
          // Filter by listId if provided
          if (listId === undefined || normalized.listId === listId) {
            tasks.push(normalized);
          }
        }
      }
      return tasks.sort((a, b) => a.position - b.position);
    },

    async getAllTasks(limit?: number): Promise<Task[]> {
      const boardIds = await redis.send('SMEMBERS', [KEYS.boards()]);
      if (!Array.isArray(boardIds) || boardIds.length === 0) return [];

      const tasks: Task[] = [];
      for (const boardId of boardIds) {
        const boardTasks = await this.getTasks(boardId as string);
        tasks.push(...boardTasks);
      }

      const sorted = tasks.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );

      if (typeof limit === 'number' && limit > 0) {
        return sorted.slice(0, limit);
      }
      return sorted;
    },

    async getTask(taskId: string): Promise<Task | null> {
      const data = await redis.get(KEYS.task(taskId));
      if (!data) return null;
      const task = JSON.parse(data) as Task;
      return { ...task, type: 'Task' };
    },

    async createTask(task: Task): Promise<Task> {
      const taskWithType: Task = { ...task, type: 'Task' };
      await redis.set(KEYS.task(task.id), JSON.stringify(taskWithType));
      await redis.send('SADD', [KEYS.boardTasks(task.boardId), task.id]);
      return taskWithType;
    },

    async updateTask(
      taskId: string,
      updates: Partial<Task>,
    ): Promise<Task | null> {
      const task = await this.getTask(taskId);
      if (!task) return null;

      const updatedTask: Task = {
        ...task,
        ...updates,
        type: 'Task',
        id: task.id, // Don't allow changing ID
        boardId: task.boardId, // Don't allow changing boardId
        updatedAt: new Date().toISOString(),
      };

      await redis.set(KEYS.task(taskId), JSON.stringify(updatedTask));
      return updatedTask;
    },

    async deleteTask(taskId: string): Promise<boolean> {
      const task = await this.getTask(taskId);
      if (!task) return false;

      await redis.del(KEYS.task(taskId));
      await redis.send('SREM', [KEYS.boardTasks(task.boardId), taskId]);
      return true;
    },
  };
}
