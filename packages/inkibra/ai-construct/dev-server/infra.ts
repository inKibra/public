/**
 * Infrastructure bootstrap for the dev server.
 *
 * Boots Redis, DB driver, streams client, and OpenAI.
 * Ensures required collections are created.
 */

import { createDriver } from '@inkibra/dal-connection/create-driver';
import type { Driver } from '@inkibra/dal-connection/driver';
import { Logger } from '@inkibra/logger';
import { createStreamsClient, type StreamsClient } from '@inkibra/streams';
import {
  WORKFLOW_COLLECTION,
  workflowRuntimeCollectionSchema,
} from '@inkibra/workflow/storage-dal';
import Redis from 'ioredis';
import OpenAI from 'openai';
import {
  constructVfsCollectionSchema,
  DEFAULT_DAL_COLLECTION,
} from '../vfs/context-persistence';
import type { DevServerConfig } from './config';

export type Infra = {
  config: DevServerConfig;
  logger: Logger;
  driver: Driver;
  redis: Redis;
  streams: StreamsClient;
  openAI: OpenAI;
};

export async function bootInfra(config: DevServerConfig): Promise<Infra> {
  const logger = Logger.createLogger(
    'ai-construct-dev-server',
    { component: 'dev-server' },
    (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') ?? 'info',
  );

  logger.info('Booting infrastructure...');

  // Database driver — PGlite if no DATABASE_URL, otherwise postgres
  const databaseUrl = config.database.url;
  const driver = await createDriver(
    databaseUrl
      ? { databaseUrl }
      : { forceTest: true, dataDir: '.dev-server-data' },
  );
  logger.info('Database driver ready', {
    type: databaseUrl ? 'postgres' : 'pglite',
  });

  // Redis / Dragonfly
  const { host, port, prefix } = config.dragonfly;
  const redis = new Redis({
    host,
    port,
    keyPrefix: prefix,
    lazyConnect: true,
  });
  await redis.connect();
  logger.info('Redis connected', { host, port });

  // Ensure collections (createIfNotExists for dev bootstrap)
  const ensureOpts = { createIfNotExists: true } as const;
  await driver.ensureCollection(
    logger,
    { ...constructVfsCollectionSchema, name: DEFAULT_DAL_COLLECTION },
    ensureOpts,
  );
  await driver.ensureCollection(
    logger,
    { ...workflowRuntimeCollectionSchema, name: WORKFLOW_COLLECTION },
    ensureOpts,
  );
  logger.info('Collections ensured');

  // Streams client (createIfNotExists for dev bootstrap)
  const streams = await createStreamsClient({
    logger,
    redis,
    driver,
    ensureCollectionOptions: { createIfNotExists: true },
  });
  logger.info('Streams client ready');

  // OpenAI-compatible client (Kimi via OpenRouter by default)
  const { apiKey, baseURL } = config.ai;
  if (!apiKey) {
    logger.warn(
      'No AI API key configured — LLM calls will fail. Run with: pulumi env run inkibra/02-inkibra-web/local -- bun dev-server/server.ts',
    );
  }
  const openAI = new OpenAI({
    apiKey: apiKey || 'sk-not-configured',
    baseURL,
  });
  logger.info('OpenAI client ready', {
    baseURL,
    model: config.ai.models.defaults.model,
  });

  return { config, logger, driver, redis, streams, openAI };
}
