import { describe, expect, test } from 'bun:test';
import { createContextCodec } from '@inkibra/router/lib/context-codec';
import { defineContextSchema } from '@inkibra/router/lib/context-schema';
import type { EventStreamChannelFactory } from '@inkibra/router/lib/event-stream-channel';
import { Ok } from '@inkibra/router/lib/result';
import { stub } from '@inkibra/test-support/stub';
import type { DurableConstructRuntime } from '../runtime';
import {
  createConstructBackend,
  createConstructBackendStreamHandlers,
  createConstructBackendStreamRoutes,
  defineConstructImpulses,
} from './index';

const authCodec = createContextCodec({
  name: 'auth',
  scope: 'session',
  schema: defineContextSchema({
    dataValidator: (input: unknown) => ({
      success: true as const,
      data: input as { id: string } | null,
    }),
  }),
  defaultValue: null,
});

describe('createConstructBackendStreamHandlers', () => {
  test('authenticates, resolves construct id, and yields stream events', async () => {
    const runtime = {
      submit: async () => ({ accepted: true as const, ref: undefined }),
      waitForRef: async () => {},
      enterEditMode: async () => ({
        contextFiles: [],
        activeContextFilePath: undefined,
      }),
      exitEditMode: async () => {},
      readContextFile: async () => '',
      writeContextFile: async () => {},
      deleteContextFile: async () => {},
      listContextFiles: async () => ({
        contextFiles: [],
        activeContextFilePath: undefined,
      }),
    } satisfies Pick<
      DurableConstructRuntime,
      | 'submit'
      | 'waitForRef'
      | 'enterEditMode'
      | 'exitEditMode'
      | 'readContextFile'
      | 'writeContextFile'
      | 'deleteContextFile'
      | 'listContextFiles'
    >;

    const backend = createConstructBackend({
      runtime,
      auth: {
        codec: authCodec,
        require: (ctx: unknown) => {
          const auth = (
            ctx as {
              auth: { type: 'Ok' | 'Err'; value: { id: string } | null };
            }
          ).auth;
          if (auth.type === 'Ok' && auth.value) {
            return {
              ok: true as const,
              auth: auth.value,
              subjectId: auth.value.id,
            };
          }
          return { ok: false as const, response: { type: 'Unauthenticated' } };
        },
      },
      impulses: defineConstructImpulses({}),
      getConstructId: ({ pathParams }) => pathParams.constructId ?? 'c1',
    });

    const routes = createConstructBackendStreamRoutes({
      authCodec,
      basePath: '/constructs',
    });

    const handlers = createConstructBackendStreamHandlers({
      backend,
      routes,
      streamRuntimeEvents: async function* ({ constructId, cursor }) {
        yield {
          event: 'streamCursor',
          data: {
            cursor: cursor ?? 'c0',
            phase: 'live',
            source: 'redis',
          },
        };
        yield {
          event: 'thinkingDelta',
          data: {
            constructId,
            delta: 'hello',
            ts: '2026-03-17T00:00:00.000Z',
          },
        };
        return Ok({ reason: 'disconnected' as const });
      },
    });

    const generator = handlers.streamConstructRuntimeEvents.execute(
      {
        pathParams: { constructId: 'c1' },
        pathQuery: { cursor: 'start' },
      },
      { auth: { id: 'u1' } },
      stub<EventStreamChannelFactory>(),
    );

    const first = await generator.next();
    expect(first.done).toBe(false);
    if (!first.done) {
      expect(first.value.event).toBe('streamCursor');
    }

    const second = await generator.next();
    expect(second.done).toBe(false);
    if (!second.done) {
      expect(second.value.event).toBe('thinkingDelta');
    }

    const completion = await generator.next();
    expect(completion.done).toBe(true);
    if (completion.done) {
      expect(completion.value.type).toBe('Ok');
    }
  });
});
