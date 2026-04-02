import { describe, expect, test } from 'bun:test';
import {
  createAiFlowScenario,
  createAiFlowTestDeps,
  textPrimitive,
} from '@inkibra/ai-flow/testing';
import { createTestDriver } from '@inkibra/dal-connection/create-driver';
import initLogger from '@inkibra/logger';
import { DEFAULT_IMPULSE_PROFILES } from '../impulse/keys';
import { createLocalConstructRuntime } from '../runtime/runtime';
import { createDalStorage } from './storage';
import type { ConstructEvent } from './types';
import { DEFAULT_CONSTRUCT_LANES } from './types';

async function waitForConstructEvent(
  events: ConstructEvent[],
  predicate: (e: ConstructEvent) => boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (events.find(predicate)) return;
    await new Promise<void>((r) => setTimeout(r, 5));
  }
  throw new Error(`waitForConstructEvent: timed out after ${timeoutMs}ms`);
}

function createNapCommitCompleteToolCall(summary = 'nap commit complete') {
  return {
    kind: 'tool_call' as const,
    name: 'complete_nap_commit',
    arguments: { summary },
  };
}

function previewExecToolCall(code: string) {
  return {
    kind: 'tool_call' as const,
    name: 'preview_exec',
    arguments: { input: code },
  };
}

function createPerLaneCommitScenario(finalCommitText: string) {
  return createAiFlowScenario({
    stream: [
      { primitives: [textPrimitive('Conversation analysis draft.')] },
      { primitives: [textPrimitive('Heartbeat analysis draft.')] },
      { primitives: [textPrimitive('Conversation proposal draft.')] },
      { primitives: [textPrimitive('Heartbeat proposal draft.')] },
      { primitives: [createNapCommitCompleteToolCall()] },
      { primitives: [textPrimitive(finalCommitText)] },
    ],
    strict: true,
  });
}

describe('construct nap/hypno — AI mock', () => {
  test('run_nap auto flow drives per-lane drafts then explicit commit completion', async () => {
    const driver = await createTestDriver();
    const logger = initLogger('construct-nap-per-lane');
    const constructId = 'nap-test-per-lane-1';

    const { deps, inspector } = createAiFlowTestDeps({
      logger,
      scenario: createPerLaneCommitScenario(
        'Nap log: committed after explicit completion.',
      ),
    });

    try {
      const runtime = createLocalConstructRuntime({
        logger,
        createConfig: async (id) => ({
          id,
          storage: createDalStorage({ driver, logger }),
          deps,
          impulseProfiles: DEFAULT_IMPULSE_PROFILES,
          stageConfig: {
            'nap/commit': { tools: { bash: false } },
          },
          computerConfig: {},
          lanes: DEFAULT_CONSTRUCT_LANES,
        }),
      });

      await runtime.submit(constructId, {
        opId: 'op-nap-1',
        kind: 'run_nap',
        payload: {},
        createdAt: new Date().toISOString(),
      });

      expect(inspector.streamCallCount()).toBe(6);
      inspector.assertConsumed();

      const construct = await runtime.runtimeManager.getOrCreate(constructId);
      construct.stop();
    } finally {
      await driver.disconnect();
    }
  }, 15_000);

  test('run_nap emits hypno lifecycle events for analyze propose commit stages', async () => {
    const driver = await createTestDriver();
    const logger = initLogger('construct-nap-stage-events');
    const constructId = 'nap-stage-events-1';

    const { deps, inspector } = createAiFlowTestDeps({
      logger,
      scenario: createPerLaneCommitScenario('Nap log: nothing to change.'),
    });

    try {
      const runtime = createLocalConstructRuntime({
        logger,
        createConfig: async (id) => ({
          id,
          storage: createDalStorage({ driver, logger }),
          deps,
          impulseProfiles: DEFAULT_IMPULSE_PROFILES,
          stageConfig: {
            'nap/commit': { tools: { bash: false } },
          },
          computerConfig: {},
          lanes: DEFAULT_CONSTRUCT_LANES,
        }),
      });

      const construct = await runtime.runtimeManager.getOrCreate(constructId);
      const events: ConstructEvent[] = [];
      construct.onEvent((event) => events.push(event));

      await runtime.submit(constructId, {
        opId: 'op-nap-events-1',
        kind: 'run_nap',
        payload: {},
        createdAt: new Date().toISOString(),
      });

      expect(events.map((event) => event.type)).toContain('hypno:started');
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'hypno:stage-change',
          stage: 'analyze',
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'hypno:stage-change',
          stage: 'propose',
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'hypno:stage-change',
          stage: 'commit',
        }),
      );
      expect(events.map((event) => event.type)).toContain('hypno:completed');
      expect(inspector.streamCallCount()).toBe(6);
      inspector.assertConsumed();

      construct.stop();
    } finally {
      await driver.disconnect();
    }
  }, 15_000);

  test('startHypno + 2× acceptHypno completes full hypno lifecycle with per-lane drafts', async () => {
    const driver = await createTestDriver();
    const logger = initLogger('construct-hypno-full-lifecycle');
    const constructId = 'hypno-test-full-lifecycle-1';

    const { deps, inspector } = createAiFlowTestDeps({
      logger,
      scenario: createPerLaneCommitScenario('Nap log: committed after review.'),
    });

    try {
      const runtime = createLocalConstructRuntime({
        logger,
        createConfig: async (id) => ({
          id,
          storage: createDalStorage({ driver, logger }),
          deps,
          impulseProfiles: DEFAULT_IMPULSE_PROFILES,
          stageConfig: {
            'nap/commit': { tools: { bash: false } },
          },
          computerConfig: {},
          lanes: DEFAULT_CONSTRUCT_LANES,
        }),
      });

      const construct = await runtime.runtimeManager.getOrCreate(constructId);
      const events: ConstructEvent[] = [];
      construct.onEvent((event) => events.push(event));

      await runtime.submit(constructId, {
        opId: 'op-start-hypno-1',
        kind: 'start_hypno',
        payload: {},
        createdAt: new Date().toISOString(),
      });

      await waitForConstructEvent(
        events,
        (e) => e.type === 'hypno:draft-ready' && e.stage === 'analyze',
      );

      await runtime.submit(constructId, {
        opId: 'op-accept-hypno-1',
        kind: 'accept_hypno',
        payload: {},
        createdAt: new Date().toISOString(),
      });

      await waitForConstructEvent(
        events,
        (e) => e.type === 'hypno:draft-ready' && e.stage === 'propose',
      );

      await runtime.submit(constructId, {
        opId: 'op-accept-hypno-2',
        kind: 'accept_hypno',
        payload: {},
        createdAt: new Date().toISOString(),
      });

      await waitForConstructEvent(events, (e) => e.type === 'hypno:completed');

      expect(construct.isHypnoActive()).toBe(false);
      expect(construct.getHypnoStage()).toBeNull();
      expect(inspector.streamCallCount()).toBe(6);
      inspector.assertConsumed();

      construct.stop();
    } finally {
      await driver.disconnect();
    }
  }, 15_000);

  test('early accept before draft-ready is latched and advances once analyze merge is ready', async () => {
    const driver = await createTestDriver();
    const logger = initLogger('construct-hypno-latched-accept');
    const constructId = 'hypno-test-latched-accept-1';

    const { deps, inspector } = createAiFlowTestDeps({
      logger,
      scenario: createPerLaneCommitScenario(
        'Nap log: committed after latched accept.',
      ),
    });

    try {
      const runtime = createLocalConstructRuntime({
        logger,
        createConfig: async (id) => ({
          id,
          storage: createDalStorage({ driver, logger }),
          deps,
          impulseProfiles: DEFAULT_IMPULSE_PROFILES,
          stageConfig: {
            'nap/commit': { tools: { bash: false } },
          },
          computerConfig: {},
          lanes: DEFAULT_CONSTRUCT_LANES,
        }),
      });

      const construct = await runtime.runtimeManager.getOrCreate(constructId);
      const events: ConstructEvent[] = [];
      construct.onEvent((event) => events.push(event));

      await runtime.submit(constructId, {
        opId: 'op-start-hypno-latched-1',
        kind: 'start_hypno',
        payload: {},
        createdAt: new Date().toISOString(),
      });

      await runtime.submit(constructId, {
        opId: 'op-accept-hypno-latched-1',
        kind: 'accept_hypno',
        payload: {},
        createdAt: new Date().toISOString(),
      });

      await waitForConstructEvent(
        events,
        (e) => e.type === 'hypno:draft-ready' && e.stage === 'propose',
      );

      await runtime.submit(constructId, {
        opId: 'op-accept-hypno-latched-2',
        kind: 'accept_hypno',
        payload: {},
        createdAt: new Date().toISOString(),
      });

      await waitForConstructEvent(events, (e) => e.type === 'hypno:completed');

      expect(construct.isHypnoActive()).toBe(false);
      expect(inspector.streamCallCount()).toBe(6);
      inspector.assertConsumed();

      construct.stop();
    } finally {
      await driver.disconnect();
    }
  }, 15_000);

  test('startHypno + cancelHypno transitions session to cancelled after merged analyze draft', async () => {
    const driver = await createTestDriver();
    const logger = initLogger('construct-hypno-cancel');
    const constructId = 'hypno-test-cancel-1';

    const { deps, inspector } = createAiFlowTestDeps({
      logger,
      scenario: createAiFlowScenario({
        stream: [
          { primitives: [textPrimitive('Conversation analysis draft.')] },
          { primitives: [textPrimitive('Heartbeat analysis draft.')] },
        ],
        strict: true,
      }),
    });

    try {
      const runtime = createLocalConstructRuntime({
        logger,
        createConfig: async (id) => ({
          id,
          storage: createDalStorage({ driver, logger }),
          deps,
          impulseProfiles: DEFAULT_IMPULSE_PROFILES,
          stageConfig: {
            'nap/commit': { tools: { bash: false } },
          },
          computerConfig: {},
          lanes: DEFAULT_CONSTRUCT_LANES,
        }),
      });

      const construct = await runtime.runtimeManager.getOrCreate(constructId);
      const events: ConstructEvent[] = [];
      construct.onEvent((event) => events.push(event));

      await runtime.submit(constructId, {
        opId: 'op-start-hypno-cancel-1',
        kind: 'start_hypno',
        payload: {},
        createdAt: new Date().toISOString(),
      });

      await waitForConstructEvent(
        events,
        (e) => e.type === 'hypno:draft-ready' && e.stage === 'analyze',
      );

      await runtime.submit(constructId, {
        opId: 'op-cancel-hypno-1',
        kind: 'cancel_hypno',
        payload: {},
        createdAt: new Date().toISOString(),
      });

      await waitForConstructEvent(events, (e) => e.type === 'hypno:cancelled');

      expect(construct.isHypnoActive()).toBe(false);
      expect(inspector.streamCallCount()).toBe(2);
      inspector.assertConsumed();

      construct.stop();
    } finally {
      await driver.disconnect();
    }
  }, 15_000);

  test('chatHypnoReview during analyze returns reply and preserves review transcript', async () => {
    const driver = await createTestDriver();
    const logger = initLogger('construct-hypno-chat-review');
    const constructId = 'hypno-test-chat-review-1';

    const { deps, inspector } = createAiFlowTestDeps({
      logger,
      scenario: createAiFlowScenario({
        stream: [
          { primitives: [textPrimitive('Conversation analysis draft.')] },
          { primitives: [textPrimitive('Heartbeat analysis draft.')] },
          {
            primitives: [
              textPrimitive(
                'Good question! The merged analysis looks solid.\n\n## Update Plan\n\n(no changes yet)',
              ),
            ],
          },
          { primitives: [textPrimitive('Conversation proposal draft.')] },
          { primitives: [textPrimitive('Heartbeat proposal draft.')] },
          { primitives: [createNapCommitCompleteToolCall()] },
          { primitives: [textPrimitive('Nap log: done after review chat.')] },
        ],
        strict: true,
      }),
    });

    try {
      const runtime = createLocalConstructRuntime({
        logger,
        createConfig: async (id) => ({
          id,
          storage: createDalStorage({ driver, logger }),
          deps,
          impulseProfiles: DEFAULT_IMPULSE_PROFILES,
          stageConfig: {
            'nap/commit': { tools: { bash: false } },
          },
          computerConfig: {},
          lanes: DEFAULT_CONSTRUCT_LANES,
        }),
      });

      const construct = await runtime.runtimeManager.getOrCreate(constructId);
      const events: ConstructEvent[] = [];
      construct.onEvent((event) => events.push(event));

      await runtime.submit(constructId, {
        opId: 'op-start-hypno-chat-1',
        kind: 'start_hypno',
        payload: {},
        createdAt: new Date().toISOString(),
      });

      await waitForConstructEvent(
        events,
        (e) => e.type === 'hypno:draft-ready' && e.stage === 'analyze',
      );

      await runtime.submit(constructId, {
        opId: 'op-chat-hypno-review-1',
        kind: 'chat_hypno_review',
        payload: { text: 'Does this merged analysis look correct?' },
        createdAt: new Date().toISOString(),
      });

      const reviewReplyEvent = events.find(
        (event) => event.type === 'hypno:review-reply',
      );
      expect(reviewReplyEvent).toBeDefined();
      if (reviewReplyEvent && reviewReplyEvent.type === 'hypno:review-reply') {
        expect(reviewReplyEvent.reply.length).toBeGreaterThan(0);
        expect(reviewReplyEvent.stage).toBe('analyze');
      }

      const reviewState = construct.getHypnoReviewState();
      expect(reviewState).not.toBeNull();
      expect(reviewState?.chatTranscript.length).toBe(2);
      expect(reviewState?.chatTranscript[0]?.role).toBe('human');
      expect(reviewState?.chatTranscript[1]?.role).toBe('assistant');

      await runtime.submit(constructId, {
        opId: 'op-accept-hypno-chat-1',
        kind: 'accept_hypno',
        payload: {},
        createdAt: new Date().toISOString(),
      });

      await waitForConstructEvent(
        events,
        (e) => e.type === 'hypno:draft-ready' && e.stage === 'propose',
      );

      await runtime.submit(constructId, {
        opId: 'op-accept-hypno-chat-2',
        kind: 'accept_hypno',
        payload: {},
        createdAt: new Date().toISOString(),
      });

      await waitForConstructEvent(events, (e) => e.type === 'hypno:completed');

      expect(inspector.streamCallCount()).toBe(7);
      inspector.assertConsumed();

      construct.stop();
    } finally {
      await driver.disconnect();
    }
  }, 15_000);

  test('commit stage honors maxToolCalls fuse and completes after explicit completion', async () => {
    const driver = await createTestDriver();
    const logger = initLogger('construct-nap-max-tool-calls');
    const constructId = 'nap-test-max-tool-calls-1';

    const { deps, inspector } = createAiFlowTestDeps({
      logger,
      scenario: createAiFlowScenario({
        stream: [
          { primitives: [textPrimitive('Conversation analysis draft.')] },
          { primitives: [textPrimitive('Heartbeat analysis draft.')] },
          { primitives: [textPrimitive('Conversation proposal draft.')] },
          { primitives: [textPrimitive('Heartbeat proposal draft.')] },
          {
            primitives: [
              previewExecToolCall("await command('list', '/agent/home');"),
            ],
          },
          {
            primitives: [
              previewExecToolCall("await command('list', '/logs');"),
            ],
          },
          { primitives: [createNapCommitCompleteToolCall('tools complete')] },
          {
            primitives: [
              textPrimitive('Nap log: reviewed context, no writes needed.'),
            ],
          },
        ],
        strict: true,
      }),
    });

    try {
      const runtime = createLocalConstructRuntime({
        logger,
        createConfig: async (id) => ({
          id,
          storage: createDalStorage({ driver, logger }),
          deps,
          impulseProfiles: DEFAULT_IMPULSE_PROFILES,
          stageConfig: {
            'nap/commit': { tools: { maxToolCalls: 2 } },
          },
          computerConfig: {},
          lanes: DEFAULT_CONSTRUCT_LANES,
        }),
      });

      const construct = await runtime.runtimeManager.getOrCreate(constructId);
      const events: ConstructEvent[] = [];
      construct.onEvent((event) => events.push(event));

      await runtime.submit(constructId, {
        opId: 'op-nap-max-tool-calls',
        kind: 'run_nap',
        payload: {},
        createdAt: new Date().toISOString(),
      });

      await waitForConstructEvent(
        events,
        (event) => event.type === 'nap:completed',
      );
      expect(events.some((event) => event.type === 'nap:error')).toBe(false);
      expect(inspector.streamCallCount()).toBe(8);
      inspector.assertConsumed();

      construct.stop();
    } finally {
      await driver.disconnect();
    }
  }, 20_000);
});
