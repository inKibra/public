import type { ReactNode } from 'react';
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  ConstructLabSnapshot,
  ConstructRuntimeSnapshot,
  ConstructStudioAction,
  ConstructStudioSnapshot,
} from '../lab/types';
import type { ConstructInFlightItem } from '../live/in-flight';
import type {
  ConstructLiveResponseDecision,
  ConstructLiveResponseHistory,
} from '../live/selectors';
import { css, cx } from '../styled-system/css';
import type { ContextTrace } from '../vfs/context-system';
import { ConstructContextPanel } from './context-panel';
import { ConstructDirectoryPanelBody } from './directory-panel';
import { ConstructFilePanelBody } from './file-panel';
import { ConstructImpulsePanel } from './impulse-panel';
import { ConstructNapPanelBody } from './nap-panel';
import {
  chipAccentClass,
  chipClass,
  chipWarningClass,
  dotClass,
  panelHeaderClass,
} from './styles';
import { ConstructThinkingPanel } from './thinking-panel';
import { ConstructTranscriptPanelBody } from './transcript-panel';
import { useIsMobile } from './use-is-mobile';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The active tab in the center workspace. */
export type CenterTab = 'chat' | 'nap' | `file:${string}`;

export type ConstructControlSurfaceProps<
  TLabAction = unknown,
  TRuntimeAction = unknown,
> = {
  studioSnapshot: ConstructStudioSnapshot;
  labSnapshot: ConstructLabSnapshot;
  runtimeSnapshot: ConstructRuntimeSnapshot;
  liveResponseHistories?: ConstructLiveResponseHistory[];
  selectedResponseId?: string;
  liveDecisionEntries?: ConstructLiveResponseDecision[];
  inFlightItems?: ConstructInFlightItem[];
  scheduledResponsesForView?: ConstructRuntimeSnapshot['scheduledResponses'];
  liveImpulseThinkingById?: Record<string, string>;
  commandInFlight?: boolean;
  /** Whether the lab is in edit mode — relaxes read-only banner on file panels. */
  editModeActive?: boolean;
  /** Full edit mode lifecycle state — drives the toggle button in the context rail. */
  editModeState?: 'running' | 'entering_edit' | 'editing' | 'exiting_edit';
  /** Called when the user requests to enter edit mode. */
  onEnterEditMode?: () => void;
  /** Called when the user requests to exit edit mode. */
  onExitEditMode?: () => void;
  streamStatus?:
    | 'disconnected'
    | 'connecting'
    | 'connected'
    | 'completed'
    | 'error';
  streamErrorMessage?: string;
  ingressIssue?: {
    level: 'warning' | 'error';
    message: string;
    ref?: string;
    ts: string;
  };
  onContextAction?: (action: ConstructStudioAction) => void;
  onLabAction?: (action: TLabAction) => void;
  onRuntimeAction?: (action: TRuntimeAction) => void;
  onSelectResponse?: (responseId: string) => void;
  initialFocus?: FocusTarget;
  /** Controlled center tab (overrides internal state when provided). */
  centerTab?: CenterTab;
  onCenterTabChange?: (tab: CenterTab) => void;
  inputSlot?: ReactNode;
  /** Read a file's content by path (for viewing files outside the context root). */
  onReadFile?: (path: string) => Promise<string>;
  onRefresh?: () => void;
  /** Fetch declared lane names from lanes.yaml */
  onFetchLanes?: () => Promise<string[]>;
  /** Fetch context trace for a stage+lane */
  onFetchTrace?: (stage: string, lane?: string) => Promise<ContextTrace | null>;
};

type FocusTarget = 'context' | 'transcript' | 'impulses' | 'thinking';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function filePathFromTab(tab: CenterTab): string | null {
  return tab.startsWith('file:') ? tab.slice(5) : null;
}

function tabFileName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

function centerTabButtonClass(active: boolean): string {
  return css({
    padding: '5px 10px',
    borderRadius: '7px',
    border: 'none',
    bg: active ? 'aic.accentSoft' : 'transparent',
    fontSize: '11px',
    fontWeight: 600,
    color: active ? 'aic.accent' : 'aic.textMuted',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    flexShrink: 0,
    whiteSpace: 'nowrap',
  });
}

function fileCloseButtonClass(): string {
  return css({
    width: '16px',
    height: '16px',
    borderRadius: '3px',
    border: 'none',
    bg: 'transparent',
    color: 'aic.textSubtle',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '11px',
    lineHeight: 1,
    padding: 0,
    flexShrink: 0,
  });
}

// ---------------------------------------------------------------------------
// Resize handle
// ---------------------------------------------------------------------------

const HANDLE_WIDTH = 6;
const MIN_PANEL_PX = 160;
const MAX_PANEL_PX = 600;

function ResizeHandle({ onDrag }: { onDrag: (deltaX: number) => void }) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    lastX.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - lastX.current;
      lastX.current = e.clientX;
      onDrag(dx);
    },
    [onDrag],
  );

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={css({
        width: `${HANDLE_WIDTH}px`,
        cursor: 'col-resize',
        bg: 'transparent',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1,
      })}
    >
      <div
        className={css({
          width: '2px',
          height: '32px',
          borderRadius: '1px',
          bg: 'aic.border',
          transition: 'background 120ms',
        })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConstructControlSurface<
  TLabAction = unknown,
  TRuntimeAction = unknown,
>(props: ConstructControlSurfaceProps<TLabAction, TRuntimeAction>) {
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState<'context' | 'chat' | 'status'>(
    'chat',
  );
  const [focus] = useState<FocusTarget>(props.initialFocus ?? 'transcript');

  // Center tab — controlled externally when props.centerTab is provided
  const [internalCenterTab, setInternalCenterTab] = useState<CenterTab>('chat');
  const centerTab = props.centerTab ?? internalCenterTab;
  const setCenterTab = useCallback(
    (tab: CenterTab) => {
      setInternalCenterTab(tab);
      props.onCenterTabChange?.(tab);
    },
    [props.onCenterTabChange],
  );

  // Chat lane filter only affects transcript visibility.
  const [chatLaneFilter, setChatLaneFilter] = useState<string | undefined>(
    undefined,
  );
  const [chatLaneDropdownOpen, setChatLaneDropdownOpen] = useState(false);
  const chatBtnRef = useRef<HTMLButtonElement>(null);
  const chatDropdownRef = useRef<HTMLDivElement>(null);

  // Close chat lane dropdown on outside click
  useEffect(() => {
    if (!chatLaneDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        chatBtnRef.current?.contains(e.target as Node) ||
        chatDropdownRef.current?.contains(e.target as Node)
      )
        return;
      setChatLaneDropdownOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [chatLaneDropdownOpen]);

  // Open file tabs list (tracks all tabs that are currently open)
  const [openFilePaths, setOpenFilePaths] = useState<string[]>([]);

  // Resizable panel widths
  const [leftWidth, setLeftWidth] = useState(220);
  const [rightWidth, setRightWidth] = useState(320);
  const onLeftDrag = useCallback(
    (dx: number) =>
      setLeftWidth((w) =>
        Math.max(MIN_PANEL_PX, Math.min(MAX_PANEL_PX, w + dx)),
      ),
    [],
  );
  const onRightDrag = useCallback(
    (dx: number) =>
      setRightWidth((w) =>
        Math.max(MIN_PANEL_PX, Math.min(MAX_PANEL_PX, w - dx)),
      ),
    [],
  );

  const { labSnapshot, runtimeSnapshot, studioSnapshot } = props;

  // Fetch declared lanes from lanes.yaml via prop callback
  const [availableLanes, setAvailableLanes] = useState<string[]>([]);
  useEffect(() => {
    if (!props.onFetchLanes) return;
    props
      .onFetchLanes()
      .then(setAvailableLanes)
      .catch(() => {});
  }, [props.onFetchLanes]);

  // Command lane selection is distinct from transcript filtering.
  const [selectedInputLane, setSelectedInputLane] = useState<
    string | undefined
  >(undefined);
  const defaultInputLane = useMemo(() => {
    if (availableLanes.includes('conversation')) {
      return 'conversation';
    }
    return availableLanes[0] ?? 'conversation';
  }, [availableLanes]);
  useEffect(() => {
    if (
      selectedInputLane &&
      availableLanes.length > 0 &&
      !availableLanes.includes(selectedInputLane)
    ) {
      setSelectedInputLane(undefined);
    }
  }, [availableLanes, selectedInputLane]);

  const filteredTranscript = useMemo(() => {
    if (!chatLaneFilter) return labSnapshot.transcript;
    return labSnapshot.transcript.filter(
      (msg) => (msg.lane ?? 'conversation') === chatLaneFilter,
    );
  }, [labSnapshot.transcript, chatLaneFilter]);
  const activeInputLane = selectedInputLane ?? defaultInputLane;
  const resolvedInputSlot = useMemo(() => {
    if (!isValidElement(props.inputSlot)) {
      return props.inputSlot;
    }
    return cloneElement(
      props.inputSlot as React.ReactElement<{
        activeLane?: string;
        availableLanes?: string[];
        onSelectLane?: (lane: string) => void;
      }>,
      {
        activeLane: activeInputLane,
        availableLanes,
        onSelectLane: setSelectedInputLane,
      },
    );
  }, [activeInputLane, availableLanes, props.inputSlot]);

  const hypnoActive = labSnapshot.hypno.active;
  const hypnoStage = labSnapshot.hypno.stage;

  // Auto-open Nap tab when hypno becomes active
  const prevHypnoActiveRef = useRef(false);
  useEffect(() => {
    if (!prevHypnoActiveRef.current && hypnoActive) {
      setCenterTab('nap');
    }
    prevHypnoActiveRef.current = hypnoActive;
  }, [hypnoActive, setCenterTab]);

  // Open a file tab
  const openFileTab = useCallback(
    (path: string) => {
      setOpenFilePaths((current) =>
        current.includes(path) ? current : [...current, path],
      );
      setCenterTab(`file:${path}`);
    },
    [setCenterTab],
  );

  // Close a file tab
  const closeFileTab = useCallback(
    (path: string) => {
      setOpenFilePaths((current) => current.filter((p) => p !== path));
      if ((props.centerTab ?? internalCenterTab) === `file:${path}`) {
        setCenterTab('chat');
      }
    },
    [internalCenterTab, props.centerTab, setCenterTab],
  );

  // Runtime notices (connection / ingress issues)
  const streamConnectivityMessage =
    props.streamStatus === 'error'
      ? props.streamErrorMessage
        ? `Runtime stream error: ${props.streamErrorMessage}`
        : 'Runtime stream disconnected with an error. Updates may be stale.'
      : props.streamStatus === 'disconnected'
        ? 'Runtime stream is disconnected. Live construct updates are paused.'
        : props.streamStatus === 'connecting'
          ? 'Connecting runtime stream...'
          : undefined;

  const runtimeNotices = [
    streamConnectivityMessage
      ? {
          id: `stream:${props.streamStatus ?? 'unknown'}`,
          level: 'warning' as const,
          message: streamConnectivityMessage,
        }
      : undefined,
    props.ingressIssue
      ? {
          id: `ingress:${props.ingressIssue.ts}`,
          level: props.ingressIssue.level,
          message: props.ingressIssue.message,
        }
      : undefined,
  ].filter(
    (
      item,
    ): item is { id: string; level: 'warning' | 'error'; message: string } =>
      Boolean(item),
  );

  // Resolve the file for the active file tab
  const activeFilePath = filePathFromTab(centerTab);
  const activeFileFromContext = activeFilePath
    ? studioSnapshot.contextFiles.find((f) => f.path === activeFilePath)
    : null;
  const activeFile = activeFileFromContext;

  // Track on-demand loaded file content for non-context files
  const [loadedFileContent, setLoadedFileContent] = useState<
    Record<string, string>
  >({});
  const activeNonContextFile =
    !activeFile && activeFilePath && !activeFilePath.endsWith('/')
      ? (() => {
          // Virtual context preview tabs
          if (activeFilePath.startsWith('__context-preview:')) {
            const stage = activeFilePath.replace('__context-preview:', '');
            return {
              path: activeFilePath,
              title: `Context Preview: ${stage}`,
              content: loadedFileContent[activeFilePath] ?? '(loading...)',
              sizeBytes: (loadedFileContent[activeFilePath] ?? '').length,
              modifiedAt: new Date().toISOString(),
              frontmatter: {},
            };
          }
          const node = runtimeSnapshot.vfs?.nodes?.find(
            (n: { path: string; type: string }) =>
              n.path === activeFilePath && n.type === 'file',
          );
          if (!node) return null;
          return {
            path: activeFilePath,
            title: activeFilePath.split('/').pop() ?? activeFilePath,
            content: loadedFileContent[activeFilePath] ?? '',
            sizeBytes: node.sizeBytes ?? 0,
            modifiedAt: node.modifiedAt ?? new Date().toISOString(),
            frontmatter: {},
          };
        })()
      : null;

  // Load content on-demand when a non-context file is opened
  const activeNonContextFilePath = activeNonContextFile?.path;

  useEffect(() => {
    if (!activeNonContextFilePath || !props.onReadFile) return;
    if (activeNonContextFilePath.startsWith('__context-preview:')) return;
    if (loadedFileContent[activeNonContextFilePath] !== undefined) return;
    void props
      .onReadFile(activeNonContextFilePath)
      .then((content) => {
        setLoadedFileContent((prev) => ({
          ...prev,
          [activeNonContextFilePath]: content,
        }));
      })
      .catch(() => {
        setLoadedFileContent((prev) => ({
          ...prev,
          [activeNonContextFilePath]: '(unable to read file)',
        }));
      });
  }, [activeNonContextFilePath, props.onReadFile, loadedFileContent]);
  const activePathIsDirectory =
    activeFilePath && !activeFilePath.startsWith('__context-preview:')
      ? (runtimeSnapshot.vfs?.nodes?.some(
          (n: { path: string; type: string }) =>
            (n.path === activeFilePath || n.path === `${activeFilePath}/`) &&
            n.type === 'directory',
        ) ?? activeFilePath.endsWith('/'))
      : false;

  // Determine center panel border colour
  const centerBorderColor =
    centerTab === 'nap' && hypnoActive
      ? 'rgba(245,158,11,0.45)'
      : activeFilePath
        ? 'token(colors.aic.accentStrong)'
        : focus === 'transcript'
          ? 'token(colors.aic.accent)'
          : 'token(colors.aic.border)';

  // ── Mobile bottom tab bar helper ──────────────────────────────────────
  const mobileTabButtonClass = (active: boolean): string =>
    css({
      flex: 1,
      padding: '10px 0',
      border: 'none',
      bg: 'transparent',
      fontSize: '12px',
      fontWeight: 600,
      color: active ? 'aic.accent' : 'aic.textMuted',
      cursor: 'pointer',
      borderTop: active
        ? '2px solid token(colors.aic.accent)'
        : '2px solid transparent',
    });

  if (isMobile) {
    const bottomBarHeight = 44;
    const inputBarHeight = mobileTab === 'chat' ? 52 : 0;
    // The mobileRoot sits inside PartnerAppFrame's <main> which has 8px
    // bottom padding on mobile. Fixed bars are viewport-relative, so the
    // reserve must subtract that padding to align the scroll edge with the
    // top of the lowest fixed bar.
    const mainBottomPadding = 8;
    const bottomReserve = bottomBarHeight + inputBarHeight - mainBottomPadding;
    return (
      <div
        className={css({
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
          overflow: 'hidden',
          bg: 'aic.canvas',
          position: 'relative',
        })}
        style={{ paddingBottom: `${bottomReserve}px` }}
      >
        {/* Active panel */}
        <div className={css({ flex: 1, minHeight: 0, overflow: 'auto' })}>
          {mobileTab === 'context' ? (
            <ConstructContextPanel
              contextFiles={studioSnapshot.contextFiles}
              activeContextFilePath={
                activeFilePath ?? studioSnapshot.activeContextFilePath
              }
              vfs={runtimeSnapshot.vfs}
              runtimeState={runtimeSnapshot.runtimeState}
              contextDiagnostics={runtimeSnapshot.context}
              onSelectFile={openFileTab}
              editModeState={props.editModeState}
              onEnterEditMode={props.onEnterEditMode}
              onExitEditMode={props.onExitEditMode}
              onFetchLanes={props.onFetchLanes}
              onFetchTrace={props.onFetchTrace}
            />
          ) : null}
          {mobileTab === 'chat' ? (
            <section
              className={css({
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                minHeight: 0,
              })}
            >
              <ConstructTranscriptPanelBody
                transcript={filteredTranscript}
                hypnoActive={hypnoActive}
                commandInFlight={props.commandInFlight ?? false}
                runtimeNotices={runtimeNotices}
              />
            </section>
          ) : null}
          {mobileTab === 'status' ? (
            <ConstructImpulsePanel
              inFlightItems={props.inFlightItems ?? []}
              impulses={runtimeSnapshot.impulses}
              scheduledResponses={
                props.scheduledResponsesForView ??
                runtimeSnapshot.scheduledResponses
              }
              liveDecisionEntries={props.liveDecisionEntries ?? []}
              liveResponseHistories={props.liveResponseHistories ?? []}
              selectedResponseId={props.selectedResponseId}
              recentDecisions={runtimeSnapshot.decisions}
              liveImpulseThinkingById={props.liveImpulseThinkingById ?? {}}
              runtimeState={runtimeSnapshot.runtimeState}
              residency={runtimeSnapshot.residency}
              napQueued={labSnapshot.queuedNextNapPins}
              napImprints={labSnapshot.queuedNextNapImprints}
              hypnoActive={hypnoActive}
              hypnoStage={hypnoStage}
              hypnoPendingPlan={labSnapshot.hypno.pendingPlan}
              hypnoLastReviewReply={labSnapshot.hypno.lastReviewReply}
              onSelectResponse={props.onSelectResponse}
            />
          ) : null}
        </div>

        {/* Input slot — fixed above bottom tab bar on chat tab */}
        {mobileTab === 'chat' ? (
          <div
            className={css({
              position: 'fixed',
              bottom: `${bottomBarHeight}px`,
              left: 0,
              right: 0,
              zIndex: 10,
              bg: 'aic.canvas',
            })}
          >
            {resolvedInputSlot}
          </div>
        ) : null}

        {/* Bottom tab bar — fixed to viewport bottom */}
        <div
          className={css({
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            display: 'flex',
            borderTop: '1px solid token(colors.aic.border)',
            bg: 'aic.panel',
            zIndex: 10,
            height: `${bottomBarHeight}px`,
          })}
        >
          <button
            type="button"
            className={mobileTabButtonClass(mobileTab === 'context')}
            onClick={() => setMobileTab('context')}
          >
            Context
          </button>
          <button
            type="button"
            className={mobileTabButtonClass(mobileTab === 'chat')}
            onClick={() => setMobileTab('chat')}
          >
            Chat
          </button>
          <button
            type="button"
            className={mobileTabButtonClass(mobileTab === 'status')}
            onClick={() => setMobileTab('status')}
          >
            Status
          </button>
        </div>
      </div>
    );
  }

  // ── Desktop layout ────────────────────────────────────────────────────
  return (
    <div
      className={css({
        display: 'grid',
        gridTemplateRows: 'minmax(0, 3fr) minmax(0, 1fr) auto',
        height: '100%',
        minHeight: 0,
        gap: '6px',
        position: 'relative',
        bg: 'aic.canvas',
      })}
    >
      {/* ── Main three-column row (resizable) ──────────────────────────── */}
      <div
        className={css({
          display: 'flex',
          minHeight: 0,
          overflow: 'hidden',
          gap: 0,
          alignItems: 'stretch',
        })}
      >
        {/* Left rail: context panel */}
        <div
          style={{ width: leftWidth }}
          className={css({
            flexShrink: 0,
            minHeight: 0,
            height: '100%',
            overflow: 'hidden',
            display: 'grid',
            gridTemplateRows: '1fr',
          })}
        >
          <ConstructContextPanel
            contextFiles={studioSnapshot.contextFiles}
            activeContextFilePath={
              activeFilePath ?? studioSnapshot.activeContextFilePath
            }
            vfs={runtimeSnapshot.vfs}
            runtimeState={runtimeSnapshot.runtimeState}
            contextDiagnostics={runtimeSnapshot.context}
            focused={focus === 'context'}
            onSelectFile={openFileTab}
            onRefresh={props.onRefresh}
            onFetchLanes={props.onFetchLanes}
            onFetchTrace={props.onFetchTrace}
            onPreviewContext={(stage, content) => {
              const path = `__context-preview:${stage}`;
              setLoadedFileContent((prev) => ({ ...prev, [path]: content }));
              openFileTab(path);
            }}
            editModeState={props.editModeState}
            onEnterEditMode={props.onEnterEditMode}
            onExitEditMode={props.onExitEditMode}
          />
        </div>

        <ResizeHandle onDrag={onLeftDrag} />

        {/* Center: tabbed workspace (Chat / Nap / file:<path>) */}
        <section
          className={css({
            border: `1px solid ${centerBorderColor}`,
            borderRadius: '14px',
            bg: 'aic.panel',
            color: 'aic.text',
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            overflow: 'hidden',
            minHeight: 0,
          })}
        >
          {/* Tab bar header */}
          <header
            className={cx(
              panelHeaderClass,
              css({
                bg:
                  centerTab === 'nap' && hypnoActive
                    ? 'rgba(245,158,11,0.04)'
                    : undefined,
                gap: '4px',
                flexWrap: 'nowrap',
                overflowX: 'auto',
              }),
            )}
          >
            {/* Fixed tabs */}
            <div
              className={css({
                display: 'flex',
                gap: '2px',
                bg: 'rgba(255,255,255,0.05)',
                border: '1px solid token(colors.aic.border)',
                padding: '2px',
                borderRadius: '8px',
                flexShrink: 0,
              })}
            >
              <div className={css({ position: 'relative' })}>
                <button
                  ref={chatBtnRef}
                  type="button"
                  className={centerTabButtonClass(centerTab === 'chat')}
                  onClick={() => {
                    if (centerTab !== 'chat') {
                      setCenterTab('chat');
                    } else if (availableLanes.length > 0) {
                      setChatLaneDropdownOpen(!chatLaneDropdownOpen);
                    }
                  }}
                >
                  {chatLaneFilter
                    ? `Chat / ${chatLaneFilter} ▾`
                    : availableLanes.length > 0
                      ? 'Chat ▾'
                      : 'Chat'}
                </button>
                {chatLaneDropdownOpen && chatBtnRef.current && (
                  <div
                    ref={chatDropdownRef}
                    style={{
                      top:
                        chatBtnRef.current.getBoundingClientRect().bottom + 4,
                      left: chatBtnRef.current.getBoundingClientRect().left,
                    }}
                    className={css({
                      position: 'fixed',
                      bg: 'aic.panel',
                      border: '1px solid token(colors.aic.border)',
                      borderRadius: '6px',
                      padding: '4px',
                      zIndex: 9999,
                      minWidth: '120px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                    })}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setChatLaneFilter(undefined);
                        setChatLaneDropdownOpen(false);
                      }}
                      className={css({
                        display: 'block',
                        width: '100%',
                        padding: '5px 8px',
                        border: 'none',
                        borderRadius: '4px',
                        bg: !chatLaneFilter ? 'aic.accentSoft' : 'transparent',
                        color: !chatLaneFilter ? 'aic.accent' : 'aic.textMuted',
                        fontSize: '10px',
                        fontWeight: 600,
                        textAlign: 'left',
                        cursor: 'pointer',
                      })}
                    >
                      All
                    </button>
                    {availableLanes.map((lane) => (
                      <button
                        key={lane}
                        type="button"
                        onClick={() => {
                          setChatLaneFilter(lane);
                          setChatLaneDropdownOpen(false);
                        }}
                        className={css({
                          display: 'block',
                          width: '100%',
                          padding: '5px 8px',
                          border: 'none',
                          borderRadius: '4px',
                          bg:
                            lane === chatLaneFilter
                              ? 'aic.accentSoft'
                              : 'transparent',
                          color:
                            lane === chatLaneFilter
                              ? 'aic.accent'
                              : 'aic.textMuted',
                          fontSize: '10px',
                          fontWeight: 600,
                          textAlign: 'left',
                          cursor: 'pointer',
                        })}
                      >
                        {lane}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                className={centerTabButtonClass(centerTab === 'nap')}
                onClick={() => setCenterTab('nap')}
              >
                Nap
                {hypnoActive ? (
                  <span className={cx(dotClass, css({ bg: 'aic.warning' }))} />
                ) : null}
              </button>
            </div>

            {/* File tabs */}
            {openFilePaths.map((path) => {
              const isActive = centerTab === `file:${path}`;
              const fileRecord = studioSnapshot.contextFiles.find(
                (f) => f.path === path,
              );
              const label = fileRecord?.title ?? tabFileName(path);
              return (
                <div
                  key={path}
                  className={css({
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1px',
                    bg: 'rgba(255,255,255,0.05)',
                    border: isActive
                      ? '1px solid token(colors.aic.accentStrong)'
                      : '1px solid token(colors.aic.border)',
                    borderRadius: '8px',
                    padding: '2px 4px 2px 2px',
                    flexShrink: 0,
                  })}
                >
                  <button
                    type="button"
                    className={fileCloseButtonClass()}
                    onClick={() => closeFileTab(path)}
                    title={`Close ${label}`}
                  >
                    ×
                  </button>
                  <button
                    type="button"
                    className={centerTabButtonClass(isActive)}
                    onClick={() => setCenterTab(`file:${path}`)}
                  >
                    {label}
                  </button>
                </div>
              );
            })}

            {/* Status chips */}
            <div
              className={css({
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginLeft: 'auto',
                flexShrink: 0,
              })}
            >
              {hypnoActive ? (
                <span className={cx(chipClass, chipWarningClass)}>
                  hypno {hypnoStage}
                </span>
              ) : null}
              {props.commandInFlight ? (
                <span className={cx(chipClass, chipAccentClass)}>running</span>
              ) : null}
            </div>
          </header>

          {/* Tab body */}
          {centerTab === 'chat' ? (
            <ConstructTranscriptPanelBody
              transcript={filteredTranscript}
              hypnoActive={hypnoActive}
              commandInFlight={props.commandInFlight ?? false}
              runtimeNotices={runtimeNotices}
            />
          ) : null}
          {centerTab === 'nap' ? (
            <ConstructNapPanelBody
              hypno={labSnapshot.hypno}
              toolLog={labSnapshot.toolLog}
              napQueued={labSnapshot.queuedNextNapPins}
              napImprints={labSnapshot.queuedNextNapImprints}
            />
          ) : null}
          {activeFilePath ? (
            activeFile ? (
              <ConstructFilePanelBody
                file={activeFile}
                editModeActive={props.editModeActive}
                onRefresh={props.onRefresh}
                onSave={
                  props.onContextAction
                    ? (path, content) => {
                        props.onContextAction?.({
                          action: 'upsertContextFile',
                          file: { path, content },
                        });
                      }
                    : undefined
                }
              />
            ) : activeNonContextFile ? (
              <ConstructFilePanelBody
                file={activeNonContextFile}
                editModeActive={false}
                onRefresh={() => {
                  if (
                    activeNonContextFile.path.startsWith('__context-preview:')
                  )
                    return;
                  if (props.onReadFile) {
                    setLoadedFileContent((prev) => {
                      const next = { ...prev };
                      delete next[activeNonContextFile.path];
                      return next;
                    });
                  } else {
                    props.onRefresh?.();
                  }
                }}
              />
            ) : activePathIsDirectory ? (
              <ConstructDirectoryPanelBody
                path={activeFilePath}
                vfsNodes={runtimeSnapshot.vfs?.nodes ?? []}
                contextFiles={studioSnapshot.contextFiles}
                onSelectPath={openFileTab}
              />
            ) : (
              <div
                className={css({
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: 1,
                  color: 'aic.textSubtle',
                  fontSize: '13px',
                  fontStyle: 'italic',
                  padding: '24px',
                })}
              >
                File not found in context: {activeFilePath}
              </div>
            )
          ) : null}
        </section>

        <ResizeHandle onDrag={onRightDrag} />

        {/* Right rail: impulse panel */}
        <div
          style={{ width: rightWidth }}
          className={css({
            flexShrink: 0,
            minHeight: 0,
            height: '100%',
            overflow: 'hidden',
            display: 'grid',
            gridTemplateRows: '1fr',
          })}
        >
          <ConstructImpulsePanel
            inFlightItems={props.inFlightItems ?? []}
            impulses={runtimeSnapshot.impulses}
            scheduledResponses={
              props.scheduledResponsesForView ??
              runtimeSnapshot.scheduledResponses
            }
            liveDecisionEntries={props.liveDecisionEntries ?? []}
            liveResponseHistories={props.liveResponseHistories ?? []}
            selectedResponseId={props.selectedResponseId}
            recentDecisions={runtimeSnapshot.decisions}
            liveImpulseThinkingById={props.liveImpulseThinkingById ?? {}}
            runtimeState={runtimeSnapshot.runtimeState}
            residency={runtimeSnapshot.residency}
            napQueued={labSnapshot.queuedNextNapPins}
            napImprints={labSnapshot.queuedNextNapImprints}
            hypnoActive={hypnoActive}
            hypnoStage={hypnoStage}
            hypnoPendingPlan={labSnapshot.hypno.pendingPlan}
            hypnoLastReviewReply={labSnapshot.hypno.lastReviewReply}
            onSelectResponse={props.onSelectResponse}
            focused={focus === 'impulses'}
          />
        </div>
      </div>

      {/* ── Thinking panel ───────────────────────────────────────────────── */}
      <div
        className={css({
          display: 'grid',
          gridTemplateRows: '1fr',
          minHeight: 0,
        })}
      >
        <ConstructThinkingPanel
          hypnoActive={hypnoActive}
          hypnoStage={hypnoStage}
          hypnoLastReviewReply={labSnapshot.hypno.lastReviewReply}
          liveResponseHistories={props.liveResponseHistories ?? []}
          selectedResponseId={props.selectedResponseId}
          onSelectResponse={props.onSelectResponse}
          commandInFlight={props.commandInFlight ?? false}
          focused={focus === 'thinking'}
        />
      </div>

      {/* ── Input slot ───────────────────────────────────────────────────── */}
      {resolvedInputSlot}
    </div>
  );
}
