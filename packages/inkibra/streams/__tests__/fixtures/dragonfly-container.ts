import { GenericContainer, type StartedTestContainer } from 'testcontainers';

export type DragonflyContainer = {
  host: string;
  port: number;
  stop: () => Promise<void>;
};

export async function startDragonflyContainer(): Promise<DragonflyContainer> {
  const container: StartedTestContainer = await new GenericContainer(
    'docker.dragonflydb.io/dragonflydb/dragonfly',
  )
    .withExposedPorts(6379)
    .withCommand(['--default_lua_flags=allow-undeclared-keys'])
    .start();

  return {
    host: container.getHost(),
    port: container.getMappedPort(6379),
    stop: async () => {
      await container.stop();
    },
  };
}
