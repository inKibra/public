import { describe, expect, test } from 'bun:test';
import {
  createApiRouteHandler,
  type Result,
  SerializableResult,
} from '@inkibra/router';
import {
  crashRoute,
  echoRoute,
  loginRoute,
  profileRoute,
} from './__tests__/fixtures/router-integration.schemas';
import { createBackend } from './create-backend';
import { getRequestTransactionCycle } from './request-transaction';

const backend = createBackend({
  logLevel: 'fatal',
  apiHandlers: {
    echo: createApiRouteHandler({
      route: echoRoute,
      handler: async (args) =>
        SerializableResult.toOk(
          {
            echo: args.body.message,
            id: args.pathParams.id,
            q: args.pathQuery.q,
          },
          200,
        ),
    }),
    login: createApiRouteHandler({
      route: loginRoute,
      handler: async (args) => ({
        result: SerializableResult.toOk({ ok: true as const }, 201),
        context: {
          session: {
            userId: args.body.userId,
          },
        },
      }),
    }),
    profile: createApiRouteHandler({
      route: profileRoute,
      handler: async (_args, ctx) =>
        SerializableResult.toOk(
          {
            userId:
              ctx.session.type === 'Ok'
                ? (ctx.session.value?.userId ?? null)
                : null,
          },
          200,
        ),
    }),
    crash: createApiRouteHandler({
      route: crashRoute,
      handler: async () => {
        throw new Error('boom');
      },
    }),
  },
});

describe('createBackend integration', () => {
  test('handles API route requests and preserves SerializableResult status', async () => {
    const request = new Request('http://localhost/api/echo/abc123?q=hello', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    });

    const response = await backend.fetch(request);
    const payload = (await response.json()) as Result<
      { echo: string; id: string; q?: string },
      { type: 'EchoError' }
    > & { statusCode: number };

    expect(response.status).toBe(200);
    expect(payload.type).toBe('Ok');
    if (payload.type === 'Ok') {
      expect(payload.value).toEqual({
        echo: 'hi',
        id: 'abc123',
        q: 'hello',
      });
    }
  });

  test('returns 400 when JSON body parsing fails', async () => {
    const request = new Request('http://localhost/api/echo/abc123', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"message":',
    });

    const response = await backend.fetch(request);
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Failed to parse JSON body');
  });

  test('returns 500 when a handler throws', async () => {
    const request = new Request('http://localhost/api/crash', {
      method: 'GET',
    });

    const response = await backend.fetch(request);
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(500);
    expect(payload.error).toBe('Internal server error');
  });

  test('prefers query context over header and cookie', async () => {
    const url = new URL('http://localhost/api/profile');
    url.searchParams.set(
      'ctx-session-session',
      JSON.stringify({ userId: 'query-user' }),
    );

    const request = new Request(url, {
      method: 'GET',
      headers: {
        'X-Session-session': JSON.stringify({ userId: 'header-user' }),
        Cookie: `ctx-session-session=${encodeURIComponent(JSON.stringify({ userId: 'cookie-user' }))}`,
      },
    });

    const response = await backend.fetch(request);
    const payload = (await response.json()) as Result<
      { userId: string | null },
      { type: 'AuthError' }
    >;

    expect(response.status).toBe(200);
    expect(payload.type).toBe('Ok');
    if (payload.type === 'Ok') {
      expect(payload.value.userId).toBe('query-user');
    }
  });

  test('falls back to default context on parse errors', async () => {
    const request = new Request('http://localhost/api/profile', {
      method: 'GET',
      headers: {
        'X-Session-session': 'not-json',
      },
    });

    const response = await backend.fetch(request);
    const payload = (await response.json()) as Result<
      { userId: string | null },
      { type: 'AuthError' }
    >;

    expect(response.status).toBe(200);
    expect(payload.type).toBe('Ok');
    if (payload.type === 'Ok') {
      expect(payload.value.userId).toBe(null);
    }
  });

  test('writes created context values to response headers and cookies', async () => {
    const request = new Request('http://localhost/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'alice' }),
    });

    const response = await backend.fetch(request);

    expect(response.status).toBe(201);
    expect(response.headers.get('X-Session-session')).toBe(
      JSON.stringify({ userId: 'alice' }),
    );

    const setCookie = response.headers.get('set-cookie');
    expect(setCookie).toContain('ctx-session-session=');
    expect(setCookie).toContain('HttpOnly');
  });
});

// ============================================================================
// Transaction lifecycle tests
// ============================================================================

describe('transaction lifecycle', () => {
  test('commits transaction on successful handler execution', async () => {
    let committed = false;
    let rolledBack = false;

    const txRuntime = {
      async begin() {
        return {
          driver: { test: true },
          effects: {
            async call() {},
            getPreviews() {
              return [];
            },
          },
          async commit() {
            committed = true;
          },
          async rollback() {
            rolledBack = true;
          },
        };
      },
    };

    const txBackend = createBackend({
      logLevel: 'fatal',
      transactionRuntime: txRuntime,
      apiHandlers: {
        echo: createApiRouteHandler({
          route: echoRoute,
          handler: async (args) => {
            // Verify tx cycle is accessible via AsyncLocalStorage
            const txCycle = getRequestTransactionCycle();
            expect(txCycle).toBeDefined();
            expect(txCycle!.driver).toEqual({ test: true });

            return SerializableResult.toOk(
              {
                echo: args.body.message,
                id: args.pathParams.id,
                q: args.pathQuery.q,
              },
              200,
            );
          },
        }),
      },
    });

    const request = new Request('http://localhost/api/echo/abc123', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    });

    const response = await txBackend.fetch(request);
    expect(response.status).toBe(200);
    expect(committed).toBe(true);
    expect(rolledBack).toBe(false);
  });

  test('rolls back transaction when handler throws', async () => {
    let committed = false;
    let rolledBack = false;

    const txRuntime = {
      async begin() {
        return {
          driver: {},
          effects: {
            async call() {},
            getPreviews() {
              return [];
            },
          },
          async commit() {
            committed = true;
          },
          async rollback() {
            rolledBack = true;
          },
        };
      },
    };

    const txBackend = createBackend({
      logLevel: 'fatal',
      transactionRuntime: txRuntime,
      apiHandlers: {
        crash: createApiRouteHandler({
          route: crashRoute,
          handler: async () => {
            throw new Error('boom');
          },
        }),
      },
    });

    const request = new Request('http://localhost/api/crash', {
      method: 'GET',
    });

    const response = await txBackend.fetch(request);
    expect(response.status).toBe(500);
    expect(committed).toBe(false);
    expect(rolledBack).toBe(true);
  });

  test('flushes staged effects after commit', async () => {
    const flushedEffects: Array<{ kind: string; payload: unknown }> = [];

    const txRuntime = {
      async begin() {
        const staged: Array<{
          kind: string;
          payload: unknown;
          preview?: string;
        }> = [];
        return {
          driver: {},
          effects: {
            async call(intent: {
              kind: string;
              payload: unknown;
              preview?: string;
            }) {
              staged.push(intent);
            },
            getPreviews() {
              return [];
            },
          },
          async commit() {
            // Flush on commit (simulates real behavior)
            for (const intent of staged) {
              flushedEffects.push({
                kind: intent.kind,
                payload: intent.payload,
              });
            }
          },
          async rollback() {},
        };
      },
    };

    const txBackend = createBackend({
      logLevel: 'fatal',
      transactionRuntime: txRuntime,
      apiHandlers: {
        echo: createApiRouteHandler({
          route: echoRoute,
          handler: async (args) => {
            // Stage an effect via the tx cycle
            const txCycle = getRequestTransactionCycle();
            await txCycle!.effects.call({
              kind: 'workflow.start',
              payload: { workflowId: 'charge-card' },
              preview: 'Start charge-card workflow',
            });

            return SerializableResult.toOk(
              {
                echo: args.body.message,
                id: args.pathParams.id,
                q: args.pathQuery.q,
              },
              200,
            );
          },
        }),
      },
    });

    const request = new Request('http://localhost/api/echo/abc123', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    });

    const response = await txBackend.fetch(request);
    expect(response.status).toBe(200);
    expect(flushedEffects).toEqual([
      { kind: 'workflow.start', payload: { workflowId: 'charge-card' } },
    ]);
  });

  test('works without transactionRuntime (no-op)', async () => {
    // Existing backend without tx should work as before
    const request = new Request('http://localhost/api/echo/abc123', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    });

    const response = await backend.fetch(request);
    expect(response.status).toBe(200);
  });
});
