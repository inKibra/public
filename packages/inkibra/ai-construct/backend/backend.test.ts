import { describe, expect, test } from 'bun:test';
import type { ConstructStudioContextFile } from '../lab/types';
import type { ConstructOp, DurableConstructRuntime } from '../runtime';
import {
  createConstructBackend,
  defineConstructImpulses,
  defineImpulse,
} from './index';
import { coachNudgePayloadSchema } from './test-impulses.schemas';

function createMockRuntime() {
  const submitted: ConstructOp[] = [];
  const waits: Array<{ constructId: string; ref: string | undefined }> = [];
  const reads: string[] = [];
  const writes: Array<{ path: string; content: string }> = [];
  const deletes: string[] = [];
  const editEntries: string[] = [];
  const editExits: string[] = [];

  const runtime = {
    submit: async (_constructId: string, op: ConstructOp) => {
      submitted.push(op);
      return { accepted: true as const, ref: 'cursor-1' };
    },
    waitForRef: async (constructId: string, ref: string | undefined) => {
      waits.push({ constructId, ref });
    },
    enterEditMode: async (constructId: string) => {
      editEntries.push(constructId);
      return {
        contextFiles: [
          {
            path: '/agent/home/persona.md',
            title: 'persona',
            content: 'hello',
            sizeBytes: 5,
            modifiedAt: '2026-03-16T00:00:00.000Z',
            frontmatter: {},
          },
        ],
        activeContextFilePath: '/agent/home/persona.md',
      };
    },
    exitEditMode: async (constructId: string) => {
      editExits.push(constructId);
    },
    readContextFile: async (_constructId: string, path: string) => {
      reads.push(path);
      return 'file-content';
    },
    writeContextFile: async (
      _constructId: string,
      path: string,
      content: string,
    ) => {
      writes.push({ path, content });
    },
    deleteContextFile: async (_constructId: string, path: string) => {
      deletes.push(path);
    },
    listContextFiles: async (_constructId: string) => ({
      contextFiles: [] as ConstructStudioContextFile[],
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

  return {
    runtime,
    submitted,
    waits,
    reads,
    writes,
    deletes,
    editEntries,
    editExits,
  };
}

describe('defineImpulsePayload', () => {
  test('validates object payloads', () => {
    const schema = coachNudgePayloadSchema;

    const success = schema.validate({ source: 'crm', note: 'hello' });
    expect(success.success).toBe(true);

    const failure = schema.validate({ source: 'crm', note: 42 });
    expect(failure.success).toBe(false);
    expect(schema.jsonSchema).toBeTruthy();
  });
});

describe('createConstructBackend', () => {
  test('submits built-in userChat as user_message op', async () => {
    const mock = createMockRuntime();
    const backend = createConstructBackend({
      runtime: mock.runtime,
      auth: {
        codec: null,
        require: () => ({
          ok: true as const,
          auth: { id: 'u1' },
          subjectId: 'u1',
        }),
      },
      impulses: defineConstructImpulses({}),
      getConstructId: () => 'c1',
    });

    await backend.submit({
      constructId: 'c1',
      impulse: 'userChat',
      payload: { content: 'hello' },
    });

    expect(mock.submitted[0]?.kind).toBe('user_message');
  });

  test('submits built-in heartbeat as system_event op', async () => {
    const mock = createMockRuntime();
    const backend = createConstructBackend({
      runtime: mock.runtime,
      auth: {
        codec: null,
        require: () => ({
          ok: true as const,
          auth: { id: 'u1' },
          subjectId: 'u1',
        }),
      },
      impulses: defineConstructImpulses({}),
      getConstructId: () => 'c1',
    });

    await backend.submit({
      constructId: 'c1',
      impulse: 'heartbeat',
      payload: { payload: { reason: 'test' } },
    });

    expect(mock.submitted[0]?.kind).toBe('system_event');
    if (mock.submitted[0]?.kind === 'system_event') {
      expect(mock.submitted[0].payload.event).toBe('heartbeat');
    }
  });

  test('submits built-in reminder as self_reminder op', async () => {
    const mock = createMockRuntime();
    const backend = createConstructBackend({
      runtime: mock.runtime,
      auth: {
        codec: null,
        require: () => ({
          ok: true as const,
          auth: { id: 'u1' },
          subjectId: 'u1',
        }),
      },
      impulses: defineConstructImpulses({}),
      getConstructId: () => 'c1',
    });

    await backend.submit({
      constructId: 'c1',
      impulse: 'reminder',
      payload: { reminderId: 'r1', message: 'remember this' },
    });

    expect(mock.submitted[0]?.kind).toBe('self_reminder');
  });

  test('submits custom system event impulse with validated payload', async () => {
    const mock = createMockRuntime();
    const impulses = defineConstructImpulses({
      custom: {
        coachNudge: defineImpulse({
          payload: coachNudgePayloadSchema,
        }),
      },
    });

    const backend = createConstructBackend({
      runtime: mock.runtime,
      auth: {
        codec: null,
        require: () => ({
          ok: true as const,
          auth: { id: 'u1' },
          subjectId: 'u1',
        }),
      },
      impulses,
      getConstructId: () => 'c1',
    });

    await backend.submit({
      constructId: 'c1',
      impulse: 'coachNudge',
      payload: { source: 'admin', note: 'check in' },
      waitFor: 'committed',
    });

    expect(mock.submitted[0]?.kind).toBe('system_event');
    expect(mock.waits).toHaveLength(1);
    if (mock.submitted[0]?.kind === 'system_event') {
      expect(mock.submitted[0].payload.event).toBe('coachNudge');
    }
  });

  test('submits custom explicit impulse with profile routing', async () => {
    const mock = createMockRuntime();
    const impulses = defineConstructImpulses({
      custom: {
        coachNudge: defineImpulse({
          payload: coachNudgePayloadSchema,
          route: {
            kind: 'explicitImpulse',
            profile: 'custom.coach_nudge',
            pool: 'background',
          },
        }),
      },
    });

    const backend = createConstructBackend({
      runtime: mock.runtime,
      auth: {
        codec: null,
        require: () => ({
          ok: true as const,
          auth: { id: 'u1' },
          subjectId: 'u1',
        }),
      },
      impulses,
      getConstructId: () => 'c1',
    });

    await backend.submit({
      constructId: 'c1',
      impulse: 'coachNudge',
      payload: { source: 'crm', note: 'background check-in' },
    });

    expect(mock.submitted[0]?.kind).toBe('impulse');
    if (mock.submitted[0]?.kind === 'impulse') {
      expect(mock.submitted[0].payload.profile).toBe('custom.coach_nudge');
      expect(mock.submitted[0].payload.pool).toBe('background');
    }
  });

  test('file facade normalizes paths and delegates to runtime', async () => {
    const mock = createMockRuntime();
    const backend = createConstructBackend({
      runtime: mock.runtime,
      auth: {
        codec: null,
        require: () => ({
          ok: true as const,
          auth: { id: 'u1' },
          subjectId: 'u1',
        }),
      },
      impulses: defineConstructImpulses({}),
      getConstructId: () => 'c1',
    });

    const read = await backend.files.read({
      constructId: 'c1',
      path: 'core/persona.md',
    });
    await backend.files.write({
      constructId: 'c1',
      path: 'core/persona.md',
      content: 'updated',
    });
    await backend.files.delete({ constructId: 'c1', path: 'core/persona.md' });
    await backend.editMode.enter({ constructId: 'c1' });
    await backend.editMode.exit({ constructId: 'c1' });

    expect(read.path).toBe('/agent/home/core/persona.md');
    expect(mock.reads[0]).toBe('/agent/home/core/persona.md');
    expect(mock.writes[0]?.path).toBe('/agent/home/core/persona.md');
    expect(mock.deletes[0]).toBe('/agent/home/core/persona.md');
    expect(mock.editEntries).toEqual(['c1']);
    expect(mock.editExits).toEqual(['c1']);
  });
});
