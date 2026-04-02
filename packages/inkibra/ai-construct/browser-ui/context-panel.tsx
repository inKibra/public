import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  ConstructRuntimeSnapshot,
  ConstructStudioSnapshot,
} from '../lab/types';
import { css, cx } from '../styled-system/css';
import { ConstructFileTree, type ConstructFileTreeItem } from './file-tree';
import {
  panelClass,
  panelHeaderClass,
  panelTitleClass,
  scrollBodyClass,
  sectionLabelClass,
} from './styles';

/** Mirrors ConstructEditModeState — inlined to avoid pulling in server-only lab-edit-mode module. */
type EditModeState = 'running' | 'entering_edit' | 'editing' | 'exiting_edit';

/** Context trace types matching the server response */
type ContextTraceEntry = {
  path: string;
  type: 'file' | 'directory';
  source: 'pin' | 'selector' | 'runtime-pinned';
  renderer: string;
  directory: string;
  selectorStrategy?: string;
};

type ContextTraceSection = {
  directory: string;
  renderer: string;
  rendererParams?: Record<string, unknown>;
  selectorConfig?: { strategy: string; [key: string]: unknown };
  hasStageOverride: boolean;
  entries: ContextTraceEntry[];
  rendererInputPaths?: string[];
  renderedPreview: string;
};

type ContextTrace = {
  stage: string;
  sections: ContextTraceSection[];
  totalEntries: number;
  totalChars: number;
};

const STAGES = ['all', 'impulse', 'scheduler', 'response', 'nap'] as const;
type StageFilter = (typeof STAGES)[number];

export type ConstructContextPanelProps = {
  contextFiles: ConstructStudioSnapshot['contextFiles'];
  activeContextFilePath?: string;
  vfs: ConstructRuntimeSnapshot['vfs'];
  runtimeState: ConstructRuntimeSnapshot['runtimeState'];
  contextDiagnostics?: ConstructRuntimeSnapshot['context'];
  focused?: boolean;
  onSelectFile?: (path: string) => void;
  onPreviewContext?: (stage: string, content: string) => void;
  onRefresh?: () => void;
  title?: string;
  editModeState?: EditModeState;
  onEnterEditMode?: () => void;
  onExitEditMode?: () => void;
  /** Fetch context trace for a stage+lane. Returns ContextTrace or null. */
  onFetchTrace?: (stage: string, lane?: string) => Promise<ContextTrace | null>;
  /** Fetch declared lane names. Returns string[]. */
  onFetchLanes?: () => Promise<string[]>;
};

type DisplayPressure = {
  totalBytes: number;
  totalTokens: number;
  ratio: number;
  status: 'ok' | 'warning' | 'critical';
  maxTokens: number;
};

function computePressure(files: ConstructStudioSnapshot['contextFiles']) {
  const totalBytes = files.reduce((sum, f) => sum + (f.sizeBytes ?? 0), 0);
  return computePressureFromBytes(totalBytes);
}

function computePressureFromBytes(totalBytes: number): DisplayPressure {
  const totalTokens = Math.round(totalBytes / 4);
  return computePressureFromTokens(totalTokens, totalBytes);
}

function computePressureFromChars(totalChars: number): DisplayPressure {
  const totalTokens = Math.round(totalChars / 4);
  const totalBytes = totalChars;
  return computePressureFromTokens(totalTokens, totalBytes);
}

function computePressureFromTokens(
  totalTokens: number,
  totalBytes: number,
): DisplayPressure {
  const maxTokens = 128000;
  const ratio = Math.min(1, totalTokens / maxTokens);
  const status: DisplayPressure['status'] =
    ratio >= 0.9 ? 'critical' : ratio >= 0.75 ? 'warning' : 'ok';
  return { totalBytes, totalTokens, ratio, status, maxTokens };
}

function pressureFromRuntimeEntry(
  entry: NonNullable<ConstructRuntimeSnapshot['context']>['pairs'][number],
): DisplayPressure {
  return {
    totalBytes: entry.contextBytes,
    totalTokens: entry.contextTokens,
    ratio: entry.ratio,
    status: entry.status,
    maxTokens: entry.maxTokens,
  };
}

function pressureColor(status: DisplayPressure['status']) {
  return status === 'ok'
    ? 'aic.success'
    : status === 'warning'
      ? 'aic.warning'
      : 'aic.error';
}

const filterBtnClass = (active: boolean) =>
  css({
    padding: '4px 6px',
    borderRadius: '6px',
    border: 'none',
    bg: active ? 'aic.accentSoft' : 'transparent',
    fontSize: '9px',
    fontWeight: 600,
    color: active ? 'aic.accent' : 'aic.textMuted',
    cursor: 'pointer',
  });

const CONTEXT_STAGES: Exclude<StageFilter, 'all'>[] = [
  'impulse',
  'scheduler',
  'response',
  'nap',
];

/** Stages that support per-lane sub-options */
const LANE_STAGES = new Set(['impulse', 'response']);

function StageDropdown(props: {
  value: Exclude<StageFilter, 'all'>;
  lane?: string;
  lanes: string[];
  active: boolean;
  onSelect: (stage: Exclude<StageFilter, 'all'>, lane?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const stageLabel = props.value.charAt(0).toUpperCase() + props.value.slice(1);
  const label = props.lane ? `${stageLabel} / ${props.lane}` : stageLabel;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        btnRef.current?.contains(e.target as Node) ||
        dropdownRef.current?.contains(e.target as Node)
      )
        return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Compute fixed position from button rect
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 4, left: rect.left });
  }, [open]);

  return (
    <div className={css({ position: 'relative' })}>
      <button
        ref={btnRef}
        type="button"
        className={cx(
          filterBtnClass(props.active),
          css({ display: 'flex', alignItems: 'center', gap: '3px' }),
        )}
        onClick={() => {
          if (!props.active) {
            props.onSelect(props.value, props.lane);
          } else {
            setOpen(!open);
          }
        }}
      >
        {props.active ? `${label} ▾` : 'In Context ▾'}
      </button>
      {open && (
        <div
          ref={dropdownRef}
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
          className={css({
            position: 'fixed',
            bg: 'aic.panel',
            border: '1px solid token(colors.aic.border)',
            borderRadius: '6px',
            padding: '4px',
            zIndex: 9999,
            minWidth: '140px',
            maxHeight: '300px',
            overflowY: 'auto',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          })}
        >
          {CONTEXT_STAGES.map((s) => {
            const isActive = s === props.value && props.lane === undefined;
            const hasLanes = LANE_STAGES.has(s) && props.lanes.length > 0;

            return (
              <div key={s}>
                <button
                  type="button"
                  onClick={() => {
                    props.onSelect(s, undefined);
                    setOpen(false);
                  }}
                  className={css({
                    display: 'block',
                    width: '100%',
                    padding: '5px 8px',
                    border: 'none',
                    borderRadius: '4px',
                    bg: isActive ? 'aic.accentSoft' : 'transparent',
                    color: isActive ? 'aic.accent' : 'aic.textMuted',
                    fontSize: '10px',
                    fontWeight: 600,
                    textAlign: 'left',
                    cursor: 'pointer',
                  })}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
                {hasLanes &&
                  props.lanes.map((lane) => {
                    const isLaneActive =
                      s === props.value && lane === props.lane;
                    return (
                      <button
                        key={`${s}:${lane}`}
                        type="button"
                        onClick={() => {
                          props.onSelect(s, lane);
                          setOpen(false);
                        }}
                        className={css({
                          display: 'block',
                          width: '100%',
                          padding: '4px 8px 4px 18px',
                          border: 'none',
                          borderRadius: '4px',
                          bg: isLaneActive ? 'aic.accentSoft' : 'transparent',
                          color: isLaneActive ? 'aic.accent' : 'aic.textMuted',
                          fontSize: '9px',
                          fontWeight: 500,
                          textAlign: 'left',
                          cursor: 'pointer',
                        })}
                      >
                        ↳ {lane}
                      </button>
                    );
                  })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ConstructContextPanel(props: ConstructContextPanelProps) {
  const [stageFilter, setStageFilter] = useState<StageFilter>('all');
  const [laneFilter, setLaneFilter] = useState<string | undefined>(undefined);
  const [trace, setTrace] = useState<ContextTrace | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [laneNames, setLaneNames] = useState<string[]>([]);

  const fallbackPressure = useMemo(() => {
    if (trace) {
      return computePressureFromChars(trace.totalChars);
    }
    return computePressure(props.contextFiles);
  }, [props.contextFiles, trace]);

  const globalMaxPair = props.contextDiagnostics?.maxPair;
  const overallPressure = globalMaxPair
    ? pressureFromRuntimeEntry(globalMaxPair)
    : fallbackPressure;

  const selectedPressure = useMemo(() => {
    if (stageFilter === 'all') {
      return undefined;
    }

    if (trace) {
      return computePressureFromChars(trace.totalChars);
    }

    if (stageFilter === 'scheduler') {
      return undefined;
    }

    const matchingPair = (props.contextDiagnostics?.pairs ?? []).find(
      (entry) => {
        if (entry.stage !== stageFilter) return false;
        if (laneFilter) return entry.lane === laneFilter;
        return true;
      },
    );

    return matchingPair ? pressureFromRuntimeEntry(matchingPair) : undefined;
  }, [props.contextDiagnostics?.pairs, laneFilter, stageFilter, trace]);

  const activePressure =
    stageFilter === 'all'
      ? overallPressure
      : (selectedPressure ?? overallPressure);
  const activePressureColor = pressureColor(activePressure.status);
  const activePressureTitle =
    stageFilter === 'all' ? 'Max context pressure' : 'Active context pressure';
  const activePressureScope =
    stageFilter === 'all'
      ? globalMaxPair
        ? `${globalMaxPair.stage} / ${globalMaxPair.lane}`
        : 'No rendered lane/stage pair'
      : selectedPressure
        ? laneFilter
          ? `${stageFilter} / ${laneFilter}`
          : stageFilter
        : 'No selected context pressure — showing overall max';

  // Fetch lanes on mount via callback prop
  useEffect(() => {
    if (!props.onFetchLanes) return;
    props
      .onFetchLanes()
      .then(setLaneNames)
      .catch(() => {});
  }, [props.onFetchLanes]);

  // Fetch trace when stage or lane changes via callback prop
  const fetchTrace = useCallback(
    async (stage: string, lane?: string) => {
      if (!props.onFetchTrace || stage === 'all') {
        setTrace(null);
        return;
      }
      setTraceLoading(true);
      try {
        const result = await props.onFetchTrace(stage, lane);
        setTrace(result);
      } catch {
        // Ignore fetch errors
      } finally {
        setTraceLoading(false);
      }
    },
    [props.onFetchTrace],
  );

  useEffect(() => {
    void fetchTrace(stageFilter, laneFilter);
  }, [stageFilter, laneFilter, fetchTrace]);

  // Build tree items based on stage filter
  const contextFilesByPath = useMemo(() => {
    const map = new Map<
      string,
      ConstructStudioSnapshot['contextFiles'][number]
    >();
    for (const file of props.contextFiles) {
      map.set(file.path, file);
    }
    return map;
  }, [props.contextFiles]);

  // Build set of paths included in the current trace
  const tracePaths = useMemo(() => {
    if (!trace) return null;
    const set = new Set<string>();
    const addWithVariants = (p: string) => {
      set.add(p);
      const stripped = p.replace(/\/+$/, '');
      set.add(stripped);
      set.add(`${stripped}/`);
    };
    for (const section of trace.sections) {
      addWithVariants(section.directory);
      // Add all ancestors of the directory
      const dirParts = section.directory.split('/').filter(Boolean);
      for (let i = 1; i <= dirParts.length; i++) {
        addWithVariants(`/${dirParts.slice(0, i).join('/')}`);
      }
      for (const entry of section.entries) {
        addWithVariants(entry.path);
        // Add all parent directories
        const parts = entry.path.split('/').filter(Boolean);
        for (let i = 1; i < parts.length; i++) {
          addWithVariants(`/${parts.slice(0, i).join('/')}`);
        }
      }
    }
    return set;
  }, [trace]);

  const unifiedTreeItems = useMemo<ConstructFileTreeItem[]>(() => {
    const items: ConstructFileTreeItem[] = [];
    const isStageMode = stageFilter !== 'all';

    // Build trace entry lookup for chips
    const traceEntryByPath = new Map<string, ContextTraceEntry>();
    const traceSectionByDir = new Map<string, ContextTraceSection>();
    if (trace) {
      for (const section of trace.sections) {
        traceSectionByDir.set(section.directory, section);
        for (const entry of section.entries) {
          traceEntryByPath.set(entry.path, entry);
        }
      }
    }

    for (const node of props.vfs.nodes) {
      const contextFile = contextFilesByPath.get(node.path);
      const inContext = !!contextFile;

      // In stage mode, filter to only paths in the trace
      if (isStageMode && tracePaths) {
        const normalized = node.path.replace(/\/+$/, '');
        if (
          !tracePaths.has(node.path) &&
          !tracePaths.has(normalized) &&
          !tracePaths.has(`${normalized}/`)
        ) {
          continue;
        }
      } else if (isStageMode && !trace) {
        // Still loading trace — show nothing
        continue;
      }

      const chips: ConstructFileTreeItem['chips'] = [];
      const traceEntry = traceEntryByPath.get(node.path);

      if (isStageMode && traceEntry) {
        // Show source + renderer as chips
        const sourceTone: Record<
          string,
          'accent' | 'muted' | 'warning' | 'neon'
        > = {
          pin: 'warning',
          selector: 'accent',
          'runtime-pinned': 'neon',
        };
        chips.push({
          label: traceEntry.source,
          tone: sourceTone[traceEntry.source] ?? 'muted',
        });
        if (traceEntry.selectorStrategy) {
          chips.push({ label: traceEntry.selectorStrategy, tone: 'muted' });
        }
      } else if (isStageMode) {
        // Check if this is a section directory
        const normalizedPath = `${node.path.replace(/\/+$/, '')}/`;
        const section =
          traceSectionByDir.get(node.path) ??
          traceSectionByDir.get(normalizedPath);
        if (section) {
          chips.push({ label: section.renderer, tone: 'accent' });
          if (section.hasStageOverride) {
            chips.push({ label: 'override', tone: 'warning' });
          }
        }
      } else {
        // Default mode chips
        if (contextFile?.pinnedSource === 'system') {
          chips.push({ label: 'sys', tone: 'warning' });
        } else if (contextFile?.pinnedSource === 'ai') {
          chips.push({ label: 'ai', tone: 'accent' });
        } else if (contextFile?.pinned) {
          chips.push({ label: 'pin', tone: 'accent' });
        }
      }

      const segments = node.path.split('/').filter(Boolean);
      const label =
        contextFile?.title || segments[segments.length - 1] || node.path;

      items.push({
        path: node.path,
        kind: node.type,
        label,
        description: node.path,
        meta: node.sizeBytes != null ? `${node.sizeBytes}b` : undefined,
        dimmed: !isStageMode && !inContext,
        chips: chips.length > 0 ? chips : undefined,
      });
    }

    return items;
  }, [props.vfs.nodes, contextFilesByPath, stageFilter, trace, tracePaths]);

  const isStageMode = stageFilter !== 'all';

  return (
    <section
      className={cx(
        panelClass,
        css({
          minHeight: 0,
          borderColor: props.focused ? 'aic.accent' : 'aic.border',
        }),
      )}
    >
      <header className={panelHeaderClass}>
        <h3 className={panelTitleClass}>
          {props.title ?? 'Context'}
          {props.onRefresh && (
            <button
              type="button"
              onClick={props.onRefresh}
              className={css({
                marginLeft: '6px',
                padding: '2px 5px',
                border: 'none',
                borderRadius: '4px',
                bg: 'transparent',
                color: 'aic.textMuted',
                fontSize: '11px',
                cursor: 'pointer',
              })}
              title="Refresh"
            >
              ↻
            </button>
          )}
        </h3>
        <div
          className={css({
            display: 'flex',
            gap: '2px',
            bg: 'rgba(255,255,255,0.05)',
            border: '1px solid token(colors.aic.border)',
            padding: '2px',
            borderRadius: '8px',
          })}
        >
          <button
            type="button"
            className={filterBtnClass(stageFilter === 'all')}
            onClick={() => {
              setStageFilter('all');
              setLaneFilter(undefined);
            }}
          >
            All
          </button>
          <StageDropdown
            value={stageFilter === 'all' ? 'impulse' : stageFilter}
            lane={laneFilter}
            lanes={laneNames}
            active={stageFilter !== 'all'}
            onSelect={(s, lane) => {
              setStageFilter(s);
              setLaneFilter(lane);
            }}
          />
        </div>
      </header>

      <div
        className={cx(
          scrollBodyClass,
          css({
            padding: '10px',
            display: 'flex',
            flexDirection: 'column',
          }),
        )}
      >
        {traceLoading ? (
          <p
            className={css({
              color: 'aic.textSubtle',
              fontSize: '11px',
              textAlign: 'center',
              margin: '20px 0',
            })}
          >
            Loading trace...
          </p>
        ) : (
          <ConstructFileTree
            items={unifiedTreeItems}
            activePath={props.activeContextFilePath}
            emptyLabel={
              isStageMode ? `No context for ${stageFilter}` : 'No VFS files'
            }
            dense
            bare
            onSelectPath={props.onSelectFile}
          />
        )}
      </div>

      {/* Trace summary when in stage mode */}
      {isStageMode && trace && (
        <div
          className={css({
            padding: '6px 12px',
            borderTop: '1px solid token(colors.aic.border)',
            fontSize: '10px',
            color: 'aic.textSubtle',
            display: 'flex',
            gap: '12px',
          })}
        >
          <span>{trace.sections.length} dirs</span>
          <span>{trace.totalEntries} files</span>
          <span>
            ~{Math.round(trace.totalChars / 4).toLocaleString()} tokens
          </span>
        </div>
      )}

      <div
        className={css({
          padding: '8px 12px',
          borderTop: '1px solid token(colors.aic.border)',
          flexShrink: 0,
        })}
      >
        <div
          className={css({
            border: '1px solid token(colors.aic.border)',
            borderRadius: '8px',
            padding: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          })}
        >
          <p className={sectionLabelClass}>{activePressureTitle}</p>
          <p
            className={css({
              margin: 0,
              color: 'aic.textMuted',
              fontSize: '11px',
            })}
          >
            {activePressureScope}
          </p>
          <div
            className={css({
              width: '100%',
              height: '4px',
              borderRadius: '2px',
              bg: 'rgba(255,255,255,0.06)',
              overflow: 'hidden',
            })}
          >
            <div
              className={css({
                height: '100%',
                borderRadius: '2px',
                transition: 'width 300ms ease',
                bg: activePressureColor,
              })}
              style={{ width: `${Math.round(activePressure.ratio * 100)}%` }}
            />
          </div>
          <p
            className={css({
              margin: 0,
              color: 'aic.textSubtle',
              fontSize: '11px',
            })}
          >
            {activePressure.status} · {Math.round(activePressure.ratio * 100)}%
            · ~{activePressure.totalTokens.toLocaleString()} /{' '}
            {activePressure.maxTokens.toLocaleString()} tokens
          </p>
        </div>
      </div>

      {/* Preview buttons — only in stage mode */}
      {isStageMode && trace && props.onPreviewContext && (
        <div
          className={css({
            padding: '4px 12px',
            borderTop: '1px solid token(colors.aic.border)',
            flexShrink: 0,
            display: 'flex',
            gap: '6px',
          })}
        >
          <button
            type="button"
            onClick={() => {
              const allPreviews = trace.sections
                .map((s) => s.renderedPreview)
                .filter(Boolean)
                .join('\n\n');
              props.onPreviewContext?.(stageFilter, allPreviews);
            }}
            className={css({
              flex: 1,
              padding: '6px 8px',
              borderRadius: '6px',
              border: '1px solid token(colors.aic.accent)',
              bg: 'aic.accentSoft',
              color: 'aic.accent',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
            })}
          >
            Preview Context
          </button>
          <button
            type="button"
            onClick={() => {
              props.onPreviewContext?.(
                `${stageFilter}-trace`,
                renderTraceAsText(trace),
              );
            }}
            className={css({
              flex: 1,
              padding: '6px 8px',
              borderRadius: '6px',
              border: '1px solid token(colors.aic.warning)',
              bg: 'aic.warningSoft',
              color: 'aic.warning',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
            })}
          >
            Trace
          </button>
        </div>
      )}

      {props.onEnterEditMode || props.onExitEditMode ? (
        <EditModeToggle
          editModeState={props.editModeState ?? 'running'}
          onEnterEditMode={props.onEnterEditMode}
          onExitEditMode={props.onExitEditMode}
        />
      ) : null}
    </section>
  );
}

function renderTraceAsText(trace: ContextTrace): string {
  const lines: string[] = [];
  lines.push(`# Context Trace: ${trace.stage}`);
  lines.push(
    `Total: ${trace.totalEntries} entries, ~${Math.round(trace.totalChars / 4)} tokens`,
  );
  lines.push('');

  for (const section of trace.sections) {
    const override = section.hasStageOverride ? ' [STAGE OVERRIDE]' : '';
    lines.push(`## ${section.directory}`);
    lines.push(`  renderer: ${section.renderer}${override}`);

    if (section.rendererParams) {
      const rp = Object.entries(section.rendererParams)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(' ');
      lines.push(`  renderer_params: ${rp}`);
    }

    if (section.selectorConfig) {
      const s = section.selectorConfig;
      const params = Object.entries(s)
        .filter(([k]) => k !== 'strategy')
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(' ');
      lines.push(`  selector: ${s.strategy} ${params}`);
    }

    lines.push('');
    lines.push('  Sources:');
    if (section.entries.length === 0) {
      lines.push('    (no files selected)');
    } else {
      for (const entry of section.entries) {
        const icon = entry.type === 'directory' ? '📁' : '📄';
        const strategy = entry.selectorStrategy
          ? ` [${entry.selectorStrategy}]`
          : '';
        lines.push(`    ${icon} ${entry.path}  ← ${entry.source}${strategy}`);
      }
    }

    lines.push('');
    lines.push(
      `  Renderer inputs (${section.rendererInputPaths?.length ?? 0} paths):`,
    );
    for (const p of section.rendererInputPaths ?? []) {
      lines.push(`    → ${p}`);
    }

    lines.push(
      `  Output: ${section.renderedPreview.length} chars (~${Math.round(section.renderedPreview.length / 4)} tokens)`,
    );
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Edit mode toggle footer
// ---------------------------------------------------------------------------

type EditModeToggleProps = {
  editModeState: EditModeState;
  onEnterEditMode?: () => void;
  onExitEditMode?: () => void;
};

function EditModeToggle(props: EditModeToggleProps) {
  const { editModeState } = props;
  const isEditing = editModeState === 'editing';
  const isTransitioning =
    editModeState === 'entering_edit' || editModeState === 'exiting_edit';

  return (
    <div
      className={css({
        padding: '8px 12px',
        borderTop: '1px solid token(colors.aic.border)',
        flexShrink: 0,
      })}
    >
      <button
        type="button"
        disabled={isTransitioning}
        onClick={() => {
          if (isEditing) {
            props.onExitEditMode?.();
          } else {
            props.onEnterEditMode?.();
          }
        }}
        className={css({
          width: '100%',
          padding: '6px 12px',
          borderRadius: '6px',
          border: isEditing
            ? '1px solid token(colors.aic.warning)'
            : '1px solid token(colors.aic.border)',
          bg: isEditing ? 'rgba(255,180,0,0.1)' : 'transparent',
          color: isEditing ? 'aic.warning' : 'aic.textMuted',
          fontSize: '12px',
          fontWeight: 600,
          cursor: isTransitioning ? 'wait' : 'pointer',
          opacity: isTransitioning ? 0.5 : 1,
        })}
      >
        {isEditing
          ? 'Exit Edit Mode'
          : isTransitioning
            ? editModeState === 'entering_edit'
              ? 'Entering...'
              : 'Exiting...'
            : 'Edit Mode'}
      </button>
    </div>
  );
}
