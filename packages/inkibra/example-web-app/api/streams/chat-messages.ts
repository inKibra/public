/**
 * Chat Messages EventStream
 *
 * Real-time message updates for a chat channel
 */

import {
  createEventStreamRoute,
  defineEventStreamSchema,
} from '@inkibra/router';
import type { ChatMessages } from '../../schemas';
import {
  validateChatMessagesCompletionData,
  validateChatMessagesCompletionError,
  validateChatMessagesEvents,
  validateChatMessagesPathParams,
  validateChatMessagesPathQuery,
} from '../../schemas';
import { SessionCodec } from '../routes/auth';

// ============================================================================
// Schema
// ============================================================================

export const chatMessagesSchema = defineEventStreamSchema({
  pathParams: validateChatMessagesPathParams,
  pathQuery: validateChatMessagesPathQuery,
  eventTypes: validateChatMessagesEvents,
  completionData: validateChatMessagesCompletionData,
  completionError: validateChatMessagesCompletionError,
});

// ============================================================================
// Route
// ============================================================================

export const chatMessagesRoute = createEventStreamRoute({
  name: 'chatMessages',
  path: '/api/streams/channels/:channelId',
  schema: chatMessagesSchema,
  contextCodec: { session: SessionCodec },
});

// ============================================================================
// Export Types
// ============================================================================

export type { ChatMessages };
