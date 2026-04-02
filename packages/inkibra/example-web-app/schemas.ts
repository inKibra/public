/**
 * Schema validators for the example web app
 *
 * Uses typia for runtime type validation.
 * This file is processed by generate-schemas to create .schemas.js
 */

import {
  defineRouteSchema,
  type SerializableResult,
  type StatusCode,
} from '@inkibra/router';
// biome-ignore lint/style/noRestrictedImports: typia is allowed in schema files
import typia from 'typia';
import type {
  BlogPost,
  Board,
  BoardList,
  BoardWithContents,
  Card,
  Channel,
  CreateBlogPostRequest,
  CreateBoardRequest,
  CreateCardRequest,
  CreateChannelRequest,
  CreateListRequest,
  CreateTaskRequest,
  LoginRequest,
  LoginResponse,
  Message,
  MoveCardRequest,
  SendMessageRequest,
  SessionData,
  Task,
  UpdateCardRequest,
  UpdateTaskRequest,
  User,
} from './shared/types';

// ============================================================================
// Entity Validators
// ============================================================================

export const validateUser = typia.createValidate<User>();
export const validateSessionData = typia.createValidate<SessionData>();
export const validateBoard = typia.createValidate<Board>();
export const validateBoardList = typia.createValidate<BoardList>();
export const validateCard = typia.createValidate<Card>();
export const validateChannel = typia.createValidate<Channel>();
export const validateMessage = typia.createValidate<Message>();

// ============================================================================
// Loader Schema Validators
// ============================================================================

/** Validator for Board[] (boards list loader) */
export const validateBoardsLoaderResponse = typia.createValidate<Board[]>();

/** Validator for BoardWithContents (board detail loader) */
export const validateBoardLoaderResponse =
  typia.createValidate<BoardWithContents>();

/** Validator for Channel[] (channels list loader) */
export const validateChannelsLoaderResponse = typia.createValidate<Channel[]>();

/** Validator for channel detail loader data */
export const validateChannelDetailLoaderResponse = typia.createValidate<{
  channel: Channel;
  messages: Message[];
}>();

/** Generic loader error validator - accepts any error with a type property */
export const validateLoaderError = typia.createValidate<{ type: string }>();

// Type guards
export const isUser = typia.createIs<User>();
export const isSessionData = typia.createIs<SessionData>();
export const isBoard = typia.createIs<Board>();
export const isCard = typia.createIs<Card>();
export const isChannel = typia.createIs<Channel>();
export const isMessage = typia.createIs<Message>();

// ============================================================================
// Query Schema Validators
// ============================================================================

/** Validator for task panel query param */
export const validateTaskPanelQueryTaskId = typia.createValidate<
  string | undefined
>();

// ============================================================================
// Auth Route Validators
// ============================================================================

// Login
export namespace Login {
  export type PathParams = Record<string, never>;
  export type PathQuery = Record<string, never>;
  export type Body = LoginRequest;
  export type Response =
    | SerializableResult.OkWithStatusCode<LoginResponse, StatusCode.OK>
    | SerializableResult.ErrWithStatusCode<
        { type: 'InvalidUsername' },
        StatusCode.BAD_REQUEST
      >;
}

export const validateLoginPathParams = typia.createValidate<Login.PathParams>();
export const validateLoginPathQuery = typia.createValidate<Login.PathQuery>();
export const validateLoginBody = typia.createValidate<Login.Body>();
export const validateLoginResponse = typia.createValidate<Login.Response>();

// Logout
export namespace Logout {
  export type PathParams = Record<string, never>;
  export type PathQuery = Record<string, never>;
  export type Body = Record<string, never>;
  export type Response = SerializableResult.OkWithStatusCode<
    { success: true },
    StatusCode.OK
  >;
}

export const validateLogoutPathParams =
  typia.createValidate<Logout.PathParams>();
export const validateLogoutPathQuery = typia.createValidate<Logout.PathQuery>();
export const validateLogoutBody = typia.createValidate<Logout.Body>();
export const validateLogoutResponse = typia.createValidate<Logout.Response>();

// Get Current User
export namespace GetCurrentUser {
  export type PathParams = Record<string, never>;
  export type PathQuery = Record<string, never>;
  export type Body = Record<string, never>;
  export type Response = SerializableResult.OkWithStatusCode<
    User | null,
    StatusCode.OK
  >;
}

export const validateGetCurrentUserPathParams =
  typia.createValidate<GetCurrentUser.PathParams>();
export const validateGetCurrentUserPathQuery =
  typia.createValidate<GetCurrentUser.PathQuery>();
export const validateGetCurrentUserBody =
  typia.createValidate<GetCurrentUser.Body>();
export const validateGetCurrentUserResponse =
  typia.createValidate<GetCurrentUser.Response>();

// ============================================================================
// Board Route Validators
// ============================================================================

// List Boards
export namespace ListBoards {
  export type PathParams = Record<string, never>;
  export type PathQuery = Record<string, never>;
  export type Body = Record<string, never>;
  export type Response =
    | SerializableResult.OkWithStatusCode<Board[], StatusCode.OK>
    | SerializableResult.ErrWithStatusCode<
        { type: 'Unauthorized' },
        StatusCode.NOT_AUTHENTICATED
      >;
}

export const validateListBoardsPathParams =
  typia.createValidate<ListBoards.PathParams>();
export const validateListBoardsPathQuery =
  typia.createValidate<ListBoards.PathQuery>();
export const validateListBoardsBody = typia.createValidate<ListBoards.Body>();
export const validateListBoardsResponse =
  typia.createValidate<ListBoards.Response>();

// Get Board
export namespace GetBoard {
  export type PathParams = { boardId: string };
  export type PathQuery = Record<string, never>;
  export type Body = Record<string, never>;
  export type Response =
    | SerializableResult.OkWithStatusCode<BoardWithContents, StatusCode.OK>
    | SerializableResult.ErrWithStatusCode<
        { type: 'BoardNotFound' },
        StatusCode.NOT_FOUND
      >;
}

export const validateGetBoardPathParams =
  typia.createValidate<GetBoard.PathParams>();
export const validateGetBoardPathQuery =
  typia.createValidate<GetBoard.PathQuery>();
export const validateGetBoardBody = typia.createValidate<GetBoard.Body>();
export const validateGetBoardResponse =
  typia.createValidate<GetBoard.Response>();

// Create Board
export namespace CreateBoard {
  export type PathParams = Record<string, never>;
  export type PathQuery = Record<string, never>;
  export type Body = CreateBoardRequest;
  export type Response =
    | SerializableResult.OkWithStatusCode<Board, StatusCode.CREATED>
    | SerializableResult.ErrWithStatusCode<
        { type: 'Unauthorized' },
        StatusCode.NOT_AUTHENTICATED
      >;
}

export const validateCreateBoardPathParams =
  typia.createValidate<CreateBoard.PathParams>();
export const validateCreateBoardPathQuery =
  typia.createValidate<CreateBoard.PathQuery>();
export const validateCreateBoardBody = typia.createValidate<CreateBoard.Body>();
export const validateCreateBoardResponse =
  typia.createValidate<CreateBoard.Response>();

// Create List
export namespace CreateList {
  export type PathParams = { boardId: string };
  export type PathQuery = Record<string, never>;
  export type Body = CreateListRequest;
  export type Response =
    | SerializableResult.OkWithStatusCode<BoardList, StatusCode.CREATED>
    | SerializableResult.ErrWithStatusCode<
        { type: 'BoardNotFound' },
        StatusCode.NOT_FOUND
      >;
}

export const validateCreateListPathParams =
  typia.createValidate<CreateList.PathParams>();
export const validateCreateListPathQuery =
  typia.createValidate<CreateList.PathQuery>();
export const validateCreateListBody = typia.createValidate<CreateList.Body>();
export const validateCreateListResponse =
  typia.createValidate<CreateList.Response>();

// Create Card
export namespace CreateCard {
  export type PathParams = { boardId: string; listId: string };
  export type PathQuery = Record<string, never>;
  export type Body = CreateCardRequest;
  export type Response =
    | SerializableResult.OkWithStatusCode<Card, StatusCode.CREATED>
    | SerializableResult.ErrWithStatusCode<
        { type: 'ListNotFound' },
        StatusCode.NOT_FOUND
      >
    | SerializableResult.ErrWithStatusCode<
        { type: 'Unauthorized' },
        StatusCode.NOT_AUTHENTICATED
      >;
}

export const validateCreateCardPathParams =
  typia.createValidate<CreateCard.PathParams>();
export const validateCreateCardPathQuery =
  typia.createValidate<CreateCard.PathQuery>();
export const validateCreateCardBody = typia.createValidate<CreateCard.Body>();
export const validateCreateCardResponse =
  typia.createValidate<CreateCard.Response>();

// Update Card
export namespace UpdateCard {
  export type PathParams = { boardId: string; cardId: string };
  export type PathQuery = Record<string, never>;
  export type Body = UpdateCardRequest;
  export type Response =
    | SerializableResult.OkWithStatusCode<Card, StatusCode.OK>
    | SerializableResult.ErrWithStatusCode<
        { type: 'CardNotFound' },
        StatusCode.NOT_FOUND
      >;
}

export const validateUpdateCardPathParams =
  typia.createValidate<UpdateCard.PathParams>();
export const validateUpdateCardPathQuery =
  typia.createValidate<UpdateCard.PathQuery>();
export const validateUpdateCardBody = typia.createValidate<UpdateCard.Body>();
export const validateUpdateCardResponse =
  typia.createValidate<UpdateCard.Response>();

// Move Card
export namespace MoveCard {
  export type PathParams = { boardId: string; cardId: string };
  export type PathQuery = Record<string, never>;
  export type Body = MoveCardRequest;
  export type Response =
    | SerializableResult.OkWithStatusCode<Card, StatusCode.OK>
    | SerializableResult.ErrWithStatusCode<
        { type: 'CardNotFound' },
        StatusCode.NOT_FOUND
      >
    | SerializableResult.ErrWithStatusCode<
        { type: 'ListNotFound' },
        StatusCode.NOT_FOUND
      >;
}

export const validateMoveCardPathParams =
  typia.createValidate<MoveCard.PathParams>();
export const validateMoveCardPathQuery =
  typia.createValidate<MoveCard.PathQuery>();
export const validateMoveCardBody = typia.createValidate<MoveCard.Body>();
export const validateMoveCardResponse =
  typia.createValidate<MoveCard.Response>();

// Delete Card
export namespace DeleteCard {
  export type PathParams = { boardId: string; cardId: string };
  export type PathQuery = Record<string, never>;
  export type Body = Record<string, never>;
  export type Response =
    | SerializableResult.OkWithStatusCode<{ success: true }, StatusCode.OK>
    | SerializableResult.ErrWithStatusCode<
        { type: 'CardNotFound' },
        StatusCode.NOT_FOUND
      >;
}

export const validateDeleteCardPathParams =
  typia.createValidate<DeleteCard.PathParams>();
export const validateDeleteCardPathQuery =
  typia.createValidate<DeleteCard.PathQuery>();
export const validateDeleteCardBody = typia.createValidate<DeleteCard.Body>();
export const validateDeleteCardResponse =
  typia.createValidate<DeleteCard.Response>();

// ============================================================================
// Task Route Validators
// ============================================================================

// Entity validators
export const validateTask = typia.createValidate<Task>();
export const isTask = typia.createIs<Task>();

// Tasks list loader
export const validateTasksLoaderResponse = typia.createValidate<Task[]>();

// List Tasks
export namespace ListTasks {
  export type PathParams = { boardId: string };
  export type PathQuery = {
    listId?: string;
    status?: 'todo' | 'in-progress' | 'done';
  };
  export type Body = Record<string, never>;
  export type Response =
    | SerializableResult.OkWithStatusCode<Task[], StatusCode.OK>
    | SerializableResult.ErrWithStatusCode<
        { type: 'Unauthorized' },
        StatusCode.NOT_AUTHENTICATED
      >;
}

export const validateListTasksPathParams =
  typia.createValidate<ListTasks.PathParams>();
export const validateListTasksPathQuery =
  typia.createValidate<ListTasks.PathQuery>();
export const validateListTasksBody = typia.createValidate<ListTasks.Body>();
export const validateListTasksResponse =
  typia.createValidate<ListTasks.Response>();

// List All Tasks (global activity)
export namespace ListAllTasks {
  export type PathParams = Record<string, never>;
  export type PathQuery = {
    limit?: number;
  };
  export type Body = Record<string, never>;
  export type Response =
    | SerializableResult.OkWithStatusCode<Task[], StatusCode.OK>
    | SerializableResult.ErrWithStatusCode<
        { type: 'Unauthorized' },
        StatusCode.NOT_AUTHENTICATED
      >;
}

export const validateListAllTasksPathParams =
  typia.createValidate<ListAllTasks.PathParams>();
export const validateListAllTasksPathQuery =
  typia.createValidate<ListAllTasks.PathQuery>();
export const validateListAllTasksBody =
  typia.createValidate<ListAllTasks.Body>();
export const validateListAllTasksResponse =
  typia.createValidate<ListAllTasks.Response>();

// Get Task
export namespace GetTask {
  export type PathParams = { taskId: string };
  export type PathQuery = Record<string, never>;
  export type Body = Record<string, never>;
  export type Response =
    | SerializableResult.OkWithStatusCode<Task, StatusCode.OK>
    | SerializableResult.ErrWithStatusCode<
        { type: 'TaskNotFound' },
        StatusCode.NOT_FOUND
      >
    | SerializableResult.ErrWithStatusCode<
        { type: 'Unauthorized' },
        StatusCode.NOT_AUTHENTICATED
      >;
}

export const validateGetTaskPathParams =
  typia.createValidate<GetTask.PathParams>();
export const validateGetTaskPathQuery =
  typia.createValidate<GetTask.PathQuery>();
export const validateGetTaskBody = typia.createValidate<GetTask.Body>();
export const validateGetTaskResponse = typia.createValidate<GetTask.Response>();

// Create Task
export namespace CreateTask {
  export type PathParams = { boardId: string };
  export type PathQuery = Record<string, never>;
  export type Body = CreateTaskRequest;
  export type Response =
    | SerializableResult.OkWithStatusCode<Task, StatusCode.CREATED>
    | SerializableResult.ErrWithStatusCode<
        { type: 'BoardNotFound' },
        StatusCode.NOT_FOUND
      >
    | SerializableResult.ErrWithStatusCode<
        { type: 'Unauthorized' },
        StatusCode.NOT_AUTHENTICATED
      >;
}

export const validateCreateTaskPathParams =
  typia.createValidate<CreateTask.PathParams>();
export const validateCreateTaskPathQuery =
  typia.createValidate<CreateTask.PathQuery>();
export const validateCreateTaskBody = typia.createValidate<CreateTask.Body>();
export const validateCreateTaskResponse =
  typia.createValidate<CreateTask.Response>();

// Update Task
export namespace UpdateTask {
  export type PathParams = { taskId: string };
  export type PathQuery = Record<string, never>;
  export type Body = UpdateTaskRequest;
  export type Response =
    | SerializableResult.OkWithStatusCode<Task, StatusCode.OK>
    | SerializableResult.ErrWithStatusCode<
        { type: 'TaskNotFound' },
        StatusCode.NOT_FOUND
      >;
}

export const validateUpdateTaskPathParams =
  typia.createValidate<UpdateTask.PathParams>();
export const validateUpdateTaskPathQuery =
  typia.createValidate<UpdateTask.PathQuery>();
export const validateUpdateTaskBody = typia.createValidate<UpdateTask.Body>();
export const validateUpdateTaskResponse =
  typia.createValidate<UpdateTask.Response>();

// Delete Task
export namespace DeleteTask {
  export type PathParams = { taskId: string };
  export type PathQuery = Record<string, never>;
  export type Body = Record<string, never>;
  export type Response =
    | SerializableResult.OkWithStatusCode<{ success: true }, StatusCode.OK>
    | SerializableResult.ErrWithStatusCode<
        { type: 'TaskNotFound' },
        StatusCode.NOT_FOUND
      >;
}

export const validateDeleteTaskPathParams =
  typia.createValidate<DeleteTask.PathParams>();
export const validateDeleteTaskPathQuery =
  typia.createValidate<DeleteTask.PathQuery>();
export const validateDeleteTaskBody = typia.createValidate<DeleteTask.Body>();
export const validateDeleteTaskResponse =
  typia.createValidate<DeleteTask.Response>();

// ============================================================================
// Chat Route Validators
// ============================================================================

// List Channels
export namespace ListChannels {
  export type PathParams = Record<string, never>;
  export type PathQuery = { boardId?: string };
  export type Body = Record<string, never>;
  export type Response = SerializableResult.OkWithStatusCode<
    Channel[],
    StatusCode.OK
  >;
}

export const validateListChannelsPathParams =
  typia.createValidate<ListChannels.PathParams>();
export const validateListChannelsPathQuery =
  typia.createValidate<ListChannels.PathQuery>();
export const validateListChannelsBody =
  typia.createValidate<ListChannels.Body>();
export const validateListChannelsResponse =
  typia.createValidate<ListChannels.Response>();

// Get Channel
export namespace GetChannel {
  export type PathParams = { channelId: string };
  export type PathQuery = Record<string, never>;
  export type Body = Record<string, never>;
  export type Response =
    | SerializableResult.OkWithStatusCode<Channel, StatusCode.OK>
    | SerializableResult.ErrWithStatusCode<
        { type: 'ChannelNotFound' },
        StatusCode.NOT_FOUND
      >;
}

export const validateGetChannelPathParams =
  typia.createValidate<GetChannel.PathParams>();
export const validateGetChannelPathQuery =
  typia.createValidate<GetChannel.PathQuery>();
export const validateGetChannelBody = typia.createValidate<GetChannel.Body>();
export const validateGetChannelResponse =
  typia.createValidate<GetChannel.Response>();

// Create Channel
export namespace CreateChannel {
  export type PathParams = Record<string, never>;
  export type PathQuery = Record<string, never>;
  export type Body = CreateChannelRequest;
  export type Response =
    | SerializableResult.OkWithStatusCode<Channel, StatusCode.CREATED>
    | SerializableResult.ErrWithStatusCode<
        { type: 'Unauthorized' },
        StatusCode.NOT_AUTHENTICATED
      >;
}

export const validateCreateChannelPathParams =
  typia.createValidate<CreateChannel.PathParams>();
export const validateCreateChannelPathQuery =
  typia.createValidate<CreateChannel.PathQuery>();
export const validateCreateChannelBody =
  typia.createValidate<CreateChannel.Body>();
export const validateCreateChannelResponse =
  typia.createValidate<CreateChannel.Response>();

// Get Messages
export namespace GetMessages {
  export type PathParams = { channelId: string };
  export type PathQuery = { limit?: number; before?: string };
  export type Body = Record<string, never>;
  export type Response =
    | SerializableResult.OkWithStatusCode<Message[], StatusCode.OK>
    | SerializableResult.ErrWithStatusCode<
        { type: 'ChannelNotFound' },
        StatusCode.NOT_FOUND
      >;
}

export const validateGetMessagesPathParams =
  typia.createValidate<GetMessages.PathParams>();
export const validateGetMessagesPathQuery =
  typia.createValidate<GetMessages.PathQuery>();
export const validateGetMessagesBody = typia.createValidate<GetMessages.Body>();
export const validateGetMessagesResponse =
  typia.createValidate<GetMessages.Response>();

// Send Message
export namespace SendMessage {
  export type PathParams = { channelId: string };
  export type PathQuery = Record<string, never>;
  export type Body = SendMessageRequest;
  export type Response =
    | SerializableResult.OkWithStatusCode<Message, StatusCode.CREATED>
    | SerializableResult.ErrWithStatusCode<
        { type: 'ChannelNotFound' },
        StatusCode.NOT_FOUND
      >
    | SerializableResult.ErrWithStatusCode<
        { type: 'Unauthorized' },
        StatusCode.NOT_AUTHENTICATED
      >;
}

export const validateSendMessagePathParams =
  typia.createValidate<SendMessage.PathParams>();
export const validateSendMessagePathQuery =
  typia.createValidate<SendMessage.PathQuery>();
export const validateSendMessageBody = typia.createValidate<SendMessage.Body>();
export const validateSendMessageResponse =
  typia.createValidate<SendMessage.Response>();

// ============================================================================
// EventStream Validators
// ============================================================================

// Board Updates
export namespace BoardUpdates {
  export type PathParams = { boardId: string };
  export type PathQuery = Record<string, never>;
  export type Events = {
    card_created: { card: Card };
    card_updated: { card: Card };
    card_moved: {
      cardId: string;
      fromListId: string;
      toListId: string;
      position: number;
    };
    card_deleted: { cardId: string };
    list_created: { list: BoardList };
    list_updated: { list: BoardList };
    list_deleted: { listId: string };
  };
  export type CompletionData = { reason: 'board_deleted' | 'disconnected' };
  export type CompletionError =
    | { type: 'BoardNotFound' }
    | { type: 'Unauthorized' };
}

export const validateBoardUpdatesPathParams =
  typia.createValidate<BoardUpdates.PathParams>();
export const validateBoardUpdatesPathQuery =
  typia.createValidate<BoardUpdates.PathQuery>();
export const validateBoardUpdatesEvents =
  typia.createValidate<Partial<BoardUpdates.Events>>();
export const validateBoardUpdatesCompletionData =
  typia.createValidate<BoardUpdates.CompletionData>();
export const validateBoardUpdatesCompletionError =
  typia.createValidate<BoardUpdates.CompletionError>();

// Chat Messages
export namespace ChatMessages {
  export type PathParams = { channelId: string };
  export type PathQuery = Record<string, never>;
  export type Events = {
    message_created: { message: Message };
    message_deleted: { messageId: string };
    typing_started: { userId: string; username: string };
    typing_stopped: { userId: string };
  };
  export type CompletionData = { reason: 'channel_deleted' | 'disconnected' };
  export type CompletionError =
    | { type: 'ChannelNotFound' }
    | { type: 'Unauthorized' };
}

export const validateChatMessagesPathParams =
  typia.createValidate<ChatMessages.PathParams>();
export const validateChatMessagesPathQuery =
  typia.createValidate<ChatMessages.PathQuery>();
export const validateChatMessagesEvents =
  typia.createValidate<Partial<ChatMessages.Events>>();
export const validateChatMessagesCompletionData =
  typia.createValidate<ChatMessages.CompletionData>();
export const validateChatMessagesCompletionError =
  typia.createValidate<ChatMessages.CompletionError>();

// ============================================================================
// Context Validators
// ============================================================================

export type SessionContextData = SessionData | null;
export type SessionContextError =
  | { type: 'SessionExpired' }
  | { type: 'SessionInvalid' };

export const validateSessionContextData =
  typia.createValidate<SessionContextData>();
export const validateSessionContextError =
  typia.createValidate<SessionContextError>();

// ============================================================================
// Blog Route Validators
// ============================================================================

// Blog Post entity validator
export const validateBlogPost = typia.createValidate<BlogPost>();

// Blog Posts List Loader
export const validateBlogPostsLoaderResponse =
  typia.createValidate<BlogPost[]>();

// Blog Post Detail Loader
export const validateBlogPostLoaderResponse = typia.createValidate<BlogPost>();

// List Blog Posts
export namespace ListBlogPosts {
  export type PathParams = Record<string, never>;
  export type PathQuery = Record<string, never>;
  export type Body = Record<string, never>;
  export type Response = SerializableResult.OkWithStatusCode<
    BlogPost[],
    StatusCode.OK
  >;
}

export const validateListBlogPostsPathParams =
  typia.createValidate<ListBlogPosts.PathParams>();
export const validateListBlogPostsPathQuery =
  typia.createValidate<ListBlogPosts.PathQuery>();
export const validateListBlogPostsBody =
  typia.createValidate<ListBlogPosts.Body>();
export const validateListBlogPostsResponse =
  typia.createValidate<ListBlogPosts.Response>();

// Get Blog Post
export namespace GetBlogPost {
  export type PathParams = { postId: string };
  export type PathQuery = Record<string, never>;
  export type Body = Record<string, never>;
  export type Response =
    | SerializableResult.OkWithStatusCode<BlogPost, StatusCode.OK>
    | SerializableResult.ErrWithStatusCode<
        { type: 'PostNotFound' },
        StatusCode.NOT_FOUND
      >;
}

export const validateGetBlogPostPathParams =
  typia.createValidate<GetBlogPost.PathParams>();
export const validateGetBlogPostPathQuery =
  typia.createValidate<GetBlogPost.PathQuery>();
export const validateGetBlogPostBody = typia.createValidate<GetBlogPost.Body>();
export const validateGetBlogPostResponse =
  typia.createValidate<GetBlogPost.Response>();

// Create Blog Post
export namespace CreateBlogPost {
  export type PathParams = Record<string, never>;
  export type PathQuery = Record<string, never>;
  export type Body = CreateBlogPostRequest;
  export type Response =
    | SerializableResult.OkWithStatusCode<BlogPost, StatusCode.CREATED>
    | SerializableResult.ErrWithStatusCode<
        { type: 'Unauthorized' },
        StatusCode.NOT_AUTHENTICATED
      >;
}

export const validateCreateBlogPostPathParams =
  typia.createValidate<CreateBlogPost.PathParams>();
export const validateCreateBlogPostPathQuery =
  typia.createValidate<CreateBlogPost.PathQuery>();
export const validateCreateBlogPostBody =
  typia.createValidate<CreateBlogPost.Body>();
export const validateCreateBlogPostResponse =
  typia.createValidate<CreateBlogPost.Response>();

// ============================================================================
// Route Schemas
// ============================================================================

type LoginRouteContract = {
  pathParams: Login.PathParams;
  pathQuery: Login.PathQuery;
  body: Login.Body;
  response: Login.Response;
};
type LogoutRouteContract = {
  pathParams: Logout.PathParams;
  pathQuery: Logout.PathQuery;
  body: Logout.Body;
  response: Logout.Response;
};
type GetCurrentUserRouteContract = {
  pathParams: GetCurrentUser.PathParams;
  pathQuery: GetCurrentUser.PathQuery;
  body: GetCurrentUser.Body;
  response: GetCurrentUser.Response;
};
type ListBoardsRouteContract = {
  pathParams: ListBoards.PathParams;
  pathQuery: ListBoards.PathQuery;
  body: ListBoards.Body;
  response: ListBoards.Response;
};
type GetBoardRouteContract = {
  pathParams: GetBoard.PathParams;
  pathQuery: GetBoard.PathQuery;
  body: GetBoard.Body;
  response: GetBoard.Response;
};
type CreateBoardRouteContract = {
  pathParams: CreateBoard.PathParams;
  pathQuery: CreateBoard.PathQuery;
  body: CreateBoard.Body;
  response: CreateBoard.Response;
};
type CreateListRouteContract = {
  pathParams: CreateList.PathParams;
  pathQuery: CreateList.PathQuery;
  body: CreateList.Body;
  response: CreateList.Response;
};
type CreateCardRouteContract = {
  pathParams: CreateCard.PathParams;
  pathQuery: CreateCard.PathQuery;
  body: CreateCard.Body;
  response: CreateCard.Response;
};
type UpdateCardRouteContract = {
  pathParams: UpdateCard.PathParams;
  pathQuery: UpdateCard.PathQuery;
  body: UpdateCard.Body;
  response: UpdateCard.Response;
};
type MoveCardRouteContract = {
  pathParams: MoveCard.PathParams;
  pathQuery: MoveCard.PathQuery;
  body: MoveCard.Body;
  response: MoveCard.Response;
};
type DeleteCardRouteContract = {
  pathParams: DeleteCard.PathParams;
  pathQuery: DeleteCard.PathQuery;
  body: DeleteCard.Body;
  response: DeleteCard.Response;
};
type ListTasksRouteContract = {
  pathParams: ListTasks.PathParams;
  pathQuery: ListTasks.PathQuery;
  body: ListTasks.Body;
  response: ListTasks.Response;
};
type ListAllTasksRouteContract = {
  pathParams: ListAllTasks.PathParams;
  pathQuery: ListAllTasks.PathQuery;
  body: ListAllTasks.Body;
  response: ListAllTasks.Response;
};
type GetTaskRouteContract = {
  pathParams: GetTask.PathParams;
  pathQuery: GetTask.PathQuery;
  body: GetTask.Body;
  response: GetTask.Response;
};
type CreateTaskRouteContract = {
  pathParams: CreateTask.PathParams;
  pathQuery: CreateTask.PathQuery;
  body: CreateTask.Body;
  response: CreateTask.Response;
};
type UpdateTaskRouteContract = {
  pathParams: UpdateTask.PathParams;
  pathQuery: UpdateTask.PathQuery;
  body: UpdateTask.Body;
  response: UpdateTask.Response;
};
type DeleteTaskRouteContract = {
  pathParams: DeleteTask.PathParams;
  pathQuery: DeleteTask.PathQuery;
  body: DeleteTask.Body;
  response: DeleteTask.Response;
};
type ListChannelsRouteContract = {
  pathParams: ListChannels.PathParams;
  pathQuery: ListChannels.PathQuery;
  body: ListChannels.Body;
  response: ListChannels.Response;
};
type GetChannelRouteContract = {
  pathParams: GetChannel.PathParams;
  pathQuery: GetChannel.PathQuery;
  body: GetChannel.Body;
  response: GetChannel.Response;
};
type CreateChannelRouteContract = {
  pathParams: CreateChannel.PathParams;
  pathQuery: CreateChannel.PathQuery;
  body: CreateChannel.Body;
  response: CreateChannel.Response;
};
type GetMessagesRouteContract = {
  pathParams: GetMessages.PathParams;
  pathQuery: GetMessages.PathQuery;
  body: GetMessages.Body;
  response: GetMessages.Response;
};
type SendMessageRouteContract = {
  pathParams: SendMessage.PathParams;
  pathQuery: SendMessage.PathQuery;
  body: SendMessage.Body;
  response: SendMessage.Response;
};
type ListBlogPostsRouteContract = {
  pathParams: ListBlogPosts.PathParams;
  pathQuery: ListBlogPosts.PathQuery;
  body: ListBlogPosts.Body;
  response: ListBlogPosts.Response;
};
type GetBlogPostRouteContract = {
  pathParams: GetBlogPost.PathParams;
  pathQuery: GetBlogPost.PathQuery;
  body: GetBlogPost.Body;
  response: GetBlogPost.Response;
};
type CreateBlogPostRouteContract = {
  pathParams: CreateBlogPost.PathParams;
  pathQuery: CreateBlogPost.PathQuery;
  body: CreateBlogPost.Body;
  response: CreateBlogPost.Response;
};

export const loginSchema = defineRouteSchema<LoginRouteContract>();
export const logoutSchema = defineRouteSchema<LogoutRouteContract>();
export const getCurrentUserSchema =
  defineRouteSchema<GetCurrentUserRouteContract>();
export const listBoardsSchema = defineRouteSchema<ListBoardsRouteContract>();
export const getBoardSchema = defineRouteSchema<GetBoardRouteContract>();
export const createBoardSchema = defineRouteSchema<CreateBoardRouteContract>();
export const createListSchema = defineRouteSchema<CreateListRouteContract>();
export const createCardSchema = defineRouteSchema<CreateCardRouteContract>();
export const updateCardSchema = defineRouteSchema<UpdateCardRouteContract>();
export const moveCardSchema = defineRouteSchema<MoveCardRouteContract>();
export const deleteCardSchema = defineRouteSchema<DeleteCardRouteContract>();
export const listTasksSchema = defineRouteSchema<ListTasksRouteContract>();
export const listAllTasksSchema =
  defineRouteSchema<ListAllTasksRouteContract>();
export const getTaskSchema = defineRouteSchema<GetTaskRouteContract>();
export const createTaskSchema = defineRouteSchema<CreateTaskRouteContract>();
export const updateTaskSchema = defineRouteSchema<UpdateTaskRouteContract>();
export const deleteTaskSchema = defineRouteSchema<DeleteTaskRouteContract>();
export const listChannelsSchema =
  defineRouteSchema<ListChannelsRouteContract>();
export const getChannelSchema = defineRouteSchema<GetChannelRouteContract>();
export const createChannelSchema =
  defineRouteSchema<CreateChannelRouteContract>();
export const getMessagesSchema = defineRouteSchema<GetMessagesRouteContract>();
export const sendMessageSchema = defineRouteSchema<SendMessageRouteContract>();
export const listBlogPostsSchema =
  defineRouteSchema<ListBlogPostsRouteContract>();
export const getBlogPostSchema = defineRouteSchema<GetBlogPostRouteContract>();
export const createBlogPostSchema =
  defineRouteSchema<CreateBlogPostRouteContract>();
