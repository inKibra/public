/**
 * Chat API Routes
 *
 * CRUD operations for channels and messages
 */

import { createAPIRoute } from '@inkibra/router';
import { HttpMethod } from '@inkibra/router/constants/http-method';
import type {
  CreateChannel,
  GetChannel,
  GetMessages,
  ListChannels,
  SendMessage,
} from '../../schemas';
import {
  createChannelSchema as createChannelRouteSchema,
  getChannelSchema as getChannelRouteSchema,
  getMessagesSchema as getMessagesRouteSchema,
  listChannelsSchema as listChannelsRouteSchema,
  sendMessageSchema as sendMessageRouteSchema,
} from '../../schemas';
import { SessionCodec } from './auth';

// ============================================================================
// List Channels
// ============================================================================

export const listChannelsSchema = listChannelsRouteSchema;

export const listChannelsRoute = createAPIRoute({
  name: 'listChannels',
  method: HttpMethod.GET,
  path: '/api/channels',
  schema: listChannelsSchema,
  contextCodec: { session: SessionCodec },
});

// ============================================================================
// Get Channel
// ============================================================================

export const getChannelSchema = getChannelRouteSchema;

export const getChannelRoute = createAPIRoute({
  name: 'getChannel',
  method: HttpMethod.GET,
  path: '/api/channels/:channelId',
  schema: getChannelSchema,
  contextCodec: { session: SessionCodec },
});

// ============================================================================
// Create Channel
// ============================================================================

export const createChannelSchema = createChannelRouteSchema;

export const createChannelRoute = createAPIRoute({
  name: 'createChannel',
  method: HttpMethod.POST,
  path: '/api/channels',
  schema: createChannelSchema,
  contextCodec: { session: SessionCodec },
});

// ============================================================================
// Get Messages
// ============================================================================

export const getMessagesSchema = getMessagesRouteSchema;

export const getMessagesRoute = createAPIRoute({
  name: 'getMessages',
  method: HttpMethod.GET,
  path: '/api/channels/:channelId/messages',
  schema: getMessagesSchema,
  contextCodec: { session: SessionCodec },
});

// ============================================================================
// Send Message
// ============================================================================

export const sendMessageSchema = sendMessageRouteSchema;

export const sendMessageRoute = createAPIRoute({
  name: 'sendMessage',
  method: HttpMethod.POST,
  path: '/api/channels/:channelId/messages',
  schema: sendMessageSchema,
  contextCodec: { session: SessionCodec },
});

// ============================================================================
// Export Types and Routes
// ============================================================================

export type {
  ListChannels,
  GetChannel,
  CreateChannel,
  GetMessages,
  SendMessage,
};

export const chatRoutes = {
  listChannels: listChannelsRoute,
  getChannel: getChannelRoute,
  createChannel: createChannelRoute,
  getMessages: getMessagesRoute,
  sendMessage: sendMessageRoute,
};
