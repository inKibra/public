/**
 * Common utility types for route definitions
 */

/**
 * Empty object type - use for routes with no path params or query
 */
export type EmptyObject = Record<string, never>;

/**
 * No data type - use for routes with no body
 */
export type NoData = void;

/**
 * Simple query params for pagination
 */
export type SimpleQuery = {
  limit?: number;
  offset?: number;
};

/**
 * Encode a query object to URL search params string
 */
export function encodeQuery<T extends object>(query: T): string {
  const queryParams = new URLSearchParams();
  for (const key in query) {
    if (query[key] !== undefined) {
      queryParams.append(key, JSON.stringify(query[key]));
    }
  }
  return queryParams.toString();
}

/**
 * Decode URL search params to a query object
 */
export function decodeQuery(query: object): Record<string, unknown> {
  const queryObject: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) {
    if (key === 'authorization') {
      continue;
    }
    try {
      queryObject[key] = JSON.parse(value);
    } catch {
      queryObject[key] = value;
    }
  }
  return queryObject;
}
