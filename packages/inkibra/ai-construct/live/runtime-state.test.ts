import { describe, expect, test } from 'bun:test';
import {
  appendConstructLiveImpulseDelta,
  formatConstructPerceptionSummary,
  pruneConstructLiveDecisionEntries,
  pruneConstructLiveImpulses,
  pruneConstructLiveImpulseThinking,
} from './runtime-state';

describe('ai-construct live runtime-state helpers', () => {
  test('appends and truncates impulse thinking deltas', () => {
    const next = appendConstructLiveImpulseDelta({}, 'impulse-1', 'hello');
    expect(next['impulse-1']).toBe('hello');
  });

  test('prunes non-running impulses and orphan thinking', () => {
    const impulses = pruneConstructLiveImpulses(
      {
        'impulse-1': {
          id: 'impulse-1',
          pool: 'conversation',
          profile: 'runtime',
          status: 'running',
          summary: 'running',
          startedAt: '2026-03-13T18:00:00.000Z',
          updatedAt: '2026-03-13T18:00:01.000Z',
          thinking: 'active',
        },
        'impulse-2': {
          id: 'impulse-2',
          pool: 'conversation',
          profile: 'runtime',
          status: 'completed',
          summary: 'done',
          startedAt: '2026-03-13T18:00:00.000Z',
          updatedAt: '2026-03-13T18:00:01.000Z',
        },
      },
      '2026-03-13T18:00:02.000Z',
    );

    expect(Object.keys(impulses)).toEqual(['impulse-1']);
    expect(
      pruneConstructLiveImpulseThinking(
        { 'impulse-1': 'keep', 'impulse-2': 'drop' },
        impulses,
      ),
    ).toEqual({ 'impulse-1': 'keep' });
  });

  test('keeps only live decision entries', () => {
    const next = pruneConstructLiveDecisionEntries(
      [
        {
          id: 'd1',
          responseId: 'r1',
          stage: 'response/decide',
          text: 'live',
          status: 'running',
          state: 'live',
          createdAt: '2026-03-13T18:00:00.000Z',
          updatedAt: '2026-03-13T18:00:00.000Z',
        },
        {
          id: 'd2',
          responseId: 'r2',
          stage: 'response/decide',
          text: 'old',
          status: 'decided',
          state: 'cooldown',
          createdAt: '2026-03-13T18:00:00.000Z',
          updatedAt: '2026-03-13T18:00:00.000Z',
        },
      ],
      '2026-03-13T18:00:01.000Z',
    );

    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe('d1');
  });

  test('formats user-message perception summaries', () => {
    expect(
      formatConstructPerceptionSummary({
        type: 'USER_MESSAGE',
        messages: [{ content: 'hello there from a runtime event' }],
      }),
    ).toContain('hello there');
  });
});
