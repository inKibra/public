import type {
  ConstructStorage,
  DalConstructStorage,
  FileConstructStorage,
} from './types';

export function createFileStorage(baseDir: string): FileConstructStorage {
  return {
    kind: 'file',
    baseDir,
  };
}

export function createDalStorage(options: {
  driver: DalConstructStorage['driver'];
  logger?: DalConstructStorage['logger'];
  collection?: DalConstructStorage['collection'];
}): DalConstructStorage {
  return {
    kind: 'dal',
    driver: options.driver,
    logger: options.logger,
    collection: options.collection,
  };
}

export function describeConstructStorage(storage: ConstructStorage): string {
  if (storage.kind === 'file') {
    return `file:${storage.baseDir}`;
  }

  return `dal:${storage.collection ?? 'construct_vfs'}`;
}
