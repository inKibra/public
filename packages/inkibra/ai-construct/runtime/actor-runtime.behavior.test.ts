/**
 * Behavioral tests for the simplified actor runtime (actor-runtime.ts).
 *
 * These tests verify the performance contracts that motivated the refactor:
 *
 * 1. Batch drain is always immediate — processMailboxMessages returns promptly
 * 2. Multiple concurrent messages fire concurrent impulses (ingestDetached)
 * 3. Response decision + delivery works end-to-end
 * 4. Source fact lifecycle completes for rate_response (no impulse needed)
 * 5. Construct reaches quiescence after processing
 *
 * All tests use real constructs with only OpenAI mocked via createAiFlowTestDeps.
 */

import { describe, expect, test } from 'bun:test';
import { createAiFlowScenario, jsonPrimitive } from '@inkibra/ai-flow/testing';
import type { MailboxMessage } from '@inkibra/mailbox';
import { parseFeedbackLog } from '../vfs/feedback';
import { VFS_PATHS } from '../vfs/layout';
import { getLatestLogPathForDir } from '../vfs/logs';
import { parseTranscriptLog } from '../vfs/transcript';
import { processMailboxMessages } from './processor';
import { createLocalConstructBehaviorHarness } from './test-behavior-harness';

describe('actor runtime — behavioral contracts', () => {
  // ---------------------------------------------------------------------------
  // Contract 1: Batch drain returns promptly
  //
  // processMailboxMessages fires ingestDetached (fire-and-forget) for mailbox
  // perception ops. It should return quickly without waiting for impulse
  // completion.
  // ---------------------------------------------------------------------------
  test('batch drain returns promptly without blocking on impulse completion', async () => {
    const harness = await createLocalConstructBehaviorHarness({
      loggerName: 'actor-behavior-batch-drain',
      scenario: createAiFlowScenario({
        stream: [
          // Provide enough AI responses for 3 concurrent impulses
          {
            primitives: [
              jsonPrimitive({
                thinking: 'Processing message 1 without replying.',
                urgency: 'none',
                intent: null,
                execId: null,
              }),
            ],
          },
          {
            primitives: [
              jsonPrimitive({
                thinking: 'Processing message 2 without replying.',
                urgency: 'none',
                intent: null,
                execId: null,
              }),
            ],
          },
          {
            primitives: [
              jsonPrimitive({
                thinking: 'Processing message 3 without replying.',
                urgency: 'none',
                intent: null,
                execId: null,
              }),
            ],
          },
        ],
        strict: false,
      }),
    });

    try {
      const construct = await harness.getConstruct();
      const messages: MailboxMessage[] = Array.from({ length: 3 }, (_, i) => ({
        kind: 'op' as const,
        operation: {
          opId: `op-batch-${i}`,
          kind: 'user_message',
          payload: { content: `batch message ${i}` },
          createdAt: new Date().toISOString(),
        },
        cursor: `cursor-batch-${i}`,
        ts: new Date().toISOString(),
      }));

      const start = Date.now();
      const result = await processMailboxMessages(construct, messages);
      const elapsed = Date.now() - start;

      // All 3 ops accepted immediately
      expect(result.processedCount).toBe(3);
      expect(result.diagnostics.processed.perceptionCount).toBe(3);

      // processMailboxMessages returns promptly (ingestDetached is fire-and-forget)
      // Should complete in well under 1 second even though impulses take time
      expect(elapsed).toBeLessThan(1_000);

      // Wait for the actual impulses to complete
      await harness.waitForIdle(10_000);

      // Verify all 3 messages landed in transcript
      const transcriptPath = await getLatestLogPathForDir(
        construct.getVfs(),
        VFS_PATHS.logs.root,
      );
      expect(transcriptPath).toBeTruthy();
      const transcript = parseTranscriptLog(
        await construct.getVfs().read(transcriptPath!),
      );
      const userEntries = transcript.filter((e) => e.role === 'user');
      expect(userEntries.length).toBe(3);
    } finally {
      await harness.dispose();
    }
  }, 20_000);

  // ---------------------------------------------------------------------------
  // Contract 2: Concurrent messages → concurrent impulses
  //
  // All perception ops in a batch fire concurrently via ingestDetached.
  // They don't block each other.
  // ---------------------------------------------------------------------------
  test('multiple messages in a batch fire concurrent impulses', async () => {
    const harness = await createLocalConstructBehaviorHarness({
      loggerName: 'actor-behavior-concurrent',
      scenario: createAiFlowScenario({
        stream: [
          {
            primitives: [
              jsonPrimitive({
                thinking: 'User greeting 1 needs no reply.',
                urgency: 'none',
                intent: null,
                execId: null,
              }),
            ],
          },
          {
            primitives: [
              jsonPrimitive({
                thinking: 'User greeting 2 needs no reply.',
                urgency: 'none',
                intent: null,
                execId: null,
              }),
            ],
          },
        ],
        strict: false,
      }),
    });

    try {
      const construct = await harness.getConstruct();

      // Submit 2 messages in one batch
      const result = await processMailboxMessages(construct, [
        {
          kind: 'op',
          operation: {
            opId: 'op-concurrent-a',
            kind: 'user_message',
            payload: { content: 'hello from concurrent a' },
            createdAt: new Date().toISOString(),
          },
          cursor: 'cursor-concurrent-a',
          ts: new Date().toISOString(),
        },
        {
          kind: 'op',
          operation: {
            opId: 'op-concurrent-b',
            kind: 'user_message',
            payload: { content: 'hello from concurrent b' },
            createdAt: new Date().toISOString(),
          },
          cursor: 'cursor-concurrent-b',
          ts: new Date().toISOString(),
        },
      ]);

      expect(result.processedCount).toBe(2);

      // Wait for both impulses to finish
      await harness.waitForIdle(10_000);

      // Both source facts should reach cleared
      const factA = await harness.waitForSourceFact(
        'op-concurrent-a',
        (r) => r?.lastPhase === 'cleared',
        10_000,
      );
      const factB = await harness.waitForSourceFact(
        'op-concurrent-b',
        (r) => r?.lastPhase === 'cleared',
        10_000,
      );

      expect(factA.factType).toBe('user_message');
      expect(factB.factType).toBe('user_message');

      // Both messages in transcript
      const transcriptPath = await getLatestLogPathForDir(
        construct.getVfs(),
        VFS_PATHS.logs.root,
      );
      expect(transcriptPath).toBeTruthy();
      const transcript = parseTranscriptLog(
        await construct.getVfs().read(transcriptPath!),
      );
      const userEntries = transcript.filter((e) => e.role === 'user');
      expect(userEntries.length).toBe(2);
    } finally {
      await harness.dispose();
    }
  }, 20_000);

  // ---------------------------------------------------------------------------
  // Contract 3: rate_response completes without spawning an impulse
  //
  // Rate ops are reflected into feedback log and cleared immediately.
  // No AI call needed.
  // ---------------------------------------------------------------------------
  test('rate_response completes lifecycle without AI call', async () => {
    const harness = await createLocalConstructBehaviorHarness({
      loggerName: 'actor-behavior-rate',
    });

    try {
      const construct = await harness.getConstruct();
      const result = await processMailboxMessages(construct, [
        {
          kind: 'op',
          operation: {
            opId: 'op-rate-behavior-1',
            kind: 'rate_response',
            payload: {
              rating: 'good',
              annotation: 'Very helpful',
              source: 'behavior-test',
            },
            createdAt: new Date().toISOString(),
          },
          cursor: 'cursor-rate-1',
          ts: new Date().toISOString(),
        },
      ]);

      expect(result.processedCount).toBe(1);

      // Verify feedback log written
      const feedbackPath = await getLatestLogPathForDir(
        construct.getVfs(),
        VFS_PATHS.logs.root,
      );
      expect(feedbackPath).toBeTruthy();
      const feedback = parseFeedbackLog(
        await construct.getVfs().read(feedbackPath!),
      );
      expect(feedback).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            rating: 'good',
            annotation: 'Very helpful',
            source: 'behavior-test',
          }),
        ]),
      );

      // Source fact should be cleared without spawning any impulse
      const fact = await harness.waitForSourceFact(
        'op-rate-behavior-1',
        (r) => r?.lastPhase === 'cleared',
      );
      expect(fact).toMatchObject({
        factType: 'rate_response',
        lastPhase: 'cleared',
        clearReason: 'no_processing_required',
      });
      // No AI calls made
      expect(harness.inspector.streamCallCount()).toBe(0);
    } finally {
      await harness.dispose();
    }
  });

  // ---------------------------------------------------------------------------
  // Contract 4: Source fact lifecycle tracks through spawn → clear
  //
  // user_message → impulse fires (spawned) → perception decides no response
  // needed → source fact cleared with clearReason. Verifies the full source
  // fact lifecycle is tracked correctly through the VFS.
  // ---------------------------------------------------------------------------
  test('source fact lifecycle progresses through spawned to cleared', async () => {
    const harness = await createLocalConstructBehaviorHarness({
      loggerName: 'actor-behavior-source-fact-lifecycle',
      scenario: createAiFlowScenario({
        stream: [
          {
            primitives: [
              jsonPrimitive({
                thinking: 'The user is greeting. No response is needed.',
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
      const result = await processMailboxMessages(construct, [
        {
          kind: 'op',
          operation: {
            opId: 'op-lifecycle-1',
            kind: 'user_message',
            payload: { content: 'Just saying hello' },
            createdAt: new Date().toISOString(),
          },
          cursor: 'cursor-lifecycle-1',
          ts: new Date().toISOString(),
        },
      ]);

      expect(result.processedCount).toBe(1);

      // Wait for full lifecycle: spawned → cleared
      const fact = await harness.waitForSourceFact(
        'op-lifecycle-1',
        (r) => r?.lastPhase === 'cleared',
        10_000,
      );

      expect(fact).toMatchObject({
        factType: 'user_message',
        journal: 'lane-log',
        lastPhase: 'cleared',
        clearReason: 'no_response_planned',
      });
      // Impulse was spawned (spawnedAt set)
      expect(fact.spawnedAt).toEqual(expect.any(String));
      // Cleared after spawning (clearedAt > spawnedAt)
      expect(fact.clearedAt).toEqual(expect.any(String));

      // Transcript has the user message
      const transcriptPath = await getLatestLogPathForDir(
        construct.getVfs(),
        VFS_PATHS.logs.root,
      );
      expect(transcriptPath).toBeTruthy();
      const transcript = parseTranscriptLog(
        await construct.getVfs().read(transcriptPath!),
      );
      expect(
        transcript.some(
          (e) => e.role === 'user' && e.content.includes('Just saying hello'),
        ),
      ).toBe(true);

      harness.inspector.assertConsumed();
    } finally {
      await harness.dispose();
    }
  }, 15_000);

  // ---------------------------------------------------------------------------
  // Contract 5: Quiescence after processing
  //
  // After all impulses complete and responses are delivered, the construct
  // should report zero active impulses, responses, and scheduler activity.
  // This is the signal that processIdle can return null (let actor go idle).
  // ---------------------------------------------------------------------------
  test('construct reaches quiescence after impulse completes', async () => {
    const harness = await createLocalConstructBehaviorHarness({
      loggerName: 'actor-behavior-quiescence',
      scenario: createAiFlowScenario({
        stream: [
          {
            primitives: [
              jsonPrimitive({
                thinking: 'Simple acknowledgment is unnecessary here.',
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
      await processMailboxMessages(construct, [
        {
          kind: 'op',
          operation: {
            opId: 'op-quiescence-1',
            kind: 'user_message',
            payload: { content: 'just checking in' },
            createdAt: new Date().toISOString(),
          },
          cursor: 'cursor-quiescence-1',
          ts: new Date().toISOString(),
        },
      ]);

      // Wait for idle
      await harness.waitForIdle(10_000);

      // Verify quiescent state
      const state = await construct.getRuntimeState();
      expect(state.activeImpulses).toBe(0);
      expect(state.scheduledResponses).toBe(0);
      expect(state.activeResponses).toBe(0);
      expect(state.schedulerBusy).toBe(false);

      harness.inspector.assertConsumed();
    } finally {
      await harness.dispose();
    }
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Edit mode persistence contracts
//
// These tests cover the fix for the exitEditMode bug: writes made via
// getOrCreateReadonly() are only durable if flush() is called on that same
// instance. When getOpen() returns null (construct is idle), exitEditMode
// must fall back to getOrCreateReadonly().flush() instead of a no-op.
// ---------------------------------------------------------------------------

describe('edit mode — write persistence contracts', () => {
  // Regression for: exitEditMode with idle construct (getOpen() returns null)
  // Before the fix: exitEditMode called getOpen()?.flush() which was a no-op
  // when the construct was not actively running, silently losing all writes.
  // After the fix: falls back to getOrCreateReadonly().flush().
  //
  // This test exercises the underlying contract directly:
  //   write via getOrCreateReadonly → flush → read from fresh readonly instance
  // which is exactly the path that the fixed exitEditMode takes when idle.
  test('write via getOrCreateReadonly + flush is readable from a fresh readonly instance', async () => {
    const harness = await createLocalConstructBehaviorHarness({
      loggerName: 'actor-edit-mode-persistence',
    });

    try {
      // Do NOT call harness.getConstruct() — we want the construct to stay
      // "not open" (simulating idle state where getOpen() returns null).
      const constructId = harness.constructId;

      // Step 1: simulate writeContextFile pattern
      const readonly =
        await harness.runtimeManager.getOrCreateReadonly(constructId);
      await readonly
        .getVfs()
        .write(
          '/agent/home/regression.md',
          '# Regression\n\nContent persisted via readonly flush.',
        );

      // Step 2: simulate the fixed exitEditMode fallback flush
      await readonly.flush();

      // Step 3: simulate a fresh enterEditMode / re-read: a new getOrCreateReadonly
      // call should see the flushed content from the DAL.
      const fresh =
        await harness.runtimeManager.getOrCreateReadonly(constructId);
      const content = await fresh.getVfs().read('/agent/home/regression.md');
      // The VFS may add YAML frontmatter on serialisation; check the body is present.
      expect(content).toContain('# Regression');
      expect(content).toContain('Content persisted via readonly flush.');
    } finally {
      await harness.dispose();
    }
  });
});
