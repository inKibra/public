import { beforeEach, describe, expect, test } from 'bun:test';
import {
  InMemoryWorkflowConcurrencyManager,
  type WorkflowConcurrencyManager,
} from './concurrency';

describe('workflow concurrency manager', () => {
  let manager: WorkflowConcurrencyManager;

  beforeEach(() => {
    manager = new InMemoryWorkflowConcurrencyManager();
  });

  test('acquires and releases a workflow scope', async () => {
    const lease = await manager.acquire(
      [{ kind: 'workflow', key: 'signup', maxActive: 1 }],
      30_000,
    );

    expect(lease).not.toBeNull();

    const blocked = await manager.acquire(
      [{ kind: 'workflow', key: 'signup', maxActive: 1 }],
      30_000,
    );

    expect(blocked).toBeNull();

    await lease?.release();

    const unblocked = await manager.acquire(
      [{ kind: 'workflow', key: 'signup', maxActive: 1 }],
      30_000,
    );

    expect(unblocked).not.toBeNull();
    await unblocked?.release();
  });

  test('rolls back multi-scope acquisition on contention', async () => {
    const first = await manager.acquire(
      [{ kind: 'resource', key: 'send-email', maxActive: 1 }],
      30_000,
    );
    expect(first).not.toBeNull();

    const blocked = await manager.acquire(
      [
        { kind: 'workflow', key: 'newsletter', maxActive: 2 },
        { kind: 'resource', key: 'send-email', maxActive: 1 },
      ],
      30_000,
    );
    expect(blocked).toBeNull();

    const workflowOnly = await manager.acquire(
      [{ kind: 'workflow', key: 'newsletter', maxActive: 2 }],
      30_000,
    );
    expect(workflowOnly).not.toBeNull();

    await workflowOnly?.release();
    await first?.release();
  });
});
