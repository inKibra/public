import { describe, expect, test } from 'bun:test';
import { createContextCodec } from '@inkibra/router/lib/context-codec';
import { defineContextSchema } from '@inkibra/router/lib/context-schema';
import type { ConstructOp, DurableConstructRuntime } from '../runtime';
import {
  createConstructBackend,
  createConstructBackendApiHandlers,
  createConstructBackendRoutes,
  defineConstructImpulses,
} from './index';

function createMockRuntime() {
  const submitted: ConstructOp[] = [];

  const runtime = {
    submit: async (_constructId: string, op: ConstructOp) => {
      submitted.push(op);
      return { accepted: true as const, ref: 'cursor-1' };
    },
    waitForRef: async () => {},
    enterEditMode: async () => ({
      contextFiles: [],
      activeContextFilePath: undefined,
    }),
    exitEditMode: async () => {},
    readContextFile: async (_constructId: string, _path: string) =>
      'file-content',
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

  return { runtime, submitted };
}

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

describe('createConstructBackendApiHandlers', () => {
  test('creates working lab snapshot and action handlers', async () => {
    const mock = createMockRuntime();
    const backend = createConstructBackend({
      runtime: mock.runtime,
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
          return {
            ok: false as const,
            response: {
              type: 'Err' as const,
              error: { type: 'Unauthenticated' as const },
              statusCode: 401 as const,
            },
          };
        },
      },
      impulses: defineConstructImpulses({}),
      getConstructId: ({ pathParams }) => pathParams.constructId ?? 'c1',
    });

    const routes = createConstructBackendRoutes({
      authCodec,
      basePath: '/constructs',
    });
    const handlers = createConstructBackendApiHandlers({
      backend,
      routes,
      loadLabSnapshot: async () => ({
        transcript: [],
        toolLog: [],
        decisionLog: [],
        runtimeState: {
          activeImpulses: 0,
          activeResponses: 0,
          scheduledResponses: 0,
          schedulerBusy: false,
        },
        queuedNextNapPins: [],
        queuedNextNapImprints: [],
        hypno: {
          active: false,
          stage: 'idle',
          pendingPlan: false,
          acceptRequiresConfirmation: false,
          updatedAt: '2026-03-16T00:00:00.000Z',
        },
      }),
      loadRuntimeSnapshot: async () => ({
        constructState: {
          id: 'c1',
          storage: 'memory',
          isRunning: true,
          activeImpulses: 0,
          queuedPerceptions: 0,
          scheduledResponses: 0,
        },
        sourceFacts: [],
        impulses: [],
        decisions: [],
        toolLog: [],
        scheduledResponses: [],
        residency: { awake: true, status: 'idle' },
        vfs: { nodes: [] },
        runtimeState: {
          activeImpulses: 0,
          activeResponses: 0,
          scheduledResponses: 0,
          schedulerBusy: false,
        },
      }),
    });

    const snapshotResult = await handlers.getConstructLabSnapshot.execute(
      {
        pathParams: { constructId: 'c1' },
        pathQuery: {},
        body: {},
        files: undefined,
      },
      { auth: { id: 'u1' } },
    );
    expect(snapshotResult.type).toBe('Ok');

    const actionResult = await handlers.applyConstructLabAction.execute(
      {
        pathParams: { constructId: 'c1' },
        pathQuery: {},
        body: { action: 'chat', message: 'hello', lane: 'conversation' },
        files: undefined,
      },
      { auth: { id: 'u1' } },
    );
    expect(actionResult.type).toBe('Ok');
    if (actionResult.type === 'Ok') {
      expect(actionResult.statusCode).toBe(202);
    }
    expect(mock.submitted[0]?.kind).toBe('user_message');

    const fileResult = await handlers.readConstructFile.execute(
      {
        pathParams: { constructId: 'c1' },
        pathQuery: {},
        body: { path: 'core/persona.md' },
        files: undefined,
      },
      { auth: { id: 'u1' } },
    );
    expect(fileResult.type).toBe('Ok');
    if (fileResult.type === 'Ok') {
      expect(fileResult.value.content).toBe('file-content');
      expect(fileResult.value.path).toBe('/agent/home/core/persona.md');
    }
  });
});
