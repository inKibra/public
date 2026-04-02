/**
 * Durable runtime factory for the dev server.
 *
 * Boots createDurableConstructRuntime with dev-server defaults
 * and attaches event publishers for SSE relay.
 */

import { notificationEffects } from '@inkibra/ai-sandbox-computer/example/notification-effects';
import { notificationsModule } from '@inkibra/ai-sandbox-computer/example/notification-module';
import { todoEffects } from '@inkibra/ai-sandbox-computer/example/todo-effects';
import { todoModule } from '@inkibra/ai-sandbox-computer/example/todo-module';
import { createDriverTransactionRuntime } from '@inkibra/dal-connection';
import type { Logger } from '@inkibra/logger';
import type { StreamsClient } from '@inkibra/streams';
import { createDalStorage } from '../construct/storage';
import type { StageConfig } from '../construct/types';
import { DEFAULT_CONSTRUCT_LANES } from '../construct/types';
import {
  CONSTRUCT_SYSTEM_EVENT_NAME,
  CORE_IMPULSE_PROFILE_NAME,
  systemEventImpulseProfile,
} from '../impulse/keys';
import { defineImpulseProfiles } from '../impulse/types';
import { createDurableConstructRuntime } from '../runtime/durable-runtime';
import { resolveStageModel } from './config';
import type { Infra } from './infra';

const DEV_STREAM_PREFIX = 'dev:construct';

function devEventStreamKey(constructId: string): string {
  return `${DEV_STREAM_PREFIX}:${constructId}:events`;
}

export { devEventStreamKey };

// biome-ignore lint/suspicious/noExplicitAny: DevRuntime wraps DurableConstructRuntime with product-specific profile/pool generics that vary by config
export type DevRuntime = Awaited<
  ReturnType<typeof createDurableConstructRuntime<any, any, any, any>>
>;

export async function bootDevRuntime(infra: Infra): Promise<DevRuntime> {
  const { config, logger, driver, redis, streams, openAI } = infra;

  // Build StageConfig from config.ai.models.stages
  const stageConfig: StageConfig = {};
  const stageIds = [
    'response/generate',
    'response/evalDraft',
    'response/evalRepeat',
    'response/evalTone',
    'impulse/think',
    'impulse/schedule',
    'nap/analyze',
    'nap/propose',
    'nap/commit',
    'scheduler/decide',
  ] as const;
  for (const stageId of stageIds) {
    const resolved = resolveStageModel(config, `construct/${stageId}`);
    stageConfig[stageId] = {
      model: resolved.model,
      reasoningEffort: resolved.reasoningEffort,
      maxOutputTokens: resolved.maxOutputTokens,
    };
  }

  const defaultModel = config.ai.models.defaults.model;

  const createEffectHandlers = (constructId: string) => ({
    ...notificationEffects.implement({
      async send(payload) {
        logger.info('notification effect flushed', { constructId, payload });
        await streams.append<Record<string, unknown>, string>({
          streamKey: devEventStreamKey(constructId),
          event: 'effectFlushed',
          data: {
            constructId,
            kind: 'notification.send',
            payload,
            ts: new Date().toISOString(),
          },
        });
      },
    }),
    ...todoEffects.implement({
      async notifyCreated(payload) {
        logger.info('todo effect flushed', { constructId, payload });
        await streams.append<Record<string, unknown>, string>({
          streamKey: devEventStreamKey(constructId),
          event: 'effectFlushed',
          data: {
            constructId,
            kind: 'todo.notifyCreated',
            payload,
            ts: new Date().toISOString(),
          },
        });
      },
    }),
  });

  const runtime = await createDurableConstructRuntime({
    logger,
    driver,
    redis,
    streams,
    createConfig: async (constructId: string) => ({
      id: constructId,
      storage: createDalStorage({ driver, logger }),
      deps: {
        openAI,
        logger: logger.child({ component: 'construct', constructId }),
      },
      model: defaultModel,
      stageConfig,
      impulseProfiles: defineImpulseProfiles({
        [CORE_IMPULSE_PROFILE_NAME.CONVERSATION_USER_MESSAGE]: {
          pool: 'conversation',
        },
        [CORE_IMPULSE_PROFILE_NAME.SYSTEM_TIME_PASSED]: {
          pool: 'background',
        },
        [CORE_IMPULSE_PROFILE_NAME.SYSTEM_SELF_REMINDER]: {
          pool: 'background',
        },
        [CORE_IMPULSE_PROFILE_NAME.BACKGROUND_DEFAULT]: {
          pool: 'background',
        },
        [systemEventImpulseProfile(CONSTRUCT_SYSTEM_EVENT_NAME.HEARTBEAT)]: {
          pool: 'background',
        },
      }),
      computerConfig: {
        modules: [notificationsModule, todoModule],
        transactionRuntime: createDriverTransactionRuntime({
          driver,
          logger: logger.child({ component: 'construct-tx', constructId }),
          effectHandlers: createEffectHandlers(constructId),
        }),
      },
      lanes: DEFAULT_CONSTRUCT_LANES,
      intents: [
        {
          intent: 'list-todos',
          hint: 'show my todos list tasks what do I need to do',
          command: 'todo-list',
        },
      ],
    }),
    onConstructOpened: async (constructId, construct) => {
      attachDevEventPublisher({
        streams,
        constructId,
        construct,
        logger,
      });
    },
    onFrontierAdvanced: async (args) => {
      // Publish frontier events to the construct's event stream
      try {
        await streams.append<Record<string, unknown>, string>({
          streamKey: devEventStreamKey(args.constructId),
          event: 'frontierAdvanced',
          data: {
            constructId: args.constructId,
            processedCursor: args.processedCursor,
            committedCursor: args.committedCursor,
            phase: args.phase,
            timestamp: Date.now(),
          },
        });
      } catch {
        // Best-effort — don't break the runtime
      }
    },
    durable: {
      namespace: 'dev-construct',
      mailboxStreamPrefix: 'dev-construct-mailbox',
      actor: {
        maxResidentConstructs: 10,
        idleTtlMs: 5 * 60 * 1000, // 5 minutes idle before eviction
      },
    },
    scheduler: {
      enabled: true,
    },
  });

  logger.info('Durable runtime ready');
  return runtime;
}

/**
 * Attach event publisher to a construct instance.
 * Writes construct events to the dev event stream for SSE relay.
 */
function attachDevEventPublisher(args: {
  streams: StreamsClient;
  constructId: string;
  construct: { onEvent: (cb: (event: unknown) => void) => void };
  logger: Logger;
}): void {
  const streamKey = devEventStreamKey(args.constructId);
  args.construct.onEvent((event: unknown) => {
    args.streams
      .append<Record<string, unknown>, string>({
        streamKey,
        event: 'constructEvent',
        data: {
          constructId: args.constructId,
          event,
          ts: new Date().toISOString(),
        },
      })
      .catch((err: unknown) => {
        args.logger.debug('Failed to publish construct event', {
          constructId: args.constructId,
          err,
        });
      });
  });
}
