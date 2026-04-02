/**
 * EventStream Routes Index
 *
 * Export all EventStream route definitions
 */

export * from './board-updates';
export * from './chat-messages';

import { boardUpdatesRoute } from './board-updates';
import { chatMessagesRoute } from './chat-messages';

/**
 * All EventStream routes
 */
export const eventStreamRoutes = {
  boardUpdates: boardUpdatesRoute,
  chatMessages: chatMessagesRoute,
};
