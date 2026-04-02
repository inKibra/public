/**
 * Auth Handlers
 *
 * Implementation of auth API routes using createApiRouteHandlerProvider
 *
 * Context codecs are now on the routes - no need to pass them to handlers.
 */

import { createApiRouteHandlerProvider } from '@inkibra/denzel-bun';
import {
  createApiRouteHandler,
  SerializableResult,
  StatusCode,
} from '@inkibra/router';
import type { RedisClient } from 'bun';
import {
  getCurrentUserRoute,
  loginRoute,
  logoutRoute,
} from '../../api/routes/auth';
import type { SessionData, User } from '../../shared/types';

// ============================================================================
// Dependencies
// ============================================================================

export type AuthDeps = {
  redis: RedisClient;
};

function getAuthenticatedSession(ctx: {
  session: { type: 'Ok' | 'Err'; value: SessionData | null };
}): SessionData | null {
  if (ctx.session.type === 'Err') {
    return null;
  }

  return ctx.session.value;
}

// ============================================================================
// Helper Functions
// ============================================================================

function generateId(): string {
  return crypto.randomUUID();
}

async function getOrCreateUser(
  redis: RedisClient,
  username: string,
): Promise<User> {
  const userKey = `user:username:${username.toLowerCase()}`;
  const existingUserId = await redis.get(userKey);

  if (existingUserId) {
    const userData = await redis.get(`user:${existingUserId}`);
    if (userData) {
      return JSON.parse(userData) as User;
    }
  }

  // Create new user
  const user: User = {
    id: generateId(),
    username,
    createdAt: new Date().toISOString(),
  };

  await redis.set(`user:${user.id}`, JSON.stringify(user));
  await redis.set(userKey, user.id);

  return user;
}

async function getUserById(
  redis: RedisClient,
  userId: string,
): Promise<User | null> {
  const userData = await redis.get(`user:${userId}`);
  return userData ? (JSON.parse(userData) as User) : null;
}

// ============================================================================
// Handlers
// ============================================================================

/**
 * Login handler
 * Route has createsContextCodec: { session: SessionCodec }
 * Handler returns context.session to create the session
 */
export const loginHandlerProvider = createApiRouteHandlerProvider(
  (deps: AuthDeps) =>
    createApiRouteHandler({
      route: loginRoute,
      handler: async (args) => {
        const { username } = args.body;

        // Validate username (alphanumeric, 3-20 chars)
        if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
          return {
            result: SerializableResult.toErr(
              { type: 'InvalidUsername' as const },
              StatusCode.BAD_REQUEST,
            ),
          };
        }

        const user = await getOrCreateUser(deps.redis, username);
        const sessionData: SessionData = {
          userId: user.id,
          username: user.username,
        };

        return {
          result: SerializableResult.toOk({ user }, StatusCode.OK),
          context: { session: sessionData },
        };
      },
    }),
);

/**
 * Logout handler
 * Route has contextCodec: { session: SessionCodec }
 * Handler can read session from ctx
 * TODO: Clear session by returning null context
 */
export const logoutHandlerProvider = createApiRouteHandlerProvider(
  (_deps: AuthDeps) =>
    createApiRouteHandler({
      route: logoutRoute,
      handler: async () => {
        // Clear session by returning empty context
        return SerializableResult.toOk(
          { success: true as const },
          StatusCode.OK,
        );
      },
    }),
);

/**
 * Get current user handler
 * Route has contextCodec: { session: SessionCodec }
 * Handler receives session from ctx (decoded by transport)
 */
export const getCurrentUserHandlerProvider = createApiRouteHandlerProvider(
  (deps: AuthDeps) =>
    createApiRouteHandler({
      route: getCurrentUserRoute,
      handler: async (_args, ctx) => {
        const session = getAuthenticatedSession(ctx);
        if (!session) {
          return SerializableResult.toOk(null, StatusCode.OK);
        }

        const user = await getUserById(deps.redis, session.userId);
        return SerializableResult.toOk(user, StatusCode.OK);
      },
    }),
);
