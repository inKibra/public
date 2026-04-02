import { describe, expect, test } from 'bun:test';
import { createContextCodec, defineContextSchema } from '@inkibra/router';
import {
  type JwtConfig,
  readContextFromRequest,
  writeContextToResponse,
} from './context-transport';
import { buildRequestContext } from './request-context';
import { createResponseContext } from './response-context';

type SessionData = { userId: string };
type SessionError = { type: 'InvalidSession' };

function success<T>(data: T) {
  return {
    success: true,
    data,
    errors: [],
  };
}

function failure<T>(input: unknown) {
  return {
    success: false,
    errors: [
      {
        path: '$input',
        expected: 'SessionData',
        value: input,
      },
    ],
    data: input as T,
  };
}

const sessionCodec = createContextCodec({
  name: 'session',
  scope: 'session',
  schema: defineContextSchema<SessionData, never, SessionError>({
    dataValidator: (input: unknown) => {
      if (
        input &&
        typeof input === 'object' &&
        'userId' in input &&
        typeof (input as { userId: unknown }).userId === 'string'
      ) {
        return success(input as SessionData);
      }

      return failure<SessionData>(input);
    },
  }),
  defaultValue: { userId: 'guest' },
});

const deviceCodec = createContextCodec({
  name: 'prefs',
  scope: 'device',
  schema: defineContextSchema<SessionData, never, SessionError>({
    dataValidator: (input: unknown) => {
      if (
        input &&
        typeof input === 'object' &&
        'userId' in input &&
        typeof (input as { userId: unknown }).userId === 'string'
      ) {
        return success(input as SessionData);
      }

      return failure<SessionData>(input);
    },
  }),
  defaultValue: { userId: 'guest-device' },
});

const signedSessionCodec = createContextCodec({
  name: 'auth',
  scope: 'session',
  secure: 'signed',
  schema: defineContextSchema<SessionData | null, never, SessionError>({
    dataValidator: (input: unknown) => {
      if (input === null) {
        return success<SessionData | null>(null);
      }

      if (
        input &&
        typeof input === 'object' &&
        'userId' in input &&
        typeof (input as { userId: unknown }).userId === 'string'
      ) {
        return success(input as SessionData);
      }

      return failure<SessionData | null>(input);
    },
  }),
  defaultValue: null as SessionData | null,
});

const jwtConfig: JwtConfig = {
  secret: 'test-secret',
  issuer: 'test-issuer',
  authenticatedValiditySeconds: 60,
  visitorValiditySeconds: 60,
};

describe('context-transport', () => {
  test('readContextFromRequest uses query before header and cookie', async () => {
    const url = new URL('http://localhost/profile');
    url.searchParams.set(
      'ctx-session-session',
      JSON.stringify({ userId: 'q' }),
    );

    const request = new Request(url, {
      method: 'GET',
      headers: {
        'X-Session-session': JSON.stringify({ userId: 'h' }),
        Cookie: `ctx-session-session=${encodeURIComponent(JSON.stringify({ userId: 'c' }))}`,
      },
    });

    const ctx = buildRequestContext(request);
    const read = await readContextFromRequest<SessionData>(ctx, sessionCodec);

    expect(read.success).toBe(true);
    if (read.success) {
      expect(read.source).toBe('query');
      expect(read.value).toEqual({ userId: 'q' });
    }
  });

  test('returns parse_error for invalid JSON payloads', async () => {
    const request = new Request('http://localhost/profile', {
      method: 'GET',
      headers: {
        'X-Session-session': 'not-json',
      },
    });

    const ctx = buildRequestContext(request);
    const read = await readContextFromRequest<SessionData>(ctx, sessionCodec);

    expect(read.success).toBe(false);
    if (!read.success) {
      expect(read.error).toBe('parse_error');
    }
  });

  test('returns validation_error for JSON payloads that fail schema validation', async () => {
    const url = new URL('http://localhost/profile');
    url.searchParams.set('ctx-session-session', JSON.stringify({ bad: true }));

    const ctx = buildRequestContext(new Request(url));
    const read = await readContextFromRequest<SessionData>(ctx, sessionCodec);

    expect(read.success).toBe(false);
    if (!read.success) {
      expect(read.error).toBe('validation_error');
    }
  });

  test('writeContextToResponse writes session values to header and session cookie', async () => {
    const responseContext = createResponseContext();
    await writeContextToResponse(responseContext, sessionCodec, {
      userId: 'alice',
    });

    const response = responseContext.toResponse(null);
    const setCookie = response.headers.get('set-cookie');

    expect(response.headers.get('x-session-session')).toBe(
      JSON.stringify({ userId: 'alice' }),
    );
    expect(setCookie).toContain('ctx-session-session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).not.toContain('Max-Age=31536000');
  });

  test('writeContextToResponse writes device values to persistent cookie', async () => {
    const responseContext = createResponseContext();
    await writeContextToResponse(responseContext, deviceCodec, {
      userId: 'mobile',
    });

    const response = responseContext.toResponse(null);
    const setCookie = response.headers.get('set-cookie');

    expect(response.headers.get('x-device-prefs')).toBe(
      JSON.stringify({ userId: 'mobile' }),
    );
    expect(setCookie).toContain('ctx-device-prefs=');
    expect(setCookie).toContain('Max-Age=31536000');
    expect(setCookie).not.toContain('HttpOnly');
  });

  test('writeContextToResponse writes signed auth cookie with Secure for SameSite=None', async () => {
    const responseContext = createResponseContext();
    await writeContextToResponse(
      responseContext,
      signedSessionCodec,
      { userId: 'alice' },
      jwtConfig,
    );

    const response = responseContext.toResponse(null);
    const setCookie = response.headers.get('set-cookie');

    expect(response.headers.get('authorization')).toBeTruthy();
    expect(setCookie).toContain('Authorization=');
    expect(setCookie).toContain('SameSite=None');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('HttpOnly');
  });
});
