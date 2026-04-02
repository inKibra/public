/**
 * Request Context - Provides typed access to HTTP request data
 *
 * Used by context codec providers to read context from requests.
 */

// ============================================================================
// Request Context Type
// ============================================================================

/**
 * Request context provides structured access to HTTP request data
 */
export type RequestContext = {
  /** HTTP headers */
  readonly headers: Headers;
  /** Parsed cookies */
  readonly cookies: Map<string, string>;
  /** Path parameters from URL pattern match */
  readonly pathParams: Record<string, string>;
  /** Query parameters from URL */
  readonly query: URLSearchParams;
  /** Raw Bun/Web Request object */
  readonly raw: Request;
  /** Request URL */
  readonly url: URL;
  /** HTTP method */
  readonly method: string;
};

// ============================================================================
// Cookie Parsing
// ============================================================================

/**
 * Parse cookies from Cookie header
 */
function parseCookies(cookieHeader: string | null): Map<string, string> {
  const cookies = new Map<string, string>();

  if (!cookieHeader) {
    return cookies;
  }

  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const [name, ...rest] = pair.trim().split('=');
    if (name) {
      const value = rest.join('='); // Handle values with = in them
      cookies.set(name, decodeURIComponent(value));
    }
  }

  return cookies;
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Build a request context from a Bun/Web Request
 *
 * @param request - The incoming HTTP request
 * @param pathParams - Path parameters extracted from URL pattern match
 *
 * @example
 * ```typescript
 * const ctx = buildRequestContext(request, { userId: '123' });
 * const authCookie = ctx.cookies.get('auth');
 * const acceptHeader = ctx.headers.get('Accept');
 * ```
 */
export function buildRequestContext(
  request: Request,
  pathParams: Record<string, string> = {},
): RequestContext {
  const url = new URL(request.url);
  const cookies = parseCookies(request.headers.get('Cookie'));

  return {
    headers: request.headers,
    cookies,
    pathParams,
    query: url.searchParams,
    raw: request,
    url,
    method: request.method,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get a header value with type narrowing
 */
export function getHeader(
  ctx: RequestContext,
  name: string,
): string | undefined {
  return ctx.headers.get(name) ?? undefined;
}

/**
 * Get a cookie value
 */
export function getCookie(
  ctx: RequestContext,
  name: string,
): string | undefined {
  return ctx.cookies.get(name);
}

/**
 * Get a path parameter
 */
export function getPathParam(
  ctx: RequestContext,
  name: string,
): string | undefined {
  return ctx.pathParams[name];
}

/**
 * Get a query parameter
 */
export function getQueryParam(
  ctx: RequestContext,
  name: string,
): string | undefined {
  return ctx.query.get(name) ?? undefined;
}

/**
 * Get all query parameters as an object
 */
export function getQueryParams(ctx: RequestContext): Record<string, string> {
  const params: Record<string, string> = {};
  ctx.query.forEach((value, key) => {
    params[key] = value;
  });
  return params;
}
