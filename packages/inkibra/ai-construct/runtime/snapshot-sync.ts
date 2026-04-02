import type { Driver } from '@inkibra/dal-connection';
import type { Logger } from '@inkibra/logger';
import type { Construct, StorageConstructView } from '../construct/construct';
import { createStorageConstruct } from '../construct/construct';
import type { ConstructStorage } from '../construct/types';

const CONSTRUCT_VFS_COLLECTION = 'construct_vfs';
const CONSTRUCT_VFS_NODE_TYPE = 'VFS_NODE';

type ConstructVfsView = Pick<Construct, 'getVfs'> | StorageConstructView;

export type ConstructVfsNode = {
  id: string;
  type: string;
  created: string;
  modified: string;
  version: number;
  constructId: string;
  path: string;
  parentPath: string;
  name: string;
  kind: 'file' | 'directory';
  meta: Record<string, unknown>;
  content: string;
  sizeBytes: number;
};

export type DalConstructFile = {
  path: string;
  content: string;
  modified: string;
};

function normalizeFsPath(path: string): string {
  if (path === '/') {
    return '/';
  }

  const trimmed = path.replace(/\/+$/g, '').replace(/\/+/g, '/');
  if (!trimmed.startsWith('/')) {
    return `/${trimmed}`;
  }
  return trimmed || '/';
}

function getParentPath(path: string): string {
  const normalized = normalizeFsPath(path);
  if (normalized === '/') {
    return '/';
  }

  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) {
    return '/';
  }
  return normalized.slice(0, idx);
}

function getPathName(path: string): string {
  const normalized = normalizeFsPath(path);
  if (normalized === '/') {
    return '/';
  }

  const idx = normalized.lastIndexOf('/');
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}

function documentIdForPath(constructId: string, path: string): string {
  return `vfs:${constructId}:${encodeURIComponent(normalizeFsPath(path))}`;
}

export async function listConstructSnapshotNodesFromDal(options: {
  driver: Driver;
  logger: Logger;
  constructId: string;
}): Promise<ConstructVfsNode[]> {
  const result = await options.driver.findByPartition<ConstructVfsNode>(
    options.logger,
    CONSTRUCT_VFS_COLLECTION,
    'construct_partition',
    options.constructId,
    [CONSTRUCT_VFS_NODE_TYPE],
    {
      limit: 20_000,
      orderBy: {
        field: 'modified',
        direction: 'DESC',
      },
    },
  );
  if (result.isErr()) {
    throw result.error;
  }

  return result.value.value;
}

export async function listConstructFilesFromDal(options: {
  driver: Driver;
  logger: Logger;
  constructId: string;
  startPath?: string;
}): Promise<DalConstructFile[]> {
  const startPath = normalizeFsPath(options.startPath ?? '/');
  const nodes = await listConstructSnapshotNodesFromDal(options);
  return nodes
    .filter((node) => node.kind === 'file')
    .filter((node) => {
      if (startPath === '/') {
        return true;
      }
      return node.path === startPath || node.path.startsWith(`${startPath}/`);
    })
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((node) => ({
      path: node.path,
      content: node.content,
      modified: node.modified,
    }));
}

export async function listConstructFilePaths(
  construct: ConstructVfsView,
  startPath = '/',
): Promise<string[]> {
  const vfs = construct.getVfs();
  const queue = [startPath];
  const visited = new Set<string>();
  const files: string[] = [];

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || visited.has(next)) {
      continue;
    }
    visited.add(next);

    let entries: Awaited<ReturnType<typeof vfs.list>>;
    try {
      entries = await vfs.list(next);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.type === 'directory') {
        queue.push(entry.path);
      } else {
        files.push(entry.path);
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

export async function clearConstructFiles(
  construct: ConstructVfsView,
  options?: {
    shouldDeletePath?: (path: string) => boolean;
  },
): Promise<void> {
  const vfs = construct.getVfs();
  const files = await listConstructFilePaths(construct, '/');
  for (const path of files.sort((left, right) => right.length - left.length)) {
    if (options?.shouldDeletePath && !options.shouldDeletePath(path)) {
      continue;
    }

    try {
      await vfs.delete(path);
    } catch {
      // ignore best-effort cleanup
    }
  }
}

export async function copyConstructSnapshot(
  source: ConstructVfsView,
  target: ConstructVfsView,
  options?: {
    clearTarget?: boolean;
    shouldCopyPath?: (path: string) => boolean;
  },
): Promise<void> {
  if (options?.clearTarget ?? true) {
    await clearConstructFiles(target);
  }

  const sourceVfs = source.getVfs();
  const targetVfs = target.getVfs();
  const files = await listConstructFilePaths(source, '/');

  for (const filePath of files) {
    if (options?.shouldCopyPath && !options.shouldCopyPath(filePath)) {
      continue;
    }

    const content = await sourceVfs.read(filePath);
    await targetVfs.write(filePath, content);
  }
}

export async function copyConstructSnapshotByStorage(options: {
  logger: Logger;
  source: {
    id: string;
    storage: ConstructStorage;
  };
  target: {
    id: string;
    storage: ConstructStorage;
  };
  clearTarget?: boolean;
  shouldCopyPath?: (path: string) => boolean;
}): Promise<void> {
  if (options.source.id === options.target.id) {
    return;
  }

  const source = await createStorageConstruct({
    id: options.source.id,
    storage: options.source.storage,
    logger: options.logger,
  });

  const target = await createStorageConstruct({
    id: options.target.id,
    storage: options.target.storage,
    logger: options.logger,
  });

  try {
    await source.flush();
    await copyConstructSnapshot(source, target, {
      clearTarget: options.clearTarget,
      shouldCopyPath: options.shouldCopyPath,
    });
    await target.flush();
  } finally {
    source.stop();
    target.stop();
  }
}

export async function copyConstructSnapshotByDalIds(options: {
  driver: Driver;
  logger: Logger;
  sourceConstructId: string;
  targetConstructId: string;
  clearTarget?: boolean;
  shouldCopyPath?: (path: string) => boolean;
}): Promise<void> {
  if (options.sourceConstructId === options.targetConstructId) {
    return;
  }

  const sourceNodes = await listConstructSnapshotNodesFromDal({
    driver: options.driver,
    logger: options.logger,
    constructId: options.sourceConstructId,
  });

  // Upsert-then-prune: write all source nodes first, then delete stale target
  // nodes. This ensures partial failure leaves a superset (old + new) rather
  // than an empty VFS.
  const now = new Date().toISOString();
  const copiedFilePaths = new Set<string>();
  const writtenNodeIds = new Set<string>();

  for (const sourceNode of sourceNodes) {
    if (
      sourceNode.kind === 'file' &&
      options.shouldCopyPath &&
      !options.shouldCopyPath(sourceNode.path)
    ) {
      continue;
    }

    const path = normalizeFsPath(sourceNode.path);
    if (sourceNode.kind === 'file') {
      copiedFilePaths.add(path);
    }

    const nextNode: ConstructVfsNode = {
      ...sourceNode,
      id: documentIdForPath(options.targetConstructId, path),
      constructId: options.targetConstructId,
      path,
      parentPath: getParentPath(path),
      name: getPathName(path),
      created: now,
      modified: now,
      sizeBytes:
        sourceNode.kind === 'file'
          ? sourceNode.sizeBytes
          : new TextEncoder().encode(sourceNode.content ?? '').length,
    };
    writtenNodeIds.add(nextNode.id);

    const upsert = await options.driver.upsert<ConstructVfsNode>(
      options.logger,
      CONSTRUCT_VFS_COLLECTION,
      nextNode,
    );
    if (upsert.isErr()) {
      throw upsert.error;
    }
  }

  // Prune stale target nodes that were not in the source set
  if (options.clearTarget ?? true) {
    const existingTargetNodes = await listConstructSnapshotNodesFromDal({
      driver: options.driver,
      logger: options.logger,
      constructId: options.targetConstructId,
    });
    for (const node of existingTargetNodes) {
      if (writtenNodeIds.has(node.id)) {
        continue;
      }
      const remove = await options.driver.remove(
        options.logger,
        CONSTRUCT_VFS_COLLECTION,
        node.id,
      );
      if (remove.isErr()) {
        throw remove.error;
      }
    }
  }

  const sourceDirectoryMap = new Map(
    sourceNodes
      .filter((node) => node.kind === 'directory')
      .map((node) => [normalizeFsPath(node.path), node] as const),
  );

  const requiredDirectories = new Set<string>();
  for (const filePath of copiedFilePaths) {
    const segments = filePath.split('/').filter(Boolean);
    for (let i = 0; i < segments.length - 1; i += 1) {
      requiredDirectories.add(`/${segments.slice(0, i + 1).join('/')}`);
    }
  }

  for (const directoryPath of requiredDirectories) {
    const sourceDirectory = sourceDirectoryMap.get(directoryPath);
    const nextNode: ConstructVfsNode = {
      id: documentIdForPath(options.targetConstructId, directoryPath),
      type: CONSTRUCT_VFS_NODE_TYPE,
      version: 1,
      created: now,
      modified: now,
      constructId: options.targetConstructId,
      path: directoryPath,
      parentPath: getParentPath(directoryPath),
      name: getPathName(directoryPath),
      kind: 'directory',
      meta: sourceDirectory?.meta ?? {
        id: directoryPath,
        tags: ['directory'],
        created: now,
        updated: now,
      },
      content: '',
      sizeBytes: 0,
    };

    const upsert = await options.driver.upsert<ConstructVfsNode>(
      options.logger,
      CONSTRUCT_VFS_COLLECTION,
      nextNode,
    );
    if (upsert.isErr()) {
      throw upsert.error;
    }
  }
}

export async function constructSnapshotExistsInDal(
  driver: Driver,
  logger: Logger,
  constructId: string,
): Promise<boolean> {
  const result = await driver.findByPartition<ConstructVfsNode>(
    logger,
    CONSTRUCT_VFS_COLLECTION,
    'construct_partition',
    constructId,
    [CONSTRUCT_VFS_NODE_TYPE],
    {
      limit: 1,
    },
  );
  if (result.isErr()) {
    logger.warn('Failed to probe construct snapshot existence', {
      constructId,
      error: result.error.message,
    });
    return false;
  }

  return result.value.value.length > 0;
}
