/**
 * Chat Data Access Layer
 *
 * Redis-based storage for channels and messages
 */

import type { RedisClient } from 'bun';
import type { Channel, Message } from '../../shared/types';

// ============================================================================
// Redis Key Patterns
// ============================================================================

const KEYS = {
  channels: () => 'channels',
  channel: (id: string) => `channel:${id}`,
  channelMessages: (channelId: string) => `channel:${channelId}:messages`,
  message: (id: string) => `message:${id}`,
  boardChannels: (boardId: string) => `board:${boardId}:channels`,
};

// ============================================================================
// Chat DAL
// ============================================================================

export type ChatDal = {
  // Channels
  listChannels: (boardId?: string) => Promise<Channel[]>;
  getChannel: (channelId: string) => Promise<Channel | null>;
  createChannel: (channel: Channel) => Promise<Channel>;
  deleteChannel: (channelId: string) => Promise<boolean>;

  // Messages
  getMessages: (
    channelId: string,
    options?: { limit?: number; before?: string },
  ) => Promise<Message[]>;
  getMessage: (messageId: string) => Promise<Message | null>;
  createMessage: (message: Message) => Promise<Message>;
  deleteMessage: (messageId: string) => Promise<boolean>;
};

export function createChatDal(redis: RedisClient): ChatDal {
  return {
    // ========================================================================
    // Channels
    // ========================================================================

    async listChannels(boardId?: string): Promise<Channel[]> {
      let channelIds: unknown[];

      if (boardId) {
        channelIds = (await redis.send('SMEMBERS', [
          KEYS.boardChannels(boardId),
        ])) as unknown[];
      } else {
        channelIds = (await redis.send('SMEMBERS', [
          KEYS.channels(),
        ])) as unknown[];
      }

      if (!Array.isArray(channelIds) || channelIds.length === 0) return [];

      const channels: Channel[] = [];
      for (const id of channelIds) {
        const data = await redis.get(KEYS.channel(id as string));
        if (data) {
          const channel = JSON.parse(data) as Channel;
          // Filter by boardId if specified
          if (
            !boardId ||
            channel.boardId === boardId ||
            channel.boardId === null
          ) {
            channels.push(channel);
          }
        }
      }
      return channels.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async getChannel(channelId: string): Promise<Channel | null> {
      const data = await redis.get(KEYS.channel(channelId));
      return data ? (JSON.parse(data) as Channel) : null;
    },

    async createChannel(channel: Channel): Promise<Channel> {
      await redis.set(KEYS.channel(channel.id), JSON.stringify(channel));
      await redis.send('SADD', [KEYS.channels(), channel.id]);
      if (channel.boardId) {
        await redis.send('SADD', [
          KEYS.boardChannels(channel.boardId),
          channel.id,
        ]);
      }
      return channel;
    },

    async deleteChannel(channelId: string): Promise<boolean> {
      const channel = await this.getChannel(channelId);
      if (!channel) return false;

      // Delete all messages in the channel
      const messageIds = await redis.send('LRANGE', [
        KEYS.channelMessages(channelId),
        '0',
        '-1',
      ]);
      if (Array.isArray(messageIds)) {
        for (const id of messageIds) {
          await redis.del(KEYS.message(id as string));
        }
      }

      await redis.del(KEYS.channel(channelId));
      await redis.del(KEYS.channelMessages(channelId));
      await redis.send('SREM', [KEYS.channels(), channelId]);
      if (channel.boardId) {
        await redis.send('SREM', [
          KEYS.boardChannels(channel.boardId),
          channelId,
        ]);
      }
      return true;
    },

    // ========================================================================
    // Messages
    // ========================================================================

    async getMessages(
      channelId: string,
      options?: { limit?: number; before?: string },
    ): Promise<Message[]> {
      const limit = options?.limit ?? 50;

      // Get message IDs (stored in a list, most recent first)
      const messageIds = (await redis.send('LRANGE', [
        KEYS.channelMessages(channelId),
        '0',
        String(limit - 1),
      ])) as unknown[];

      if (!Array.isArray(messageIds) || messageIds.length === 0) return [];

      const messages: Message[] = [];
      for (const id of messageIds) {
        const data = await redis.get(KEYS.message(id as string));
        if (data) {
          const message = JSON.parse(data) as Message;
          // Filter by 'before' if specified
          if (!options?.before || message.createdAt < options.before) {
            messages.push(message);
          }
        }
      }

      // Return in chronological order (oldest first)
      return messages.reverse();
    },

    async getMessage(messageId: string): Promise<Message | null> {
      const data = await redis.get(KEYS.message(messageId));
      return data ? (JSON.parse(data) as Message) : null;
    },

    async createMessage(message: Message): Promise<Message> {
      await redis.set(KEYS.message(message.id), JSON.stringify(message));
      // Add to front of list (most recent first)
      await redis.send('LPUSH', [
        KEYS.channelMessages(message.channelId),
        message.id,
      ]);
      return message;
    },

    async deleteMessage(messageId: string): Promise<boolean> {
      const message = await this.getMessage(messageId);
      if (!message) return false;

      await redis.del(KEYS.message(messageId));
      await redis.send('LREM', [
        KEYS.channelMessages(message.channelId),
        '1',
        messageId,
      ]);
      return true;
    },
  };
}
