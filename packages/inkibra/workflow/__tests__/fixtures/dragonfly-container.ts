import Redis from 'ioredis';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';

export type DragonflyContainerHandle = {
  redis: Redis;
  host: string;
  port: number;
  stop: () => Promise<void>;
};

export async function connectToDragonfly(
  host: string,
  port: number,
): Promise<DragonflyContainerHandle> {
  const redis = new Redis({
    host,
    port,
    maxRetriesPerRequest: null,
  });

  await redis.ping();

  return {
    redis,
    host,
    port,
    stop: async () => {
      await redis.quit();
    },
  };
}

export async function startDragonflyContainer(): Promise<DragonflyContainerHandle> {
  let container: StartedTestContainer;
  try {
    container = await new GenericContainer(
      'docker.dragonflydb.io/dragonflydb/dragonfly',
    )
      .withExposedPorts(6379)
      .withCommand(['--default_lua_flags=allow-undeclared-keys'])
      .start();
  } catch (error) {
    throw new Error(
      `Failed to start Dragonfly test container: ${String(error)}`,
    );
  }

  const host = container.getHost();
  const port = container.getMappedPort(6379);
  const base = await connectToDragonfly(host, port);

  return {
    redis: base.redis,
    host,
    port,
    stop: async () => {
      await base.stop();
      await container.stop();
    },
  };
}
