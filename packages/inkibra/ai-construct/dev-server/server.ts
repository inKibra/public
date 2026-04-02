/**
 * ai-construct Dev Server
 *
 * Standalone Bun server for creating and interacting with constructs.
 * Uses the durable runtime with Redis + DB + streams.
 *
 * Start (from packages/inkibra/ai-construct):
 *   pulumi env run inkibra/02-inkibra-web/local -- bun dev-server/server.ts
 *
 * The API key and dragonfly config come from INKIBRA_WEB_ENV (injected by pulumi env).
 */

import { createRouter } from '@inkibra/denzel-bun';
import { createDevBackend } from './backend';
import { loadDevServerConfig } from './config';
import { seedDefaults } from './construct-registry';
import { createDevServerFrontend } from './frontend.server';
import { bootInfra } from './infra';
import { bootDevRuntime } from './runtime';

async function main() {
  const config = loadDevServerConfig();
  const infra = await bootInfra(config);
  const runtime = await bootDevRuntime(infra);

  // Seed default construct
  seedDefaults();

  const backend = createDevBackend({
    runtime,
    streams: infra.streams,
    logger: infra.logger,
  });

  const frontend = createDevServerFrontend(backend);

  const router = createRouter({
    backends: [backend],
    frontends: [frontend],
    staticDirs: {
      '/dist': './dist',
    },
  });

  const port = config.port;

  const server = Bun.serve({
    port,
    fetch: router.fetch,
  });

  infra.logger.info(
    `ai-construct dev-server running at http://localhost:${server.port}`,
  );
  console.log(
    `\n  ai-construct dev-server running at http://localhost:${server.port}`,
  );
  console.log(`  Model: ${config.ai.models.defaults.model}`);
  console.log(`  AI base URL: ${config.ai.baseURL}`);
  console.log(
    `  Database: ${config.database.url ? 'postgres' : 'PGlite (.dev-server-data/)'}`,
  );
  console.log(`  Redis: ${config.dragonfly.host}:${config.dragonfly.port}\n`);
  console.log('  Lab UI:');
  console.log(
    `    http://localhost:${server.port}/constructs/dev-default/lab\n`,
  );
  console.log('  API:');
  console.log(
    '    GET  /api/constructs                           — List constructs',
  );
  console.log(
    '    POST /api/constructs                           — Create construct',
  );
  console.log(
    '    GET  /api/constructs/:id/lab                   — Lab snapshot',
  );
  console.log(
    '    POST /api/constructs/:id/lab/actions           — Submit action',
  );
  console.log(
    '    GET  /api/constructs/:id/runtime               — Runtime snapshot',
  );
  console.log(
    '    GET  /api/constructs/:id/runtime/events (SSE)  — Event stream',
  );
  console.log('');

  // Graceful shutdown
  const shutdown = async () => {
    infra.logger.info('Shutting down...');
    await runtime.shutdown();
    infra.redis.disconnect();
    server.stop();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Failed to start dev-server:', err);
  process.exit(1);
});
