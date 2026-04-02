/**
 * Runtime Tests for @inkibra/query-cache
 *
 * Tests:
 * 1. Query DSL - Filter parsing/serialization
 * 2. Query DSL - Filter matching
 * 3. Query DSL - URL parameter conversion
 * 4. QueryCache - Entity storage and retrieval
 * 5. QueryCache - Optimistic overlays
 * 6. QueryCache - DSL queries with filtering
 * 7. QueryCache - Subscriptions
 */

import { beforeEach, describe, expect, test } from 'bun:test';
// QueryCache
import { QueryCache } from './index';
// Query DSL
import {
  type FilterExpression,
  fromURLSearchParams,
  matchesFilter,
  matchesFilters,
  parseFilter,
  parseQueryParams,
  type QueryParams,
  serializeFilter,
  serializeQueryParams,
  toURLSearchParams,
} from './query-dsl';

// ============================================================================
// Query DSL - Filter Parsing Tests
// ============================================================================

describe('Query DSL - Filter Parsing', () => {
  describe('parseFilter', () => {
    test('parses eq filter', () => {
      const result = parseFilter('eq:active');
      expect(result).toEqual({ op: 'eq', value: 'active' });
    });

    test('parses eq with number', () => {
      const result = parseFilter('eq:42');
      expect(result).toEqual({ op: 'eq', value: 42 });
    });

    test('parses eq with boolean true', () => {
      const result = parseFilter('eq:true');
      expect(result).toEqual({ op: 'eq', value: true });
    });

    test('parses eq with boolean false', () => {
      const result = parseFilter('eq:false');
      expect(result).toEqual({ op: 'eq', value: false });
    });

    test('defaults to eq when no operator', () => {
      const result = parseFilter('somevalue');
      expect(result).toEqual({ op: 'eq', value: 'somevalue' });
    });

    test('parses notEq filter', () => {
      const result = parseFilter('notEq:inactive');
      expect(result).toEqual({ op: 'notEq', value: 'inactive' });
    });

    test('parses gt filter', () => {
      const result = parseFilter('gt:100');
      expect(result).toEqual({ op: 'gt', value: 100 });
    });

    test('parses lt filter', () => {
      const result = parseFilter('lt:50');
      expect(result).toEqual({ op: 'lt', value: 50 });
    });

    test('parses gte filter', () => {
      const result = parseFilter('gte:10');
      expect(result).toEqual({ op: 'gte', value: 10 });
    });

    test('parses lte filter', () => {
      const result = parseFilter('lte:20');
      expect(result).toEqual({ op: 'lte', value: 20 });
    });

    test('parses between filter', () => {
      const result = parseFilter('between:10:100');
      expect(result).toEqual({ op: 'between', min: 10, max: 100 });
    });

    test('parses in filter', () => {
      const result = parseFilter('in:a,b,c');
      expect(result).toEqual({ op: 'in', values: ['a', 'b', 'c'] });
    });

    test('parses in filter with numbers', () => {
      const result = parseFilter('in:1,2,3');
      expect(result).toEqual({ op: 'in', values: [1, 2, 3] });
    });

    test('parses notIn filter', () => {
      const result = parseFilter('notIn:x,y,z');
      expect(result).toEqual({ op: 'notIn', values: ['x', 'y', 'z'] });
    });

    test('parses anyIn filter', () => {
      const result = parseFilter('anyIn:tag1,tag2');
      expect(result).toEqual({ op: 'anyIn', values: ['tag1', 'tag2'] });
    });

    test('parses everyIn filter', () => {
      const result = parseFilter('everyIn:a,b');
      expect(result).toEqual({ op: 'everyIn', values: ['a', 'b'] });
    });

    test('parses likeAnd filter', () => {
      const result = parseFilter('likeAnd:hello,world');
      expect(result).toEqual({ op: 'likeAnd', terms: ['hello', 'world'] });
    });

    test('parses likeOr filter', () => {
      const result = parseFilter('likeOr:foo,bar');
      expect(result).toEqual({ op: 'likeOr', terms: ['foo', 'bar'] });
    });

    test('throws on invalid between filter', () => {
      expect(() => parseFilter('between:10')).toThrow();
    });

    test('throws on unknown operator', () => {
      expect(() => parseFilter('unknown:value')).toThrow();
    });
  });

  describe('serializeFilter', () => {
    test('serializes eq filter', () => {
      const result = serializeFilter({ op: 'eq', value: 'active' });
      expect(result).toBe('eq:active');
    });

    test('serializes notEq filter', () => {
      const result = serializeFilter({ op: 'notEq', value: 'inactive' });
      expect(result).toBe('notEq:inactive');
    });

    test('serializes comparison filters', () => {
      expect(serializeFilter({ op: 'gt', value: 100 })).toBe('gt:100');
      expect(serializeFilter({ op: 'lt', value: 50 })).toBe('lt:50');
      expect(serializeFilter({ op: 'gte', value: 10 })).toBe('gte:10');
      expect(serializeFilter({ op: 'lte', value: 20 })).toBe('lte:20');
    });

    test('serializes between filter', () => {
      const result = serializeFilter({ op: 'between', min: 10, max: 100 });
      expect(result).toBe('between:10:100');
    });

    test('serializes list filters', () => {
      expect(serializeFilter({ op: 'in', values: ['a', 'b', 'c'] })).toBe(
        'in:a,b,c',
      );
      expect(serializeFilter({ op: 'notIn', values: [1, 2, 3] })).toBe(
        'notIn:1,2,3',
      );
      expect(serializeFilter({ op: 'anyIn', values: ['x', 'y'] })).toBe(
        'anyIn:x,y',
      );
      expect(serializeFilter({ op: 'everyIn', values: ['p', 'q'] })).toBe(
        'everyIn:p,q',
      );
    });

    test('serializes like filters', () => {
      expect(
        serializeFilter({ op: 'likeAnd', terms: ['hello', 'world'] }),
      ).toBe('likeAnd:hello,world');
      expect(serializeFilter({ op: 'likeOr', terms: ['foo', 'bar'] })).toBe(
        'likeOr:foo,bar',
      );
    });

    test('round-trips all filter types', () => {
      const filters: FilterExpression[] = [
        { op: 'eq', value: 'test' },
        { op: 'notEq', value: 123 },
        { op: 'gt', value: 50 },
        { op: 'lt', value: 100 },
        { op: 'gte', value: 0 },
        { op: 'lte', value: 999 },
        { op: 'between', min: 10, max: 20 },
        { op: 'in', values: ['a', 'b'] },
        { op: 'notIn', values: [1, 2] },
        { op: 'anyIn', values: ['x'] },
        { op: 'everyIn', values: ['y', 'z'] },
        { op: 'likeAnd', terms: ['hello'] },
        { op: 'likeOr', terms: ['world'] },
      ];

      for (const filter of filters) {
        const serialized = serializeFilter(filter);
        const parsed = parseFilter(serialized);
        expect(parsed).toEqual(filter);
      }
    });
  });
});

// ============================================================================
// Query DSL - Filter Matching Tests
// ============================================================================

describe('Query DSL - Filter Matching', () => {
  describe('matchesFilter', () => {
    test('eq matches exact value', () => {
      expect(matchesFilter('active', { op: 'eq', value: 'active' })).toBe(true);
      expect(matchesFilter('inactive', { op: 'eq', value: 'active' })).toBe(
        false,
      );
    });

    test('eq matches numbers', () => {
      expect(matchesFilter(42, { op: 'eq', value: 42 })).toBe(true);
      expect(matchesFilter(43, { op: 'eq', value: 42 })).toBe(false);
    });

    test('eq matches booleans', () => {
      expect(matchesFilter(true, { op: 'eq', value: true })).toBe(true);
      expect(matchesFilter(false, { op: 'eq', value: true })).toBe(false);
    });

    test('notEq matches non-equal values', () => {
      expect(matchesFilter('other', { op: 'notEq', value: 'active' })).toBe(
        true,
      );
      expect(matchesFilter('active', { op: 'notEq', value: 'active' })).toBe(
        false,
      );
    });

    test('gt matches greater values', () => {
      expect(matchesFilter(101, { op: 'gt', value: 100 })).toBe(true);
      expect(matchesFilter(100, { op: 'gt', value: 100 })).toBe(false);
      expect(matchesFilter(99, { op: 'gt', value: 100 })).toBe(false);
    });

    test('lt matches lesser values', () => {
      expect(matchesFilter(49, { op: 'lt', value: 50 })).toBe(true);
      expect(matchesFilter(50, { op: 'lt', value: 50 })).toBe(false);
      expect(matchesFilter(51, { op: 'lt', value: 50 })).toBe(false);
    });

    test('gte matches greater or equal values', () => {
      expect(matchesFilter(11, { op: 'gte', value: 10 })).toBe(true);
      expect(matchesFilter(10, { op: 'gte', value: 10 })).toBe(true);
      expect(matchesFilter(9, { op: 'gte', value: 10 })).toBe(false);
    });

    test('lte matches lesser or equal values', () => {
      expect(matchesFilter(19, { op: 'lte', value: 20 })).toBe(true);
      expect(matchesFilter(20, { op: 'lte', value: 20 })).toBe(true);
      expect(matchesFilter(21, { op: 'lte', value: 20 })).toBe(false);
    });

    test('between matches values in range', () => {
      expect(matchesFilter(50, { op: 'between', min: 10, max: 100 })).toBe(
        true,
      );
      expect(matchesFilter(10, { op: 'between', min: 10, max: 100 })).toBe(
        true,
      );
      expect(matchesFilter(100, { op: 'between', min: 10, max: 100 })).toBe(
        true,
      );
      expect(matchesFilter(9, { op: 'between', min: 10, max: 100 })).toBe(
        false,
      );
      expect(matchesFilter(101, { op: 'between', min: 10, max: 100 })).toBe(
        false,
      );
    });

    test('in matches values in list', () => {
      expect(matchesFilter('a', { op: 'in', values: ['a', 'b', 'c'] })).toBe(
        true,
      );
      expect(matchesFilter('d', { op: 'in', values: ['a', 'b', 'c'] })).toBe(
        false,
      );
    });

    test('notIn matches values not in list', () => {
      expect(matchesFilter('d', { op: 'notIn', values: ['a', 'b', 'c'] })).toBe(
        true,
      );
      expect(matchesFilter('a', { op: 'notIn', values: ['a', 'b', 'c'] })).toBe(
        false,
      );
    });

    test('anyIn matches arrays with any value', () => {
      expect(
        matchesFilter(['a', 'x'], { op: 'anyIn', values: ['a', 'b'] }),
      ).toBe(true);
      expect(
        matchesFilter(['x', 'y'], { op: 'anyIn', values: ['a', 'b'] }),
      ).toBe(false);
    });

    test('everyIn matches arrays with all values', () => {
      expect(
        matchesFilter(['a', 'b', 'c'], { op: 'everyIn', values: ['a', 'b'] }),
      ).toBe(true);
      expect(
        matchesFilter(['a', 'c'], { op: 'everyIn', values: ['a', 'b'] }),
      ).toBe(false);
    });

    test('likeAnd matches strings containing all terms', () => {
      expect(
        matchesFilter('Hello World', {
          op: 'likeAnd',
          terms: ['hello', 'world'],
        }),
      ).toBe(true);
      expect(
        matchesFilter('Hello There', {
          op: 'likeAnd',
          terms: ['hello', 'world'],
        }),
      ).toBe(false);
    });

    test('likeOr matches strings containing any term', () => {
      expect(
        matchesFilter('Hello There', {
          op: 'likeOr',
          terms: ['hello', 'world'],
        }),
      ).toBe(true);
      expect(
        matchesFilter('Goodbye', { op: 'likeOr', terms: ['hello', 'world'] }),
      ).toBe(false);
    });
  });

  describe('matchesFilters', () => {
    test('matches entity with all filters', () => {
      const entity = { status: 'active', count: 50, name: 'Test Item' };
      const filters = {
        status: { op: 'eq', value: 'active' } as FilterExpression,
        count: { op: 'gte', value: 10 } as FilterExpression,
      };

      expect(matchesFilters(entity, filters)).toBe(true);
    });

    test('fails if any filter fails', () => {
      const entity = { status: 'inactive', count: 50 };
      const filters = {
        status: { op: 'eq', value: 'active' } as FilterExpression,
        count: { op: 'gte', value: 10 } as FilterExpression,
      };

      expect(matchesFilters(entity, filters)).toBe(false);
    });

    test('passes with empty filters', () => {
      const entity = { anything: 'works' };
      expect(matchesFilters(entity, {})).toBe(true);
    });
  });
});

// ============================================================================
// Query DSL - URL Parameter Tests
// ============================================================================

describe('Query DSL - URL Parameters', () => {
  describe('toURLSearchParams and fromURLSearchParams', () => {
    test('converts simple query params', () => {
      const params: QueryParams = {
        sort: 'desc',
        sortKey: 'createdAt',
        limit: 20,
      };

      const urlParams = toURLSearchParams(params);
      expect(urlParams.get('sort')).toBe('desc');
      expect(urlParams.get('sortKey')).toBe('createdAt');
      expect(urlParams.get('limit')).toBe('20');
    });

    test('converts filters with filter. prefix', () => {
      const params: QueryParams = {
        filter: {
          status: { op: 'eq', value: 'active' },
          count: { op: 'gt', value: 10 },
        },
      };

      const urlParams = toURLSearchParams(params);
      expect(urlParams.get('filter.status')).toBe('eq:active');
      expect(urlParams.get('filter.count')).toBe('gt:10');
    });

    test('round-trips query params', () => {
      const original: QueryParams = {
        filter: {
          status: { op: 'eq', value: 'active' },
          priority: { op: 'in', values: ['high', 'medium'] },
        },
        sort: 'asc',
        sortKey: 'name',
        after: 'cursor123',
        limit: 50,
      };

      const urlParams = toURLSearchParams(original);
      const parsed = fromURLSearchParams(urlParams);

      expect(parsed).toEqual(original);
    });

    test('handles cursor params', () => {
      const params: QueryParams = {
        after: 'abc123',
        before: 'xyz789',
      };

      const urlParams = toURLSearchParams(params);
      const parsed = fromURLSearchParams(urlParams);

      expect(parsed.after).toBe('abc123');
      expect(parsed.before).toBe('xyz789');
    });
  });

  describe('parseQueryParams and serializeQueryParams', () => {
    test('parses serialized filters', () => {
      const serialized = {
        filter: {
          status: 'eq:active',
          count: 'between:10:100',
        },
        sort: 'desc' as const,
        limit: 25,
      };

      const parsed = parseQueryParams(serialized);

      expect(parsed.filter?.status).toEqual({ op: 'eq', value: 'active' });
      expect(parsed.filter?.count).toEqual({
        op: 'between',
        min: 10,
        max: 100,
      });
      expect(parsed.sort).toBe('desc');
      expect(parsed.limit).toBe(25);
    });

    test('round-trips query params', () => {
      const original: QueryParams = {
        filter: {
          tags: { op: 'anyIn', values: ['a', 'b'] },
        },
        sortKey: 'updatedAt',
      };

      const serialized = serializeQueryParams(original);
      const parsed = parseQueryParams(serialized);

      expect(parsed).toEqual(original);
    });
  });
});

// ============================================================================
// QueryCache - Entity Storage Tests
// ============================================================================

describe('QueryCache - Entity Storage', () => {
  let cache: QueryCache;

  beforeEach(() => {
    cache = new QueryCache();
  });

  describe('set and get', () => {
    test('stores and retrieves entity', () => {
      cache.set('user', '1', { name: 'Alice', age: 30 });

      const entry = cache.get<{ name: string; age: number }>('user', '1');
      expect(entry?.data).toEqual({ name: 'Alice', age: 30 });
      expect(entry?.status).toBe('ok');
      expect(entry?.type).toBe('user');
      expect(entry?.id).toBe('1');
    });

    test('returns undefined for non-existent entity', () => {
      const entry = cache.get('user', '999');
      expect(entry).toBeUndefined();
    });

    test('overwrites existing entity', () => {
      cache.set('user', '1', { name: 'Alice' });
      cache.set('user', '1', { name: 'Bob' });

      const entry = cache.get<{ name: string }>('user', '1');
      expect(entry?.data?.name).toBe('Bob');
    });
  });

  describe('setStatus', () => {
    test('sets not-found status', () => {
      cache.setStatus('user', '404', 'not-found');

      const entry = cache.get('user', '404');
      expect(entry?.status).toBe('not-found');
      expect(entry?.data).toBeNull();
    });

    test('sets deleted status', () => {
      cache.set('user', '1', { name: 'Alice' });
      cache.setStatus('user', '1', 'deleted');

      const entry = cache.get('user', '1');
      expect(entry?.status).toBe('deleted');
      expect(entry?.data).toBeNull();
    });

    test('preserves data with preserveData option', () => {
      cache.set('user', '1', { name: 'Alice' });
      cache.setStatus('user', '1', 'error', true);

      const entry = cache.get<{ name: string }>('user', '1');
      expect(entry?.status).toBe('error');
      expect(entry?.data?.name).toBe('Alice'); // Data preserved
    });
  });

  describe('delete', () => {
    test('removes entity', () => {
      cache.set('user', '1', { name: 'Alice' });
      const deleted = cache.delete('user', '1');

      expect(deleted).toBe(true);
      expect(cache.get('user', '1')).toBeUndefined();
    });

    test('returns false for non-existent entity', () => {
      const deleted = cache.delete('user', '999');
      expect(deleted).toBe(false);
    });
  });

  describe('isStale', () => {
    test('returns true for non-existent entity', () => {
      expect(cache.isStale('user', '999')).toBe(true);
    });

    test('respects stale time config', () => {
      const shortCache = new QueryCache({ defaultStaleTime: 1000 });
      shortCache.set('user', '1', { name: 'Alice' });

      // Immediately after setting, should not be stale
      expect(shortCache.isStale('user', '1')).toBe(false);
    });

    test('respects per-type stale time', () => {
      const mixedCache = new QueryCache({
        defaultStaleTime: 10000, // 10s default
        staleTimeByType: { user: 60000 }, // 60s for users
      });

      mixedCache.set('user', '1', { name: 'Alice' });
      mixedCache.set('post', '1', { title: 'Hello' });

      // Both should not be stale immediately (within their stale times)
      expect(mixedCache.isStale('user', '1')).toBe(false); // 60s stale time
      expect(mixedCache.isStale('post', '1')).toBe(false); // 10s stale time

      // Note: To test actual staleness, we'd need to mock Date.now()
      // or wait, which is impractical for unit tests
    });
  });
});

// ============================================================================
// QueryCache - Optimistic Overlay Tests
// ============================================================================

describe('QueryCache - Optimistic Overlays', () => {
  let cache: QueryCache;

  beforeEach(() => {
    cache = new QueryCache();
  });

  test('setOptimistic overlays committed data', () => {
    cache.set('user', '1', { name: 'Alice' });
    cache.setOptimistic('user', '1', { name: 'Alice Updated' }, 'global');

    const entry = cache.get<{ name: string }>('user', '1');
    expect(entry?.data?.name).toBe('Alice Updated');
  });

  test('removeOptimistic reveals committed data', () => {
    cache.set('user', '1', { name: 'Alice' });
    cache.setOptimistic('user', '1', { name: 'Optimistic' }, 'global');
    cache.removeOptimistic('user', '1', 'global');

    const entry = cache.get<{ name: string }>('user', '1');
    expect(entry?.data?.name).toBe('Alice');
  });

  test('commit applies data and clears overlay', () => {
    cache.set('user', '1', { name: 'Alice' });
    cache.setOptimistic('user', '1', { name: 'Pending' }, 'mutation-1');
    cache.commit('user', '1', { name: 'Confirmed' }, 'mutation-1');

    // Should now read committed data
    const entry = cache.get<{ name: string }>('user', '1');
    expect(entry?.data?.name).toBe('Confirmed');
  });

  test('scoped overlays are independent', () => {
    cache.set('user', '1', { name: 'Original' });
    cache.setOptimistic('user', '1', { name: 'Scope A' }, 'scope-a');
    cache.setOptimistic('user', '1', { name: 'Scope B' }, 'scope-b');

    // Reading with scope-a should get scope-a overlay
    const entryA = cache.get<{ name: string }>('user', '1', {
      scopes: ['scope-a'],
    });
    expect(entryA?.data?.name).toBe('Scope A');

    // Reading with scope-b should get scope-b overlay
    const entryB = cache.get<{ name: string }>('user', '1', {
      scopes: ['scope-b'],
    });
    expect(entryB?.data?.name).toBe('Scope B');

    // Reading with both scopes - later scope wins
    const entryBoth = cache.get<{ name: string }>('user', '1', {
      scopes: ['scope-a', 'scope-b'],
    });
    expect(entryBoth?.data?.name).toBe('Scope B');
  });

  test('clearScope removes all overlays in scope', () => {
    cache.setOptimistic('user', '1', { name: 'User 1' }, 'batch');
    cache.setOptimistic('user', '2', { name: 'User 2' }, 'batch');
    cache.clearScope('batch');

    // Both should be gone
    expect(cache.get('user', '1', { scopes: ['batch'] })).toBeUndefined();
    expect(cache.get('user', '2', { scopes: ['batch'] })).toBeUndefined();
  });
});

// ============================================================================
// QueryCache - DSL Query Tests
// ============================================================================

describe('QueryCache - DSL Queries', () => {
  let cache: QueryCache;

  beforeEach(() => {
    cache = new QueryCache();
    // Seed with test data
    cache.set('task', '1', { title: 'Task 1', status: 'active', priority: 1 });
    cache.set('task', '2', { title: 'Task 2', status: 'active', priority: 2 });
    cache.set('task', '3', {
      title: 'Task 3',
      status: 'completed',
      priority: 3,
    });
    cache.set('task', '4', { title: 'Task 4', status: 'active', priority: 1 });
  });

  test('query returns all entities of type', () => {
    const results = cache.query('task');
    expect(results.length).toBe(4);
  });

  test('query filters by DSL expression', () => {
    const results = cache.query<{ status: string }>('task', {
      filter: {
        status: { op: 'eq', value: 'active' },
      },
    });

    expect(results.length).toBe(3);
    expect(results.every((e) => e.data?.status === 'active')).toBe(true);
  });

  test('query with multiple filters (AND)', () => {
    const results = cache.query<{ status: string; priority: number }>('task', {
      filter: {
        status: { op: 'eq', value: 'active' },
        priority: { op: 'eq', value: 1 },
      },
    });

    expect(results.length).toBe(2);
  });

  test('query excludes non-ok status entries', () => {
    cache.setStatus('task', '1', 'deleted');

    const results = cache.query('task');
    expect(results.length).toBe(3);
    expect(results.find((e) => e.id === '1')).toBeUndefined();
  });

  test('query includes optimistic overlays', () => {
    cache.setOptimistic(
      'task',
      '5',
      { title: 'New Task', status: 'active', priority: 1 },
      'global',
    );

    const results = cache.query('task');
    expect(results.length).toBe(5);
    expect(results.find((e) => e.id === '5')).toBeDefined();
  });

  test('query respects scopes', () => {
    cache.setOptimistic(
      'task',
      '6',
      { title: 'Scoped Task', status: 'active' },
      'my-scope',
    );

    // Without scope - should not include scoped entity
    const withoutScope = cache.query('task');
    expect(withoutScope.find((e) => e.id === '6')).toBeUndefined();

    // With scope - should include
    const withScope = cache.query('task', undefined, {
      scopes: ['global', 'my-scope'],
    });
    expect(withScope.find((e) => e.id === '6')).toBeDefined();
  });
});

// ============================================================================
// QueryCache - Subscription Tests
// ============================================================================

describe('QueryCache - Subscriptions', () => {
  let cache: QueryCache;

  beforeEach(() => {
    cache = new QueryCache();
  });

  test('subscribe notifies on set', () => {
    let notified = false;
    // biome-ignore lint/suspicious/noExplicitAny: Test needs to capture callback data
    let receivedData: any = null;

    cache.subscribe<{ name: string }>('user', '1', (entry) => {
      notified = true;
      receivedData = entry.data;
    });

    cache.set('user', '1', { name: 'Alice' });

    expect(notified).toBe(true);
    expect(receivedData).toEqual({ name: 'Alice' });
  });

  test('subscribe notifies on status change', () => {
    let callCount = 0;

    cache.subscribe('user', '1', () => {
      callCount++;
    });

    cache.set('user', '1', { name: 'Alice' });
    cache.setStatus('user', '1', 'error');

    expect(callCount).toBe(2);
  });

  test('subscribe notifies on optimistic update', () => {
    let notified = false;

    cache.subscribe('user', '1', () => {
      notified = true;
    });

    cache.setOptimistic('user', '1', { name: 'Optimistic' });

    expect(notified).toBe(true);
  });

  test('unsubscribe stops notifications', () => {
    let callCount = 0;

    const unsubscribe = cache.subscribe('user', '1', () => {
      callCount++;
    });

    cache.set('user', '1', { name: 'First' });
    expect(callCount).toBe(1);

    unsubscribe();

    cache.set('user', '1', { name: 'Second' });
    expect(callCount).toBe(1); // Should not increase
  });

  test('subscribeToType notifies for all entities of type', () => {
    const notifications: string[] = [];

    cache.subscribeToType('user', (entry) => {
      notifications.push(entry.id);
    });

    cache.set('user', '1', { name: 'Alice' });
    cache.set('user', '2', { name: 'Bob' });
    cache.set('post', '1', { title: 'Hello' }); // Different type

    expect(notifications).toEqual(['1', '2']);
  });
});
