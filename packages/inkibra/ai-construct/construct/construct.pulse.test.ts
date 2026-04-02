import { describe, expect, test } from 'bun:test';
import {
  createAiFlowScenario,
  createAiFlowTestDeps,
} from '@inkibra/ai-flow/testing';
import { createTestDriver } from '@inkibra/dal-connection/create-driver';
import initLogger from '@inkibra/logger';
import { DEFAULT_IMPULSE_PROFILES } from '../impulse/keys';
import { loadHeartbeatMeta } from '../vfs/heartbeat';
import { createConstruct } from './construct';
import { createDalStorage } from './storage';
import { DEFAULT_CONSTRUCT_LANES } from './types';

describe('construct pulse', () => {
  test('updates explicit pulse metadata without exposing any AI tool path', async () => {
    const driver = await createTestDriver();
    const logger = initLogger('construct-pulse');
    const { deps } = createAiFlowTestDeps({
      logger,
      scenario: createAiFlowScenario({ stream: [], strict: false }),
    });

    try {
      const construct = await createConstruct({
        id: 'construct-pulse-1',
        storage: createDalStorage({ driver, logger }),
        deps,
        impulseProfiles: DEFAULT_IMPULSE_PROFILES,
        computerConfig: {},
        lanes: DEFAULT_CONSTRUCT_LANES,
      });

      const pulseAt = new Date('2026-03-30T12:00:00.000Z');
      await construct.pulse({ source: 'developer', at: pulseAt });

      const heartbeatMeta = await loadHeartbeatMeta(construct.getVfs());
      expect(heartbeatMeta.last_pulse_at).toBe(pulseAt.toISOString());
      expect(heartbeatMeta.last_pulse_source).toBe('developer');
    } finally {
      await driver.disconnect();
    }
  });
});
