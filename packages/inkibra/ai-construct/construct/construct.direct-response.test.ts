import { describe, expect, test } from 'bun:test';
import {
  createAiFlowScenario,
  createAiFlowTestDeps,
  jsonPrimitive,
} from '@inkibra/ai-flow/testing';
import { createTestDriver } from '@inkibra/dal-connection/create-driver';
import initLogger from '@inkibra/logger';
import {
  CONSTRUCT_SYSTEM_EVENT_NAME,
  DEFAULT_IMPULSE_PROFILES,
  systemEventImpulseProfile,
} from '../impulse/keys';
import { defineImpulseProfiles } from '../impulse/types';
import { readDerivedTranscriptEntries } from '../vfs/transcript';
import { createConstruct } from './construct';
import { createDalStorage } from './storage';
import { DEFAULT_CONSTRUCT_LANES } from './types';

function previewExecToolCall(code: string) {
  return {
    kind: 'tool_call' as const,
    name: 'preview_exec',
    arguments: { input: code },
  };
}

function createObservationOnlyScenario(args: {
  thinking: string;
  intent: string | null;
  urgency: 'none' | 'normal' | 'urgent' | 'now' | 'low' | 'defer';
}) {
  return createAiFlowScenario({
    stream: [
      { primitives: [previewExecToolCall('console.log("noop")')] },
      {
        primitives: [
          jsonPrimitive({
            thinking: args.thinking,
            intent: args.intent,
            urgency: args.urgency,
            execId: null,
          }),
        ],
      },
    ],
    strict: true,
  });
}
describe('direct construct response scheduling', () => {
  test('does not deliver a direct response when the impulse returns execId:null', async () => {
    const driver = await createTestDriver();
    const logger = initLogger('construct-direct-respond');

    const { deps, inspector } = createAiFlowTestDeps({
      logger,
      scenario: createObservationOnlyScenario({
        thinking: 'The user asked a direct question and expects help.',
        intent: 'answer directly',
        urgency: 'normal',
      }),
    });

    try {
      const construct = await createConstruct({
        id: 'construct-direct-respond-1',
        storage: createDalStorage({ driver, logger }),
        deps,
        impulseProfiles: DEFAULT_IMPULSE_PROFILES,
        computerConfig: {},
        lanes: DEFAULT_CONSTRUCT_LANES,
      });

      construct.start();
      await construct.ingest({
        lane: 'conversation',
        role: 'user',
        source: 'user_message',
        content: 'Can you help me?',
        occurredAt: new Date(),
        receivedAt: new Date(),
      });

      for (let i = 0; i < 150; i++) {
        const state = await construct.getRuntimeState();
        if (
          inspector.streamCallCount() >= 1 &&
          state.activeResponses === 0 &&
          state.schedulerBusy === false &&
          state.scheduledResponses === 0
        ) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      expect(inspector.streamCallCount()).toBe(2);
      inspector.assertConsumed();

      const transcript = await readDerivedTranscriptEntries(construct.getVfs());
      expect(
        transcript.some(
          (entry) =>
            entry.role === 'construct' && entry.content.includes('help'),
        ),
      ).toBe(false);

      construct.stop();
    } finally {
      await driver.disconnect();
    }
  });

  test('does not persist a construct response after reopen when execId is null', async () => {
    const driver = await createTestDriver();
    const logger = initLogger('construct-direct-persisted-response');

    const { deps, inspector } = createAiFlowTestDeps({
      logger,
      scenario: createObservationOnlyScenario({
        thinking: 'The user sent a ping and expects an acknowledgment.',
        intent: 'acknowledge ping',
        urgency: 'normal',
      }),
    });

    try {
      const storage = createDalStorage({ driver, logger });
      const constructId = 'construct-direct-persisted-response-1';
      const construct = await createConstruct({
        id: constructId,
        storage,
        deps,
        impulseProfiles: DEFAULT_IMPULSE_PROFILES,
        computerConfig: {},
        lanes: DEFAULT_CONSTRUCT_LANES,
      });

      construct.start();
      await construct.ingest({
        lane: 'conversation',
        role: 'user',
        source: 'user_message',
        content: 'PING-PERSIST-1',
        occurredAt: new Date(),
        receivedAt: new Date(),
      });

      for (let i = 0; i < 200; i += 1) {
        const state = await construct.getRuntimeState();
        if (
          inspector.streamCallCount() >= 1 &&
          state.activeResponses === 0 &&
          state.schedulerBusy === false &&
          state.scheduledResponses === 0
        ) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      await construct.flush();
      construct.stop();

      const reopened = await createConstruct({
        id: constructId,
        storage,
        deps,
        impulseProfiles: DEFAULT_IMPULSE_PROFILES,
        computerConfig: {},
        lanes: DEFAULT_CONSTRUCT_LANES,
      });

      const transcript = await readDerivedTranscriptEntries(reopened.getVfs());
      expect(
        transcript.some(
          (entry) =>
            entry.role === 'construct' &&
            entry.content.includes('PING-PERSIST-1'),
        ),
      ).toBe(false);

      inspector.assertConsumed();
    } finally {
      await driver.disconnect();
    }
  });

  test('does not kick the scheduler when a heartbeat impulse returns execId:null', async () => {
    const driver = await createTestDriver();
    const logger = initLogger('construct-heartbeat-kick');

    const { deps, inspector } = createAiFlowTestDeps({
      logger,
      scenario: createObservationOnlyScenario({
        thinking: 'Heartbeat check-in should respond gently.',
        intent: 'check in warmly',
        urgency: 'normal',
      }),
    });

    try {
      const construct = await createConstruct({
        id: 'construct-heartbeat-kick-1',
        storage: createDalStorage({ driver, logger }),
        deps,
        impulseProfiles: defineImpulseProfiles({
          [systemEventImpulseProfile(CONSTRUCT_SYSTEM_EVENT_NAME.HEARTBEAT)]:
            {},
        }),
        computerConfig: {},
        lanes: DEFAULT_CONSTRUCT_LANES,
      });

      const scheduler = construct.getScheduler();
      const originalPoll = scheduler.poll.bind(scheduler);
      const originalStart = scheduler.start.bind(scheduler);
      let pollCalls = 0;
      scheduler.poll = async () => {
        pollCalls += 1;
        return originalPoll();
      };
      scheduler.start = () => scheduler;

      construct.start();
      await construct.ingest({
        lane: 'heartbeat',
        role: 'system',
        source: 'system_event',
        event: CONSTRUCT_SYSTEM_EVENT_NAME.HEARTBEAT,
        content: CONSTRUCT_SYSTEM_EVENT_NAME.HEARTBEAT,
        occurredAt: new Date(),
        metadata: {},
      });

      for (let i = 0; i < 200; i += 1) {
        const state = await construct.getRuntimeState();
        if (
          inspector.streamCallCount() >= 1 &&
          state.activeResponses === 0 &&
          state.schedulerBusy === false &&
          state.scheduledResponses === 0
        ) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      expect(pollCalls).toBe(0);
      expect(inspector.streamCallCount()).toBe(2);
      inspector.assertConsumed();

      const transcript = await readDerivedTranscriptEntries(construct.getVfs());
      expect(
        transcript.some(
          (entry) =>
            entry.role === 'construct' && entry.content.includes('checking in'),
        ),
      ).toBe(false);

      construct.stop();
      scheduler.start = originalStart;
    } finally {
      await driver.disconnect();
    }
  });

  test('drops concurrent heartbeat impulses instead of queueing them', async () => {
    const driver = await createTestDriver();
    const logger = initLogger('construct-heartbeat-drop');

    const { deps, inspector } = createAiFlowTestDeps({
      logger,
      scenario: createObservationOnlyScenario({
        thinking: 'heartbeat one',
        intent: null,
        urgency: 'none',
      }),
    });

    try {
      const construct = await createConstruct({
        id: 'construct-heartbeat-drop-1',
        storage: createDalStorage({ driver, logger }),
        deps,
        impulseProfiles: defineImpulseProfiles({
          [systemEventImpulseProfile(CONSTRUCT_SYSTEM_EVENT_NAME.HEARTBEAT)]: {
            pool: 'heartbeat',
          },
        }),
        computerConfig: {},
        lanes: DEFAULT_CONSTRUCT_LANES,
        impulsePool: {
          perPool: {
            heartbeat: 1,
          },
        },
      });

      construct.start();
      void construct.ingest({
        lane: 'heartbeat',
        role: 'system',
        source: 'system_event',
        event: CONSTRUCT_SYSTEM_EVENT_NAME.HEARTBEAT,
        content: CONSTRUCT_SYSTEM_EVENT_NAME.HEARTBEAT,
        occurredAt: new Date(),
        metadata: {},
      });
      void construct.ingest({
        lane: 'heartbeat',
        role: 'system',
        source: 'system_event',
        event: CONSTRUCT_SYSTEM_EVENT_NAME.HEARTBEAT,
        content: CONSTRUCT_SYSTEM_EVENT_NAME.HEARTBEAT,
        occurredAt: new Date(),
        metadata: {},
      });

      for (let i = 0; i < 200; i += 1) {
        const state = await construct.getRuntimeState();
        if (
          inspector.streamCallCount() >= 1 &&
          state.activeImpulses === 0 &&
          state.schedulerBusy === false
        ) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      expect(inspector.streamCallCount()).toBe(2);
      expect(construct.getImpulsePool().getActive()).toHaveLength(0);
      construct.stop();
    } finally {
      await driver.disconnect();
    }
  });
});
