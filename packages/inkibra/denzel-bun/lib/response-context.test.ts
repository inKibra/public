import { describe, expect, test } from 'bun:test';
import { createResponseContext } from './response-context';

describe('response-context', () => {
  test('builds JSON response with headers and cookies', async () => {
    const ctx = createResponseContext();
    ctx.setHeader('X-Test', 'yes');
    ctx.setCookie('session', 'abc123', { path: '/', httpOnly: true });

    const response = ctx.toJsonResponse({ ok: true }, { status: 201 });
    const body = (await response.json()) as { ok: boolean };

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('x-test')).toBe('yes');

    const setCookie = response.headers.get('set-cookie');
    expect(setCookie).toContain('session=abc123');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('HttpOnly');
  });

  test('serializes deleted cookies in Set-Cookie header', () => {
    const ctx = createResponseContext();
    ctx.deleteCookie('session', { path: '/' });

    const response = ctx.toResponse(null);
    const setCookie = response.headers.get('set-cookie');

    expect(setCookie).toContain('session=');
    expect(setCookie).toContain('Max-Age=0');
    expect(setCookie).toContain('Path=/');
  });
});
