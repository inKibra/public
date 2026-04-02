/**
 * Runtime Tests for @inkibra/router
 *
 * Tests core functionality:
 * 1. Result type utilities (Ok, Err, match, map, etc.)
 * 2. Route matching (matchAppRoute)
 * 3. Location sources (createSegmentSource, createVirtualSource)
 * 4. Query parameter parsing
 */

import { describe, expect, test } from 'bun:test';
// Query parsing
import { parseNamespacedQuery, serializeNamespacedQuery } from './app-routes';
// Location sources
import {
  buildCheckpointUrl,
  createSegmentSource,
  createVirtualSource,
} from './location-source';
// Result utilities
import {
  andThen,
  Err,
  isErr,
  isOk,
  map,
  mapErr,
  match,
  Ok,
  unwrap,
  unwrapErr,
  unwrapOr,
} from './result';
// Route matching
import { matchAppRoute } from './route-matcher';

// ============================================================================
// Result Type Tests
// ============================================================================

describe('Result utilities', () => {
  describe('Ok and Err constructors', () => {
    test('Ok creates success result with value', () => {
      const result = Ok(42);
      expect(result.type).toBe('Ok');
      expect(result.value).toBe(42);
      expect(result.isOk).toBe(true);
      expect(result.isErr).toBe(false);
    });

    test('Ok works with complex objects', () => {
      const data = { users: [{ id: 1, name: 'Alice' }] };
      const result = Ok(data);
      expect(result.value).toEqual(data);
    });

    test('Err creates error result', () => {
      const result = Err('Something went wrong');
      expect(result.type).toBe('Err');
      expect(result.error).toBe('Something went wrong');
      expect(result.isOk).toBe(false);
      expect(result.isErr).toBe(true);
    });

    test('Err works with error objects', () => {
      const error = { code: 'NOT_FOUND', message: 'Resource not found' };
      const result = Err(error);
      expect(result.error).toEqual(error);
    });
  });

  describe('Type guards (isOk, isErr)', () => {
    test('isOk returns true for Ok results', () => {
      expect(isOk(Ok('success'))).toBe(true);
      expect(isOk(Err('error'))).toBe(false);
    });

    test('isErr returns true for Err results', () => {
      expect(isErr(Err('error'))).toBe(true);
      expect(isErr(Ok('success'))).toBe(false);
    });
  });

  describe('match function', () => {
    test('calls ok handler for Ok result', () => {
      const result = Ok(10);
      const output = match(result, {
        ok: (v) => v * 2,
        err: () => 0,
      });
      expect(output).toBe(20);
    });

    test('calls err handler for Err result', () => {
      const result = Err('failed');
      const output = match(result, {
        ok: () => 'success',
        err: (e) => `Error: ${e}`,
      });
      expect(output).toBe('Error: failed');
    });

    test('match transforms types correctly', () => {
      const okResult = Ok({ count: 5 });
      const errResult = Err({ code: 404 });

      const okString = match(okResult, {
        ok: (v) => `Count is ${v.count}`,
        err: (e: { code: number }) => `Error ${e.code}`,
      });
      expect(okString).toBe('Count is 5');

      const errString = match(errResult, {
        ok: (v: { count: number }) => `Count is ${v.count}`,
        err: (e) => `Error ${e.code}`,
      });
      expect(errString).toBe('Error 404');
    });
  });

  describe('map function', () => {
    test('transforms Ok value', () => {
      const result = map(Ok(5), (n) => n * 2);
      expect(isOk(result) && result.value).toBe(10);
    });

    test('passes through Err unchanged', () => {
      const result = map(Err('error'), (n: number) => n * 2);
      expect(isErr(result) && result.error).toBe('error');
    });
  });

  describe('mapErr function', () => {
    test('transforms Err error', () => {
      const result = mapErr(Err('not found'), (e) => ({ message: e }));
      expect(isErr(result) && result.error).toEqual({ message: 'not found' });
    });

    test('passes through Ok unchanged', () => {
      const result = mapErr(Ok(42), (e: string) => ({ message: e }));
      expect(isOk(result) && result.value).toBe(42);
    });
  });

  describe('andThen (flatMap)', () => {
    test('chains Ok results', () => {
      const divide = (a: number, b: number) =>
        b === 0 ? Err('division by zero') : Ok(a / b);

      const result = andThen(Ok(10), (n) => divide(n, 2));
      expect(isOk(result) && result.value).toBe(5);
    });

    test('short-circuits on Err', () => {
      const result = andThen(Err('initial error'), () => Ok(42));
      expect(isErr(result) && result.error).toBe('initial error');
    });

    test('propagates error from chain', () => {
      const result = andThen(Ok(10), () => Err('chain error'));
      expect(isErr(result) && result.error).toBe('chain error');
    });
  });

  describe('unwrap functions', () => {
    test('unwrap returns value for Ok', () => {
      expect(unwrap(Ok('hello'))).toBe('hello');
    });

    test('unwrap throws for Err', () => {
      expect(() => unwrap(Err('error'))).toThrow();
    });

    test('unwrapOr returns value for Ok', () => {
      expect(unwrapOr(Ok(42), 0)).toBe(42);
    });

    test('unwrapOr returns default for Err', () => {
      expect(unwrapOr(Err('error'), 0)).toBe(0);
    });

    test('unwrapErr returns error for Err', () => {
      expect(unwrapErr(Err('the error'))).toBe('the error');
    });

    test('unwrapErr throws for Ok', () => {
      expect(() => unwrapErr(Ok('value'))).toThrow();
    });
  });
});

// ============================================================================
// Location Source Tests
// ============================================================================

describe('Location sources', () => {
  describe('createSegmentSource', () => {
    test('parses URL path correctly', () => {
      const source = createSegmentSource('https://example.com/boards/123');
      expect(source.getPath()).toBe('/boards/123');
    });

    test('handles root path', () => {
      const source = createSegmentSource('https://example.com/');
      expect(source.getPath()).toBe('/');
    });

    test('handles path without trailing slash', () => {
      const source = createSegmentSource('https://example.com/users');
      expect(source.getPath()).toBe('/users');
    });

    test('parses query params via getQuery', () => {
      const source = createSegmentSource(
        'https://example.com/search?q=test&page=1',
      );
      const query = source.getQuery();
      expect(query.q).toBe('test');
      expect(query.page).toBe('1');
    });
  });

  describe('createVirtualSource', () => {
    // Virtual source requires two params: initial URL and key for the query param
    test('creates source from query param', () => {
      // Initial URL with ?panel=/virtual/path means the virtual source starts at /virtual/path
      const source = createVirtualSource('?panel=/virtual/path', 'panel');
      expect(source.getPath()).toBe('/virtual/path');
    });

    test('defaults to root when key not in query', () => {
      const source = createVirtualSource('', 'panel');
      expect(source.getPath()).toBe('/');
    });

    test('navigate updates path', () => {
      const source = createVirtualSource('', 'panel');
      source.navigate('/updated');
      expect(source.getPath()).toBe('/updated');
    });

    test('subscribe notifies on navigation', () => {
      const source = createVirtualSource('', 'panel');
      let notified = false;

      source.subscribe(() => {
        notified = true;
      });

      source.navigate('/end');
      expect(notified).toBe(true);
    });

    test('unsubscribe stops notifications', () => {
      const source = createVirtualSource('', 'panel');
      let callCount = 0;

      const unsubscribe = source.subscribe(() => {
        callCount++;
      });

      source.navigate('/path1');
      expect(callCount).toBe(1);

      unsubscribe();
      source.navigate('/path2');
      expect(callCount).toBe(1); // Should not increase
    });

    test('getCheckpointState returns key and path', () => {
      const source = createVirtualSource('?panel=/test', 'panel');
      const state = source.getCheckpointState();
      expect(state.key).toBe('panel');
      expect(state.path).toBe('/test');
    });
  });

  describe('buildCheckpointUrl', () => {
    // buildCheckpointUrl expects Array<{ key, path }> for virtual states
    test('builds checkpoint URL with virtual states', () => {
      const url = buildCheckpointUrl('/boards', [
        { key: 'panel', path: '/tasks' },
      ]);
      expect(url).toContain('/boards');
      expect(url).toContain('panel=%2Ftasks'); // URL-encoded /tasks
    });

    test('handles empty virtual states', () => {
      const url = buildCheckpointUrl('/simple', []);
      expect(url).toBe('/simple');
    });

    test('handles multiple virtual states', () => {
      const url = buildCheckpointUrl('/app', [
        { key: 'panel', path: '/tasks' },
        { key: 'modal', path: '/edit' },
      ]);
      expect(url).toContain('panel=');
      expect(url).toContain('modal=');
    });
  });
});

// ============================================================================
// Query Parameter Tests
// ============================================================================

describe('Namespaced query parsing', () => {
  describe('parseNamespacedQuery', () => {
    // Note: parseNamespacedQuery tries to JSON.parse values, so numbers become numbers
    test('parses outlet-prefixed query params with JSON parsing', () => {
      // Values are JSON-stringified in serialize, so simulate that format
      const params = new URLSearchParams(
        'main.filter="active"&main.page=2', // 2 is valid JSON (number)
      );
      const result = parseNamespacedQuery(params);

      expect(result.main).toEqual({ filter: 'active', page: 2 });
    });

    test('handles multiple outlets', () => {
      const params = new URLSearchParams(
        'main.tab="users"&sidebar.open=true', // true is valid JSON (boolean)
      );
      const result = parseNamespacedQuery(params);

      expect(result.main).toEqual({ tab: 'users' });
      expect(result.sidebar).toEqual({ open: true });
    });

    test('returns empty object for no namespaced params', () => {
      const params = new URLSearchParams('plain=value');
      const result = parseNamespacedQuery(params);

      // Non-namespaced params are ignored
      expect(result.main).toBeUndefined();
    });

    test('falls back to raw string when JSON parse fails', () => {
      const params = new URLSearchParams('main.search=hello world'); // not valid JSON
      const result = parseNamespacedQuery(params);

      expect(result.main).toEqual({ search: 'hello world' });
    });
  });

  describe('serializeNamespacedQuery', () => {
    // Note: serializeNamespacedQuery JSON.stringifies all values
    test('serializes outlet query to JSON-encoded URL params', () => {
      const query = {
        main: { filter: 'active', page: 1 },
      };
      const result = serializeNamespacedQuery(query);

      // Values are JSON stringified
      expect(result.get('main.filter')).toBe('"active"');
      expect(result.get('main.page')).toBe('1');
    });

    test('handles multiple outlets', () => {
      const query = {
        main: { tab: 'users' },
        detail: { id: 123 },
      };
      const result = serializeNamespacedQuery(query);

      expect(result.get('main.tab')).toBe('"users"');
      expect(result.get('detail.id')).toBe('123');
    });

    test('round-trips correctly', () => {
      const original = {
        main: { filter: 'active', sort: 'date', page: 1 },
        sidebar: { collapsed: false },
      };

      const serialized = serializeNamespacedQuery(original);
      const parsed = parseNamespacedQuery(serialized);

      expect(parsed).toEqual(original);
    });

    test('handles complex values', () => {
      const query = {
        filters: { tags: ['a', 'b'], config: { nested: true } },
      };

      const serialized = serializeNamespacedQuery(query);
      const parsed = parseNamespacedQuery(serialized);

      expect(parsed).toEqual(query);
    });
  });
});

// ============================================================================
// Route Matching Tests (requires route tree setup)
// ============================================================================

describe('Route matching (matchAppRoute)', () => {
  // Note: Full route matching tests would require setting up a complete
  // route tree with createAppRouteTree. These are placeholder tests
  // demonstrating the test structure.

  test('matchAppRoute is a function', () => {
    expect(typeof matchAppRoute).toBe('function');
  });

  // Integration tests with real route trees would go here
  // Example structure:
  //
  // test('matches root path', () => {
  //   const routes = createAppRouteTree({}).page({ component: RootPage });
  //   const result = matchAppRoute(routes, new URL('https://example.com/'));
  //   expect(result.root).not.toBeNull();
  // });
  //
  // test('matches segment with params', () => {
  //   const routes = createAppRouteTree({})
  //     .outlets((o) => ({
  //       main: o.outlet('main').segments((s) => ({
  //         ':id': s.leaf(':id').page({ component: DetailPage }),
  //       })),
  //     }));
  //   const result = matchAppRoute(routes, new URL('https://example.com/123'));
  //   expect(result.outlets.main?.params.id).toBe('123');
  // });
});
