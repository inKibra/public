import { describe, expect, test } from 'bun:test';
import { stub } from '@inkibra/test-support/stub';
import type { ConstructEvent } from '../construct/types';
import {
  createConstructLiveEventState,
  reduceConstructEvent,
} from './event-reducer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const T0 = '2026-03-15T18:00:00.000Z';
const T1 = '2026-03-15T18:00:01.000Z';
const T2 = '2026-03-15T18:00:02.000Z';
const T3 = '2026-03-15T18:00:03.000Z';

function reduce(...events: Array<{ type: string } & Record<string, unknown>>) {
  let state = createConstructLiveEventState();
  for (const [i, event] of events.entries()) {
    const ts = [T0, T1, T2, T3][i] ?? T3;
    state = reduceConstructEvent(state, event as ConstructEvent, ts);
  }
  return state;
}

// ---------------------------------------------------------------------------
// nap:started
// ---------------------------------------------------------------------------

describe('nap:started', () => {
  test('clears liveNapToolLogEntries', () => {
    // Seed some tool entries first via nap:tool
    let state = createConstructLiveEventState();
    state = reduceConstructEvent(
      state,
      stub<ConstructEvent>({
        type: 'nap:tool',
        command: 'ls',
        output: 'file.md',
      }),
      T0,
    );
    expect(state.liveNapToolLogEntries).toHaveLength(1);

    state = reduceConstructEvent(
      state,
      stub<ConstructEvent>({ type: 'nap:started' }),
      T1,
    );
    expect(state.liveNapToolLogEntries).toHaveLength(0);
  });

  test('sets commandInFlight', () => {
    const state = reduce({ type: 'nap:started' });
    expect(state.commandInFlight).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// nap:tool
// ---------------------------------------------------------------------------

describe('nap:tool', () => {
  test('accumulates entries with correct shape', () => {
    const state = reduce(
      { type: 'nap:started' },
      { type: 'nap:tool', command: 'read /context/USER.md', output: '# User' },
    );
    expect(state.liveNapToolLogEntries).toHaveLength(1);
    const entry = state.liveNapToolLogEntries[0];
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      tool: 'nap',
      command: 'read /context/USER.md',
      output: '# User',
    });
    expect(typeof entry!.id).toBe('string');
    expect(typeof entry!.createdAt).toBe('string');
  });

  test('accumulates multiple entries in order', () => {
    let state = createConstructLiveEventState();
    state = reduceConstructEvent(
      state,
      stub<ConstructEvent>({ type: 'nap:started' }),
      T0,
    );
    state = reduceConstructEvent(
      state,
      stub<ConstructEvent>({
        type: 'nap:tool',
        command: 'cmd1',
        output: 'out1',
      }),
      T1,
    );
    state = reduceConstructEvent(
      state,
      stub<ConstructEvent>({
        type: 'nap:tool',
        command: 'cmd2',
        output: 'out2',
      }),
      T2,
    );
    expect(state.liveNapToolLogEntries).toHaveLength(2);
    expect(state.liveNapToolLogEntries[0]?.command).toBe('cmd1');
    expect(state.liveNapToolLogEntries[1]?.command).toBe('cmd2');
  });

  test('uses empty strings when command/output missing', () => {
    const state = reduce({ type: 'nap:tool' });
    expect(state.liveNapToolLogEntries[0]?.command).toBe('');
    expect(state.liveNapToolLogEntries[0]?.output).toBe('');
  });
});

// ---------------------------------------------------------------------------
// hypno:started
// ---------------------------------------------------------------------------

describe('hypno:started', () => {
  test('sets initial liveHypno with active=true, stage=idle', () => {
    const state = reduce({ type: 'hypno:started' });
    expect(state.liveHypno).toMatchObject({
      active: true,
      stage: 'idle',
      pendingPlan: false,
      acceptRequiresConfirmation: false,
      lastReviewReply: undefined,
    });
    expect(state.liveHypno?.updatedAt).toBe(T0);
  });

  test('clears liveNapToolLogEntries', () => {
    let state = createConstructLiveEventState();
    state = reduceConstructEvent(
      state,
      stub<ConstructEvent>({ type: 'nap:tool', command: 'ls', output: 'x' }),
      T0,
    );
    state = reduceConstructEvent(
      state,
      stub<ConstructEvent>({ type: 'hypno:started' }),
      T1,
    );
    expect(state.liveNapToolLogEntries).toHaveLength(0);
  });

  test('sets commandInFlight', () => {
    const state = reduce({ type: 'hypno:started' });
    expect(state.commandInFlight).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hypno:stage-change
// ---------------------------------------------------------------------------

describe('hypno:stage-change', () => {
  test('maps analyze stage', () => {
    const state = reduce(
      { type: 'hypno:started' },
      { type: 'hypno:stage-change', stage: 'analyze' },
    );
    expect(state.liveHypno?.stage).toBe('analyze');
    expect(state.liveHypno?.active).toBe(true);
  });

  test('maps propose stage', () => {
    const state = reduce(
      { type: 'hypno:started' },
      { type: 'hypno:stage-change', stage: 'propose' },
    );
    expect(state.liveHypno?.stage).toBe('propose');
  });

  test('maps commit stage', () => {
    const state = reduce(
      { type: 'hypno:started' },
      { type: 'hypno:stage-change', stage: 'commit' },
    );
    expect(state.liveHypno?.stage).toBe('commit');
  });

  test('maps unknown stage to review', () => {
    const state = reduce(
      { type: 'hypno:started' },
      { type: 'hypno:stage-change', stage: 'some-unknown-stage' },
    );
    expect(state.liveHypno?.stage).toBe('review');
  });

  test('updates updatedAt timestamp', () => {
    const state = reduce(
      { type: 'hypno:started' },
      { type: 'hypno:stage-change', stage: 'analyze' },
    );
    // T1 is the timestamp for the second event
    expect(state.liveHypno?.updatedAt).toBe(T1);
  });

  test('preserves other fields from existing liveHypno', () => {
    let state = createConstructLiveEventState();
    state = reduceConstructEvent(
      state,
      stub<ConstructEvent>({ type: 'hypno:started' }),
      T0,
    );
    state = reduceConstructEvent(
      state,
      stub<ConstructEvent>({ type: 'hypno:plan-updated' }),
      T1,
    );
    state = reduceConstructEvent(
      state,
      stub<ConstructEvent>({ type: 'hypno:stage-change', stage: 'commit' }),
      T2,
    );
    // pendingPlan and acceptRequiresConfirmation set by plan-updated should survive
    expect(state.liveHypno?.pendingPlan).toBe(true);
    expect(state.liveHypno?.acceptRequiresConfirmation).toBe(true);
    expect(state.liveHypno?.stage).toBe('commit');
  });
});

// ---------------------------------------------------------------------------
// hypno:review-reply
// ---------------------------------------------------------------------------

describe('hypno:review-reply', () => {
  test('patches lastReviewReply without clobbering other fields', () => {
    let state = createConstructLiveEventState();
    state = reduceConstructEvent(
      state,
      stub<ConstructEvent>({ type: 'hypno:started' }),
      T0,
    );
    state = reduceConstructEvent(
      state,
      stub<ConstructEvent>({ type: 'hypno:stage-change', stage: 'propose' }),
      T1,
    );
    state = reduceConstructEvent(
      state,
      stub<ConstructEvent>({ type: 'hypno:review-reply', reply: 'Looks good' }),
      T2,
    );
    expect(state.liveHypno?.lastReviewReply).toBe('Looks good');
    // Other fields survive
    expect(state.liveHypno?.active).toBe(true);
    expect(state.liveHypno?.stage).toBe('propose');
  });

  test('uses empty string when reply is missing', () => {
    const state = reduce({ type: 'hypno:review-reply' });
    expect(state.liveHypno?.lastReviewReply).toBe('');
  });
});

// ---------------------------------------------------------------------------
// hypno:plan-updated
// ---------------------------------------------------------------------------

describe('hypno:plan-updated', () => {
  test('sets pendingPlan=true and acceptRequiresConfirmation=true', () => {
    const state = reduce(
      { type: 'hypno:started' },
      { type: 'hypno:plan-updated' },
    );
    expect(state.liveHypno?.pendingPlan).toBe(true);
    expect(state.liveHypno?.acceptRequiresConfirmation).toBe(true);
  });

  test('preserves active and stage from prior state', () => {
    let state = createConstructLiveEventState();
    state = reduceConstructEvent(
      state,
      stub<ConstructEvent>({ type: 'hypno:started' }),
      T0,
    );
    state = reduceConstructEvent(
      state,
      stub<ConstructEvent>({ type: 'hypno:stage-change', stage: 'propose' }),
      T1,
    );
    state = reduceConstructEvent(
      state,
      stub<ConstructEvent>({ type: 'hypno:plan-updated' }),
      T2,
    );
    expect(state.liveHypno?.stage).toBe('propose');
    expect(state.liveHypno?.active).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hypno:completed
// ---------------------------------------------------------------------------

describe('hypno:completed', () => {
  test('sets active=false, stage=completed', () => {
    const state = reduce(
      { type: 'hypno:started' },
      { type: 'hypno:stage-change', stage: 'commit' },
      { type: 'hypno:completed' },
    );
    expect(state.liveHypno?.active).toBe(false);
    expect(state.liveHypno?.stage).toBe('completed');
  });

  test('clears commandInFlight', () => {
    const state = reduce(
      { type: 'hypno:started' },
      { type: 'hypno:completed' },
    );
    expect(state.commandInFlight).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hypno:cancelled and hypno:error
// ---------------------------------------------------------------------------

describe('hypno:cancelled', () => {
  test('sets active=false, stage=idle', () => {
    const state = reduce(
      { type: 'hypno:started' },
      { type: 'hypno:stage-change', stage: 'analyze' },
      { type: 'hypno:cancelled' },
    );
    expect(state.liveHypno?.active).toBe(false);
    expect(state.liveHypno?.stage).toBe('idle');
  });

  test('clears commandInFlight', () => {
    const state = reduce(
      { type: 'hypno:started' },
      { type: 'hypno:cancelled' },
    );
    expect(state.commandInFlight).toBe(false);
  });
});

describe('hypno:error', () => {
  test('sets active=false, stage=idle', () => {
    const state = reduce(
      { type: 'hypno:started' },
      { type: 'hypno:stage-change', stage: 'analyze' },
      { type: 'hypno:error' },
    );
    expect(state.liveHypno?.active).toBe(false);
    expect(state.liveHypno?.stage).toBe('idle');
  });

  test('clears commandInFlight', () => {
    const state = reduce({ type: 'hypno:started' }, { type: 'hypno:error' });
    expect(state.commandInFlight).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// nap:completed / nap:cancelled commandInFlight
// ---------------------------------------------------------------------------

describe('nap:completed', () => {
  test('clears commandInFlight', () => {
    const state = reduce({ type: 'nap:started' }, { type: 'nap:completed' });
    expect(state.commandInFlight).toBe(false);
  });
});

describe('nap:cancelled', () => {
  test('clears commandInFlight', () => {
    const state = reduce({ type: 'nap:started' }, { type: 'nap:cancelled' });
    expect(state.commandInFlight).toBe(false);
  });
});
