/**
 * Auth API Routes
 *
 * Simple username-based authentication for the example app
 */

import {
  createAPIRoute,
  createContextCodec,
  defineContextSchema,
} from '@inkibra/router';
import { HttpMethod } from '@inkibra/router/constants/http-method';
import type { GetCurrentUser, Login, Logout } from '../../schemas';
import {
  getCurrentUserSchema as getCurrentUserRouteSchema,
  loginSchema as loginRouteSchema,
  logoutSchema as logoutRouteSchema,
  type SessionContextData,
  type SessionContextError,
  validateSessionContextData,
} from '../../schemas';

// ============================================================================
// Context Codec
// ============================================================================

/**
 * Session context codec - stored in session storage (cleared on browser session end)
 *
 * defaultValue: null means "not authenticated" state
 */
export const SessionCodec = createContextCodec({
  name: 'session',
  scope: 'device',
  // secure: 'signed', // TODO: verify this works
  schema: defineContextSchema<SessionContextData, never, SessionContextError>({
    dataValidator: validateSessionContextData,
  }),
  defaultValue: null,
});

// ============================================================================
// Login Route
// ============================================================================

export const loginSchema = loginRouteSchema;

export const loginRoute = createAPIRoute({
  name: 'login',
  method: HttpMethod.POST,
  path: '/api/auth/login',
  schema: loginSchema,
  createsContextCodec: { session: SessionCodec },
});

// ============================================================================
// Logout Route
// ============================================================================

export const logoutSchema = logoutRouteSchema;

export const logoutRoute = createAPIRoute({
  name: 'logout',
  method: HttpMethod.POST,
  path: '/api/auth/logout',
  schema: logoutSchema,
  contextCodec: { session: SessionCodec },
});

// ============================================================================
// Get Current User Route
// ============================================================================

export const getCurrentUserSchema = getCurrentUserRouteSchema;

export const getCurrentUserRoute = createAPIRoute({
  name: 'getCurrentUser',
  method: HttpMethod.GET,
  path: '/api/auth/me',
  schema: getCurrentUserSchema,
  contextCodec: { session: SessionCodec },
});

// ============================================================================
// Export Types and Routes
// ============================================================================

export type { Login, Logout, GetCurrentUser };

export const authRoutes = {
  login: loginRoute,
  logout: logoutRoute,
  getCurrentUser: getCurrentUserRoute,
};
