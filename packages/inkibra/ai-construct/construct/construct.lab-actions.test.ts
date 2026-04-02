import { describe, expect, test } from 'bun:test';
import {
  createAiFlowScenario,
  createAiFlowTestDeps,
  jsonPrimitive,
} from '@inkibra/ai-flow/testing';
import { createTestDriver } from '@inkibra/dal-connection/create-driver';
import initLogger from '@inkibra/logger';
import { stub } from '@inkibra/test-support/stub';
import type OpenAI from 'openai';
import {
  CORE_IMPULSE_PROFILE_NAME,
  DEFAULT_IMPULSE_PROFILES,
} from '../impulse/keys';
import { defineImpulseProfiles } from '../impulse/types';
import { createLocalConstructRuntime } from '../runtime/runtime';
import { parseFeedbackLog } from '../vfs/feedback';
import { getLatestLogPath } from '../vfs/logs';
import {
  loadPendingNextNapImprints,
  loadPendingNextNapPins,
} from '../vfs/nap-instructions';
import { readDerivedTranscriptEntries } from '../vfs/transcript';
import { createDalStorage } from './storage';
import type { ConstructEvent } from './types';
import { DEFAULT_CONSTRUCT_LANES } from './types';

// ---------------------------------------------------------------------------
// No-AI group — direct construct method calls via ingress, no OpenAI calls
// ---------------------------------------------------------------------------

describe('construct lab actions — no AI', () => {
  test('queueNextNapPin enqueues entry readable via VFS', async () => {
    const driver = await createTestDriver();
    const logger = initLogger('construct-lab-queue-pin');
    const constructId = 'lab-test-pin-1';

    try {
      const runtime = createLocalConstructRuntime({
        logger,
        createConfig: async (id) => ({
          id,
          storage: createDalStorage({ driver, logger }),
          deps: { openAI: stub<OpenAI>(), logger },
          impulseProfiles: DEFAULT_IMPULSE_PROFILES,
          computerConfig: {},
          lanes: DEFAULT_CONSTRUCT_LANES,
        }),
      });

      await runtime.submit(constructId, {
        opId: 'op-open-1',
        kind: 'next_nap_pin',
        payload: { path: '/agent/home/PRINCIPLES.md' },
        createdAt: new Date().toISOString(),
      });

      const construct = await runtime.runtimeManager.getOrCreate(constructId);
      const vfs = construct.getVfs();
      const entries = await loadPendingNextNapPins(vfs);

      expect(entries.length).toBe(1);
      expect(entries[0]?.path).toBe('/agent/home/PRINCIPLES.md');
      expect(entries[0]?.status).toBe('pending');

      construct.stop();
    } finally {
      await driver.disconnect();
    }
  });

  test('queueNextNapImprint enqueues entry readable via VFS', async () => {
    const driver = await createTestDriver();
    const logger = initLogger('construct-lab-queue-imprint');
    const constructId = 'lab-test-imprint-1';

    try {
      const runtime = createLocalConstructRuntime({
        logger,
        createConfig: async (id) => ({
          id,
          storage: createDalStorage({ driver, logger }),
          deps: { openAI: stub<OpenAI>(), logger },
          impulseProfiles: DEFAULT_IMPULSE_PROFILES,
          computerConfig: {},
          lanes: DEFAULT_CONSTRUCT_LANES,
        }),
      });

      await runtime.submit(constructId, {
        opId: 'op-imprint-1',
        kind: 'next_nap_imprint',
        payload: { text: 'Bias toward concise principles updates.' },
        createdAt: new Date().toISOString(),
      });

      const construct = await runtime.runtimeManager.getOrCreate(constructId);
      const vfs = construct.getVfs();
      const entries = await loadPendingNextNapImprints(vfs);

      expect(entries.length).toBe(1);
      expect(entries[0]?.text).toBe('Bias toward concise principles updates.');
      expect(entries[0]?.status).toBe('pending');

      construct.stop();
    } finally {
      await driver.disconnect();
    }
  });

  test('rate_response good writes feedback log entry to VFS', async () => {
    const driver = await createTestDriver();
    const logger = initLogger('construct-lab-rate');
    const constructId = 'lab-test-rate-1';

    try {
      const runtime = createLocalConstructRuntime({
        logger,
        createConfig: async (id) => ({
          id,
          storage: createDalStorage({ driver, logger }),
          deps: { openAI: stub<OpenAI>(), logger },
          impulseProfiles: DEFAULT_IMPULSE_PROFILES,
          computerConfig: {},
          lanes: DEFAULT_CONSTRUCT_LANES,
        }),
      });

      await runtime.submit(constructId, {
        opId: 'op-rate-1',
        kind: 'rate_response',
        payload: {
          rating: 'good',
          annotation: 'Helpful',
          source: 'lab',
          lane: 'conversation',
        },
        createdAt: new Date().toISOString(),
      });

      const construct = await runtime.runtimeManager.getOrCreate(constructId);
      const vfs = construct.getVfs();

      // Feedback now lives in the conversation lane log.

      let feedbackContent: string | null = null;
      const logPath = await getLatestLogPath(vfs, 'conversation');
      if (logPath) {
        feedbackContent = await vfs.read(logPath);
      }

      expect(feedbackContent).not.toBeNull();
      if (feedbackContent) {
        const entries = parseFeedbackLog(feedbackContent);
        expect(entries.length).toBeGreaterThan(0);
        expect(entries[0]?.rating).toBe('good');
        expect(entries[0]?.annotation).toBe('Helpful');
        expect(entries[0]?.source).toBe('lab');
      }

      construct.stop();
    } finally {
      await driver.disconnect();
    }
  });

  test('cancel_hypno with no active session is a no-op (does not throw)', async () => {
    const driver = await createTestDriver();
    const logger = initLogger('construct-lab-cancel-hypno');
    const constructId = 'lab-test-cancel-hypno-1';

    try {
      const runtime = createLocalConstructRuntime({
        logger,
        createConfig: async (id) => ({
          id,
          storage: createDalStorage({ driver, logger }),
          deps: { openAI: stub<OpenAI>(), logger },
          impulseProfiles: DEFAULT_IMPULSE_PROFILES,
          computerConfig: {},
          lanes: DEFAULT_CONSTRUCT_LANES,
        }),
      });

      // Should not throw even though no hypno session is active
      await runtime.submit(constructId, {
        opId: 'op-cancel-hypno-1',
        kind: 'cancel_hypno',
        payload: {},
        createdAt: new Date().toISOString(),
      });

      const construct = await runtime.runtimeManager.getOrCreate(constructId);
      expect(construct.isHypnoActive()).toBe(false);

      construct.stop();
    } finally {
      await driver.disconnect();
    }
  });

  test('throws when a resolved impulse profile is not registered', async () => {
    const driver = await createTestDriver();
    const logger = initLogger('construct-lab-unregistered-impulse-profile');
    const constructId = 'lab-test-unregistered-profile-1';

    try {
      const runtime = createLocalConstructRuntime({
        logger,
        createConfig: async (id) => ({
          id,
          storage: createDalStorage({ driver, logger }),
          deps: { openAI: stub<OpenAI>(), logger },
          impulseProfiles: defineImpulseProfiles({
            [CORE_IMPULSE_PROFILE_NAME.CONVERSATION_USER_MESSAGE]: {},
          }),
          computerConfig: {},
          lanes: DEFAULT_CONSTRUCT_LANES,
        }),
      });

      await expect(
        runtime.submit(constructId, {
          opId: 'op-time-passed-unregistered-1',
          kind: 'time_passed',
          payload: { elapsed: '5m' },
          createdAt: new Date().toISOString(),
        }),
      ).rejects.toThrow('Unregistered impulse profile "system.time_passed"');
    } finally {
      await driver.disconnect();
    }
  });
});

// ---------------------------------------------------------------------------
// AI-mock group — uses createAiFlowTestDeps with scripted scenario turns
// ---------------------------------------------------------------------------

describe('construct lab actions — AI mock', () => {
  test('user_message urgency:none consumes 1 merged impulse turn', async () => {
    const driver = await createTestDriver();
    const logger = initLogger('construct-lab-chat-no-respond');
    const constructId = 'lab-test-chat-no-respond-1';

    const { deps, inspector } = createAiFlowTestDeps({
      logger,
      scenario: createAiFlowScenario({
        stream: [
          // Turn 1: merged impulse decision — the construct decides not to respond
          {
            primitives: [
              jsonPrimitive({
                thinking: 'The user is just greeting. No reply is needed yet.',
                urgency: 'none',
                intent: null,
                execId: null,
              }),
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
          computerConfig: {},
          lanes: DEFAULT_CONSTRUCT_LANES,
        }),
      });

      await runtime.submit(constructId, {
        opId: 'op-chat-1',
        kind: 'user_message',
        payload: { content: 'Hello!' },
        createdAt: new Date().toISOString(),
      });

      // Wait for impulse to complete
      const construct = await runtime.runtimeManager.getOrCreate(constructId);
      for (let i = 0; i < 100; i++) {
        await runtime.waitForSettled?.(constructId);
        if (inspector.streamCallCount() >= 1) {
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }

      expect(inspector.streamCallCount()).toBe(1);
      inspector.assertConsumed();

      construct.stop();
    } finally {
      await driver.disconnect();
    }
  });

  test('user_message with execId:null does not schedule a response turn', async () => {
    const driver = await createTestDriver();
    const logger = initLogger('construct-lab-chat-respond');
    const constructId = 'lab-test-chat-respond-1';

    const { deps, inspector } = createAiFlowTestDeps({
      logger,
      scenario: createAiFlowScenario({
        stream: [
          {
            primitives: [
              jsonPrimitive({
                thinking: 'The user asked directly and expects help.',
                intent: 'reply now',
                urgency: 'normal',
                execId: null,
              }),
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
          computerConfig: {},
          lanes: DEFAULT_CONSTRUCT_LANES,
        }),
      });

      await runtime.submit(constructId, {
        opId: 'op-chat-respond-1',
        kind: 'user_message',
        payload: { content: 'Can you help me?' },
        createdAt: new Date().toISOString(),
      });

      const construct = await runtime.runtimeManager.getOrCreate(constructId);
      for (let i = 0; i < 100; i++) {
        await runtime.waitForSettled?.(constructId);
        if (inspector.streamCallCount() >= 1) {
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }

      expect(inspector.streamCallCount()).toBe(1);
      inspector.assertConsumed();

      const transcript = await readDerivedTranscriptEntries(construct.getVfs());
      expect(
        transcript.some(
          (entry) =>
            entry.role === 'construct' && entry.content.includes('help me'),
        ),
      ).toBe(false);

      construct.stop();
    } finally {
      await driver.disconnect();
    }
  });

  test('user_message with execId:null emits no response thinking stage markers', async () => {
    const driver = await createTestDriver();
    const logger = initLogger('construct-lab-chat-thinking-stage-markers');
    const constructId = 'lab-test-chat-thinking-stage-markers-1';

    const { deps, inspector } = createAiFlowTestDeps({
      logger,
      scenario: createAiFlowScenario({
        stream: [
          {
            primitives: [
              jsonPrimitive({
                thinking: 'The user wants a concise plan and should get one.',
                intent: 'reply now',
                urgency: 'normal',
                execId: null,
              }),
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
          computerConfig: {},
          lanes: DEFAULT_CONSTRUCT_LANES,
        }),
      });

      const construct = await runtime.runtimeManager.getOrCreate(constructId);
      const events: ConstructEvent[] = [];
      construct.onEvent((event) => events.push(event));

      await runtime.submit(constructId, {
        opId: 'op-chat-thinking-stage-markers-1',
        kind: 'user_message',
        payload: { content: 'Can you help me with a concise plan?' },
        createdAt: new Date().toISOString(),
      });

      for (let i = 0; i < 100; i++) {
        await runtime.waitForSettled?.(constructId);
        if (inspector.streamCallCount() >= 1) {
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }

      const thinkingEvents = events.filter(
        (
          event,
        ): event is Extract<ConstructEvent, { type: 'response:thinking' }> =>
          event.type === 'response:thinking',
      );

      const stageMarkerEvents = thinkingEvents.filter((event) =>
        event.delta.startsWith('[[stage:'),
      );
      const stageSet = new Set(stageMarkerEvents.map((event) => event.stage));

      expect(stageSet.has('response/decide')).toBe(false);
      expect(stageSet.has('response/generate')).toBe(false);
      expect(stageSet.has('response/evalDraft')).toBe(false);

      expect(inspector.streamCallCount()).toBe(1);
      inspector.assertConsumed();

      construct.stop();
    } finally {
      await driver.disconnect();
    }
  });

  test('steer_directive consumes 1 merged impulse turn and writes steering log', async () => {
    const driver = await createTestDriver();
    const logger = initLogger('construct-lab-steer');
    const constructId = 'lab-test-steer-1';

    const { deps, inspector } = createAiFlowTestDeps({
      logger,
      scenario: createAiFlowScenario({
        stream: [
          // Turn 1: merged impulse decision — no response needed for background event
          {
            primitives: [
              jsonPrimitive({
                thinking: 'Steering directive received and applied internally.',
                urgency: 'none',
                intent: null,
                execId: null,
              }),
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
          computerConfig: {},
          lanes: DEFAULT_CONSTRUCT_LANES,
        }),
      });

      await runtime.submit(constructId, {
        opId: 'op-steer-1',
        kind: 'steer_directive',
        payload: {
          directive: 'Be more concise in your answers.',
          source: 'lab',
          lane: 'conversation',
        },
        createdAt: new Date().toISOString(),
      });

      const construct = await runtime.runtimeManager.getOrCreate(constructId);
      for (let i = 0; i < 30; i++) {
        await construct.getScheduler().poll();
        const state = await construct.getRuntimeState();
        if (
          state.activeResponses === 0 &&
          state.schedulerBusy === false &&
          state.scheduledResponses === 0
        ) {
          break;
        }
        await new Promise((r) => setTimeout(r, 10));
      }

      expect(inspector.streamCallCount()).toBe(1);
      inspector.assertConsumed();

      // Steering now lives in the conversation lane log.
      const vfs = construct.getVfs();
      const { getLatestLogPath } = await import('../vfs/logs');
      const steeringPath = await getLatestLogPath(vfs, 'conversation');
      expect(steeringPath).toBeTruthy();

      construct.stop();
    } finally {
      await driver.disconnect();
    }
  });
});
