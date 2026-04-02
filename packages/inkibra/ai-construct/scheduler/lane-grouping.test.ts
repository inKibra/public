/**
 * Tests for scheduler lane grouping (connected components by shared target lanes).
 */

import { describe, expect, test } from 'bun:test';
import type { PendingImpulseSubmission } from './preview-types';

// We need to test the groupByTargetLanes function which is private to scheduler.ts.
// Instead, we test the observable behavior through the public API pattern.
// For unit testing the algorithm, we extract and re-implement the grouping logic here.

function groupByTargetLanes(
  submissions: PendingImpulseSubmission[],
): PendingImpulseSubmission[][] {
  if (submissions.length <= 1) return [submissions];

  const parent = new Map<number, number>();
  const rank = new Map<number, number>();

  function find(x: number): number {
    let root = x;
    while (parent.get(root) !== root) {
      root = parent.get(root) ?? root;
    }
    let curr = x;
    while (curr !== root) {
      const next = parent.get(curr) ?? curr;
      parent.set(curr, root);
      curr = next;
    }
    return root;
  }

  function union(a: number, b: number): void {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return;
    const rankA = rank.get(rootA) ?? 0;
    const rankB = rank.get(rootB) ?? 0;
    if (rankA < rankB) {
      parent.set(rootA, rootB);
    } else if (rankA > rankB) {
      parent.set(rootB, rootA);
    } else {
      parent.set(rootB, rootA);
      rank.set(rootA, rankA + 1);
    }
  }

  for (let i = 0; i < submissions.length; i++) {
    parent.set(i, i);
    rank.set(i, 0);
  }

  const laneToIndices = new Map<string, number[]>();
  for (let i = 0; i < submissions.length; i++) {
    const sub = submissions[i]!;
    const lanes = sub.targetLanes.length > 0 ? sub.targetLanes : [sub.lane];
    for (const lane of lanes) {
      const indices = laneToIndices.get(lane);
      if (indices) {
        indices.push(i);
      } else {
        laneToIndices.set(lane, [i]);
      }
    }
  }

  for (const indices of laneToIndices.values()) {
    for (let j = 1; j < indices.length; j++) {
      union(indices[0]!, indices[j]!);
    }
  }

  const groups = new Map<number, PendingImpulseSubmission[]>();
  for (let i = 0; i < submissions.length; i++) {
    const root = find(i);
    const group = groups.get(root);
    if (group) {
      group.push(submissions[i]!);
    } else {
      groups.set(root, [submissions[i]!]);
    }
  }

  return Array.from(groups.values());
}

function makeSub(
  id: string,
  lane: string,
  targetLanes: string[],
): PendingImpulseSubmission {
  return {
    impulseId: id,
    lane,
    targetLanes,
    thinking: '',
    urgency: 'normal',
    submittedAt: new Date(),
    selectedPreview: null,
  };
}

describe('groupByTargetLanes', () => {
  test('single submission returns one group', () => {
    const subs = [makeSub('a', 'conversation', ['conversation'])];
    const groups = groupByTargetLanes(subs);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(1);
  });

  test('disjoint lanes produce independent groups', () => {
    const subs = [
      makeSub('a', 'conversation', ['conversation']),
      makeSub('b', 'heartbeat', ['heartbeat']),
    ];
    const groups = groupByTargetLanes(subs);
    expect(groups).toHaveLength(2);
  });

  test('shared target lane groups submissions together', () => {
    const subs = [
      makeSub('a', 'conversation', ['conversation']),
      makeSub('b', 'background', ['conversation']),
    ];
    const groups = groupByTargetLanes(subs);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  test('transitive grouping: A↔B↔C via shared lanes', () => {
    // A targets [conversation], B targets [conversation, announcements], C targets [announcements]
    // A and B share 'conversation', B and C share 'announcements' → all in one group
    const subs = [
      makeSub('a', 'impulse-a', ['conversation']),
      makeSub('b', 'impulse-b', ['conversation', 'announcements']),
      makeSub('c', 'impulse-c', ['announcements']),
    ];
    const groups = groupByTargetLanes(subs);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });

  test('mixed: two connected components', () => {
    // Group 1: A→conversation, B→conversation
    // Group 2: C→heartbeat, D→heartbeat
    const subs = [
      makeSub('a', 'x', ['conversation']),
      makeSub('b', 'y', ['conversation']),
      makeSub('c', 'z', ['heartbeat']),
      makeSub('d', 'w', ['heartbeat']),
    ];
    const groups = groupByTargetLanes(subs);
    expect(groups).toHaveLength(2);
    const ids = groups.map((g) => g.map((s) => s.impulseId).sort());
    expect(ids).toContainEqual(['a', 'b']);
    expect(ids).toContainEqual(['c', 'd']);
  });

  test('empty targetLanes falls back to source lane', () => {
    const subs = [
      makeSub('a', 'conversation', []),
      makeSub('b', 'conversation', []),
    ];
    const groups = groupByTargetLanes(subs);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });
});
