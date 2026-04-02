import { execSync, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GenericContainer } from 'testcontainers';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const packageDir = resolve(scriptDir, '../../..');

function printContainerRuntimeDiagnostics(error) {
  console.error(
    'Failed to start Dragonfly Testcontainer for ai-construct actor integration tests.',
  );
  console.error(String(error));
  console.error('');
  console.error('Container runtime diagnostics:');

  try {
    const dockerInfo = execSync('docker info --format "{{.ServerVersion}}"', {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    }).trim();
    console.error(`- docker info: reachable (server version ${dockerInfo})`);
  } catch (dockerInfoError) {
    console.error(`- docker info: unavailable (${String(dockerInfoError)})`);
  }

  console.error(`- DOCKER_HOST: ${process.env.DOCKER_HOST ?? '(not set)'}`);
  console.error(
    `- TESTCONTAINERS_HOST_OVERRIDE: ${process.env.TESTCONTAINERS_HOST_OVERRIDE ?? '(not set)'}`,
  );
}

async function run() {
  let container;
  try {
    container = await new GenericContainer(
      'docker.dragonflydb.io/dragonflydb/dragonfly',
    )
      .withExposedPorts(6379)
      .withCommand(['--default_lua_flags=allow-undeclared-keys'])
      .start();
  } catch (error) {
    printContainerRuntimeDiagnostics(error);
    throw error;
  }

  const host = container.getHost();
  const port = String(container.getMappedPort(6379));

  try {
    const code = await new Promise((resolveCode, reject) => {
      const child = spawn(
        'bun',
        [
          'test',
          '--preload',
          './preload.ts',
          './runtime/__tests__/integration/actor-durable.integration.test.ts',
        ],
        {
          cwd: packageDir,
          stdio: 'inherit',
          env: {
            ...process.env,
            AI_CONSTRUCT_RUNTIME_INTEGRATION: '1',
            AI_CONSTRUCT_DRAGONFLY_HOST: host,
            AI_CONSTRUCT_DRAGONFLY_PORT: port,
          },
        },
      );

      child.on('error', reject);
      child.on('exit', (exitCode) => resolveCode(exitCode ?? 1));
    });

    process.exit(Number(code));
  } finally {
    await container.stop();
  }
}

run().catch(() => {
  process.exit(1);
});
