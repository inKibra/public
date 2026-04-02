/**
 * Cursor-based pagination types for use with DAL queries.
 * Cursors are constrained to filterable/indexed properties (K extends keyof T),
 * matching the pattern used by Filter<T, K>.
 */

import { Filter } from './filter';

/**
 * Represents a cursor window - the boundaries of a page of results.
 * K is constrained to the filterable keys of T (same as Filter<T, K>).
 */
export type Cursor<T, K extends keyof T> = {
  /** The property to sort/paginate on (must be a filterable/indexed key) */
  sortKey: K;
  /** Sort order for the cursor */
  sortOrder: 'asc' | 'desc';
  /** Value of sortKey for the first item in the current window */
  first: T[K];
  /** ID of the first item (tie-breaker when sortKey values are equal) */
  firstId: string;
  /** Value of sortKey for the last item in the current window */
  last: T[K];
  /** ID of the last item (tie-breaker when sortKey values are equal) */
  lastId: string;
};

export namespace Cursor {
  /** Direction to fetch relative to the anchor */
  export type Direction = 'forward' | 'backward';

  /**
   * A cursor request sent by the client to fetch a page.
   * K is constrained to filterable keys of T.
   */
  export type Request<T, K extends keyof T> = {
    /** The property to sort/paginate on */
    sortKey: K;
    /** Sort order */
    sortOrder: 'asc' | 'desc';
    /** The boundary value to start from (exclusive) */
    anchor?: T[K];
    /** ID tie-breaker for the anchor (required when anchor values may collide) */
    anchorId?: string;
    /** Direction to fetch: forward = after anchor, backward = before anchor */
    direction: Direction;
    /** Maximum number of items to fetch */
    limit: number;
  };

  /**
   * Page metadata returned by the server alongside the items.
   * Describes the returned window and whether more data exists.
   */
  export type PageInfo<T, K extends keyof T> = {
    /** Cursor describing the boundaries of the returned page */
    cursor: Cursor<T, K>;
    /** True if more items exist before the first item in this page */
    hasBefore: boolean;
    /** True if more items exist after the last item in this page */
    hasAfter: boolean;
  };

  /**
   * Serialized cursor for transport over HTTP query params.
   * The sortKey is encoded as a string; values are JSON-serialized.
   */
  export type SerializedRequest = {
    sortKey: string;
    sortOrder: 'asc' | 'desc';
    anchor?: string;
    anchorId?: string;
    direction: Direction;
    limit: number;
  };

  /**
   * Serializes a cursor request for transport.
   */
  export function serializeRequest<T, K extends keyof T>(
    request: Request<T, K>,
  ): SerializedRequest {
    return {
      sortKey: String(request.sortKey),
      sortOrder: request.sortOrder,
      anchor:
        request.anchor !== undefined
          ? JSON.stringify(request.anchor)
          : undefined,
      anchorId: request.anchorId,
      direction: request.direction,
      limit: request.limit,
    };
  }

  /**
   * Deserializes a cursor request from transport format.
   */
  export function deserializeRequest<T, K extends keyof T>(
    serialized: SerializedRequest,
    sortKey: K,
  ): Request<T, K> {
    return {
      sortKey,
      sortOrder: serialized.sortOrder,
      anchor:
        serialized.anchor !== undefined
          ? JSON.parse(serialized.anchor)
          : undefined,
      anchorId: serialized.anchorId,
      direction: serialized.direction,
      limit: serialized.limit,
    };
  }

  /**
   * Creates an initial cursor request for fetching the first page.
   * Fetches the most recent items first (descending by sortKey).
   */
  export function initialRequest<T, K extends keyof T>(
    sortKey: K,
    limit: number,
    sortOrder: 'asc' | 'desc' = 'desc',
  ): Request<T, K> {
    return {
      sortKey,
      sortOrder,
      direction: 'forward',
      limit,
    };
  }

  /**
   * Creates a request to fetch the next page (forward from the last item).
   */
  export function nextPageRequest<T, K extends keyof T>(
    pageInfo: PageInfo<T, K>,
    limit: number,
  ): Request<T, K> | undefined {
    if (!pageInfo.hasAfter) {
      return undefined;
    }
    return {
      sortKey: pageInfo.cursor.sortKey,
      sortOrder: pageInfo.cursor.sortOrder,
      anchor: pageInfo.cursor.last,
      anchorId: pageInfo.cursor.lastId,
      direction: 'forward',
      limit,
    };
  }

  /**
   * Creates a request to fetch the previous page (backward from the first item).
   */
  export function prevPageRequest<T, K extends keyof T>(
    pageInfo: PageInfo<T, K>,
    limit: number,
  ): Request<T, K> | undefined {
    if (!pageInfo.hasBefore) {
      return undefined;
    }
    return {
      sortKey: pageInfo.cursor.sortKey,
      sortOrder: pageInfo.cursor.sortOrder,
      anchor: pageInfo.cursor.first,
      anchorId: pageInfo.cursor.firstId,
      direction: 'backward',
      limit,
    };
  }

  /**
   * Applies cursor conditions to an existing filter object.
   * Returns a new filter with the appropriate gt/lt conditions based on anchor and direction.
   *
   * @param existingFilter - The base filter to extend
   * @param request - The cursor request with anchor/direction
   * @returns A new filter with cursor conditions applied
   */
  export function applyCursorToFilter<
    T extends { id: string },
    K extends keyof T,
  >(
    existingFilter: Filter<T, K> | undefined,
    request: Request<T, K>,
  ): Filter<T, K | 'id'> {
    // Deep clone the filter to avoid mutation
    const filter: Filter<T, K | 'id'> = existingFilter
      ? JSON.parse(JSON.stringify(existingFilter))
      : {};

    // No anchor means we're fetching from the start/end, no additional filter needed
    if (request.anchor === undefined) {
      return filter;
    }

    // Determine comparison operator based on direction and sort order
    // For ascending order:
    //   - forward = gt (items after anchor)
    //   - backward = lt (items before anchor)
    // For descending order:
    //   - forward = lt (items after anchor in desc = smaller values)
    //   - backward = gt (items before anchor in desc = larger values)
    const isForward = request.direction === 'forward';
    const isAsc = request.sortOrder === 'asc';

    let operator: Filter.Operators.GREATER_THAN | Filter.Operators.LESS_THAN;
    if (isAsc) {
      operator = isForward
        ? Filter.Operators.GREATER_THAN
        : Filter.Operators.LESS_THAN;
    } else {
      operator = isForward
        ? Filter.Operators.LESS_THAN
        : Filter.Operators.GREATER_THAN;
    }

    // Apply the filter based on value type
    const anchorValue = request.anchor;

    if (typeof anchorValue === 'string') {
      (filter as Record<K, Filter.StringFilter>)[request.sortKey] = {
        operator,
        value: anchorValue,
      };
    } else if (typeof anchorValue === 'number') {
      (filter as Record<K, Filter.NumberFilter>)[request.sortKey] = {
        operator,
        value: anchorValue,
      };
    }

    return filter;
  }

  /**
   * Builds page info from a list of items.
   * Determines cursor boundaries and whether more items exist.
   *
   * @param items - The items returned from the query
   * @param request - The original cursor request
   * @param idKey - The key to use for item IDs (defaults to 'id')
   * @returns PageInfo describing the returned page
   */
  export function buildPageInfo<T extends { id: string }, K extends keyof T>(
    items: T[],
    request: Request<T, K>,
  ): PageInfo<T, K> | undefined {
    if (items.length === 0) {
      return undefined;
    }

    const firstItem = items[0]!;
    const lastItem = items[items.length - 1]!;

    const cursor: Cursor<T, K> = {
      sortKey: request.sortKey,
      sortOrder: request.sortOrder,
      first: firstItem[request.sortKey],
      firstId: firstItem.id,
      last: lastItem[request.sortKey],
      lastId: lastItem.id,
    };

    // Determine hasBefore/hasAfter
    // If we got fewer items than requested, there's no more in that direction
    const gotFullPage = items.length >= request.limit;

    // Default logic: if we have an anchor, there's likely data in the opposite direction
    // If we got a full page, there's likely more in the current direction
    let hasBefore: boolean;
    let hasAfter: boolean;

    if (request.direction === 'forward') {
      // We were fetching forward (after anchor)
      // hasBefore = true if we had an anchor (meaning there's data before)
      // hasAfter = true if we got a full page (meaning there might be more)
      hasBefore = request.anchor !== undefined;
      hasAfter = gotFullPage;
    } else {
      // We were fetching backward (before anchor)
      // hasBefore = true if we got a full page (meaning there might be more before)
      // hasAfter = true if we had an anchor (meaning there's data after)
      hasBefore = gotFullPage;
      hasAfter = request.anchor !== undefined;
    }

    return {
      cursor,
      hasBefore,
      hasAfter,
    };
  }

  /**
   * Sorts items according to cursor request's sort order.
   * This is useful for client-side merging of pages.
   *
   * @param items - The items to sort
   * @param sortKey - The key to sort by
   * @param sortOrder - The sort order
   * @returns Sorted items (new array, does not mutate input)
   */
  export function sortItems<T, K extends keyof T>(
    items: T[],
    sortKey: K,
    sortOrder: 'asc' | 'desc',
  ): T[] {
    return [...items].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];

      let comparison: number;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        comparison = aVal.localeCompare(bVal);
      } else if (typeof aVal === 'number' && typeof bVal === 'number') {
        comparison = aVal - bVal;
      } else {
        // Fallback for other types - convert to string
        comparison = String(aVal).localeCompare(String(bVal));
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }

  /**
   * Merges two pages of items, deduplicating by id and maintaining sort order.
   *
   * @param existingItems - The current items
   * @param newItems - The new items to merge
   * @param sortKey - The key to sort by
   * @param sortOrder - The sort order
   * @returns Merged and sorted items
   */
  export function mergePages<T extends { id: string }, K extends keyof T>(
    existingItems: T[],
    newItems: T[],
    sortKey: K,
    sortOrder: 'asc' | 'desc',
  ): T[] {
    // Create a map for deduplication by id
    const itemMap = new Map<string, T>();

    for (const item of existingItems) {
      itemMap.set(item.id, item);
    }

    for (const item of newItems) {
      // New items override existing (in case of updates)
      itemMap.set(item.id, item);
    }

    return sortItems(Array.from(itemMap.values()), sortKey, sortOrder);
  }
}
