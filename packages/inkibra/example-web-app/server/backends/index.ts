/**
 * Backends Index
 *
 * Sets up dependencies and creates backend instances.
 */

import { createRedisChannelFactory } from '@inkibra/denzel-bun';
import { RedisClient } from 'bun';
import { type AuthBackend, createAuthBackend } from './auth';
import { type BlogBackend, createBlogBackend } from './blog';
import { type BoardBackend, createBoardBackend } from './board';
import { type ChatBackend, createChatBackend } from './chat';

// ============================================================================
// Configuration
// ============================================================================

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// ============================================================================
// Redis Client
// ============================================================================

export const redis = new RedisClient(REDIS_URL);

// ============================================================================
// Dependencies
// ============================================================================

const deps = { redis };
const channelFactory = createRedisChannelFactory({ redis });

// ============================================================================
// Backend Instances
// ============================================================================

export const authBackend: AuthBackend = createAuthBackend(deps);
export const blogBackend: BlogBackend = createBlogBackend({});
export const boardBackend: BoardBackend = createBoardBackend({
  redis,
  channelFactory,
});
export const chatBackend: ChatBackend = createChatBackend({
  redis,
  channelFactory,
});

// Re-export types for convenience
export type { AuthBackend, BlogBackend, BoardBackend, ChatBackend };
