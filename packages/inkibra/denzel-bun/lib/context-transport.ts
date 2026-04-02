/**
 * Context Transport - Read/write context values based on codec scope
 *
 * Handles serialization of context values to/from HTTP:
 *
 * READ (by scope):
 * - session: query → header → cookie
 * - device: query → header → cookie
 *
 * For secure: 'signed' codecs, reads Authorization token from:
 * - ?authorization query param (for SSE)
 * - Authorization header (strips 'Bearer ' prefix)
 * - Authorization cookie
 *
 * WRITE (both scopes):
 * - header: X-{Scope}-{name} (for fetch provider to read)
 * - cookie: ctx-{scope}-{name} (for persistence)
 *
 * For secure: 'signed' codecs, writes a refreshed JWT to
 * both Authorization header and Authorization cookie.
 *
 * Header format: X-Session-{name} or X-Device-{name}
 * Query format: ctx-session-{name} or ctx-device-{name}
 * Cookie format: ctx-session-{name} or ctx-device-{name}
 *
 * All names are normalized to lowercase for HTTP header compatibility.
 */

import { issueJWT, validateJWT } from '@inkibra/crypto-jwt-claim';
import type {
  AnyContextCodec,
  ContextCodecMap,
  ContextDecodeWarning,
} from '@inkibra/router';
import type { RequestContext } from './request-context';
import type { CookieOptions, ResponseContext } from './response-context';

// ============================================================================
// JWT Config
// ============================================================================

/**
 * Configuration for JWT signing/verification used by secure: 'signed' codecs.
 */
export type JwtConfig = {
  secret: string;
  issuer: string;
  clockTolerance?: number;
  /** Seconds until a visitor (null-value) JWT expires */
  visitorValiditySeconds: number;
  /** Seconds until an authenticated JWT expires */
  authenticatedValiditySeconds: number;
};

// ============================================================================
// Constants & Helpers
// ============================================================================

/** Get header key for a codec: X-Session-{name} or X-Device-{name} */
function getHeaderKey(codec: AnyContextCodec): string {
  const scopePrefix = codec.scope === 'session' ? 'X-Session-' : 'X-Device-';
  return `${scopePrefix}${codec.name.toLowerCase()}`;
}

/** Get query/cookie key for a codec: ctx-session-{name} or ctx-device-{name} */
function getTransportKey(codec: AnyContextCodec): string {
  const scopePrefix =
    codec.scope === 'session' ? 'ctx-session-' : 'ctx-device-';
  return `${scopePrefix}${codec.name.toLowerCase()}`;
}

// ============================================================================
// Read Context
// ============================================================================

/**
 * Result of reading a context value
 */
export type ReadContextResult<T> =
  | { success: true; value: T; source: 'query' | 'header' | 'cookie' }
  | { success: false; error: 'not_found' }
  | { success: false; error: 'parse_error'; message: string }
  | { success: false; error: 'validation_error'; errors: unknown };

/**
 * Read a context value from the request based on codec scope.
 *
 * For secure: 'signed' codecs, reads a JWT from:
 *   1. ?authorization query param (for SSE)
 *   2. Authorization header (strips 'Bearer ' prefix)
 *   3. Authorization cookie
 *
 * If jwtConfig is not provided for a signed codec, decode fails closed.
 *
 * Priority for plain codecs (both scopes):
 * - query → header → cookie
 *
 * Header keys are normalized to lowercase for comparison.
 */
export async function readContextFromRequest<T>(
  request: RequestContext,
  codec: AnyContextCodec,
  jwtConfig?: JwtConfig,
): Promise<ReadContextResult<T>> {
  // ── secure: 'signed' path ──────────────────────────────────────────────────
  if (codec.secure === 'signed') {
    if (!jwtConfig) {
      return {
        success: false,
        error: 'parse_error',
        message: `Missing JWT config for signed context codec: ${codec.name}`,
      };
    }

    // Collect the raw token string from the three sources in priority order
    let rawToken: string | undefined;

    // 1. ?authorization query param (needed for SSE – sent as JSON string or plain)
    const queryVal = request.query.get('authorization') ?? undefined;
    if (queryVal) {
      // The old token-handler parsed it with JSON.parse – support both forms
      try {
        rawToken = JSON.parse(queryVal) as string;
      } catch {
        rawToken = queryVal;
      }
      // Strip 'Bearer ' prefix if present (client may include it from the
      // Authorization header value it captured)
      rawToken = rawToken.replace(/^Bearer\s+/i, '');
    }

    // 2. Authorization header (strip optional 'Bearer ' prefix)
    if (!rawToken) {
      const headerVal = request.headers.get('authorization') ?? undefined;
      if (headerVal) {
        rawToken = headerVal.replace(/^Bearer\s+/i, '');
      }
    }

    // 3. Authorization cookie
    if (!rawToken) {
      rawToken = request.cookies.get('Authorization') ?? undefined;
    }

    if (!rawToken) {
      // No token at all – treat as not_found (codec defaultValue will be used)
      return { success: false, error: 'not_found' };
    }

    // Verify JWT
    let payload: Record<string, unknown>;
    try {
      const parsed = await validateJWT<Record<string, unknown>>(
        jwtConfig.secret,
        jwtConfig.issuer,
        rawToken,
        jwtConfig.clockTolerance ?? 0,
      );
      payload = parsed.payload;
    } catch {
      return {
        success: false,
        error: 'parse_error',
        message: 'Invalid or expired JWT',
      };
    }

    // Visitor tokens → treat as absent (not_found), codec default applies
    if (payload.session === 'VISITOR' || payload.contextType === 'VISITOR') {
      return { success: false, error: 'not_found' };
    }

    // Reconstruct the codec value from JWT payload fields.
    // Prefer the generalized 'data' claim (new format), fall back to legacy
    // hardcoded fields for backward compatibility.
    const codecValue: Record<string, unknown> =
      payload.data !== undefined
        ? typeof payload.data === 'string'
          ? (JSON.parse(payload.data) as Record<string, unknown>)
          : (payload.data as Record<string, unknown>)
        : {
            id: payload.sessionId,
            fullName: payload.sessionFullName,
            roles: payload.sessionRoles,
          };

    // Validate reconstructed value against codec schema
    const validation = codec.schema.dataValidator(codecValue);
    if (!validation.success) {
      return {
        success: false,
        error: 'validation_error',
        errors: validation.errors,
      };
    }

    return { success: true, value: validation.data as T, source: 'header' };
  }

  // ── plain JSON path ────────────────────────────────────────────────────────
  const queryKey = getTransportKey(codec);
  const headerKey = getHeaderKey(codec).toLowerCase(); // Headers are case-insensitive
  const cookieKey = getTransportKey(codec);

  let encoded: string | undefined;
  let source: 'query' | 'header' | 'cookie' | undefined;

  // 1. Try query param first
  encoded = request.query.get(queryKey) ?? undefined;
  if (encoded) {
    source = 'query';
  }

  // 2. Try header
  if (!encoded) {
    encoded = request.headers.get(headerKey) ?? undefined;
    if (encoded) {
      source = 'header';
    }
  }

  // 3. Try cookie (both scopes now use cookies for persistence)
  if (!encoded) {
    encoded = request.cookies.get(cookieKey);
    if (encoded) {
      source = 'cookie';
    }
  }

  // Not found
  if (!encoded || !source) {
    return { success: false, error: 'not_found' };
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch (e) {
    return {
      success: false,
      error: 'parse_error',
      message: e instanceof Error ? e.message : 'Invalid JSON',
    };
  }

  // Validate against schema
  const validation = codec.schema.dataValidator(parsed);
  if (!validation.success) {
    return {
      success: false,
      error: 'validation_error',
      errors: validation.errors,
    };
  }

  return { success: true, value: validation.data as T, source };
}

/**
 * Result of reading all contexts - includes whether any had errors
 */
export type ReadContextsResult<T extends ContextCodecMap> = {
  /** Context values (defaultValue used for missing/invalid) */
  values: { [K in keyof T]: T[K]['_dataType'] };
  /** Decode warnings keyed by context codec key */
  decodeWarnings: Partial<{ [K in keyof T]: readonly ContextDecodeWarning[] }>;
  /** Any malformed contexts that should be logged/reset */
  errors: Array<{
    codec: string;
    error: 'not_found' | 'parse_error' | 'validation_error';
    details?: unknown;
  }>;
};

/**
 * Read all contexts from a codec map
 *
 * Returns an object with codec keys mapped to their deserialized values.
 * Missing or invalid contexts use the codec's defaultValue.
 * Also returns malformed context errors for logging/reset behavior.
 */
export async function readContextsFromRequest<T extends ContextCodecMap>(
  request: RequestContext,
  codecs: T,
  jwtConfig?: JwtConfig,
): Promise<ReadContextsResult<T>> {
  const values: Record<string, unknown> = {};
  const decodeWarnings: Record<string, readonly ContextDecodeWarning[]> = {};
  const errors: ReadContextsResult<T>['errors'] = [];

  for (const [key, codec] of Object.entries(codecs)) {
    const readResult = await readContextFromRequest(request, codec, jwtConfig);
    if (readResult.success) {
      values[key] = readResult.value;
    } else {
      // Use defaultValue for missing/invalid contexts
      values[key] = codec.defaultValue;

      decodeWarnings[key] = [
        readResult.error === 'not_found'
          ? { type: 'ContextNotFound' }
          : readResult.error === 'parse_error'
            ? { type: 'ContextParseError', message: readResult.message }
            : { type: 'ContextValidationError', errors: readResult.errors },
      ];

      // Track malformed contexts for logging/reset behavior
      if (readResult.error === 'not_found') {
        // Not found is not an error - just use default
        // Don't add to errors array
      } else {
        errors.push({
          codec: codec.name,
          error: readResult.error,
          details:
            readResult.error === 'parse_error'
              ? readResult.message
              : readResult.error === 'validation_error'
                ? readResult.errors
                : undefined,
        });
      }
    }
  }

  return {
    values: values as { [K in keyof T]: T[K]['_dataType'] },
    decodeWarnings: decodeWarnings as ReadContextsResult<T>['decodeWarnings'],
    errors,
  };
}

// ============================================================================
// Write Context
// ============================================================================

/**
 * Write a context value to the response based on codec scope.
 *
 * For secure: 'signed' codecs:
 * - If value is populated (authenticated): re-sign and emit a refreshed JWT
 *   via the Authorization header and Authorization cookie.
 * - If value is null/undefined (visitor): sign a fresh visitor JWT and emit it
 *   the same way.
 *
 * For plain codecs, both scopes write to headers AND cookies:
 * - session: X-Session-{name} header + session cookie (no maxAge)
 * - device: X-Device-{name} header + persistent cookie (1 year maxAge)
 */
export async function writeContextToResponse(
  response: ResponseContext,
  codec: AnyContextCodec,
  value: unknown,
  jwtConfig?: JwtConfig,
): Promise<void> {
  // ── secure: 'signed' path ──────────────────────────────────────────────────
  if (codec.secure === 'signed') {
    if (!jwtConfig) {
      console.error(
        `Cannot write signed context codec without jwtConfig: ${codec.name}`,
      );
      return;
    }

    let tokenString: string;

    if (value !== null && value !== undefined) {
      // Authenticated value – re-sign as authenticated JWT
      // Use generalized 'data' claim for arbitrary codec shapes, plus legacy
      // fields for backward compatibility with existing tokens.
      const authValue = value as Record<string, unknown>;
      const subject =
        typeof authValue.id === 'string' ? authValue.id : crypto.randomUUID();
      const expirationMinutes = jwtConfig.authenticatedValiditySeconds / 60;
      const result = await issueJWT(
        jwtConfig.secret,
        jwtConfig.issuer,
        subject,
        {
          session: 'AUTHENTICATED',
          data: JSON.stringify(value),
          // Legacy fields for backward compat
          sessionId: authValue.id,
          sessionFullName: authValue.fullName,
          sessionRoles: authValue.roles,
          contextType: 'AUTHENTICATED',
        },
        expirationMinutes,
      );
      tokenString = result.tokenString;
    } else {
      // Null/visitor – sign a visitor JWT (pure in-memory, no DB write)
      const expirationMinutes = jwtConfig.visitorValiditySeconds / 60;
      const visitorId = crypto.randomUUID();
      const result = await issueJWT(
        jwtConfig.secret,
        jwtConfig.issuer,
        visitorId,
        {
          session: 'VISITOR',
          sessionId: visitorId,
          sessionEmail: undefined,
          sessionFullName: undefined,
          contextType: 'VISITOR',
        },
        expirationMinutes,
      );
      tokenString = result.tokenString;
    }

    // Emit the JWT token via header and cookie (same as old tokenHandler.setToken)
    response.setHeader('Authorization', tokenString);
    const cookieMaxAge =
      value !== null && value !== undefined
        ? jwtConfig.authenticatedValiditySeconds
        : jwtConfig.visitorValiditySeconds;
    response.setCookie('Authorization', tokenString, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      maxAge: cookieMaxAge,
    });
    return;
  }

  // ── plain JSON path ────────────────────────────────────────────────────────
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch (e) {
    console.error(`Failed to serialize context ${codec.name}:`, e);
    return;
  }

  const headerKey = getHeaderKey(codec);
  const cookieKey = getTransportKey(codec);

  // Always write to response header (for fetch provider to read)
  response.setHeader(headerKey, encoded);

  // Always write to cookie, scope determines lifetime
  const cookieOptions: CookieOptions = {
    httpOnly: codec.scope === 'session', // Session cookies are httpOnly
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    // Session scope: no maxAge = session cookie (expires with browser)
    // Device scope: 1 year persistence
    ...(codec.scope === 'device' ? { maxAge: 60 * 60 * 24 * 365 } : {}),
  };

  response.setCookie(cookieKey, encoded, cookieOptions);
}

/**
 * Write multiple context values to the response
 */
export async function writeContextsToResponse<T extends ContextCodecMap>(
  response: ResponseContext,
  codecs: T,
  values: Partial<{ [K in keyof T]: T[K]['_dataType'] }>,
  jwtConfig?: JwtConfig,
): Promise<void> {
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      const codec = codecs[key];
      if (codec) {
        await writeContextToResponse(response, codec, value, jwtConfig);
      }
    }
  }
}

/**
 * Delete a context value (clear cookie)
 */
export function deleteContext(
  response: ResponseContext,
  codec: AnyContextCodec,
): void {
  const cookieKey = getTransportKey(codec);

  // Clear cookie (works for both scopes since both use cookies now)
  response.deleteCookie(cookieKey, { path: '/' });

  // Note: Can't "unset" a header that was already set on a previous response
  // Deletion is mainly for cookies
}
