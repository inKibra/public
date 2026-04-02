/** @jsxImportSource react */

import {
  ConstructControlSurface,
  ConstructInputBar,
  type ConstructLabAction,
  type ConstructLabSnapshot,
  type ConstructLabSnapshotBundle,
  useConstructLab,
} from '@inkibra/ai-construct';
import type { RoutePageProps } from '@inkibra/router';
import { useCallback, useMemo, useState } from 'react';
import { createLabCallbacksFromApi } from '../../../lab/create-lab-callbacks';
import type { ContextTrace } from '../../../vfs/context-system';
import type { devAppRoutes } from '../route-tree';
import type { DevLabLoaderResponse } from '../schemas.schemas';

/** Typed page props derived from the route tree definition */
type DevLabRouteProps = RoutePageProps<
  (typeof devAppRoutes.$pages.main)[':constructId']['main']['lab']
>;

type DevLabApiImplementations = DevLabRouteProps['apiImplementations'];
type DevLabEventStreams = DevLabRouteProps['eventStreams'];
type DevLabCtx = DevLabRouteProps['ctx'];

function DevLabLivePage({
  snapshotBundle: initialSnapshotBundle,
  constructId,
  apiImplementations,
  eventStreams,
  ctx,
}: {
  snapshotBundle: DevLabLoaderResponse;
  constructId: string;
  apiImplementations: DevLabApiImplementations;
  eventStreams: DevLabEventStreams;
  ctx: DevLabCtx;
}) {
  const [snapshotOverride, setSnapshotOverride] =
    useState<DevLabLoaderResponse | null>(null);
  const snapshotBundle = snapshotOverride ?? initialSnapshotBundle;

  const refreshSnapshot = useCallback(async (): Promise<
    ConstructLabSnapshotBundle | undefined
  > => {
    const result = await apiImplementations.getDevCombinedSnapshot.execute(
      {
        pathParams: { constructId },
        pathQuery: { view: 'lab' },
        body: {},
        files: undefined,
      },
      {},
    );
    if (
      result.type !== 'Ok' ||
      !result.value?.studio ||
      !result.value?.lab ||
      !result.value?.runtime
    ) {
      return undefined;
    }

    const nextSnapshotBundle: DevLabLoaderResponse = {
      cursor: result.value.cursor,
      studioSnapshot: result.value.studio,
      labSnapshot: result.value.lab,
      runtimeSnapshot: result.value.runtime,
    } as DevLabLoaderResponse;
    setSnapshotOverride(nextSnapshotBundle);
    return {
      cursor: nextSnapshotBundle.cursor,
      constructSnapshot: nextSnapshotBundle.labSnapshot,
      runtimeSnapshot: nextSnapshotBundle.runtimeSnapshot,
      contextFiles: nextSnapshotBundle.studioSnapshot.contextFiles,
      activeContextFilePath:
        nextSnapshotBundle.studioSnapshot.activeContextFilePath,
    };
  }, [apiImplementations, constructId]);
  const callbacks = useMemo(
    () => ({
      ...createLabCallbacksFromApi(
        {
          submitAction: apiImplementations.applyConstructLabAction,
          enterEditMode: apiImplementations.enterConstructEditMode,
          exitEditMode: apiImplementations.exitConstructEditMode,
          readFile: apiImplementations.readConstructFile,
          writeFile: apiImplementations.writeConstructFile,
          deleteFile: apiImplementations.deleteConstructFile,
          listFiles: apiImplementations.listConstructFiles,
        },
        constructId,
        ctx,
      ),
      refreshSnapshot,
    }),
    [apiImplementations, constructId, ctx, refreshSnapshot],
  );

  const lab = useConstructLab({
    snapshot: {
      cursor: snapshotBundle.cursor,
      constructSnapshot: snapshotBundle.labSnapshot,
      runtimeSnapshot: snapshotBundle.runtimeSnapshot,
      contextFiles: snapshotBundle.studioSnapshot.contextFiles,
      activeContextFilePath:
        snapshotBundle.studioSnapshot.activeContextFilePath,
    },
    streamHandler: eventStreams.streamConstructRuntimeEvents,
    pathParams: { constructId },
    callbacks,
  });

  return (
    <ConstructControlSurface
      studioSnapshot={snapshotBundle.studioSnapshot}
      labSnapshot={{
        ...(lab.projected.constructSnapshot as ConstructLabSnapshot),
        transcript: lab.transcript as ConstructLabSnapshot['transcript'],
      }}
      runtimeSnapshot={{
        ...snapshotBundle.runtimeSnapshot,
        ...lab.projected.runtimeSnapshot,
      }}
      liveResponseHistories={lab.liveResponseHistories}
      selectedResponseId={lab.selectedResponseId}
      liveDecisionEntries={lab.liveDecisionEntries}
      inFlightItems={lab.inFlightItems}
      scheduledResponsesForView={lab.scheduledResponsesForView}
      liveImpulseThinkingById={lab.liveImpulseThinkingById}
      commandInFlight={lab.commandInFlight}
      editModeActive={lab.editModeState === 'editing'}
      editModeState={lab.editModeState}
      onEnterEditMode={() => void lab.enterEditMode()}
      onExitEditMode={() => void lab.exitEditMode()}
      streamStatus={lab.streamStatus}
      streamErrorMessage={lab.streamError}
      ingressIssue={lab.ingressIssue}
      onSelectResponse={lab.selectResponse}
      onLabAction={(action) => void lab.submit(action as ConstructLabAction)}
      inputSlot={
        <ConstructInputBar
          hypnoActive={snapshotBundle.labSnapshot.hypno?.active ?? false}
          hypnoStage={snapshotBundle.labSnapshot.hypno?.stage ?? 'idle'}
          commandInFlight={lab.commandInFlight}
          editModeActive={lab.editModeState === 'editing'}
          onAction={(action: ConstructLabAction) => void lab.submit(action)}
        />
      }
      onFetchLanes={async () => {
        const result = await apiImplementations.getDevLanes.execute(
          {
            pathParams: { constructId },
            pathQuery: {},
            body: {},
            files: undefined,
          },
          ctx,
        );
        if (result.type === 'Ok' && result.value) {
          return Object.keys(result.value as Record<string, unknown>);
        }
        return [];
      }}
      onFetchTrace={async (stage, lane) => {
        const result = await apiImplementations.getDevContextTrace.execute(
          {
            pathParams: { constructId },
            pathQuery: { stage, lane },
            body: {},
            files: undefined,
          },
          ctx,
        );
        if (result.type === 'Ok' && result.value) {
          return result.value as ContextTrace;
        }
        return null;
      }}
      onReadFile={async (path) => {
        const result = await apiImplementations.readConstructFile.execute(
          {
            pathParams: { constructId },
            pathQuery: {},
            body: { path },
            files: undefined,
          },
          ctx,
        );
        if (result.type === 'Ok' && result.value) {
          return result.value.content ?? '';
        }
        return '';
      }}
      onRefresh={() => void refreshSnapshot()}
      initialFocus="transcript"
    />
  );
}

export default function DevLabRoutePage(props: DevLabRouteProps) {
  const snapshotBundle =
    props.loaderData?.type === 'Ok' ? props.loaderData.value : undefined;
  const constructId = props.params.constructId;

  if (!snapshotBundle || !constructId) {
    return (
      <div style={{ color: '#fca5a5', padding: 18 }}>
        Lab data unavailable. Make sure the construct exists.
      </div>
    );
  }

  return (
    <DevLabLivePage
      snapshotBundle={snapshotBundle}
      constructId={constructId}
      apiImplementations={props.apiImplementations}
      eventStreams={props.eventStreams}
      ctx={props.ctx}
    />
  );
}
