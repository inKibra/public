import { describe, expect, test } from 'bun:test';
import { createTestDriver } from '@inkibra/dal-connection/create-driver';
import initLogger from '@inkibra/logger';
import { stub } from '@inkibra/test-support/stub';
import type OpenAI from 'openai';
import { DEFAULT_IMPULSE_PROFILES } from '../impulse/keys';
import { createDalContextPersistence } from '../vfs/context-persistence';
import { createConstruct } from './construct';
import { createDalStorage } from './storage';
import { DEFAULT_CONSTRUCT_LANES } from './types';

describe('construct persistence backends', () => {
  test('supports DAL-backed VFS persistence', async () => {
    const driver = await createTestDriver();
    const logger = initLogger('construct-dal-persistence-test');
    const constructId = 'construct-dal-backed-1';

    try {
      const construct = await createConstruct({
        id: constructId,
        storage: createDalStorage({
          driver,
          logger,
        }),
        deps: {
          openAI: stub<OpenAI>(),
          logger,
        },
        impulseProfiles: DEFAULT_IMPULSE_PROFILES,
        computerConfig: {},
        lanes: DEFAULT_CONSTRUCT_LANES,
      });

      const persistence = createDalContextPersistence({
        driver,
        logger,
        constructId,
      });

      const session = await persistence.load('/runtime/state/session.md');
      expect(session).not.toBeNull();

      construct.stop();
    } finally {
      await driver.disconnect();
    }
  });
});
