import { describe, expect, test } from 'bun:test';

/**
 * Regression test for bug #9: scheduleIdleFlush drops shorter retries
 * when a longer timer is already pending.
 *
 * This tests the scheduling logic in isolation by simulating the same
 * debounce/replace pattern used in construct.ts.
 */

type ScheduleState = {
  fireAt: number;
  timer?: ReturnType<typeof setTimeout>;
  flushCount: number;
};

function createScheduler() {
  const state: ScheduleState = { fireAt: 0, flushCount: 0 };

  function schedule(delayMs: number): void {
    const now = Date.now();
    const newFireAt = now + delayMs;

    // This is the fixed logic from construct.ts:
    // Only skip if the pending timer fires sooner or at the same time.
    if (state.fireAt > 0 && state.fireAt <= newFireAt) {
      return;
    }

    clearTimeout(state.timer);
    state.fireAt = newFireAt;
    state.timer = setTimeout(() => {
      state.fireAt = 0;
      state.flushCount++;
    }, delayMs);
  }

  return { state, schedule };
}

describe('idle flush scheduling', () => {
  test('shorter delay replaces longer pending timer', async () => {
    const { state, schedule } = createScheduler();

    // Schedule a long retry (2000ms) — simulates error retry
    schedule(2000);
    expect(state.fireAt).toBeGreaterThan(0);
    const longFireAt = state.fireAt;

    // 50ms later, schedule a shorter flush (300ms) — simulates going idle
    await new Promise((r) => setTimeout(r, 50));
    schedule(300);

    // The fire-at should now be sooner than the original 2000ms timer
    expect(state.fireAt).toBeLessThan(longFireAt);
    expect(state.flushCount).toBe(0);

    // Wait for the shorter timer to fire
    await new Promise((r) => setTimeout(r, 350));
    expect(state.flushCount).toBe(1);
  });

  test('longer delay is dropped when shorter timer is already pending', async () => {
    const { state, schedule } = createScheduler();

    // Schedule a short flush (300ms)
    schedule(300);
    const shortFireAt = state.fireAt;

    // Try to schedule a longer one (2000ms) — should be dropped
    schedule(2000);
    expect(state.fireAt).toBe(shortFireAt);

    // Wait for the short timer
    await new Promise((r) => setTimeout(r, 350));
    expect(state.flushCount).toBe(1);
  });

  test('equal delay is dropped when already pending', async () => {
    const { state, schedule } = createScheduler();

    schedule(300);
    const firstFireAt = state.fireAt;

    // Same delay — should be treated as "already covered"
    schedule(300);
    expect(state.fireAt).toBe(firstFireAt);

    await new Promise((r) => setTimeout(r, 350));
    expect(state.flushCount).toBe(1);
  });

  test('schedule after timer fires works correctly', async () => {
    const { state, schedule } = createScheduler();

    schedule(50);
    await new Promise((r) => setTimeout(r, 100));
    expect(state.flushCount).toBe(1);
    expect(state.fireAt).toBe(0);

    // Schedule again after previous timer completed
    schedule(50);
    await new Promise((r) => setTimeout(r, 100));
    expect(state.flushCount).toBe(2);
  });
});
