/**
 * useConstructLab — the single hook for construct lab live state management.
 *
 * Encapsulates:
 * - Seeding ConstructViewState from loader snapshot data
 * - SSE stream connection via useLive with latency-instrumented reducers
 * - Reconnection cursor sync
 * - Projection via projectConstructViewState
 * - Optimistic chat overlay (sticky state + canonical-match clear)
 * - Selected response ID tracking
 * - Action submission with full lifecycle (optimistic, snapshot apply)
 * - Edit mode (pause construct, direct VFS CRUD for context files)
 *
 * The consumer provides product-specific bits (stream handler, path params,
 * action/edit callbacks) and gets back a fully managed lab view.
 */

import type {
  AnyEventStreamHandler,
  LiveReducer,
} from '@inkibra/router/lib/use-event-stream-hooks';
import { useLive } from '@inkibra/router/lib/use-event-stream-hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildConstructLivePathQuery,
  isConstructLiveReconnectStatus,
} from '../live/connection';
import type { ConstructInFlightItem } from '../live/in-flight';
import {
  installConstructLatencyDevtools,
  noteConstructLatencyChatAccepted,
  noteConstructLatencyChatSubmit,
  noteConstructLatencyFirstDelta,
  noteConstructLatencyProjectionRender,
  noteConstructLatencyStreamEvent,
} from '../live/latency-tracker';
import type { ConstructLiveDecisionEntry } from '../live/runtime-state';
import type { ConstructLiveResponseHistory } from '../live/selectors';
import type {
  ConstructSnapshot,
  ConstructSnapshotTranscriptMessage,
} from '../live/snapshot-types';
import {
  type ConstructViewStreamEventMap,
  constructViewStreamHandlers,
} from '../live/view-event-adapter';
import {
  type ConstructRuntimeFullSnapshotView,
  type ConstructRuntimeScheduledResponseView,
  type ConstructViewIngressIssue,
  type ConstructViewProjection,
  type ConstructViewState,
  createConstructViewState,
  projectConstructViewState,
  replaceConstructViewConstructSnapshot,
  replaceConstructViewRuntimeSnapshot,
  replaceConstructViewSnapshot,
} from '../live/view-machine';
import type { LabRouteImplementations } from './create-lab-callbacks';
import type { ConstructEditModeState } from './lab-edit-mode';
import {
  type OptimisticSendingChat,
  overlayOptimisticSendingChat,
} from './lab-optimistic';
import type { ConstructLabAction, ConstructStudioContextFile } from './types';

// ---------------------------------------------------------------------------
// Debug helpers (client-only, localStorage-gated)
// ---------------------------------------------------------------------------

function getConstructLiveDebugFactIdClient(): string | undefined {
  try {
    const value = globalThis.localStorage?.getItem('constructLiveDebugFactId');
    return value && value.trim().length > 0 ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

function logConstructLiveHookDebug(scope: string, payload: unknown): void {
  const factId = getConstructLiveDebugFactIdClient();
  if (!factId) {
    return;
  }
  try {
    console.debug(
      `[construct-lab-hook:${scope}] ${JSON.stringify(
        {
          factId,
          ...(payload && typeof payload === 'object'
            ? (payload as Record<string, unknown>)
            : { payload }),
        },
        null,
        2,
      )}`,
    );
  } catch {
    // Ignore console failures.
  }
}

// ---------------------------------------------------------------------------
// Hook input types
// ---------------------------------------------------------------------------

/**
 * Snapshot bundle provided by the route loader.
 */
export type ConstructLabSnapshotBundle = {
  cursor?: string;
  constructSnapshot: ConstructSnapshot;
  runtimeSnapshot: ConstructRuntimeFullSnapshotView;
  /** Initial context files from the loader (optional — loaded on edit mode entry if not provided) */
  contextFiles?: ConstructStudioContextFile[];
  /** Initial active context file path from the loader */
  activeContextFilePath?: string;
};

/**
 * Standardized result from a lab action submission.
 * The consumer's `submitAction` callback should return this shape.
 */
export type ConstructLabActionResult =
  | {
      type: 'Accepted';
      opId?: string;
      queuedAt: string;
      action: string;
    }
  | {
      type: 'Snapshot';
      snapshot: ConstructSnapshot;
    }
  | {
      type: 'Rejected';
      message: string;
    };

/** Extract the return type of a route handler's .execute */
type RouteResult<K extends keyof LabRouteImplementations> = Awaited<
  ReturnType<LabRouteImplementations[K]['execute']>
>;

/**
 * Callbacks for server communication.
 * Simple domain signatures — pathParams and ctx are pre-bound by the caller.
 * Return types extracted from the route handler .execute() — same type path.
 */
export type ConstructLabCallbacks = {
  submitAction: (
    action: ConstructLabAction,
  ) => Promise<RouteResult<'submitAction'>>;
  enterEditMode: () => Promise<RouteResult<'enterEditMode'>>;
  exitEditMode: () => Promise<RouteResult<'exitEditMode'>>;
  readFile: (path: string) => Promise<RouteResult<'readFile'>>;
  writeFile: (
    path: string,
    content: string,
  ) => Promise<RouteResult<'writeFile'>>;
  deleteFile: (path: string) => Promise<RouteResult<'deleteFile'>>;
  listFiles: () => Promise<RouteResult<'listFiles'>>;
  refreshSnapshot?: () => Promise<ConstructLabSnapshotBundle | undefined>;
};

/**
 * Options for the useConstructLab hook.
 */
export type UseConstructLabOptions = {
  /** Snapshot data from the route loader */
  snapshot: ConstructLabSnapshotBundle;
  /** SSE event stream handler (product-specific route) */
  streamHandler: AnyEventStreamHandler;
  /** Construct ID (for latency tracking) */
  constructId?: string;
  /** Path params for the SSE connection */
  pathParams: Record<string, string>;
  /** Additional path query for the SSE connection (e.g., { gymTrainerBindingId }) */
  pathQuery?: Record<string, string | undefined>;
  /** Callbacks — route handler implementations, never throw */
  callbacks: ConstructLabCallbacks;
};

const SNAPSHOT_REFRESH_POLL_INTERVAL_MS = 2_000;
const SNAPSHOT_REFRESH_POLL_MAX_ATTEMPTS = 30;

// ---------------------------------------------------------------------------
// Hook return types
// ---------------------------------------------------------------------------

/**
 * CRUD interface for context files during edit mode.
 */
export type ConstructLabFileCrud = {
  read: (path: string) => Promise<string>;
  write: (path: string, content: string) => Promise<void>;
  delete: (path: string) => Promise<void>;
  list: () => Promise<void>;
};

/**
 * The complete lab view returned by useConstructLab.
 */
export type ConstructLabView = {
  // -- Projected construct view --
  /** Full projection (all derived views from SSE + snapshot state) */
  projected: ConstructViewProjection;
  /** Final transcript with optimistic overlay applied */
  transcript: ConstructSnapshotTranscriptMessage[];
  /** Final in-flight items with optimistic overlay applied */
  inFlightItems: ConstructInFlightItem[];
  /** Live response histories */
  liveResponseHistories: ConstructLiveResponseHistory[];
  /** Live decision entries */
  liveDecisionEntries: ConstructLiveDecisionEntry[];
  /** Scheduled responses for view */
  scheduledResponsesForView: ConstructRuntimeScheduledResponseView[];
  /** Live impulse thinking text by impulse ID */
  liveImpulseThinkingById: Record<string, string>;
  /** Whether a command (nap/hypno/compaction) is currently in flight */
  commandInFlight: boolean;
  /** Current ingress issue (warning/error) */
  ingressIssue?: ConstructViewIngressIssue;

  // -- Stream status --
  /** SSE stream status */
  streamStatus:
    | 'connecting'
    | 'connected'
    | 'error'
    | 'disconnected'
    | 'completed';
  /** SSE error message if any */
  streamError?: string;

  // -- Selected response --
  /** Selected response history ID (resolved against available histories) */
  selectedResponseId?: string;
  /** Select a response history by ID */
  selectResponse: (id: string | undefined) => void;

  // -- Context files / edit mode --
  /** Current edit mode state */
  editModeState: ConstructEditModeState;
  /** Context files (from loader or edit mode) */
  contextFiles: ConstructStudioContextFile[];
  /** Active context file path */
  activeContextFilePath?: string;
  /** Enter edit mode — pauses construct, loads context files */
  enterEditMode: () => Promise<void>;
  /** Exit edit mode — flushes changes, resumes construct */
  exitEditMode: () => Promise<void>;
  /** File CRUD (only usable during edit mode) */
  files: ConstructLabFileCrud;

  // -- Action submission --
  /** Submit a lab action (chat, nap, steer, rate). Manages optimistic state internally. */
  submit: (action: ConstructLabAction) => Promise<void>;
  /** Whether a submission is currently in flight */
  isSubmitting: boolean;

  // -- Low-level APIs --
  /** Apply a runtime snapshot update (for runtime action responses) */
  applyRuntimeSnapshot: (snapshot: ConstructRuntimeFullSnapshotView) => void;
  /** Low-level state mutate for advanced use cases */
  mutate: (updater: (state: ConstructViewState) => ConstructViewState) => void;
};

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

export function useConstructLab(
  options: UseConstructLabOptions,
): ConstructLabView {
  const { snapshot, streamHandler, pathParams, pathQuery, callbacks } = options;

  // -------------------------------------------------------------------------
  // 1. Seed ConstructViewState from loader data
  // -------------------------------------------------------------------------

  const constructViewSeedKey = useMemo(
    () =>
      JSON.stringify({
        cursor: snapshot.cursor,
        constructSnapshot: snapshot.constructSnapshot,
        runtimeSnapshot: snapshot.runtimeSnapshot,
      }),
    [snapshot.cursor, snapshot.constructSnapshot, snapshot.runtimeSnapshot],
  );

  const seededConstructViewState = useMemo(
    () =>
      createConstructViewState({
        cursor: snapshot.cursor,
        constructSnapshot: snapshot.constructSnapshot,
        runtimeSnapshot: snapshot.runtimeSnapshot,
      }),
    [snapshot.cursor, snapshot.constructSnapshot, snapshot.runtimeSnapshot],
  );

  // -------------------------------------------------------------------------
  // 2. Connect cursor management
  // -------------------------------------------------------------------------

  const [connectCursor, setConnectCursor] = useState<string | undefined>(
    seededConstructViewState.cursor,
  );

  const appliedConstructViewSeedKeyRef = useRef(constructViewSeedKey);
  useEffect(() => {
    if (appliedConstructViewSeedKeyRef.current === constructViewSeedKey) {
      return;
    }
    appliedConstructViewSeedKeyRef.current = constructViewSeedKey;
    setConnectCursor(seededConstructViewState.cursor);
  }, [constructViewSeedKey, seededConstructViewState]);

  // -------------------------------------------------------------------------
  // 3. Edit mode state
  // -------------------------------------------------------------------------

  const [editModeState, setEditModeState] =
    useState<ConstructEditModeState>('running');
  const [contextFiles, setContextFiles] = useState<
    ConstructStudioContextFile[]
  >(snapshot.contextFiles ?? []);
  const [activeContextFilePath, setActiveContextFilePath] = useState<
    string | undefined
  >(snapshot.activeContextFilePath);

  // -------------------------------------------------------------------------
  // 4. Build stream path query with cursor
  //    When in edit mode, pass undefined to disconnect SSE
  // -------------------------------------------------------------------------

  const streamPathQuery = useMemo(
    () =>
      buildConstructLivePathQuery(
        (pathQuery ?? {}) as Record<string, string>,
        connectCursor,
      ),
    [connectCursor, pathQuery],
  );

  const isEditing =
    editModeState === 'editing' ||
    editModeState === 'entering_edit' ||
    editModeState === 'exiting_edit';

  const streamParams = useMemo(
    () =>
      isEditing
        ? undefined
        : {
            pathParams,
            pathQuery: streamPathQuery,
          },
    [isEditing, pathParams, streamPathQuery],
  );

  // -------------------------------------------------------------------------
  // 5. Build latency-instrumented stream reducer
  // -------------------------------------------------------------------------

  // Track which responses have had their first delta recorded so we only note it once.
  const firstDeltaSeenRef = useRef(new Set<string>());

  const streamReducer = useMemo<
    LiveReducer<ConstructViewState, ConstructViewStreamEventMap>
  >(
    () => ({
      streamCursor: (state, event) => {
        noteConstructLatencyStreamEvent({ type: 'streamCursor', event });
        return constructViewStreamHandlers.streamCursor(state, event);
      },
      constructEvent: (state, event) => {
        if (!event?.event) return state;
        noteConstructLatencyStreamEvent({ type: 'constructEvent', event });
        return constructViewStreamHandlers.constructEvent(state, event);
      },
      thinkingDelta: (state, event) => {
        noteConstructLatencyStreamEvent({ type: 'thinkingDelta', event });
        return constructViewStreamHandlers.thinkingDelta(state, event);
      },
      responseThinkingDelta: (state, event) => {
        noteConstructLatencyStreamEvent({
          type: 'responseThinkingDelta',
          event,
        });
        return constructViewStreamHandlers.responseThinkingDelta(state, event);
      },
      responseDelta: (state, event) => {
        noteConstructLatencyStreamEvent({ type: 'responseDelta', event });
        if (!firstDeltaSeenRef.current.has(event.responseId)) {
          firstDeltaSeenRef.current.add(event.responseId);
          noteConstructLatencyFirstDelta({
            responseId: event.responseId,
            serverTs: event.ts,
          });
        }
        return constructViewStreamHandlers.responseDelta(state, event);
      },
      sourceFactLifecycle: (state, event) => {
        noteConstructLatencyStreamEvent({
          type: 'sourceFactLifecycle',
          event,
        });
        const nextState = constructViewStreamHandlers.sourceFactLifecycle(
          state,
          event,
        );
        if (event.factId === getConstructLiveDebugFactIdClient()) {
          logConstructLiveHookDebug('sourceFactLifecycle', {
            event,
            previousFrontier: state.frontier,
            nextFrontier: nextState.frontier,
          });
        }
        return nextState;
      },
      ingressAccepted: (state, event) => {
        noteConstructLatencyStreamEvent({ type: 'ingressAccepted', event });
        return constructViewStreamHandlers.ingressAccepted(state, event);
      },
      ingressCommitted: (state, event) => {
        noteConstructLatencyStreamEvent({ type: 'ingressCommitted', event });
        return constructViewStreamHandlers.ingressCommitted(state, event);
      },
      ingressStalled: (state, event) => {
        noteConstructLatencyStreamEvent({ type: 'ingressStalled', event });
        return constructViewStreamHandlers.ingressStalled(state, event);
      },
      frontierAdvanced: (state, event) => {
        noteConstructLatencyStreamEvent({ type: 'frontierAdvanced', event });
        const nextState = constructViewStreamHandlers.frontierAdvanced(
          state,
          event,
        );
        if (getConstructLiveDebugFactIdClient()) {
          logConstructLiveHookDebug('frontierAdvanced', {
            event,
            previousFrontier: state.frontier,
            nextFrontier: nextState.frontier,
          });
        }
        return nextState;
      },
    }),
    [],
  );

  // -------------------------------------------------------------------------
  // 6. Connect SSE stream via useLive
  // -------------------------------------------------------------------------

  const {
    data: constructViewState,
    status: streamStatus,
    error: streamError,
    mutate: mutateConstructViewState,
  } = useLive(
    seededConstructViewState,
    streamHandler,
    streamParams,
    {},
    streamReducer,
  );

  // -------------------------------------------------------------------------
  // 7. Reconnection cursor sync
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!isConstructLiveReconnectStatus(streamStatus)) {
      return;
    }

    setConnectCursor((current) =>
      current === constructViewState.cursor
        ? current
        : constructViewState.cursor,
    );
  }, [constructViewState.cursor, streamStatus]);

  // -------------------------------------------------------------------------
  // 8. Project view state
  // -------------------------------------------------------------------------

  const projected = useMemo(
    () => projectConstructViewState(constructViewState),
    [constructViewState],
  );

  useEffect(() => {
    noteConstructLatencyProjectionRender(projected);
  }, [projected]);

  // Install devtools helpers once on mount so they're callable from browser console:
  //   __constructLatency()        → print all recent traces
  //   __constructLatency('id')    → print specific trace
  //   __constructLatencyStore()   → raw store
  useEffect(() => {
    installConstructLatencyDevtools();
  }, []);

  // -------------------------------------------------------------------------
  // 9. Optimistic chat overlay
  // -------------------------------------------------------------------------

  const [stickyOptimisticChat, setStickyOptimisticChat] = useState<
    OptimisticSendingChat | undefined
  >(undefined);

  const optimisticOverlay = useMemo(
    () =>
      overlayOptimisticSendingChat({
        transcript: projected.constructSnapshot.transcript,
        inFlightItems: projected.inFlightItems,
        optimisticChat: stickyOptimisticChat,
      }),
    [
      projected.constructSnapshot.transcript,
      projected.inFlightItems,
      stickyOptimisticChat,
    ],
  );

  useEffect(() => {
    if (optimisticOverlay.matchedCanonical) {
      setStickyOptimisticChat(undefined);
    }
  }, [optimisticOverlay.matchedCanonical]);

  // Poll snapshots after an accepted chat action so the lab still converges
  // when SSE is delayed, disconnected, or unavailable in preview environments.
  const stickyOptimisticChatRef = useRef<OptimisticSendingChat | undefined>(
    stickyOptimisticChat,
  );
  useEffect(() => {
    stickyOptimisticChatRef.current = stickyOptimisticChat;
  }, [stickyOptimisticChat]);

  useEffect(() => {
    if (editModeState !== 'running') {
      return;
    }
    if (!stickyOptimisticChat?.queuedAt || !callbacks.refreshSnapshot) {
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    const scheduleNext = () => {
      if (cancelled) {
        return;
      }
      if (!stickyOptimisticChatRef.current?.queuedAt) {
        return;
      }
      if (attempts >= SNAPSHOT_REFRESH_POLL_MAX_ATTEMPTS) {
        return;
      }

      timeoutId = setTimeout(() => {
        void pollSnapshot();
      }, SNAPSHOT_REFRESH_POLL_INTERVAL_MS);
    };

    const pollSnapshot = async () => {
      if (cancelled || !callbacks.refreshSnapshot) {
        return;
      }
      if (!stickyOptimisticChatRef.current?.queuedAt) {
        return;
      }

      attempts += 1;
      const nextSnapshot = await callbacks.refreshSnapshot();
      if (cancelled) {
        return;
      }

      if (nextSnapshot) {
        mutateConstructViewState((state) =>
          replaceConstructViewSnapshot(state, {
            cursor: nextSnapshot.cursor,
            constructSnapshot: nextSnapshot.constructSnapshot,
            runtimeSnapshot: nextSnapshot.runtimeSnapshot,
          }),
        );
        setConnectCursor((current) =>
          current === nextSnapshot.cursor ? current : nextSnapshot.cursor,
        );
        if (nextSnapshot.contextFiles !== undefined) {
          setContextFiles(nextSnapshot.contextFiles);
        }
        if ('activeContextFilePath' in nextSnapshot) {
          setActiveContextFilePath(nextSnapshot.activeContextFilePath);
        }
      }

      scheduleNext();
    };

    scheduleNext();

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [
    callbacks,
    editModeState,
    mutateConstructViewState,
    stickyOptimisticChat?.queuedAt,
  ]);

  // -------------------------------------------------------------------------
  // 10. Selected response tracking
  // -------------------------------------------------------------------------

  const [selectedResponseId, setSelectedResponseId] = useState<
    string | undefined
  >(undefined);

  const selectedResponseIdForView = useMemo(() => {
    if (
      selectedResponseId &&
      projected.liveResponseHistories.some(
        (history) => history.responseId === selectedResponseId,
      )
    ) {
      return selectedResponseId;
    }

    return projected.liveResponseHistories.some(
      (history) => history.responseId === projected.defaultSelectedResponseId,
    )
      ? projected.defaultSelectedResponseId
      : projected.liveResponseHistories[0]?.responseId;
  }, [
    projected.defaultSelectedResponseId,
    projected.liveResponseHistories,
    selectedResponseId,
  ]);

  // -------------------------------------------------------------------------
  // 11. Action submission
  // -------------------------------------------------------------------------

  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = useCallback(
    async (action: ConstructLabAction) => {
      setIsSubmitting(true);

      // Optimistic chat
      let chatMessage: string | undefined;
      let pendingId: string | undefined;
      if (action.action === 'chat') {
        chatMessage = action.message;
        pendingId = `submit:${Date.now()}`;
        const createdAt = new Date().toISOString();
        setStickyOptimisticChat({
          id: `optimistic:${createdAt}:${Math.random().toString(36).slice(2, 8)}`,
          message: action.message,
          createdAt,
        });
        noteConstructLatencyChatSubmit({
          constructId:
            options.constructId ?? Object.values(pathParams)[0] ?? 'unknown',
          pendingId,
          message: action.message,
        });
      }

      const result = await callbacks.submitAction(action);

      if (result.type === 'Ok') {
        const value = result.value;
        if ('transcript' in value) {
          // Full snapshot returned
          mutateConstructViewState((state) =>
            replaceConstructViewConstructSnapshot(
              state,
              value as ConstructSnapshot,
            ),
          );
        } else if ('queuedAt' in value && chatMessage) {
          // Accepted
          const accepted = value as { opId?: string; queuedAt: string };
          setStickyOptimisticChat((current) =>
            current && current.message === chatMessage
              ? {
                  ...current,
                  ...(accepted.opId ? { factId: accepted.opId } : {}),
                  queuedAt: accepted.queuedAt,
                }
              : current,
          );
          if (accepted.opId) {
            noteConstructLatencyChatAccepted({
              pendingId: pendingId ?? `submit:${Date.now()}`,
              message: chatMessage,
              factId: accepted.opId,
              opId: accepted.opId,
              queuedAt: accepted.queuedAt,
            });
          }
        }
      } else if (chatMessage) {
        // Err — reject optimistic chat
        setStickyOptimisticChat((current) =>
          current && current.message === chatMessage ? undefined : current,
        );
      }

      setIsSubmitting(false);
    },
    [callbacks, mutateConstructViewState, pathParams, options.constructId],
  );

  // -------------------------------------------------------------------------
  // 12. Edit mode lifecycle
  // -------------------------------------------------------------------------

  const enterEditMode = useCallback(async () => {
    if (editModeState !== 'running') {
      return;
    }
    setEditModeState('entering_edit');
    const result = await callbacks.enterEditMode();
    if (result.type === 'Ok') {
      setContextFiles(result.value.contextFiles);
      setActiveContextFilePath(result.value.activeContextFilePath);
      setEditModeState('editing');
    } else {
      setEditModeState('running');
    }
  }, [callbacks, editModeState]);

  const exitEditMode = useCallback(async () => {
    if (editModeState !== 'editing') {
      return;
    }
    setEditModeState('exiting_edit');
    await callbacks.exitEditMode();
    setEditModeState('running');
  }, [callbacks, editModeState]);

  // -------------------------------------------------------------------------
  // 13. File CRUD (edit mode only)
  // -------------------------------------------------------------------------

  const files: ConstructLabFileCrud = useMemo(
    () => ({
      read: async (path: string) => {
        const result = await callbacks.readFile(path);
        return result.type === 'Ok' ? result.value.content : '';
      },
      write: async (path: string, content: string) => {
        await callbacks.writeFile(path, content);
        const listResult = await callbacks.listFiles();
        if (listResult.type === 'Ok') {
          setContextFiles(listResult.value.contextFiles);
          setActiveContextFilePath(listResult.value.activeContextFilePath);
        }
      },
      delete: async (path: string) => {
        await callbacks.deleteFile(path);
        const listResult = await callbacks.listFiles();
        if (listResult.type === 'Ok') {
          setContextFiles(listResult.value.contextFiles);
          setActiveContextFilePath(listResult.value.activeContextFilePath);
        }
      },
      list: async () => {
        const listResult = await callbacks.listFiles();
        if (listResult.type === 'Ok') {
          setContextFiles(listResult.value.contextFiles);
          setActiveContextFilePath(listResult.value.activeContextFilePath);
        }
      },
    }),
    [callbacks],
  );

  // -------------------------------------------------------------------------
  // 14. Low-level APIs
  // -------------------------------------------------------------------------

  const applyRuntimeSnapshot = useCallback(
    (runtimeSnapshot: ConstructRuntimeFullSnapshotView) => {
      mutateConstructViewState((state) =>
        replaceConstructViewRuntimeSnapshot(state, runtimeSnapshot),
      );
    },
    [mutateConstructViewState],
  );

  const mutate = useCallback(
    (updater: (state: ConstructViewState) => ConstructViewState) => {
      mutateConstructViewState(updater);
    },
    [mutateConstructViewState],
  );

  // -------------------------------------------------------------------------
  // 15. Return the composed view
  // -------------------------------------------------------------------------

  return {
    projected,
    transcript: optimisticOverlay.transcript,
    inFlightItems: optimisticOverlay.inFlightItems,
    liveResponseHistories: projected.liveResponseHistories,
    liveDecisionEntries: projected.liveDecisionEntries,
    scheduledResponsesForView: projected.scheduledResponsesForView,
    liveImpulseThinkingById: projected.liveImpulseThinkingById,
    commandInFlight: projected.commandInFlight,
    ingressIssue: projected.ingressIssue,
    streamStatus,
    streamError: streamError?.message,
    selectedResponseId: selectedResponseIdForView,
    selectResponse: setSelectedResponseId,
    editModeState,
    contextFiles,
    activeContextFilePath,
    enterEditMode,
    exitEditMode,
    files,
    submit,
    isSubmitting,
    applyRuntimeSnapshot,
    mutate,
  };
}
