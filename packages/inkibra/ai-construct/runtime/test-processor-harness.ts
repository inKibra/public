import type { OverlayFs } from '@inkibra/ai-flow';
import type { Construct } from '../construct/construct';
import {
  createLocalConstructBehaviorHarness,
  type LocalConstructBehaviorHarness,
} from './test-behavior-harness';

type RuntimeStateSnapshot = Awaited<ReturnType<Construct['getRuntimeState']>>;
type ProcessorConstructOverrides = {
  getVfs?: () => OverlayFs;
  getScheduler?: () => { poll: () => Promise<void> };
  getRuntimeState?: () => Promise<RuntimeStateSnapshot>;
  getState?: () => Promise<{ activeImpulses: number }>;
  getImpulsePool?: () => {
    getActive: () => Array<{ triggeredBy: { type: string } }>;
  };
  ingest?: (...args: never[]) => Promise<unknown>;
  ingestDetached?: (...args: never[]) => Promise<unknown>;
  queueNextNapPin?: (input: { path: string; id?: string }) => Promise<unknown>;
  queueNextNapImprint?: (input: {
    text: string;
    id?: string;
  }) => Promise<unknown>;
  rate?: (input: Record<string, unknown>) => Promise<unknown>;
  steer?: (input: Record<string, unknown>) => Promise<unknown>;
  nap?: () => Promise<unknown>;
  startHypno?: () => Promise<unknown>;
  chatHypnoReview?: (text: string) => Promise<unknown>;
  acceptHypno?: () => unknown;
  updateHypno?: () => unknown;
  cancelHypno?: () => unknown;
  isHypnoActive?: () => boolean;
  reflectPerceptionSourceFact?: (...args: never[]) => Promise<unknown>;
  reflectSteeringDirective?: (
    input: Record<string, unknown>,
  ) => Promise<unknown>;
  failWritesContaining?: string;
};

let harnessCount = 0;
const activeHarnesses: LocalConstructBehaviorHarness[] = [];

export async function createMailboxProcessorConstruct(
  overrides: ProcessorConstructOverrides = {},
): Promise<Construct> {
  harnessCount += 1;
  const harness = await createLocalConstructBehaviorHarness({
    loggerName: `processor-test-harness-${harnessCount}`,
  });
  activeHarnesses.push(harness);

  const construct = await harness.getConstruct();
  const getVfs = overrides.getVfs ?? construct.getVfs.bind(construct);
  construct.getVfs = getVfs;
  const vfs = construct.getVfs();

  if (typeof overrides.failWritesContaining === 'string') {
    const originalWrite = vfs.write.bind(vfs);
    vfs.write = async (path: string, content: string) => {
      if (path.includes(overrides.failWritesContaining!)) {
        throw new Error('simulated vfs write failure');
      }

      await originalWrite(path, content);
    };
  }

  const patch: Record<string, unknown> = {
    getScheduler:
      overrides.getScheduler ?? construct.getScheduler.bind(construct),
    getRuntimeState:
      overrides.getRuntimeState ?? construct.getRuntimeState.bind(construct),
    getState: overrides.getState ?? construct.getState.bind(construct),
    getImpulsePool:
      overrides.getImpulsePool ?? construct.getImpulsePool.bind(construct),
    ingest: overrides.ingest ?? construct.ingest.bind(construct),
    ingestDetached:
      overrides.ingestDetached ??
      overrides.ingest ??
      construct.ingestDetached.bind(construct),
    queueNextNapPin:
      overrides.queueNextNapPin ?? construct.queueNextNapPin.bind(construct),
    queueNextNapImprint:
      overrides.queueNextNapImprint ??
      construct.queueNextNapImprint.bind(construct),
    rate: overrides.rate ?? construct.rate.bind(construct),
    steer: overrides.steer ?? construct.steer.bind(construct),
    nap: overrides.nap ?? construct.nap.bind(construct),
    startHypno: overrides.startHypno ?? construct.startHypno.bind(construct),
    chatHypnoReview:
      overrides.chatHypnoReview ?? construct.chatHypnoReview.bind(construct),
    acceptHypno: overrides.acceptHypno ?? construct.acceptHypno.bind(construct),
    updateHypno: overrides.updateHypno ?? construct.updateHypno.bind(construct),
    cancelHypno: overrides.cancelHypno ?? construct.cancelHypno.bind(construct),
    isHypnoActive:
      overrides.isHypnoActive ?? construct.isHypnoActive.bind(construct),
  };

  if (overrides.reflectPerceptionSourceFact) {
    patch.reflectPerceptionSourceFact = overrides.reflectPerceptionSourceFact;
  }
  if (overrides.reflectSteeringDirective) {
    patch.reflectSteeringDirective = overrides.reflectSteeringDirective;
  }

  Object.assign(construct, patch);

  return construct;
}

export async function disposeMailboxProcessorConstructs(): Promise<void> {
  while (activeHarnesses.length > 0) {
    await activeHarnesses.pop()!.dispose();
  }
}

export function createDefaultRuntimeState(): RuntimeStateSnapshot {
  return {
    activeImpulses: 0,
    scheduledResponses: 0,
    activeResponses: 0,
    schedulerBusy: false,
  };
}
