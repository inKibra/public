import { execSync, spawn } from 'node:child_process';
import { GenericContainer } from 'testcontainers';

function printContainerRuntimeDiagnostics(error) {
  console.error('Failed to start Dragonfly Testcontainer for workflow integration tests.');
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

  const dockerHost = process.env.DOCKER_HOST;
  const containerHost = process.env.TESTCONTAINERS_HOST_OVERRIDE;

  console.error(`- DOCKER_HOST: ${dockerHost ?? '(not set)'}`);
  console.error(`- TESTCONTAINERS_HOST_OVERRIDE: ${containerHost ?? '(not set)'}`);
  console.error('');
  console.error('Hints:');
  console.error('- Ensure Docker Desktop/engine is running and reachable from this shell.');
  console.error('- If Docker runs in another context, export DOCKER_HOST accordingly.');
  console.error('- Re-run: bun run test:integration');
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
    const code = await new Promise((resolve, reject) => {
      const child = spawn('bun', ['test', './__tests__/integration'], {
        stdio: 'inherit',
        env: {
          ...process.env,
          WORKFLOW_INTEGRATION: '1',
          WORKFLOW_DRAGONFLY_HOST: host,
          WORKFLOW_DRAGONFLY_PORT: port,
        },
      });

      child.on('error', reject);
      child.on('exit', (exitCode) => {
        resolve(exitCode ?? 1);
      });
    });

    process.exit(Number(code));
  } finally {
    await container.stop();
  }
}

run().catch(() => {
  process.exit(1);
});
