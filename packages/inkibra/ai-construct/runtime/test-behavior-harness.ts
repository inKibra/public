import {
  createAiFlowScenario,
  createAiFlowTestDeps,
} from '@inkibra/ai-flow/testing';
import { createTestDriver } from '@inkibra/dal-connection/create-driver';
import type { Logger } from '@inkibra/logger';
import initLogger from '@inkibra/logger';
import type { Construct } from '../construct/construct';
import { createDalStorage } from '../construct/storage';
import type { ConstructConfig } from '../construct/types';
import { DEFAULT_CONSTRUCT_LANES } from '../construct/types';
import { DEFAULT_IMPULSE_PROFILES } from '../impulse/keys';
import type { ResponseLifecycleReceipt } from '../response-lifecycle';
import type { SourceFactLifecycleReceipt } from '../source-facts';
import type { ResponseLifecycleRecord } from '../vfs/response-lifecycle-state';
import { loadResponseLifecycleState } from '../vfs/response-lifecycle-state';
import type { SourceFactRecord } from '../vfs/source-fact-state';
import {
  loadSourceFactState,
  mergeSourceFactReceipts,
} from '../vfs/source-fact-state';
import { isQuiescentState } from './processor';
import { createLocalConstructRuntime } from './runtime';
import type {
  ConstructResponseLifecycleSink,
  ConstructSourceFactSink,
} from './types';

type AiScenario = Parameters<typeof createAiFlowTestDeps>[0]['scenario'];

export type LocalConstructBehaviorHarness = {
  constructId: string;
  logger: Logger;
  runtimeManager: ReturnType<
    typeof createLocalConstructRuntime
  >['runtimeManager'];
  ingress: Pick<ReturnType<typeof createLocalConstructRuntime>, 'submit'> & {
    waitForSettled?: (constructId: string) => Promise<void>;
  };
  inspector: ReturnType<typeof createAiFlowTestDeps>['inspector'];
  sourceFactReceipts: SourceFactLifecycleReceipt[];
  responseLifecycleReceipts: ResponseLifecycleReceipt[];
  getConstruct: () => Promise<Construct>;
  waitForIdle: (timeoutMs?: number) => Promise<Construct>;
  waitForSourceFact: (
    factId: string,
    predicate?: (record: SourceFactRecord | undefined) => boolean,
    timeoutMs?: number,
  ) => Promise<SourceFactRecord>;
  waitForResponseLifecycle: (
    responseId: string,
    predicate?: (record: ResponseLifecycleRecord | undefined) => boolean,
    timeoutMs?: number,
  ) => Promise<ResponseLifecycleRecord>;
  dispose: () => Promise<void>;
};

export async function createLocalConstructBehaviorHarness(options: {
  loggerName: string;
  constructId?: string;
  scenario?: AiScenario;
  stageConfig?: ConstructConfig['stageConfig'];
  sourceFactSink?: ConstructSourceFactSink;
  responseLifecycleSink?: ConstructResponseLifecycleSink;
}): Promise<LocalConstructBehaviorHarness> {
  const driver = await createTestDriver();
  const logger = initLogger(options.loggerName);
  const { deps, inspector } = createAiFlowTestDeps({
    logger,
    scenario:
      options.scenario ??
      createAiFlowScenario({
        stream: [],
        strict: true,
      }),
  });

  const constructId =
    options.constructId ?? `${options.loggerName}:${crypto.randomUUID()}`;
  const sourceFactReceipts: SourceFactLifecycleReceipt[] = [];
  const responseLifecycleReceipts: ResponseLifecycleReceipt[] = [];
  const sourceFactSink: ConstructSourceFactSink = {
    publish: async (receipt) => {
      sourceFactReceipts.push(receipt);
      await options.sourceFactSink?.publish(receipt);
    },
  };
  const responseLifecycleSink: ConstructResponseLifecycleSink = {
    publish: async (receipt) => {
      responseLifecycleReceipts.push(receipt);
      await options.responseLifecycleSink?.publish(receipt);
    },
  };
  const runtime = createLocalConstructRuntime({
    logger,
    createConfig: async (id) => ({
      id,
      storage: createDalStorage({ driver, logger }),
      deps,
      impulseProfiles: DEFAULT_IMPULSE_PROFILES,
      lanes: DEFAULT_CONSTRUCT_LANES,
      stageConfig: options.stageConfig,
      computerConfig: {},
    }),
    sourceFacts: {
      sink: sourceFactSink,
    },
    responses: {
      sink: responseLifecycleSink,
    },
  });
  const manager = runtime.runtimeManager;
  const ingress = {
    submit:
      runtime.submit as LocalConstructBehaviorHarness['ingress']['submit'],
    waitForSettled: runtime.waitForSettled,
  };

  async function waitForValue<T>(
    getValue: () => Promise<T | null>,
    timeoutMs = 4_000,
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = await getValue();
      if (value !== null) {
        return value;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    throw new Error(
      `Timed out waiting for test harness condition after ${timeoutMs}ms`,
    );
  }

  return {
    constructId,
    logger,
    runtimeManager: manager,
    ingress,
    inspector,
    sourceFactReceipts,
    responseLifecycleReceipts,
    getConstruct() {
      return manager.getOrCreate(constructId);
    },
    async waitForIdle(timeoutMs = 4_000) {
      return waitForValue(async () => {
        await ingress.waitForSettled?.(constructId);
        await manager.waitForSettled?.(constructId);
        const construct = await manager.getOrCreate(constructId);
        await construct.getScheduler().poll();
        const state = await construct.getRuntimeState();
        return isQuiescentState(state) ? construct : null;
      }, timeoutMs);
    },
    async waitForSourceFact(
      factId,
      predicate = (record) => record !== undefined,
      timeoutMs = 4_000,
    ) {
      return waitForValue(async () => {
        await manager.waitForSettled?.(constructId);
        const construct = await manager.getOrCreate(constructId);
        // Merge VFS state with in-memory receipts (terminal facts are pruned from VFS)
        const vfsState = await loadSourceFactState(construct.getVfs());
        const merged = mergeSourceFactReceipts(vfsState, sourceFactReceipts);
        const record = merged[factId];
        return predicate(record) && record ? record : null;
      }, timeoutMs);
    },
    async waitForResponseLifecycle(
      responseId,
      predicate = (record) => record !== undefined,
      timeoutMs = 4_000,
    ) {
      return waitForValue(async () => {
        await manager.waitForSettled?.(constructId);
        const construct = await manager.getOrCreate(constructId);
        const record = (await loadResponseLifecycleState(construct.getVfs()))[
          responseId
        ];
        return predicate(record) && record ? record : null;
      }, timeoutMs);
    },
    async dispose() {
      const open = manager.getOpen(constructId);
      if (open) {
        await manager.flushAndRelease(constructId);
      }
      await driver.disconnect();
    },
  };
}
