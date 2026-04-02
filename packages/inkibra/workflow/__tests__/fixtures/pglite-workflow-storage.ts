import type { Driver } from '@inkibra/dal-connection';
import { createTestDriver } from '@inkibra/dal-connection/create-driver';
import initLogger from '@inkibra/logger';
import { DalWorkflowStorage } from '../../storage-dal';

export type PgliteWorkflowStorageFixture = {
  storage: DalWorkflowStorage;
  driver: Driver;
  stop: () => Promise<void>;
};

export async function createPgliteWorkflowStorageFixture(
  name: string,
): Promise<PgliteWorkflowStorageFixture> {
  const driver = await createTestDriver();
  const logger = initLogger(name);
  const storage = new DalWorkflowStorage(driver, logger);
  await storage.initialize();

  return {
    storage,
    driver,
    stop: async () => {
      await driver.disconnect();
    },
  };
}
