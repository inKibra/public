import { describe, expect, test } from 'bun:test';
import { stub } from '@inkibra/test-support/stub';
import type { Construct } from '../construct/construct';
import {
  buildConstructLabActionOp,
  normalizeContextPath,
} from './lab-action-ops';
import {
  createConstructLabCommandLockManager,
  isConstructLabExclusiveCommand,
  isConstructLabPerceptionAction,
  toConstructLabCommandAction,
  validateConstructLabExclusiveCommand,
} from './lab-command-lock';
import { listRecentConstructLogNodes } from './lab-snapshot-builders';
import type { ConstructLabAction, ConstructSnapshotNode } from './types';

// ---------------------------------------------------------------------------
// normalizeContextPath
// ---------------------------------------------------------------------------

describe('normalizeContextPath', () => {
  test('already prefixed passes through', () => {
    expect(normalizeContextPath('/agent/home/persona.md')).toBe(
      '/agent/home/persona.md',
    );
  });

  test('leading slash gets /agent/home prefix', () => {
    expect(normalizeContextPath('/core/persona.md')).toBe(
      '/agent/home/core/persona.md',
    );
  });

  test('bare path gets /agent/home/ prefix', () => {
    expect(normalizeContextPath('core/persona.md')).toBe(
      '/agent/home/core/persona.md',
    );
  });

  test('trims whitespace', () => {
    expect(normalizeContextPath('  /context/foo.md  ')).toBe(
      '/agent/home/context/foo.md',
    );
  });
});

// ---------------------------------------------------------------------------
// Action classification
// ---------------------------------------------------------------------------

describe('action classification', () => {
  test('chat is perception-lane', () => {
    const action: ConstructLabAction = {
      action: 'chat',
      message: 'hello',
      lane: 'conversation',
    };
    expect(isConstructLabPerceptionAction(action)).toBe(true);
    expect(isConstructLabExclusiveCommand(action)).toBe(false);
  });

  test('rate is perception-lane', () => {
    const action: ConstructLabAction = {
      action: 'rate',
      rating: 'helpful',
      lane: 'conversation',
    };
    expect(isConstructLabPerceptionAction(action)).toBe(true);
  });

  test('steer is perception-lane', () => {
    const action: ConstructLabAction = {
      action: 'steer',
      directive: 'be nicer',
      lane: 'conversation',
    };
    expect(isConstructLabPerceptionAction(action)).toBe(true);
  });

  test('nap is exclusive command', () => {
    const action: ConstructLabAction = { action: 'nap' };
    expect(isConstructLabExclusiveCommand(action)).toBe(true);
    expect(isConstructLabPerceptionAction(action)).toBe(false);
  });

  test('startHypno is exclusive command', () => {
    const action: ConstructLabAction = { action: 'startHypno' };
    expect(isConstructLabExclusiveCommand(action)).toBe(true);
  });

  test('toConstructLabCommandAction maps correctly', () => {
    expect(toConstructLabCommandAction({ action: 'nap' })).toBe('nap');
    expect(toConstructLabCommandAction({ action: 'startHypno' })).toBe(
      'startHypno',
    );
    expect(toConstructLabCommandAction({ action: 'cancelHypno' })).toBe(
      'cancelHypno',
    );
  });
});

// ---------------------------------------------------------------------------
// Command lock manager
// ---------------------------------------------------------------------------

describe('command lock manager', () => {
  test('first acquire succeeds', () => {
    const manager = createConstructLabCommandLockManager();
    const result = manager.tryAcquire('construct-1', 'nap');
    expect(result.acquired).toBe(true);
  });

  test('duplicate acquire returns CommandDuplicate', () => {
    const manager = createConstructLabCommandLockManager();
    const first = manager.tryAcquire('construct-1', 'nap');
    expect(first.acquired).toBe(true);

    const second = manager.tryAcquire('construct-1', 'nap');
    expect(second.acquired).toBe(false);
    if (!second.acquired) {
      expect(second.reason).toBe('CommandDuplicate');
    }
  });

  test('different command acquire returns CommandBusy', () => {
    const manager = createConstructLabCommandLockManager();
    const first = manager.tryAcquire('construct-1', 'nap');
    expect(first.acquired).toBe(true);

    const second = manager.tryAcquire('construct-1', 'startHypno');
    expect(second.acquired).toBe(false);
    if (!second.acquired) {
      expect(second.reason).toBe('CommandBusy');
      expect(second.activeCommand).toBe('nap');
    }
  });

  test('release allows re-acquire', () => {
    const manager = createConstructLabCommandLockManager();
    const first = manager.tryAcquire('construct-1', 'nap');
    expect(first.acquired).toBe(true);
    if (first.acquired) {
      first.release();
    }

    const second = manager.tryAcquire('construct-1', 'startHypno');
    expect(second.acquired).toBe(true);
  });

  test('different constructs are independent', () => {
    const manager = createConstructLabCommandLockManager();
    const first = manager.tryAcquire('construct-1', 'nap');
    expect(first.acquired).toBe(true);

    const second = manager.tryAcquire('construct-2', 'nap');
    expect(second.acquired).toBe(true);
  });

  test('get returns current lock', () => {
    const manager = createConstructLabCommandLockManager();
    expect(manager.get('construct-1')).toBeUndefined();

    const result = manager.tryAcquire('construct-1', 'nap');
    expect(result.acquired).toBe(true);
    expect(manager.get('construct-1')?.action).toBe('nap');

    if (result.acquired) {
      result.release();
    }
    expect(manager.get('construct-1')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// validateConstructLabExclusiveCommand
// ---------------------------------------------------------------------------

describe('validateConstructLabExclusiveCommand', () => {
  function mockConstruct(hypnoActive: boolean) {
    return stub<Construct>({
      isHypnoActive: () => hypnoActive,
    });
  }

  test('nap is valid when no hypno active', () => {
    const result = validateConstructLabExclusiveCommand(
      mockConstruct(false),
      'nap',
    );
    expect(result.ok).toBe(true);
  });

  test('nap is invalid when hypno is active', () => {
    const result = validateConstructLabExclusiveCommand(
      mockConstruct(true),
      'nap',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('CommandInvalidState');
    }
  });

  test('startHypno is invalid when hypno already active', () => {
    const result = validateConstructLabExclusiveCommand(
      mockConstruct(true),
      'startHypno',
    );
    expect(result.ok).toBe(false);
  });

  test('acceptHypno is invalid when no active hypno', () => {
    const result = validateConstructLabExclusiveCommand(
      mockConstruct(false),
      'acceptHypno',
    );
    expect(result.ok).toBe(false);
  });

  test('acceptHypno is valid when hypno is active', () => {
    const result = validateConstructLabExclusiveCommand(
      mockConstruct(true),
      'acceptHypno',
    );
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildConstructLabActionOp
// ---------------------------------------------------------------------------

describe('buildConstructLabActionOp', () => {
  test('chat maps to user_message op', () => {
    const op = buildConstructLabActionOp('c1', {
      action: 'chat',
      message: 'hello',
      lane: 'agent:frontend',
    });
    expect(op.kind).toBe('user_message');
    if (op.kind === 'user_message') {
      expect(op.payload.content).toBe('hello');
      expect(op.payload.lane).toBe('agent:frontend');
    }
    expect(op.opId).toMatch(/^partner-lab:c1:/);
  });

  test('nap maps to run_nap op', () => {
    const op = buildConstructLabActionOp('c1', { action: 'nap' });
    expect(op.kind).toBe('run_nap');
  });

  test('rate helpful maps to good rating', () => {
    const op = buildConstructLabActionOp('c1', {
      action: 'rate',
      rating: 'helpful',
      annotation: 'great answer',
      lane: 'conversation',
    });
    expect(op.kind).toBe('rate_response');
    if (op.kind === 'rate_response') {
      expect(op.payload.rating).toBe('good');
      expect(op.payload.annotation).toBe('great answer');
      expect(op.payload.lane).toBe('conversation');
    }
  });

  test('rate unhelpful maps to bad rating', () => {
    const op = buildConstructLabActionOp('c1', {
      action: 'rate',
      rating: 'unhelpful',
      lane: 'conversation',
    });
    if (op.kind === 'rate_response') {
      expect(op.payload.rating).toBe('bad');
      expect(op.payload.lane).toBe('conversation');
    }
  });

  test('steer maps to steer_directive op', () => {
    const op = buildConstructLabActionOp('c1', {
      action: 'steer',
      directive: 'be concise',
      lane: 'conversation',
    });
    expect(op.kind).toBe('steer_directive');
    if (op.kind === 'steer_directive') {
      expect(op.payload.directive).toBe('be concise');
      expect(op.payload.lane).toBe('conversation');
    }
  });

  test('queueNextNapPin normalizes the path', () => {
    const op = buildConstructLabActionOp('c1', {
      action: 'queueNextNapPin',
      path: 'core/persona.md',
    });
    expect(op.kind).toBe('next_nap_pin');
    if (op.kind === 'next_nap_pin') {
      expect(op.payload.path).toBe('/agent/home/core/persona.md');
    }
  });
});

// ---------------------------------------------------------------------------
// listRecentConstructLogNodes
// ---------------------------------------------------------------------------

describe('listRecentConstructLogNodes', () => {
  const nodes: ConstructSnapshotNode[] = [
    {
      path: '/logs/conversation/2026/W10/2026-03-05-0.log',
      kind: 'file',
      content: 'log1',
      sizeBytes: 4,
      modified: '2026-03-05',
    },
    {
      path: '/logs/conversation/2026/W09/2026-02-26-0.log',
      kind: 'file',
      content: 'log2',
      sizeBytes: 4,
      modified: '2026-02-26',
    },
    {
      path: '/logs/conversation/2026/W08/2026-02-19-0.log',
      kind: 'file',
      content: 'log3',
      sizeBytes: 4,
      modified: '2026-02-19',
    },
    {
      path: '/logs/feedback/2026/W10/2026-03-05-0.log',
      kind: 'file',
      content: 'feedback',
      sizeBytes: 8,
      modified: '2026-03-05',
    },
    {
      path: '/agent/home/persona.md',
      kind: 'file',
      content: 'not a log',
      sizeBytes: 10,
      modified: '2026-03-01',
    },
    {
      path: '/logs/conversation',
      kind: 'directory',
      content: '',
      sizeBytes: 0,
      modified: '2026-03-05',
    },
  ];

  test('returns only .log files under baseDir', () => {
    const result = listRecentConstructLogNodes(nodes, '/logs/conversation', 10);
    expect(result).toHaveLength(3);
    expect(result.every((n) => n.path.startsWith('/logs/conversation/'))).toBe(
      true,
    );
  });

  test('respects limit', () => {
    const result = listRecentConstructLogNodes(nodes, '/logs/conversation', 2);
    expect(result).toHaveLength(2);
  });

  test('returns newest first', () => {
    const result = listRecentConstructLogNodes(nodes, '/logs/conversation', 10);
    expect(result[0]!.path).toContain('W10');
    expect(result[2]!.path).toContain('W08');
  });

  test('feedback baseDir returns only feedback logs', () => {
    const result = listRecentConstructLogNodes(nodes, '/logs/feedback', 10);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe('feedback');
  });

  test('empty for non-matching baseDir', () => {
    const result = listRecentConstructLogNodes(nodes, '/logs/steering', 10);
    expect(result).toHaveLength(0);
  });
});
