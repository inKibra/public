import { describe, expect, test } from 'bun:test';
import {
  buildRequestContext,
  getCookie,
  getHeader,
  getPathParam,
  getQueryParam,
  getQueryParams,
} from './request-context';

describe('request-context', () => {
  test('buildRequestContext parses cookies, path params, and query params', () => {
    const request = new Request(
      'http://localhost/api/items/42?sort=asc&limit=10',
      {
        method: 'GET',
        headers: {
          Cookie: 'token=abc%20123; theme=dark',
          'X-Trace-ID': 'trace-1',
        },
      },
    );

    const ctx = buildRequestContext(request, { itemId: '42' });

    expect(getCookie(ctx, 'token')).toBe('abc 123');
    expect(getCookie(ctx, 'theme')).toBe('dark');
    expect(getPathParam(ctx, 'itemId')).toBe('42');
    expect(getQueryParam(ctx, 'sort')).toBe('asc');
    expect(getQueryParam(ctx, 'limit')).toBe('10');
    expect(getHeader(ctx, 'x-trace-id')).toBe('trace-1');
    expect(getQueryParams(ctx)).toEqual({ sort: 'asc', limit: '10' });
  });

  test('handles missing cookie header', () => {
    const request = new Request('http://localhost/health', { method: 'GET' });
    const ctx = buildRequestContext(request);

    expect(getCookie(ctx, 'session')).toBeUndefined();
    expect(getQueryParams(ctx)).toEqual({});
  });
});
