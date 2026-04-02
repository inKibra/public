/**
 * Response Context - Builder for HTTP responses
 *
 * Used by context codec providers to write context to responses.
 */

// ============================================================================
// Cookie Options
// ============================================================================

/**
 * Options for setting cookies
 */
export type CookieOptions = {
  /** Max age in seconds */
  maxAge?: number;
  /** Expiration date */
  expires?: Date;
  /** Cookie path */
  path?: string;
  /** Cookie domain */
  domain?: string;
  /** Secure flag (HTTPS only) */
  secure?: boolean;
  /** HttpOnly flag (no JS access) */
  httpOnly?: boolean;
  /** SameSite policy */
  sameSite?: 'strict' | 'lax' | 'none';
};

/**
 * Cookie entry for Set-Cookie header
 */
export type CookieEntry = {
  name: string;
  value: string;
  options: CookieOptions;
};

// ============================================================================
// Response Context Type
// ============================================================================

/**
 * Response context provides methods to build HTTP responses
 */
export type ResponseContext = {
  /** Response headers */
  readonly headers: Headers;
  /** Cookies to set */
  readonly cookies: CookieEntry[];
  /** Cookies to delete */
  readonly deletedCookies: string[];

  /** Set a response header */
  setHeader(name: string, value: string): void;

  /** Append a value to an existing header */
  appendHeader(name: string, value: string): void;

  /** Set a cookie */
  setCookie(name: string, value: string, options?: CookieOptions): void;

  /** Delete a cookie */
  deleteCookie(
    name: string,
    options?: Pick<CookieOptions, 'path' | 'domain'>,
  ): void;

  /** Build a Response with the given body */
  toResponse(body: BodyInit | null, init?: ResponseInit): Response;

  /** Build a JSON Response */
  toJsonResponse(data: unknown, init?: ResponseInit): Response;
};

// ============================================================================
// Cookie Serialization
// ============================================================================

/**
 * Serialize a cookie entry to Set-Cookie header format
 */
function serializeCookie(entry: CookieEntry): string {
  const { name, value, options } = entry;
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }

  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }

  if (options.path) {
    parts.push(`Path=${options.path}`);
  }

  if (options.domain) {
    parts.push(`Domain=${options.domain}`);
  }

  if (options.secure) {
    parts.push('Secure');
  }

  if (options.httpOnly) {
    parts.push('HttpOnly');
  }

  if (options.sameSite) {
    parts.push(
      `SameSite=${options.sameSite.charAt(0).toUpperCase() + options.sameSite.slice(1)}`,
    );
  }

  return parts.join('; ');
}

/**
 * Serialize a cookie deletion
 */
function serializeDeleteCookie(
  name: string,
  options?: Pick<CookieOptions, 'path' | 'domain'>,
): string {
  const parts = [
    `${name}=`,
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];

  if (options?.path) {
    parts.push(`Path=${options.path}`);
  }

  if (options?.domain) {
    parts.push(`Domain=${options.domain}`);
  }

  return parts.join('; ');
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a response context for building HTTP responses
 *
 * @example
 * ```typescript
 * const ctx = createResponseContext();
 *
 * ctx.setHeader('X-Request-ID', requestId);
 * ctx.setCookie('session', token, { httpOnly: true, secure: true });
 *
 * return ctx.toJsonResponse({ success: true });
 * ```
 */
export function createResponseContext(): ResponseContext {
  const headers = new Headers();
  const cookies: CookieEntry[] = [];
  const deletedCookies: string[] = [];
  const deletedCookieOptions: Map<
    string,
    Pick<CookieOptions, 'path' | 'domain'>
  > = new Map();

  const ctx: ResponseContext = {
    headers,
    cookies,
    deletedCookies,

    setHeader(name: string, value: string) {
      headers.set(name, value);
    },

    appendHeader(name: string, value: string) {
      headers.append(name, value);
    },

    setCookie(name: string, value: string, options: CookieOptions = {}) {
      // Remove from deleted if it was marked for deletion
      const deleteIndex = deletedCookies.indexOf(name);
      if (deleteIndex !== -1) {
        deletedCookies.splice(deleteIndex, 1);
        deletedCookieOptions.delete(name);
      }

      // Remove existing cookie with same name
      const existingIndex = cookies.findIndex((c) => c.name === name);
      if (existingIndex !== -1) {
        cookies.splice(existingIndex, 1);
      }

      cookies.push({ name, value, options });
    },

    deleteCookie(
      name: string,
      options?: Pick<CookieOptions, 'path' | 'domain'>,
    ) {
      // Remove from cookies if it was set
      const existingIndex = cookies.findIndex((c) => c.name === name);
      if (existingIndex !== -1) {
        cookies.splice(existingIndex, 1);
      }

      if (!deletedCookies.includes(name)) {
        deletedCookies.push(name);
        if (options) {
          deletedCookieOptions.set(name, options);
        }
      }
    },

    toResponse(body: BodyInit | null, init: ResponseInit = {}) {
      // Clone headers
      const responseHeaders = new Headers(headers);

      // Add Set-Cookie headers for cookies
      for (const cookie of cookies) {
        responseHeaders.append('Set-Cookie', serializeCookie(cookie));
      }

      // Add Set-Cookie headers for deleted cookies
      for (const name of deletedCookies) {
        responseHeaders.append(
          'Set-Cookie',
          serializeDeleteCookie(name, deletedCookieOptions.get(name)),
        );
      }

      // Merge with init headers
      if (init.headers) {
        const initHeaders = new Headers(init.headers);
        initHeaders.forEach((value, key) => {
          // Use append for Set-Cookie to preserve multiple cookie headers
          // Use set for all other headers to replace values
          if (key.toLowerCase() === 'set-cookie') {
            responseHeaders.append(key, value);
          } else {
            responseHeaders.set(key, value);
          }
        });
      }

      return new Response(body, {
        ...init,
        headers: responseHeaders,
      });
    },

    toJsonResponse(data: unknown, init: ResponseInit = {}) {
      // Create new init with Content-Type header without mutating shared state
      const jsonInit: ResponseInit = {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          // Merge any existing headers from init
          ...(init.headers instanceof Headers
            ? (() => {
                const h: Record<string, string> = {};
                init.headers.forEach((v, k) => {
                  h[k] = v;
                });
                return h;
              })()
            : init.headers),
        },
      };
      return ctx.toResponse(JSON.stringify(data), jsonInit);
    },
  };

  return ctx;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a redirect response
 */
export function createRedirectResponse(
  url: string,
  status: 301 | 302 | 303 | 307 | 308 = 302,
): Response {
  return new Response(null, {
    status,
    headers: {
      Location: url,
    },
  });
}

/**
 * Create a not found response
 */
export function createNotFoundResponse(message = 'Not Found'): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 404,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Create an error response
 */
export function createErrorResponse(
  message: string,
  status = 500,
  details?: unknown,
): Response {
  return new Response(
    JSON.stringify({
      error: message,
      ...(details ? { details } : {}),
    }),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
      },
    },
  );
}
