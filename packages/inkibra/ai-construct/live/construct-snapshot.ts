import {
  loadPendingNextNapImprints,
  loadPendingNextNapPins,
} from '../vfs/nap-instructions';
import { loadResponseLifecycleState } from '../vfs/response-lifecycle-state';
import { buildConstructHypnoSnapshot } from './hypno-snapshot';
import type {
  BuildConstructSnapshotOptions,
  ConstructSnapshot,
} from './snapshot-types';
import { buildConstructSnapshotTranscript } from './transcript-snapshot';

export async function buildConstructSnapshot(
  options: BuildConstructSnapshotOptions,
): Promise<ConstructSnapshot> {
  const vfs = options.construct.getVfs();
  const responseLifecyclePromise = loadResponseLifecycleState(vfs);
  const [runtimeState, pendingPins, pendingImprints, transcript, hypno] =
    await Promise.all([
      options.construct.getRuntimeState(),
      loadPendingNextNapPins(vfs),
      loadPendingNextNapImprints(vfs),
      buildConstructSnapshotTranscript({
        construct: options.construct,
        sourceFacts: options.sourceFacts,
        responseLifecycleById: await responseLifecyclePromise,
        mailboxPreview: options.mailboxPreview,
        frontier: options.frontier,
        transcriptLimit: options.transcriptLimit,
      }),
      Promise.resolve(buildConstructHypnoSnapshot(options.construct)),
    ]);

  return {
    transcript,
    frontier: options.frontier,
    hypno,
    queuedNextNapPins: pendingPins.map((entry) => ({
      id: entry.id,
      path: entry.path,
      createdAt: entry.createdAt,
    })),
    queuedNextNapImprints: pendingImprints.map((entry) => ({
      id: entry.id,
      text: entry.text,
      createdAt: entry.createdAt,
    })),
    toolLog: options.toolLog,
    decisionLog: options.decisionLog,
    runtimeState,
  };
}
