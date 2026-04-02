import { describe, expect, test } from 'bun:test';
import { createAiFlowScenario, jsonPrimitive } from '@inkibra/ai-flow/testing';
import type { MailboxMessage } from '@inkibra/mailbox';
import { parseFeedbackLog } from '../vfs/feedback';
import { VFS_PATHS } from '../vfs/layout';
import { getLatestLogPathForDir } from '../vfs/logs';
import { parseTranscriptLog } from '../vfs/transcript';
import { processMailboxMessages } from './processor';
import { createLocalConstructBehaviorHarness } from './test-behavior-harness';

describe('construct runtime processor — behavior', () => {
  test('processes a real user_message mailbox op into transcript and lifecycle state', async () => {
    const harness = await createLocalConstructBehaviorHarness({
      loggerName: 'processor-behavior-user-message',
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
      const construct = await harness.getConstruct();
      const messages: MailboxMessage[] = [
        {
          kind: 'op',
          operation: {
            opId: 'op-mailbox-user-1',
            kind: 'user_message',
            payload: { content: 'hello from mailbox' },
            createdAt: new Date().toISOString(),
          },
          cursor: 'cursor-user-1',
          ts: new Date().toISOString(),
        },
      ];

      const result = await processMailboxMessages(construct, messages);
      expect(result.processedCount).toBe(1);
      expect(result.opOutcomes).toEqual([
        {
          source: 'mailbox',
          opId: 'op-mailbox-user-1',
          opKind: 'user_message',
          ref: 'cursor-user-1',
          lifecycle: 'applied',
        },
      ]);

      await harness.waitForIdle();

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
            content: 'hello from mailbox',
          }),
        ]),
      );

      const fact = await harness.waitForSourceFact(
        'op-mailbox-user-1',
        (record) => Boolean(record?.clearedAt),
      );
      expect(fact).toMatchObject({
        factType: 'user_message',
        journal: 'lane-log',
        lastPhase: 'cleared',
        clearReason: 'no_response_planned',
      });
      expect(fact.spawnedAt).toEqual(expect.any(String));

      harness.inspector.assertConsumed();
    } finally {
      await harness.dispose();
    }
  });

  test('processes a real rate_response mailbox op without spawning work', async () => {
    const harness = await createLocalConstructBehaviorHarness({
      loggerName: 'processor-behavior-rate-response',
    });

    try {
      const construct = await harness.getConstruct();
      const result = await processMailboxMessages(construct, [
        {
          kind: 'op',
          operation: {
            opId: 'op-mailbox-rate-1',
            kind: 'rate_response',
            payload: {
              rating: 'good',
              annotation: 'Tight and useful',
              source: 'mailbox',
            },
            createdAt: new Date().toISOString(),
          },
          cursor: 'cursor-rate-1',
          ts: new Date().toISOString(),
        },
      ]);

      expect(result.processedCount).toBe(1);
      expect(result.opOutcomes).toEqual([
        {
          source: 'mailbox',
          opId: 'op-mailbox-rate-1',
          opKind: 'rate_response',
          ref: 'cursor-rate-1',
          lifecycle: 'applied',
        },
      ]);

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
            annotation: 'Tight and useful',
            source: 'mailbox',
          }),
        ]),
      );

      const fact = await harness.waitForSourceFact(
        'op-mailbox-rate-1',
        (record) => Boolean(record?.clearedAt),
      );
      expect(fact).toMatchObject({
        factType: 'rate_response',
        journal: 'lane-log',
        lastPhase: 'cleared',
        clearReason: 'no_processing_required',
      });
      expect(fact.spawnedAt).toBeUndefined();
      expect(harness.inspector.streamCallCount()).toBe(0);
    } finally {
      await harness.dispose();
    }
  });
});
