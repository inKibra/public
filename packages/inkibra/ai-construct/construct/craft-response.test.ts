import { describe, expect, test } from 'bun:test';
import { createOverlayFs } from '@inkibra/ai-flow';
import { checkLanePermission } from './craft-response';

describe('checkLanePermission', () => {
  test('defaults to same-lane only when no lanes config exists', async () => {
    const vfs = createOverlayFs();

    await expect(
      checkLanePermission(vfs, 'conversation', 'conversation'),
    ).resolves.toBe(true);
    await expect(
      checkLanePermission(vfs, 'conversation', 'heartbeat'),
    ).resolves.toBe(false);
  });

  test('allows only declared cross-lane targets', async () => {
    const vfs = createOverlayFs();
    await vfs.write(
      '/developer/config/lanes.yaml',
      [
        'conversation: {}',
        'heartbeat:',
        '  can_respond_to:',
        '    - conversation',
      ].join('\n'),
    );

    await expect(
      checkLanePermission(vfs, 'heartbeat', 'heartbeat'),
    ).resolves.toBe(true);
    await expect(
      checkLanePermission(vfs, 'heartbeat', 'conversation'),
    ).resolves.toBe(true);
    await expect(
      checkLanePermission(vfs, 'conversation', 'heartbeat'),
    ).resolves.toBe(false);
    await expect(
      checkLanePermission(vfs, 'heartbeat', 'workspace:frontend'),
    ).resolves.toBe(false);
  });
});
