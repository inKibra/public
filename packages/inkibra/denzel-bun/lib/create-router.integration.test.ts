import { describe, expect, test } from 'bun:test';
import { createApiRouteHandler, SerializableResult } from '@inkibra/router';
import { echoRoute } from './__tests__/fixtures/router-integration.schemas';
import { createBackend } from './create-backend';
import { createRouter } from './create-router';

describe('createRouter integration', () => {
  test('returns backend response when a backend route matches', async () => {
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
      },
    });

    const router = createRouter({ backends: [backend] });
    const request = new Request('http://localhost/api/echo/abc?q=router', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'from-router' }),
    });

    const response = await router.fetch(request);
    const payload = (await response.json()) as {
      type: string;
      value?: { echo: string; id: string; q?: string };
    };

    expect(response.status).toBe(200);
    expect(payload.type).toBe('Ok');
    expect(payload.value).toEqual({
      echo: 'from-router',
      id: 'abc',
      q: 'router',
    });
  });

  test('uses custom notFoundHandler when no route matches', async () => {
    const router = createRouter({
      backends: [],
      notFoundHandler: () =>
        new Response(JSON.stringify({ error: 'custom-not-found' }), {
          status: 418,
          headers: { 'Content-Type': 'application/json' },
        }),
    });

    const response = await router.fetch(
      new Request('http://localhost/nope', { method: 'GET' }),
    );
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(418);
    expect(payload.error).toBe('custom-not-found');
  });

  test('routes to matching frontend by domain and mount path', async () => {
    const router = createRouter({
      frontends: [
        {
          name: 'WebFrontend',
          mountPath: '/app',
          allowedDomains: ['example.com'],
          domainAssets: undefined,
          contextCodecs: undefined,
          render: async () =>
            new Response('frontend-response', {
              status: 200,
              headers: { 'Content-Type': 'text/plain' },
            }),
        },
      ],
      notFoundHandler: () => new Response('missing', { status: 404 }),
    });

    const response = await router.fetch(
      new Request('http://example.com/app/dashboard', { method: 'GET' }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('frontend-response');
  });
});
