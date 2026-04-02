/**
 * Chat Backend
 *
 * Chat API handlers with typed implementations.
 */

import { createBackend } from '@inkibra/denzel-bun';
import type { EventStreamChannelFactory } from '@inkibra/router';
import type { RedisClient } from 'bun';
import {
  chatMessagesHandlerProvider,
  createChannelHandlerProvider,
  getChannelHandlerProvider,
  getMessagesHandlerProvider,
  listChannelsHandlerProvider,
  sendMessageHandlerProvider,
} from '../handlers/chat-handlers';

// ============================================================================
// Dependencies
// ============================================================================

export type ChatBackendDeps = {
  redis: RedisClient;
  channelFactory: EventStreamChannelFactory;
};

// ============================================================================
// Create Chat Backend
// ============================================================================

/**
 * Create the chat backend with typed handlers
 *
 * Uses explicit keys (not spread) to preserve type information.
 *
 * Usage:
 * ```typescript
 * const { listChannels } = chatBackend.apiHandlers.listChannels.with({ session });
 * const { sendMessage } = chatBackend.apiHandlers.sendMessage.with({ session });
 * ```
 */
export function createChatBackend(deps: ChatBackendDeps) {
  const { redis, channelFactory } = deps;
  const handlerDeps = { redis };

  return createBackend({
    apiHandlers: {
      listChannels: listChannelsHandlerProvider(handlerDeps),
      getChannel: getChannelHandlerProvider(handlerDeps),
      createChannel: createChannelHandlerProvider(handlerDeps),
      getMessages: getMessagesHandlerProvider(handlerDeps),
      sendMessage: sendMessageHandlerProvider(handlerDeps),
    },
    streamHandlers: {
      chatMessages: chatMessagesHandlerProvider(handlerDeps),
    },
    channelFactory,
  });
}

// Type for the chat backend
export type ChatBackend = ReturnType<typeof createChatBackend>;
