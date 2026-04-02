/**
 * @inkibra/storybook - Chrome Runtime
 *
 * Parent window with 3-pane layout:
 * - Left: Story list organized by category with search, filters, collapsible groups
 * - Center: Iframe viewport for story rendering
 * - Right: Output panel showing story events
 */

import { manifest } from 'virtual:storybook';
import {
  StrictMode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createRoot } from 'react-dom/client';
import type { StoryKind, StoryRecord, StoryRuntimeMode } from '../types';
import {
  type IframeToParentMessage,
  isIframeMessage,
  SB_CONTROLS_HOST_ID,
  type SbOutputMessage,
  type SbRegisterInputMessage,
} from './messages';

// ============================================================================
// Types
// ============================================================================

type OutputEntry = {
  id: number;
  storyId: string;
  data: unknown;
  timestamp: number;
};

type KindFilter = 'all' | StoryKind;

type StoryGroup = {
  category: string;
  stories: StoryRecord[];
};

type KindSubGroup = {
  kind: StoryKind;
  stories: StoryRecord[];
};

// ============================================================================
// URL / localStorage helpers
// ============================================================================

const LS_COLLAPSED_KEY = 'sb-collapsed-categories';

function getUrlParam(key: string): string | null {
  return new URLSearchParams(window.location.search).get(key);
}

function setUrlParams(updates: Record<string, string | null>): void {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === '' || value === 'all') {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, value);
    }
  }
  window.history.replaceState({}, '', url.toString());
}

function getCollapsedCategories(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_COLLAPSED_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    /* ignore */
  }
  return new Set();
}

function saveCollapsedCategories(set: Set<string>): void {
  try {
    localStorage.setItem(LS_COLLAPSED_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

// ============================================================================
// Utilities
// ============================================================================

function getStoryIdFromUrl(): string | null {
  return getUrlParam('story');
}

function setStoryIdInUrl(storyId: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('story', storyId);
  window.history.pushState({}, '', url.toString());
}

function buildIframeSrc(storyId: string, sessionId: string): string {
  const iframeUrl = new URL('/__sb/iframe.html', window.location.origin);
  iframeUrl.searchParams.set('story', storyId);
  iframeUrl.searchParams.set('sb_session', sessionId);

  const params = new URLSearchParams(window.location.search);
  const forwardedParams = ['sb_mode', 'sb_controls'];

  for (const key of forwardedParams) {
    const value = params.get(key);
    if (value !== null) {
      iframeUrl.searchParams.set(key, value);
    }
  }

  return `${iframeUrl.pathname}?${iframeUrl.searchParams.toString()}`;
}

function getRuntimeModeFromUrl(): StoryRuntimeMode {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('sb_mode');
  if (mode === 'test' || mode === 'vrt') {
    return mode;
  }
  return 'dev';
}

function areControlsEnabled(runtimeMode: StoryRuntimeMode): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.get('sb_controls') === '0') return false;
  if (runtimeMode !== 'dev') return false;
  return true;
}

/**
 * Group stories by category, then sub-group by kind within each category.
 */
function groupByCategory(stories: readonly StoryRecord[]): StoryGroup[] {
  const groups = new Map<string, StoryRecord[]>();

  for (const story of stories) {
    const category = story.meta.category || 'Uncategorized';
    const list = groups.get(category) || [];
    list.push(story);
    groups.set(category, list);
  }

  const sortedCategories = Array.from(groups.keys()).sort();

  return sortedCategories.map((category) => ({
    category,
    stories: groups.get(category)!.sort((a, b) => a.id.localeCompare(b.id)),
  }));
}

function getKindSubGroups(stories: StoryRecord[]): KindSubGroup[] {
  const byKind = new Map<StoryKind, StoryRecord[]>();
  for (const s of stories) {
    const list = byKind.get(s.kind) || [];
    list.push(s);
    byKind.set(s.kind, list);
  }
  // Order: page > component > scenario
  const order: StoryKind[] = ['page', 'component', 'scenario'];
  const result: KindSubGroup[] = [];
  for (const kind of order) {
    const list = byKind.get(kind);
    if (list && list.length > 0) {
      result.push({ kind, stories: list });
    }
  }
  return result;
}

function getUniqueCategories(stories: readonly StoryRecord[]): string[] {
  const set = new Set<string>();
  for (const s of stories) set.add(s.meta.category || 'Uncategorized');
  return Array.from(set).sort();
}

const kindLabels: Record<StoryKind, string> = {
  page: 'Pages',
  component: 'Components',
  scenario: 'Scenarios',
};

// ============================================================================
// Styles (inline)
// ============================================================================

const styles = {
  container: {
    display: 'grid',
    gridTemplateColumns: '280px 1fr 320px',
    height: '100vh',
    background: '#f9fafb',
  } as const,

  leftPane: {
    background: '#ffffff',
    borderRight: '1px solid #e5e7eb',
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
  } as const,

  centerPane: {
    display: 'flex',
    flexDirection: 'column',
    background: '#ffffff',
    overflow: 'hidden',
  } as const,

  rightPane: {
    background: '#ffffff',
    borderLeft: '1px solid #e5e7eb',
    overflow: 'auto',
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  } as const,

  sectionTitle: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    color: '#6b7280',
  } as const,

  controlsHost: {
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    minHeight: 84,
    padding: 12,
    background: '#fcfcfd',
  } as const,

  controlsEmpty: {
    color: '#9ca3af',
    fontSize: 12,
  } as const,

  header: {
    padding: '12px 16px',
    borderBottom: '1px solid #e5e7eb',
    fontSize: 12,
    fontWeight: 600,
    color: '#374151',
    background: '#f9fafb',
  } as const,

  // Sidebar search
  searchWrap: {
    padding: '10px 12px',
    borderBottom: '1px solid #e5e7eb',
  } as const,

  searchInput: {
    width: '100%',
    height: 32,
    padding: '0 10px',
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    fontSize: 12,
    outline: 'none',
    background: '#f9fafb',
    color: '#111827',
  } as const,

  // Filter pills row
  filterRow: {
    display: 'flex',
    gap: 4,
    padding: '8px 12px',
    borderBottom: '1px solid #e5e7eb',
    flexWrap: 'wrap' as const,
  } as const,

  filterPill: {
    height: 24,
    padding: '0 10px',
    borderRadius: 12,
    border: '1px solid #e5e7eb',
    background: '#ffffff',
    color: '#6b7280',
    fontSize: 11,
    fontWeight: 500,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    whiteSpace: 'nowrap' as const,
    transition: 'all 120ms ease',
  } as const,

  filterPillActive: {
    background: '#eff6ff',
    borderColor: '#93c5fd',
    color: '#1d4ed8',
    fontWeight: 600,
  } as const,

  // Category section
  categoryRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px 8px 12px',
    cursor: 'pointer',
    userSelect: 'none' as const,
    borderBottom: '1px solid #f3f4f6',
    background: '#fafafa',
  } as const,

  categoryLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: '#6b7280',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  } as const,

  categoryChevron: {
    fontSize: 10,
    color: '#9ca3af',
    transition: 'transform 150ms ease',
  } as const,

  categoryCount: {
    fontSize: 10,
    color: '#9ca3af',
    fontWeight: 400,
    marginLeft: 6,
  } as const,

  // Kind sub-group
  kindHeader: {
    padding: '6px 12px 4px 20px',
    fontSize: 10,
    fontWeight: 600,
    color: '#9ca3af',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
  } as const,

  // Story item
  storyItem: {
    padding: '6px 12px 6px 32px',
    fontSize: 12,
    color: '#374151',
    cursor: 'pointer',
    border: 'none',
    background: 'transparent',
    width: '100%',
    textAlign: 'left' as const,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    lineHeight: '1.4',
  } as const,

  storyItemSelected: {
    background: '#eff6ff',
    color: '#1d4ed8',
    fontWeight: 500,
  } as const,

  kindBadge: {
    fontSize: 9,
    fontWeight: 600,
    padding: '1px 5px',
    borderRadius: 3,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    flexShrink: 0,
  } as const,

  kindBadgePage: {
    background: '#dbeafe',
    color: '#1e40af',
  } as const,

  kindBadgeComponent: {
    background: '#fef3c7',
    color: '#92400e',
  } as const,

  kindBadgeScenario: {
    background: '#ede9fe',
    color: '#5b21b6',
  } as const,

  // Misc
  noResults: {
    padding: '24px 16px',
    textAlign: 'center' as const,
    color: '#9ca3af',
    fontSize: 12,
  } as const,

  storyList: {
    flex: 1,
    overflow: 'auto',
  } as const,

  iframe: {
    border: 0,
    width: '100%',
    height: '100%',
    flex: 1,
  } as const,

  outputEntry: {
    background: '#f9fafb',
    borderRadius: 4,
    padding: 12,
    fontSize: 12,
    fontFamily: 'monospace',
  } as const,

  outputTime: {
    color: '#6b7280',
    fontSize: 10,
    marginBottom: 4,
  } as const,

  outputData: {
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const,
    color: '#111827',
  } as const,

  errorBanner: {
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 4,
    padding: 12,
    color: '#dc2626',
    fontSize: 12,
  } as const,

  metaSummary: {
    background: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderRadius: 4,
    padding: 12,
    fontSize: 12,
    color: '#166534',
  } as const,

  emptyState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: '#9ca3af',
    fontSize: 14,
  } as const,
};

function getKindBadgeStyle(kind: StoryKind): React.CSSProperties {
  if (kind === 'page') return { ...styles.kindBadge, ...styles.kindBadgePage };
  if (kind === 'scenario')
    return { ...styles.kindBadge, ...styles.kindBadgeScenario };
  return { ...styles.kindBadge, ...styles.kindBadgeComponent };
}

// ============================================================================
// StoryList Component (search + filters + collapsible groups + kind sub-groups)
// ============================================================================

type StoryListProps = {
  groups: StoryGroup[];
  allStories: readonly StoryRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  // Filter state (managed by parent)
  search: string;
  onSearchChange: (v: string) => void;
  kindFilter: KindFilter;
  onKindFilterChange: (v: KindFilter) => void;
  categoryFilter: string | null;
  onCategoryFilterChange: (v: string | null) => void;
};

function StoryList({
  groups,
  allStories,
  selectedId,
  onSelect,
  search,
  onSearchChange,
  kindFilter,
  onKindFilterChange,
  categoryFilter,
  onCategoryFilterChange,
}: StoryListProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(
    getCollapsedCategories,
  );
  const categories = useMemo(
    () => getUniqueCategories(allStories),
    [allStories],
  );

  const toggleCategory = useCallback((cat: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      saveCollapsedCategories(next);
      return next;
    });
  }, []);

  // Filter stories
  const filteredGroups = useMemo(() => {
    const searchLower = search.toLowerCase().trim();

    return groups
      .filter((g) => !categoryFilter || g.category === categoryFilter)
      .map((g) => {
        let stories = g.stories;
        if (kindFilter !== 'all') {
          stories = stories.filter((s) => s.kind === kindFilter);
        }
        if (searchLower) {
          stories = stories.filter(
            (s) =>
              (s.meta.label || s.id).toLowerCase().includes(searchLower) ||
              s.id.toLowerCase().includes(searchLower) ||
              (s.meta.components ?? []).some((c) =>
                c.toLowerCase().includes(searchLower),
              ),
          );
        }
        return { ...g, stories };
      })
      .filter((g) => g.stories.length > 0);
  }, [groups, kindFilter, categoryFilter, search]);

  const totalFiltered = filteredGroups.reduce(
    (n, g) => n + g.stories.length,
    0,
  );

  return (
    <div style={styles.leftPane}>
      {/* Header */}
      <div style={styles.header}>
        Stories
        <span style={{ fontWeight: 400, color: '#9ca3af', marginLeft: 8 }}>
          {totalFiltered}
        </span>
      </div>

      {/* Search */}
      <div style={styles.searchWrap}>
        <input
          type="text"
          placeholder="Search stories..."
          value={search}
          onChange={(e) => onSearchChange(e.currentTarget.value)}
          style={styles.searchInput}
        />
      </div>

      {/* Kind filter pills */}
      <div style={styles.filterRow}>
        {(['all', 'page', 'component', 'scenario'] as KindFilter[]).map((k) => {
          const isActive = kindFilter === k;
          const label =
            k === 'all'
              ? 'All'
              : k === 'page'
                ? 'Pages'
                : k === 'component'
                  ? 'Components'
                  : 'Scenarios';
          // Count how many stories match this kind (after category + search)
          const count =
            k === 'all'
              ? totalFiltered
              : filteredGroups.reduce(
                  (n, g) => n + g.stories.filter((s) => s.kind === k).length,
                  0,
                );
          if (k !== 'all' && count === 0 && !isActive) return null;
          return (
            <button
              key={k}
              type="button"
              style={{
                ...styles.filterPill,
                ...(isActive ? styles.filterPillActive : {}),
              }}
              onClick={() =>
                onKindFilterChange(isActive && k !== 'all' ? 'all' : k)
              }
            >
              {label}
              <span style={{ opacity: 0.6 }}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Category filter pills */}
      <div style={{ ...styles.filterRow, paddingTop: 4, paddingBottom: 8 }}>
        <button
          type="button"
          style={{
            ...styles.filterPill,
            ...(!categoryFilter ? styles.filterPillActive : {}),
          }}
          onClick={() => onCategoryFilterChange(null)}
        >
          All categories
        </button>
        {categories.map((cat) => {
          const isActive = categoryFilter === cat;
          return (
            <button
              key={cat}
              type="button"
              style={{
                ...styles.filterPill,
                ...(isActive ? styles.filterPillActive : {}),
              }}
              onClick={() => onCategoryFilterChange(isActive ? null : cat)}
            >
              {cat}
            </button>
          );
        })}
      </div>

      {/* Story list */}
      <div style={styles.storyList}>
        {filteredGroups.length === 0 && (
          <div style={styles.noResults}>No stories match your filters.</div>
        )}

        {filteredGroups.map((group) => {
          const isCollapsed = collapsed.has(group.category);
          const subGroups = getKindSubGroups(group.stories);
          const hasMultipleKinds = subGroups.length > 1;

          return (
            <div key={group.category}>
              {/* Category header (click to collapse) */}
              <div
                style={styles.categoryRow}
                onClick={() => toggleCategory(group.category)}
              >
                <span>
                  <span style={styles.categoryLabel}>{group.category}</span>
                  <span style={styles.categoryCount}>
                    {group.stories.length}
                  </span>
                </span>
                <span
                  style={{
                    ...styles.categoryChevron,
                    transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                  }}
                >
                  ▾
                </span>
              </div>

              {/* Stories grouped by kind */}
              {!isCollapsed && (
                <>
                  {subGroups.map((sg) => (
                    <div key={sg.kind}>
                      {/* Kind sub-header (only if multiple kinds in this category) */}
                      {hasMultipleKinds && (
                        <div style={styles.kindHeader}>
                          {kindLabels[sg.kind]}
                        </div>
                      )}

                      {sg.stories.map((story) => (
                        <button
                          key={story.id}
                          type="button"
                          onClick={() => onSelect(story.id)}
                          style={{
                            ...styles.storyItem,
                            ...(hasMultipleKinds ? { paddingLeft: 40 } : {}),
                            ...(selectedId === story.id
                              ? styles.storyItemSelected
                              : {}),
                          }}
                        >
                          <span
                            style={{
                              flex: 1,
                              minWidth: 0,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {story.meta.label || story.id}
                          </span>
                          <span style={getKindBadgeStyle(story.kind)}>
                            {story.kind}
                          </span>
                        </button>
                      ))}
                    </div>
                  ))}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// IframeViewport
// ============================================================================

type IframeViewportProps = {
  storyId: string | null;
  sessionId: string;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
};

function IframeViewport({
  storyId,
  sessionId,
  iframeRef,
}: IframeViewportProps) {
  if (!storyId) {
    return (
      <div style={{ ...styles.centerPane, ...styles.emptyState }}>
        Select a story from the list
      </div>
    );
  }

  return (
    <div style={styles.centerPane}>
      <div style={styles.header}>{storyId}</div>
      <iframe
        ref={iframeRef}
        src={buildIframeSrc(storyId, sessionId)}
        style={styles.iframe}
        title={`Story: ${storyId}`}
      />
    </div>
  );
}

// ============================================================================
// OutputPanel
// ============================================================================

type OutputPanelProps = {
  outputs: OutputEntry[];
  error: { message: string; stack?: string } | null;
  currentStory: StoryRecord | null;
  controlsEnabled: boolean;
  hasInputPanel: boolean;
};

function OutputPanel({
  outputs,
  error,
  currentStory,
  controlsEnabled,
  hasInputPanel,
}: OutputPanelProps) {
  return (
    <div style={styles.rightPane}>
      <div style={{ ...styles.header, margin: '-16px -16px 0 -16px' }}>
        Output
      </div>

      <div style={styles.sectionTitle}>Controls</div>
      <div id={SB_CONTROLS_HOST_ID} style={styles.controlsHost}>
        {!controlsEnabled && (
          <div style={styles.controlsEmpty}>
            Controls disabled outside dev mode.
          </div>
        )}
        {controlsEnabled && !hasInputPanel && (
          <div style={styles.controlsEmpty}>
            This story did not register an input panel.
          </div>
        )}
      </div>

      {currentStory && (
        <div style={styles.metaSummary}>
          <strong>{currentStory.meta.label}</strong>
          <div style={{ marginTop: 4, fontSize: 11, color: '#15803d' }}>
            Kind: {currentStory.kind} | Category:{' '}
            {currentStory.meta.category || 'none'}
          </div>
          {currentStory.meta.tags && currentStory.meta.tags.length > 0 && (
            <div style={{ marginTop: 4, fontSize: 11 }}>
              Tags: {currentStory.meta.tags.join(', ')}
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={styles.errorBanner}>
          <strong>Error:</strong> {error.message}
          {error.stack && (
            <pre style={{ marginTop: 8, fontSize: 10, overflow: 'auto' }}>
              {error.stack}
            </pre>
          )}
        </div>
      )}

      {outputs.length === 0 && !error && (
        <div style={{ color: '#9ca3af', fontSize: 12 }}>
          No outputs yet. Interact with the story to see events here.
        </div>
      )}

      {outputs.map((entry) => (
        <div key={entry.id} style={styles.outputEntry}>
          <div style={styles.outputTime}>
            {new Date(entry.timestamp).toLocaleTimeString()}
          </div>
          <div style={styles.outputData}>
            {JSON.stringify(entry.data, null, 2)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Main App
// ============================================================================

function ChromeApp() {
  const [selectedId, setSelectedId] = useState<string | null>(
    getStoryIdFromUrl,
  );
  const [iframeSession, setIframeSession] = useState(1);
  const [outputs, setOutputs] = useState<OutputEntry[]>([]);
  const [error, setError] = useState<{
    message: string;
    stack?: string;
  } | null>(null);
  const [hasInputPanel, setHasInputPanel] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const outputIdRef = useRef(0);
  const sessionIdRef = useRef(`s${iframeSession}`);

  // Filter state — initialized from URL params
  const [search, setSearch] = useState(() => getUrlParam('sb_search') ?? '');
  const [kindFilter, setKindFilter] = useState<KindFilter>(() => {
    const v = getUrlParam('sb_kind');
    if (v === 'page' || v === 'component' || v === 'scenario') return v;
    return 'all';
  });
  const [categoryFilter, setCategoryFilter] = useState<string | null>(() =>
    getUrlParam('sb_cat'),
  );

  const groups = useMemo(() => groupByCategory(manifest), []);
  const runtimeMode = getRuntimeModeFromUrl();
  const controlsEnabled = areControlsEnabled(runtimeMode);
  const sessionId = `s${iframeSession}`;

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const currentStory = useMemo(
    () => manifest.find((s: StoryRecord) => s.id === selectedId) || null,
    [selectedId],
  );

  // Sync filter state to URL
  const handleSearchChange = useCallback((v: string) => {
    setSearch(v);
    setUrlParams({ sb_search: v || null });
  }, []);

  const handleKindFilterChange = useCallback((v: KindFilter) => {
    setKindFilter(v);
    setUrlParams({ sb_kind: v === 'all' ? null : v });
  }, []);

  const handleCategoryFilterChange = useCallback((v: string | null) => {
    setCategoryFilter(v);
    setUrlParams({ sb_cat: v });
  }, []);

  const handleSelectStory = useCallback((id: string) => {
    setSelectedId(id);
    setStoryIdInUrl(id);
    setOutputs([]);
    setError(null);
    setHasInputPanel(false);
    setIframeSession((prev) => prev + 1);
  }, []);

  // Listen for messages from iframe
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (!isIframeMessage(event.data)) return;

      const msg = event.data as IframeToParentMessage;

      if (msg.sessionId && msg.sessionId !== sessionIdRef.current) {
        return;
      }

      switch (msg.type) {
        case 'SB_READY':
          setError(null);
          break;

        case 'SB_OUTPUT': {
          const outputMsg = msg as SbOutputMessage;
          setOutputs((prev) => [
            {
              id: ++outputIdRef.current,
              storyId: outputMsg.storyId,
              data: outputMsg.data,
              timestamp: outputMsg.timestamp,
            },
            ...prev.slice(0, 49),
          ]);
          break;
        }

        case 'SB_ERROR':
          setError({ message: msg.message, stack: msg.stack });
          break;

        case 'SB_REGISTER_INPUT':
          setHasInputPanel((msg as SbRegisterInputMessage).hasPanel);
          break;
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Handle browser back/forward
  useEffect(() => {
    function handlePopState() {
      const id = getStoryIdFromUrl();
      if (id !== selectedId) {
        setSelectedId(id);
        setOutputs([]);
        setError(null);
        setHasInputPanel(false);
        setIframeSession((prev) => prev + 1);
      }
      // Also restore filter state from URL on popstate
      setSearch(getUrlParam('sb_search') ?? '');
      const k = getUrlParam('sb_kind');
      setKindFilter(
        k === 'page' || k === 'component' || k === 'scenario' ? k : 'all',
      );
      setCategoryFilter(getUrlParam('sb_cat'));
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [selectedId]);

  return (
    <div style={styles.container}>
      <StoryList
        groups={groups}
        allStories={manifest}
        selectedId={selectedId}
        onSelect={handleSelectStory}
        search={search}
        onSearchChange={handleSearchChange}
        kindFilter={kindFilter}
        onKindFilterChange={handleKindFilterChange}
        categoryFilter={categoryFilter}
        onCategoryFilterChange={handleCategoryFilterChange}
      />
      <IframeViewport
        storyId={selectedId}
        sessionId={sessionId}
        iframeRef={iframeRef}
      />
      <OutputPanel
        outputs={outputs}
        error={error}
        currentStory={currentStory}
        controlsEnabled={controlsEnabled}
        hasInputPanel={hasInputPanel}
      />
    </div>
  );
}

// ============================================================================
// Mount
// ============================================================================

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <ChromeApp />
    </StrictMode>,
  );
}
