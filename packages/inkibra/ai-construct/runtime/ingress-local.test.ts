import { describe, expect, test } from 'bun:test';
import {
  createAiFlowScenario,
  jsonPrimitive,
  textPrimitive,
} from '@inkibra/ai-flow/testing';
import {
  loadDeferredParentResolutionRecords,
  loadPendingDeferredPerceptionQueueEntries,
} from '../vfs/deferred-perceptions';
import { parseFeedbackLog } from '../vfs/feedback';
import { VFS_PATHS } from '../vfs/layout';
import { getLatestLogPathForDir } from '../vfs/logs';
import {
  loadPendingNextNapImprints,
  loadPendingNextNapPins,
} from '../vfs/nap-instructions';
import { loadSourceFactState } from '../vfs/source-fact-state';
import { parseTranscriptLog } from '../vfs/transcript';
import { createLocalConstructBehaviorHarness } from './test-behavior-harness';

describe('local construct ingress', () => {
  test('reflects user_message into transcript and source-fact state', async () => {
    const harness = await createLocalConstructBehaviorHarness({
      loggerName: 'ingress-local-user-message',
      scenario: createAiFlowScenario({
        stream: [
          {
            primitives: [
              jsonPrimitive({
                thinking:
                  'The user is greeting the construct. No reply is needed.',
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
      await harness.ingress.submit(harness.constructId, {
        opId: 'op-user-1',
        kind: 'user_message',
        payload: { content: 'hello' },
        createdAt: new Date().toISOString(),
      });

      const construct = await harness.waitForIdle();
      const transcriptPath = await getLatestLogPathForDir(
        construct.getVfs(),
        VFS_PATHS.logs.root,
      );

      expect(transcriptPath).not.toBeNull();
      const transcript = parseTranscriptLog(
        await construct.getVfs().read(transcriptPath!),
      );
      expect(transcript).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: 'hello',
          }),
        ]),
      );

      const fact = await harness.waitForSourceFact('op-user-1', (record) =>
        Boolean(record?.clearedAt),
      );
      expect(fact).toMatchObject({
        factId: 'op-user-1',
        factType: 'user_message',
        journal: 'lane-log',
        lastPhase: 'cleared',
        clearReason: 'no_response_planned',
      });
      expect(fact.queuedAt).toEqual(expect.any(String));
      expect(fact.reflectedAt).toEqual(expect.any(String));
      expect(fact.spawnedAt).toEqual(expect.any(String));
      expect(fact.clearedAt).toEqual(expect.any(String));

      harness.inspector.assertConsumed();
    } finally {
      await harness.dispose();
    }
  });

  test('routes runtime queue ops into next-nap VFS queues', async () => {
    const harness = await createLocalConstructBehaviorHarness({
      loggerName: 'ingress-local-next-nap-queue',
    });

    try {
      await harness.ingress.submit(harness.constructId, {
        opId: 'op-open-1',
        kind: 'next_nap_pin',
        payload: { path: '/agent/home/PRINCIPLES.md' },
        createdAt: new Date().toISOString(),
      });
      await harness.ingress.submit(harness.constructId, {
        opId: 'op-imprint-1',
        kind: 'next_nap_imprint',
        payload: { text: 'Bias toward concise principles updates.' },
        createdAt: new Date().toISOString(),
      });

      const construct = await harness.getConstruct();
      const vfs = construct.getVfs();

      expect(await loadPendingNextNapPins(vfs)).toEqual([
        expect.objectContaining({
          id: 'op-open-1',
          path: '/agent/home/PRINCIPLES.md',
          status: 'pending',
        }),
      ]);
      expect(await loadPendingNextNapImprints(vfs)).toEqual([
        expect.objectContaining({
          id: 'op-imprint-1',
          text: 'Bias toward concise principles updates.',
          status: 'pending',
        }),
      ]);

      expect(harness.inspector.streamCallCount()).toBe(0);
    } finally {
      await harness.dispose();
    }
  });

  test('writes feedback log and clears rate_response without spawning', async () => {
    const harness = await createLocalConstructBehaviorHarness({
      loggerName: 'ingress-local-rate-response',
    });

    try {
      await harness.ingress.submit(harness.constructId, {
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

      const construct = await harness.getConstruct();
      const feedbackPath = await getLatestLogPathForDir(
        construct.getVfs(),
        VFS_PATHS.logs.root,
      );

      expect(feedbackPath).not.toBeNull();
      const feedback = parseFeedbackLog(
        await construct.getVfs().read(feedbackPath!),
      );
      expect(feedback).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            rating: 'good',
            annotation: 'Helpful',
            source: 'lab',
          }),
        ]),
      );

      const fact = await harness.waitForSourceFact('op-rate-1', (record) =>
        Boolean(record?.clearedAt),
      );
      expect(fact).toMatchObject({
        factId: 'op-rate-1',
        factType: 'rate_response',
        journal: 'lane-log',
        lastPhase: 'cleared',
        clearReason: 'no_processing_required',
      });
      expect(fact.queuedAt).toEqual(expect.any(String));
      expect(fact.spawnedAt).toBeUndefined();
      expect(fact.reflectedAt).toEqual(expect.any(String));
      expect(fact.clearedAt).toEqual(expect.any(String));

      expect(harness.inspector.streamCallCount()).toBe(0);
    } finally {
      await harness.dispose();
    }
  });

  test('keeps cancel_hypno as a no-op when no session is active', async () => {
    const harness = await createLocalConstructBehaviorHarness({
      loggerName: 'ingress-local-cancel-hypno',
    });

    try {
      await harness.ingress.submit(harness.constructId, {
        opId: 'op-cancel-hypno-1',
        kind: 'cancel_hypno',
        payload: {},
        createdAt: new Date().toISOString(),
      });

      const construct = await harness.getConstruct();
      expect(construct.isHypnoActive()).toBe(false);
      expect(harness.inspector.streamCallCount()).toBe(0);
    } finally {
      await harness.dispose();
    }
  });

  test('local steer_directive during hypno reflects the parent fact without spawning work', async () => {
    const harness = await createLocalConstructBehaviorHarness({
      loggerName: 'ingress-local-hypno-deferred-steer',
      scenario: createAiFlowScenario({
        stream: [
          {
            primitives: [
              textPrimitive(
                'Analysis draft: hold while deferred steering is queued.',
              ),
            ],
          },
        ],
        strict: false,
      }),
    });

    try {
      await harness.ingress.submit(harness.constructId, {
        opId: 'op-local-start-hypno-1',
        kind: 'start_hypno',
        payload: {},
        createdAt: new Date().toISOString(),
      });

      const construct = await waitForCondition(async () => {
        const current = await harness.getConstruct();
        return current.isHypnoActive() ? current : null;
      });
      const vfs = construct.getVfs();

      await harness.ingress.submit(harness.constructId, {
        opId: 'op-local-steer-invalid-parent-1',
        kind: 'steer_directive',
        payload: {
          directive: '',
          source: 'local-hypno-test',
          lane: 'conversation',
        },
        createdAt: new Date().toISOString(),
      });

      expect(await loadPendingDeferredPerceptionQueueEntries(vfs)).toHaveLength(
        0,
      );
      expect(
        (await loadSourceFactState(vfs))['op-local-steer-invalid-parent-1'],
      ).toMatchObject({
        factType: 'steer_directive',
        journal: 'lane-log',
        lastPhase: 'reflected',
      });

      await harness.ingress.submit(harness.constructId, {
        opId: 'op-local-cancel-hypno-1',
        kind: 'cancel_hypno',
        payload: {},
        createdAt: new Date().toISOString(),
      });

      await waitForCondition(async () => {
        const current = await harness.getConstruct();
        return current.isHypnoActive() ? null : true;
      });
      expect(
        (await loadDeferredParentResolutionRecords(vfs))[
          'op-local-steer-invalid-parent-1'
        ],
      ).toMatchObject({
        parentOpId: 'op-local-steer-invalid-parent-1',
        childOpId: 'nap-child:op-local-steer-invalid-parent-1',
        status: 'failed_permanent',
      });
    } finally {
      await harness.dispose();
    }
  });
});

async function waitForCondition<T>(
  getValue: () => Promise<T | null>,
  timeoutMs = 4_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await getValue();
    if (value !== null) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for condition after ${timeoutMs}ms`);
}
