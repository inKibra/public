/**
 * Chat Handlers
 *
 * Implementation of chat API routes using createApiRouteHandlerProvider
 *
 * Context codecs are now on the routes - no need to pass them to handlers.
 */

import {
  createApiRouteHandlerProvider,
  createEventStreamHandlerProvider,
  publishToChannel,
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
  createChannelRoute,
  getChannelRoute,
  getMessagesRoute,
  listChannelsRoute,
  sendMessageRoute,
} from '../../api/routes/chat';
import { chatMessagesRoute } from '../../api/streams/chat-messages';
import type { Channel, Message, SessionData } from '../../shared/types';
import { createChatDal } from '../dal/chat-dal';

// ============================================================================
// Dependencies
// ============================================================================

export type ChatDeps = {
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

export const listChannelsHandlerProvider = createApiRouteHandlerProvider(
  (deps: ChatDeps) =>
    createApiRouteHandler({
      route: listChannelsRoute,
      handler: async (args) => {
        const dal = createChatDal(deps.redis);
        const channels = await dal.listChannels(args.pathQuery.boardId);
        return SerializableResult.toOk(channels, StatusCode.OK);
      },
    }),
);

export const getChannelHandlerProvider = createApiRouteHandlerProvider(
  (deps: ChatDeps) =>
    createApiRouteHandler({
      route: getChannelRoute,
      handler: async (args) => {
        const dal = createChatDal(deps.redis);
        const channel = await dal.getChannel(args.pathParams.channelId);

        if (!channel) {
          return SerializableResult.toErr(
            { type: 'ChannelNotFound' as const },
            StatusCode.NOT_FOUND,
          );
        }

        return SerializableResult.toOk(channel, StatusCode.OK);
      },
    }),
);

export const createChannelHandlerProvider = createApiRouteHandlerProvider(
  (deps: ChatDeps) =>
    createApiRouteHandler({
      route: createChannelRoute,
      handler: async (args, ctx) => {
        const session = getAuthenticatedSession(ctx);
        if (!session) {
          return SerializableResult.toErr(
            { type: 'Unauthorized' as const },
            StatusCode.NOT_AUTHENTICATED,
          );
        }

        const dal = createChatDal(deps.redis);

        const channel: Channel = {
          id: generateId(),
          name: args.body.name,
          description: args.body.description,
          boardId: args.body.boardId ?? null,
          createdBy: session.userId,
          createdAt: new Date().toISOString(),
        };

        await dal.createChannel(channel);
        return SerializableResult.toOk(channel, StatusCode.CREATED);
      },
    }),
);

export const getMessagesHandlerProvider = createApiRouteHandlerProvider(
  (deps: ChatDeps) =>
    createApiRouteHandler({
      route: getMessagesRoute,
      handler: async (args) => {
        const dal = createChatDal(deps.redis);

        // Check channel exists
        const channel = await dal.getChannel(args.pathParams.channelId);
        if (!channel) {
          return SerializableResult.toErr(
            { type: 'ChannelNotFound' as const },
            StatusCode.NOT_FOUND,
          );
        }

        const messages = await dal.getMessages(args.pathParams.channelId, {
          limit: args.pathQuery.limit,
          before: args.pathQuery.before,
        });

        return SerializableResult.toOk(messages, StatusCode.OK);
      },
    }),
);

export const sendMessageHandlerProvider = createApiRouteHandlerProvider(
  (deps: ChatDeps) =>
    createApiRouteHandler({
      route: sendMessageRoute,
      handler: async (args, ctx) => {
        const session = getAuthenticatedSession(ctx);
        if (!session) {
          return SerializableResult.toErr(
            { type: 'Unauthorized' as const },
            StatusCode.NOT_AUTHENTICATED,
          );
        }

        const dal = createChatDal(deps.redis);

        // Check channel exists
        const channel = await dal.getChannel(args.pathParams.channelId);
        if (!channel) {
          return SerializableResult.toErr(
            { type: 'ChannelNotFound' as const },
            StatusCode.NOT_FOUND,
          );
        }

        const message: Message = {
          id: generateId(),
          channelId: args.pathParams.channelId,
          content: args.body.content,
          authorId: session.userId,
          authorUsername: session.username,
          createdAt: new Date().toISOString(),
        };

        await dal.createMessage(message);

        // Publish to EventStream channel so subscribers get the new message
        await publishToChannel(
          deps.redis,
          chatMessagesRoute,
          {
            pathParams: { channelId: args.pathParams.channelId },
            pathQuery: {},
          },
          'message_created',
          { message },
        );
        console.debug('[sendMessage] Published message_created event', {
          channelId: args.pathParams.channelId,
          messageId: message.id,
        });

        return SerializableResult.toOk(message, StatusCode.CREATED);
      },
    }),
);

// ============================================================================
// Stream Handlers
// ============================================================================

export const chatMessagesHandlerProvider = createEventStreamHandlerProvider(
  (deps: ChatDeps) =>
    createEventStreamHandler({
      route: chatMessagesRoute,
      handler: async function* (args, _ctx, channelFactory) {
        if (!channelFactory) {
          return Err({ type: 'ChannelNotFound' as const });
        }
        const dal = createChatDal(deps.redis);

        // Check channel exists
        const chatChannel = await dal.getChannel(args.pathParams.channelId);
        if (!chatChannel) {
          return Err({ type: 'ChannelNotFound' as const });
        }

        // Send a test message immediately to verify connection works
        console.log('[chatMessages] yielding test message_created event');
        yield {
          event: 'message_created' as const,
          data: {
            message: {
              id: 'test-' + Date.now(),
              channelId: args.pathParams.channelId,
              content: '🔗 Stream connected!',
              authorId: 'system',
              authorUsername: 'System',
              createdAt: new Date().toISOString(),
            },
          },
        };

        // Subscribe to channel for chat messages
        await using channel = channelFactory.get(chatMessagesRoute, args);

        // Listen for events
        for await (const event of channel) {
          console.log('[chatMessages] yielding event from redis', event);
          yield event;
        }

        return Ok({ reason: 'disconnected' as const });
      },
    }),
);
