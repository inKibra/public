/**
 * Shared types for the example web app
 *
 * Domain: Workspace with Task Boards and Chat Channels
 */

// ============================================================================
// User & Session
// ============================================================================

/**
 * Simple user - just a username for this example
 */
export type User = {
  id: string;
  username: string;
  createdAt: string;
};

/**
 * Session data stored in context
 */
export type SessionData = {
  userId: string;
  username: string;
};

// ============================================================================
// Boards & Cards
// ============================================================================

/**
 * A board contains multiple lists
 */
export type Board = {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * A list within a board contains cards
 */
export type BoardList = {
  id: string;
  boardId: string;
  name: string;
  position: number;
  createdAt: string;
};

/**
 * A card within a list
 */
export type Card = {
  id: string;
  listId: string;
  boardId: string;
  title: string;
  description: string;
  position: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * A list with its cards
 */
export type BoardListWithCards = BoardList & { cards: Card[] };

/**
 * Board with all its lists and cards
 */
export type BoardWithContents = Board & {
  lists: BoardListWithCards[];
};

// ============================================================================
// Tasks
// ============================================================================

export type TaskStatus = 'todo' | 'in-progress' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high';
export const TaskType = 'Task' as const;
export type TaskType = typeof TaskType;

/**
 * A task within a board
 */
export type Task = {
  type: TaskType;
  id: string;
  boardId: string;
  listId?: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  position: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Request to create a task
 */
export type CreateTaskRequest = {
  title: string;
  description: string;
  listId?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
};

/**
 * Request to update a task
 */
export type UpdateTaskRequest = {
  title?: string;
  description?: string;
  listId?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  position?: number;
};

// ============================================================================
// Chat
// ============================================================================

/**
 * A chat channel within the workspace
 */
export type Channel = {
  id: string;
  name: string;
  description: string;
  boardId: string | null; // null = workspace-level channel
  createdBy: string;
  createdAt: string;
};

/**
 * A message in a channel
 */
export type Message = {
  id: string;
  channelId: string;
  content: string;
  authorId: string;
  authorUsername: string;
  createdAt: string;
};

// ============================================================================
// EventStream Events
// ============================================================================

/**
 * Board update events for real-time sync
 */
export type BoardUpdateEvent =
  | { type: 'card_created'; card: Card }
  | { type: 'card_updated'; card: Card }
  | {
      type: 'card_moved';
      cardId: string;
      fromListId: string;
      toListId: string;
      position: number;
    }
  | { type: 'card_deleted'; cardId: string }
  | { type: 'list_created'; list: BoardList }
  | { type: 'list_updated'; list: BoardList }
  | { type: 'list_deleted'; listId: string };

/**
 * Chat message events for real-time sync
 */
export type ChatMessageEvent =
  | { type: 'message_created'; message: Message }
  | { type: 'message_deleted'; messageId: string };

// ============================================================================
// API Request/Response Types
// ============================================================================

// Auth
export type LoginRequest = {
  username: string;
};

export type LoginResponse = {
  user: User;
};

// Boards
export type CreateBoardRequest = {
  name: string;
  description: string;
};

export type CreateListRequest = {
  name: string;
};

export type CreateCardRequest = {
  title: string;
  description: string;
};

export type MoveCardRequest = {
  toListId: string;
  position: number;
};

export type UpdateCardRequest = {
  title?: string;
  description?: string;
};

// Chat
export type CreateChannelRequest = {
  name: string;
  description: string;
  boardId?: string;
};

export type SendMessageRequest = {
  content: string;
};

// ============================================================================
// Blog
// ============================================================================

/**
 * A blog post - static content for the blog example
 */
export type BlogPost = {
  id: string;
  title: string;
  slug: string;
  content: string;
  authorId: string;
  authorUsername: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Request to create a new blog post
 */
export type CreateBlogPostRequest = {
  title: string;
  content: string;
};
