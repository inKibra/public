import { describe, expect, test } from 'bun:test';
import { createPgliteWorkflowStorageFixture } from './__tests__/fixtures/pglite-workflow-storage';

describe('dal workflow storage locking', () => {
  test('enforces executionId ownership for heartbeat and unlock', async () => {
    const fixture = await createPgliteWorkflowStorageFixture(
      'workflow-storage-locking-test',
    );

    try {
      const now = new Date().toISOString();
      await fixture.storage.saveInstance({
        id: 'instance-lock-1',
        workflowName: 'lock-test',
        version: '1.0.0',
        status: 'running',
        definitionKind: 'function',
        currentStage: '__function__',
        snapshot: {},
        eventTokens: [],
        contextData: {},
        created: now,
        modified: now,
      });

      const locked = await fixture.storage.lockInstance(
        'instance-lock-1',
        'exec-1',
        30_000,
      );
      expect(locked?.lock?.executionId).toBe('exec-1');

      const lockRetry = await fixture.storage.lockInstance(
        'instance-lock-1',
        'exec-2',
        30_000,
      );
      expect(lockRetry).toBeNull();

      const wrongHeartbeat = await fixture.storage.heartbeatLock(
        'instance-lock-1',
        'exec-2',
        60_000,
      );
      expect(wrongHeartbeat).toBe(false);

      const heartbeatOk = await fixture.storage.heartbeatLock(
        'instance-lock-1',
        'exec-1',
        60_000,
      );
      expect(heartbeatOk).toBe(true);

      await fixture.storage.unlockInstance('instance-lock-1', 'exec-2');
      const stillLocked = await fixture.storage.getInstance('instance-lock-1');
      expect(stillLocked?.lock?.executionId).toBe('exec-1');

      await fixture.storage.unlockInstance('instance-lock-1', 'exec-1');
      const unlocked = await fixture.storage.getInstance('instance-lock-1');
      expect(unlocked?.lock).toBeUndefined();
    } finally {
      await fixture.stop();
    }
  });
});
