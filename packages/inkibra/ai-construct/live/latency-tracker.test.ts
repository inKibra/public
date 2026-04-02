import { beforeEach, describe, expect, test } from 'bun:test';
import {
  getConstructLatencyStoreSnapshot,
  noteConstructLatencyChatAccepted,
  noteConstructLatencyChatSubmit,
  noteConstructLatencyProjectionRender,
  noteConstructLatencyStreamEvent,
  resetConstructLatencyStore,
} from './latency-tracker';

describe('construct latency tracker', () => {
  beforeEach(() => {
    resetConstructLatencyStore();
  });

  test('tracks stream and render milestones for a chat trace', () => {
    noteConstructLatencyChatSubmit({
      constructId: 'construct-1',
      pendingId: 'pending-1',
      message: 'hello world',
    });
    noteConstructLatencyChatAccepted({
      pendingId: 'pending-1',
      message: 'hello world',
      factId: 'fact-1',
      opId: 'fact-1',
      queuedAt: '2026-03-15T22:00:00.000Z',
    });
    noteConstructLatencyStreamEvent({
      type: 'sourceFactLifecycle',
      event: {
        constructId: 'construct-1',
        factId: 'fact-1',
        factType: 'user_message',
        phase: 'queued',
        ts: '2026-03-15T22:00:00.000Z',
        previewText: 'hello world',
        queueRef: 'cursor-1',
      },
    });
    noteConstructLatencyStreamEvent({
      type: 'constructEvent',
      event: {
        constructId: 'construct-1',
        instanceKind: 'draft',
        instanceId: 'persona-1',
        ts: '2026-03-15T22:00:01.000Z',
        event: {
          type: 'impulse:started',
          impulseId: 'impulse-1',
          perception: {
            type: 'USER_MESSAGE',
            messages: [{ content: 'hello world', timestamp: new Date() }],
            receivedAt: new Date(),
          },
        },
      },
    });
    noteConstructLatencyStreamEvent({
      type: 'constructEvent',
      event: {
        constructId: 'construct-1',
        instanceKind: 'draft',
        instanceId: 'persona-1',
        ts: '2026-03-15T22:00:02.000Z',
        event: {
          type: 'response:scheduled',
          responseId: 'response-1',
          scheduledBy: 'impulse-1',
          intent: 'ack',
          urgency: 'normal',
        },
      },
    });

    noteConstructLatencyProjectionRender({
      cursor: undefined,
      constructSnapshot: {
        transcript: [
          {
            id: 'fact-1',
            factId: 'fact-1',
            role: 'user',
            content: 'hello world',
            createdAt: '2026-03-15T22:00:00.000Z',
            queuedAt: '2026-03-15T22:00:00.000Z',
            deliveryState: 'seen',
            kind: 'chat',
          },
          {
            id: 'response-1:delivered:1',
            role: 'assistant',
            content: 'hi',
            createdAt: '2026-03-15T22:00:10.000Z',
            kind: 'chat',
          },
        ],
        frontier: {},
        hypno: {
          active: false,
          stage: 'idle',
          pendingPlan: false,
          acceptRequiresConfirmation: false,
          updatedAt: '2026-03-15T22:00:00.000Z',
        },
        queuedNextNapPins: [],
        queuedNextNapImprints: [],
        toolLog: [],
        decisionLog: [],
        runtimeState: {
          activeImpulses: 0,
          scheduledResponses: 0,
          activeResponses: 0,
          schedulerBusy: false,
        },
      },
      runtimeSnapshot: {
        runtimeState: {
          activeImpulses: 0,
          scheduledResponses: 0,
          activeResponses: 0,
          schedulerBusy: false,
        },
        residency: { awake: false, status: 'idle' },
        impulses: [],
        sourceFacts: [],
        scheduledResponses: [],
        decisions: [],
        toolLog: [],
      },
      liveResponseHistories: [
        {
          responseId: 'response-1',
          status: 'delivered',
          createdAt: '2026-03-15T22:00:02.000Z',
          updatedAt: '2026-03-15T22:00:10.000Z',
          attempts: [],
        },
      ],
      liveDecisionEntries: [],
      inFlightItems: [],
      scheduledResponsesForView: [],
      liveImpulseThinkingById: {},
      commandInFlight: false,
      defaultSelectedResponseId: undefined,
      ingressIssue: undefined,
    });

    const snapshot = getConstructLatencyStoreSnapshot();
    const trace = snapshot.tracesById['pending-1'];

    expect(trace).toBeDefined();
    if (!trace) {
      throw new Error('expected pending-1 trace to exist');
    }
    expect(trace.factIds).toContain('fact-1');
    expect(trace.impulseIds).toContain('impulse-1');
    expect(trace.responseIds).toContain('response-1');
    expect(trace.pointPhases['client:chat-submit']).toBeDefined();
    expect(trace.pointPhases['event:source-fact-queued']).toBeDefined();
    expect(trace.pointPhases['event:response-scheduled']).toBeDefined();
    expect(trace.pointPhases['render:user-message']).toBeDefined();
    expect(trace.pointPhases['render:user-delivery-seen']).toBeDefined();
    expect(trace.pointPhases['render:assistant-message']).toBeDefined();
    expect(trace.pointPhases['render:in-flight-cleared']).toBeDefined();
  });
});
