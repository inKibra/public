/**
 * Auth Backend
 *
 * Authentication API handlers with typed implementations.
 */

import { createBackend } from '@inkibra/denzel-bun';
import type { RedisClient } from 'bun';
import {
  getCurrentUserHandlerProvider,
  loginHandlerProvider,
  logoutHandlerProvider,
} from '../handlers/auth-handlers';

// ============================================================================
// Dependencies
// ============================================================================

export type AuthBackendDeps = {
  redis: RedisClient;
};

// ============================================================================
// Create Auth Backend
// ============================================================================

/**
 * Create the auth backend with typed handlers
 *
 * Uses explicit keys (not spread) to preserve type information.
 *
 * Usage:
 * ```typescript
 * const { login } = authBackend.apiHandlers.login.with({});
 * const { getCurrentUser } = authBackend.apiHandlers.getCurrentUser.with({ session });
 * ```
 */
export function createAuthBackend(deps: AuthBackendDeps) {
  const backend = createBackend({
    apiHandlers: {
      login: loginHandlerProvider(deps),
      logout: logoutHandlerProvider(deps),
      getCurrentUser: getCurrentUserHandlerProvider(deps),
    },
  });

  return backend;
}

// Type for the auth backend
export type AuthBackend = ReturnType<typeof createAuthBackend>;
