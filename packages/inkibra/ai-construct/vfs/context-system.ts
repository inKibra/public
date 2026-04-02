/**
 * Declarative Context System
 *
 * Implements the declarative context system per VFS v2 spec (§19B).
 *
 * Core concepts:
 *   1. Context manifest — list of directories with CONTEXT.yaml files
 *   2. CONTEXT.yaml — per-directory renderer, selector, pins, lane overrides, nap
 *   3. lanes.yaml — lane declarations with permissions and response flags
 *   4. Renderers — verbatim, timeline, summary
 *   5. Selectors — recency, latest, tagged, all
 *
 * Resolution algorithm:
 *   1. Read context manifest → directory list
 *   3. Collect static pins
 *   4. Evaluate selector → dynamic file/dir selections
 *   5. If "runtime-pinned" in manifest, merge lane-aware runtime pinned entries
 *   6. Load each selection, pass through directory's renderer
 *   7. Concatenate all rendered sections
 */

import { type OverlayFs, parseContextFile } from '@inkibra/ai-flow';
import { formatRelativeTime, replaceIsoTimestamps } from '../utils/time';
import {
  type LaneTimelineEntry,
  projectTimelineEntriesFromLaneLogFile,
} from './lane-logs';
import { loadPinnedState, queryPinnedEntries } from './pinned';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parsed CONTEXT.yaml for a directory. No top-level defaults are supported. */
export type ContextConfig = {
  /** Explicit global stage config: stages.<stageName> */
  stages?: Record<string, ContextStageOverride>;
  /** Per-lane per-stage overrides: lanes.<laneName>.<stageName> */
  lanes?: Record<string, Record<string, ContextStageOverride>>;
};

export type ContextPin = {
  path: string;
  meta?: boolean; // frontmatter-only mode
};

export type ContextStageOverride = {
  pins?: ContextPin[];
  selector?: SelectorConfig;
  renderer?: RendererName;
  rendererParams?: RendererParams;
};

export type RendererName = 'verbatim' | 'timeline' | 'summary';

/** Where clause for renderer ops — all fields are arrays, match-any semantics. */
export type RendererOpWhere = {
  /** Source lane filter. 'this' resolves to the concrete lane at render time. '*' matches all. */
  lanes?: string[];
  /** Entry kind filter (impulse, response, reflected_impulse, feedback, steering). '*' matches all. */
  entry_kinds?: string[];
  /** Item kind filter. 'entry' = parsed log body, 'summary' = frontmatter stub. '*' matches all. */
  item_kinds?: ('entry' | 'summary' | '*')[];
};

/** Select op — additive. Guarantees a minimum count from the full entry pool. */
export type SelectOp = {
  select: {
    at_least: number;
    where?: RendererOpWhere;
  };
};

/** Filter op — subtractive. Removes entries from the working set. */
export type FilterOp = {
  filter: {
    window?: string;
    max_items?: number;
    where?: RendererOpWhere;
  };
};

export type RendererOp = SelectOp | FilterOp;

export type RendererParams = {
  /** Sequential renderer operation pipeline */
  ops?: RendererOp[];
  /** @deprecated Use ops instead. Minimum number of entries to show (timeline) */
  minItems?: number;
  /** @deprecated Use ops instead. Time window (timeline). e.g. "15m" */
  window?: string;
  /** @deprecated Use ops instead. Maximum entries (timeline) */
  maxItems?: number;
};

type SelectorFilter = {
  /** Only include files matching these suffixes (e.g. [".conversation.log", ".transcript.log"]) */
  include?: string[];
  /** Exclude files matching these suffixes */
  exclude?: string[];
};

export type SelectorConfig =
  | ({ strategy: 'all' } & SelectorFilter)
  | ({ strategy: 'latest'; count: number } & SelectorFilter)
  | ({ strategy: 'tagged'; tags: string[]; limit?: number } & SelectorFilter)
  | ({
      strategy: 'recency';
      dirs?: number;
      files?: number;
      window?: string;
    } & SelectorFilter);

/** Context directory manifest — flat list of directories with CONTEXT.yaml */
export type ContextManifest = {
  directories: string[];
};

/** Parsed lanes.yaml — lane declarations */
export type LanesConfig = Record<string, LaneConfig>;

export type LaneConfig = {
  /** Which other lanes this lane is allowed to respond to. Omit = self only. */
  can_respond_to?: string[];
};

/** A resolved context section ready for the prompt */
export type ContextSection = {
  directory: string;
  renderer: RendererName;
  content: string;
};

// ---------------------------------------------------------------------------
// YAML Parsing (Bun native)
// ---------------------------------------------------------------------------

const EMPTY_CONTEXT_CONFIG: ContextConfig = {};

function parseYaml(raw: string): Record<string, unknown> {
  // The VFS persistence layer wraps files in YAML frontmatter (--- ... ---).
  // Strip it so we parse the actual config content, not the metadata.
  let content = raw;
  if (content.startsWith('---')) {
    const endIdx = content.indexOf('---', 3);
    if (endIdx !== -1) {
      content = content.slice(endIdx + 3).trim();
    }
  }
  if (!content) return {};
  const parsed = Bun.YAML.parse(content);
  if (parsed && typeof parsed === 'object') {
    return parsed as Record<string, unknown>;
  }
  return {};
}

/**
 * Parse CONTEXT.yaml using the explicit stages/lanes schema.
 *
 * ```yaml
 * stages:
 *   impulse:
 *     renderer: { type: verbatim }
 *     pins: [{ path: SOUL.md }]
 * lanes:
 *   conversation:
 *     response: { selector: ... }
 * ```
 *
 * Override chain: lanes.{lane}.{stage} → stages.{stage}.
 * Legacy top-level keys such as `default` or `nap` are rejected.
 */
export function parseContextYaml(raw: string): ContextConfig {
  try {
    const parsed = parseYaml(raw);
    if (Object.keys(parsed).length === 0) return EMPTY_CONTEXT_CONFIG;

    const allowedTopLevelKeys = new Set(['stages', 'lanes']);
    for (const key of Object.keys(parsed)) {
      if (!allowedTopLevelKeys.has(key)) {
        return EMPTY_CONTEXT_CONFIG;
      }
    }

    // Lane overrides: lanes.<laneName>.<stageName>
    const lanes: Record<string, Record<string, ContextStageOverride>> = {};
    const lanesRaw = parsed.lanes as Record<string, unknown> | undefined;
    if (lanesRaw && typeof lanesRaw === 'object') {
      for (const [laneName, laneData] of Object.entries(lanesRaw)) {
        if (!laneData || typeof laneData !== 'object') continue;
        lanes[laneName] = {};
        for (const [stageName, stageData] of Object.entries(
          laneData as Record<string, unknown>,
        )) {
          if (!stageData || typeof stageData !== 'object') continue;
          lanes[laneName][stageName] = parseStageOverride(
            stageData as Record<string, unknown>,
          );
        }
        if (Object.keys(lanes[laneName]).length === 0) {
          delete lanes[laneName];
        }
      }
    }

    const stages: Record<string, ContextStageOverride> = {};
    const stagesRaw = parsed.stages as Record<string, unknown> | undefined;
    if (stagesRaw && typeof stagesRaw === 'object') {
      for (const [stageName, stageData] of Object.entries(stagesRaw)) {
        if (!stageData || typeof stageData !== 'object') continue;
        stages[stageName] = parseStageOverride(
          stageData as Record<string, unknown>,
        );
      }
    }

    return {
      lanes: Object.keys(lanes).length > 0 ? lanes : undefined,
      stages: Object.keys(stages).length > 0 ? stages : undefined,
    };
  } catch {
    return EMPTY_CONTEXT_CONFIG;
  }
}

/**
 * Parse renderer field — object form per spec:
 * `{ type: "timeline", ops: [...] }`
 * Also supports string shorthand: `"verbatim"`
 * Legacy flat fields (min_items, window, max_items) are parsed for backward compat.
 */
function parseRendererField(raw: unknown): {
  renderer: RendererName;
  rendererParams?: RendererParams;
} {
  if (typeof raw === 'string') {
    return { renderer: raw as RendererName };
  }
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    const renderer = (r.type as RendererName) ?? 'verbatim';
    const params: RendererParams = {};

    // New ops-based pipeline
    if (Array.isArray(r.ops)) {
      params.ops = r.ops
        .filter(
          (op): op is Record<string, unknown> =>
            op != null && typeof op === 'object',
        )
        .map(parseRendererOp)
        .filter((op): op is RendererOp => op != null);
    }

    // Legacy flat fields (backward compat)
    if (r.min_items != null) params.minItems = Number(r.min_items);
    if (r.minItems != null) params.minItems = Number(r.minItems);
    if (r.window != null && typeof r.window === 'string')
      params.window = r.window;
    if (r.max_items != null) params.maxItems = Number(r.max_items);
    if (r.maxItems != null) params.maxItems = Number(r.maxItems);
    const rendererParams = Object.keys(params).length > 0 ? params : undefined;
    return { renderer, rendererParams };
  }
  return { renderer: 'verbatim' };
}

function parseRendererOpWhere(raw: unknown): RendererOpWhere | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const w = raw as Record<string, unknown>;
  const where: RendererOpWhere = {};
  if (Array.isArray(w.lanes)) where.lanes = w.lanes.map(String);
  if (Array.isArray(w.entry_kinds))
    where.entry_kinds = w.entry_kinds.map(String);
  if (Array.isArray(w.item_kinds))
    where.item_kinds = w.item_kinds.map(
      String,
    ) as RendererOpWhere['item_kinds'];
  return Object.keys(where).length > 0 ? where : undefined;
}

function parseRendererOp(raw: Record<string, unknown>): RendererOp | null {
  if (raw.select && typeof raw.select === 'object') {
    const s = raw.select as Record<string, unknown>;
    const atLeast = Number(s.at_least ?? 0);
    if (atLeast <= 0) return null;
    return {
      select: {
        at_least: atLeast,
        where: parseRendererOpWhere(s.where),
      },
    };
  }
  if (raw.filter && typeof raw.filter === 'object') {
    const f = raw.filter as Record<string, unknown>;
    const filter: FilterOp['filter'] = {};
    if (typeof f.window === 'string') filter.window = f.window;
    if (f.max_items != null) filter.max_items = Number(f.max_items);
    filter.where = parseRendererOpWhere(f.where);
    if (!filter.window && filter.max_items == null) return null;
    return { filter };
  }
  return null;
}

function parseStageOverride(sd: Record<string, unknown>): ContextStageOverride {
  const { renderer, rendererParams } = sd.renderer
    ? parseRendererField(sd.renderer)
    : { renderer: undefined, rendererParams: undefined };
  return {
    pins: sd.pins ? parseContextPins(sd.pins) : undefined,
    selector: sd.selector ? parseSelectorConfig(sd.selector) : undefined,
    renderer,
    rendererParams,
  };
}

function parseContextPins(raw: unknown): ContextPin[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p) => p && typeof p === 'object' && typeof p.path === 'string')
    .map((p) => ({
      path: p.path as string,
      meta: p.meta === true ? true : undefined,
    }));
}

function parseSelectorFilter(s: Record<string, unknown>): SelectorFilter {
  const include = Array.isArray(s.include)
    ? (s.include as string[])
    : undefined;
  const exclude = Array.isArray(s.exclude)
    ? (s.exclude as string[])
    : undefined;
  return { include, exclude };
}

function parseSelectorConfig(raw: unknown): SelectorConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const s = raw as Record<string, unknown>;
  const strategy = s.strategy as string;
  const filter = parseSelectorFilter(s);

  switch (strategy) {
    case 'all':
      return { strategy: 'all', ...filter };
    case 'latest':
      return { strategy: 'latest', count: Number(s.count ?? 5), ...filter };
    case 'tagged':
      return {
        strategy: 'tagged',
        tags: Array.isArray(s.tags) ? (s.tags as string[]) : [],
        limit: s.limit != null ? Number(s.limit) : undefined,
        ...filter,
      };
    case 'recency':
      return {
        strategy: 'recency',
        dirs: s.dirs != null ? Number(s.dirs) : undefined,
        files: s.files != null ? Number(s.files) : undefined,
        window: typeof s.window === 'string' ? s.window : undefined,
        ...filter,
      };
    default:
      return undefined;
  }
}

export function parseContextManifest(raw: string): ContextManifest {
  try {
    const parsed = parseYaml(raw);
    const directories = Array.isArray(parsed.directories)
      ? (parsed.directories as string[])
      : [];
    return { directories };
  } catch {
    return { directories: [] };
  }
}

export function parseLanesYaml(raw: string): LanesConfig {
  try {
    const parsed = parseYaml(raw);
    const config: LanesConfig = {};
    for (const [laneName, laneData] of Object.entries(parsed)) {
      if (!laneData || typeof laneData !== 'object') continue;
      const ld = laneData as Record<string, unknown>;
      config[laneName] = {
        can_respond_to: Array.isArray(ld.can_respond_to)
          ? (ld.can_respond_to as string[])
          : undefined,
      };
    }
    return config;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

type FileInfo = {
  path: string;
  modifiedAt?: Date;
  meta?: Record<string, unknown>;
  isDirectory: boolean;
};

/**
 * Apply include/exclude filters to a list of paths.
 * Supports both suffix matching (e.g. ".conversation.log") and
 * glob-style patterns with * (e.g. "*.workspace-frontend.log").
 */
function applySelectorFilter(
  paths: string[],
  filter: SelectorFilter,
  lane?: string,
): string[] {
  let result = paths;
  if (filter.include && filter.include.length > 0) {
    const includePatterns = lane
      ? filter.include.map((pattern) => expandLaneTemplate(pattern, lane))
      : filter.include;
    result = result.filter((p) =>
      includePatterns.some((pattern) => matchFilterPattern(p, pattern)),
    );
  }
  if (filter.exclude && filter.exclude.length > 0) {
    const excludePatterns = lane
      ? filter.exclude.map((pattern) => expandLaneTemplate(pattern, lane))
      : filter.exclude;
    result = result.filter(
      (p) => !excludePatterns.some((pattern) => matchFilterPattern(p, pattern)),
    );
  }
  return result;
}

/** Match a path against a filter pattern (suffix or glob with *) */
function matchFilterPattern(path: string, pattern: string): boolean {
  if (pattern.includes('*')) {
    // Convert glob to regex: * matches any non-/ characters
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped.replace(/\*/g, '[^/]*'));
    const filename = path.split('/').pop() ?? path;
    return regex.test(filename);
  }
  return path.endsWith(pattern);
}

/** Select files from a directory tree based on a selector config */
export async function applySelector(
  vfs: OverlayFs,
  directory: string,
  selector: SelectorConfig | undefined,
  now: Date,
  lane?: string,
): Promise<string[]> {
  if (!selector) return [];

  let paths: string[];
  switch (selector.strategy) {
    case 'all':
      paths = await selectAll(vfs, directory);
      break;
    case 'latest':
      paths = await selectLatest(vfs, directory, selector.count);
      break;
    case 'tagged':
      paths = await selectTagged(vfs, directory, selector.tags, selector.limit);
      break;
    case 'recency':
      paths = await selectRecency(vfs, directory, selector, now);
      break;
  }

  return applySelectorFilter(paths, selector, lane);
}

async function listFilesRecursive(
  vfs: OverlayFs,
  dir: string,
): Promise<FileInfo[]> {
  const results: FileInfo[] = [];
  try {
    const entries = await vfs.list(dir);
    for (const entry of entries) {
      const fullPath = `${dir}/${entry.name}`.replace(/\/+/g, '/');
      if (entry.name === 'CONTEXT.yaml') continue; // Skip context config files
      if (entry.type === 'directory') {
        const children = await listFilesRecursive(vfs, fullPath);
        results.push(...children);
      } else {
        let meta: Record<string, unknown> | undefined;
        let modifiedAt: Date | undefined;
        try {
          const content = await vfs.read(fullPath);
          if (content.trim().startsWith('---')) {
            const parsed = parseContextFile(content);
            meta = parsed.meta;
            const updated =
              meta?.updated ?? (meta?.modified as string | undefined);
            if (typeof updated === 'string') {
              modifiedAt = new Date(updated);
            }
          }
        } catch {
          // Can't read file — skip metadata
        }
        results.push({ path: fullPath, meta, modifiedAt, isDirectory: false });
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return results;
}

async function selectAll(vfs: OverlayFs, dir: string): Promise<string[]> {
  const files = await listFilesRecursive(vfs, dir);
  return files.map((f) => f.path);
}

async function selectLatest(
  vfs: OverlayFs,
  dir: string,
  count: number,
): Promise<string[]> {
  const files = await listFilesRecursive(vfs, dir);
  files.sort(
    (a, b) => (b.modifiedAt?.getTime() ?? 0) - (a.modifiedAt?.getTime() ?? 0),
  );
  return files.slice(0, count).map((f) => f.path);
}

async function selectTagged(
  vfs: OverlayFs,
  dir: string,
  tags: string[],
  limit?: number,
): Promise<string[]> {
  const files = await listFilesRecursive(vfs, dir);
  const tagSet = new Set(tags);
  const matched = files.filter((f) => {
    const fileTags = f.meta?.tags;
    if (!Array.isArray(fileTags)) return false;
    return fileTags.some((t) => tagSet.has(String(t)));
  });
  return limit
    ? matched.slice(0, limit).map((f) => f.path)
    : matched.map((f) => f.path);
}

async function selectRecency(
  vfs: OverlayFs,
  dir: string,
  config: Extract<SelectorConfig, { strategy: 'recency' }>,
  now: Date,
): Promise<string[]> {
  const selected: string[] = [];

  // Find leaf directories (dirs containing files, not just subdirs)
  const leafDirs = await findLeafDirectories(vfs, dir);

  // Sort by name descending (e.g. 2026/W13 > 2026/W12)
  leafDirs.sort((a, b) => b.localeCompare(a));

  // Select recent directories
  if (config.dirs != null && config.dirs > 0) {
    for (const leafDir of leafDirs.slice(0, config.dirs)) {
      selected.push(leafDir); // Directory itself — rendered as directory listing
    }
  }

  // Select recent files
  if (config.files != null && config.files > 0) {
    const allFiles = await listFilesRecursive(vfs, dir);
    allFiles.sort(
      (a, b) => (b.modifiedAt?.getTime() ?? 0) - (a.modifiedAt?.getTime() ?? 0),
    );

    // Apply window filter if set
    let candidates = allFiles;
    if (config.window) {
      const windowMs = parseWindowDuration(config.window);
      if (windowMs > 0) {
        const cutoff = now.getTime() - windowMs;
        candidates = allFiles.filter(
          (f) => (f.modifiedAt?.getTime() ?? 0) >= cutoff,
        );
      }
    }

    for (const file of candidates.slice(0, config.files)) {
      if (!selected.includes(file.path)) {
        selected.push(file.path);
      }
    }
  }

  return selected;
}

async function findLeafDirectories(
  vfs: OverlayFs,
  dir: string,
): Promise<string[]> {
  const leaves: string[] = [];
  try {
    const entries = await vfs.list(dir);
    const hasFiles = entries.some((e) => e.type === 'file');
    const subdirs = entries.filter((e) => e.type === 'directory');

    if (hasFiles) {
      leaves.push(dir);
    }

    for (const sub of subdirs) {
      const subPath = `${dir}/${sub.name}`.replace(/\/+/g, '/');
      const subLeaves = await findLeafDirectories(vfs, subPath);
      leaves.push(...subLeaves);
    }
  } catch {
    // Directory doesn't exist
  }
  return leaves;
}

function parseWindowDuration(window: string): number {
  const match = window.match(/^(\d+)(m|h|d)$/);
  if (!match) return 0;
  const value = Number(match[1]);
  switch (match[2]) {
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

export type RenderOptions = {
  now: Date;
  timeZone?: string;
  rendererParams?: RendererParams;
  /** Concrete lane name for resolving 'this' in renderer op where clauses */
  lane?: string;
};

/** Render selected files through a renderer */
export async function renderSection(
  vfs: OverlayFs,
  directory: string,
  paths: string[],
  renderer: RendererName,
  options: RenderOptions,
): Promise<string> {
  if (paths.length === 0) return '';

  switch (renderer) {
    case 'verbatim':
      return renderVerbatim(vfs, directory, paths, options);
    case 'timeline':
      return renderTimeline(vfs, directory, paths, options);
    case 'summary':
      return renderSummary(vfs, directory, paths, options);
  }
}

async function renderVerbatim(
  vfs: OverlayFs,
  directory: string,
  paths: string[],
  options: RenderOptions,
): Promise<string> {
  const sections: string[] = [];

  for (const path of paths) {
    try {
      // Check if it's a directory (list returns entries for dirs, empty/null for files)
      const entries = await vfs.list(path).catch(() => null);
      if (entries && entries.length > 0) {
        // Directory listing
        const lines = [`### ${path}/`];
        for (const entry of entries) {
          if (entry.name === 'CONTEXT.yaml') continue;
          const marker = entry.type === 'directory' ? 'd' : ' ';
          lines.push(`  ${marker} ${entry.name}`);
        }
        sections.push(lines.join('\n'));
        continue;
      }

      // File content
      const content = await vfs.read(path);
      const rendered = replaceIsoTimestamps(
        content,
        options.now,
        options.timeZone,
      );
      sections.push(`### ${path}\n${rendered}`);
    } catch {
      // File doesn't exist or can't be read
    }
  }

  return sections.length > 0
    ? `## ${directory}\n\n${sections.join('\n\n')}`
    : '';
}

async function renderTimeline(
  vfs: OverlayFs,
  directory: string,
  paths: string[],
  options: RenderOptions,
): Promise<string> {
  const entries: LaneTimelineEntry[] = [];
  const explicitFilePaths = new Set<string>();

  for (const path of paths) {
    if (!(await isDirectoryPath(vfs, path))) {
      explicitFilePaths.add(path);
    }
  }

  for (const path of paths) {
    try {
      if (await isDirectoryPath(vfs, path)) {
        entries.push(
          ...(await buildDirectoryTimelineSummaryEntries(
            vfs,
            path,
            explicitFilePaths,
            options,
          )),
        );
        continue;
      }

      const content = await vfs.read(path);
      const parsed = parseContextFile(content);
      const meta = parsed.meta as Record<string, unknown>;
      const logType =
        typeof meta.log_type === 'string' ? meta.log_type : guessLogType(path);

      // Selected compacted log files should still contribute a summary item
      // from frontmatter; otherwise recency-selected compacted logs never
      // surface their summaries in preview context.
      if (typeof meta.summary === 'string' && meta.summary.length > 0) {
        const timestamp = resolveFrontmatterTimestamp(meta, options.now);
        const relative = formatRelativeTime(timestamp, {
          now: options.now,
          timeZone: options.timeZone,
        });
        const label = buildTimelineSummaryLabel(logType, path);
        entries.push({
          timestamp,
          header: `[${relative}] ${label}`,
          body: formatTimelineBody(
            formatTimelineFrontmatterSummary(meta),
            options.now,
            options.timeZone,
          ),
          lane: logType,
          itemKind: 'summary',
        });
      }

      const laneTimelineEntries = projectTimelineEntriesFromLaneLogFile(
        content,
        {
          now: options.now,
          timeZone: options.timeZone,
        },
      );
      if (laneTimelineEntries.length > 0) {
        entries.push(...laneTimelineEntries);
        continue;
      }

      // Fallback: parse as generic log blocks (non-lane log files)
      const body = parsed.content;

      const blocks = body.split(/\n---\n/).filter((b) => b.trim());
      for (const block of blocks) {
        const lines = block.trim().split('\n');
        const tsMatch = lines[0]?.match(/^\[(\d{4}-\d{2}-\d{2}T[^\]]+)\]/);
        const timestamp = tsMatch?.[1] ? new Date(tsMatch[1]) : new Date(0);
        const firstLine = lines[0] ?? '';
        const restLines = lines.slice(1);
        const relTime = formatRelativeTime(timestamp, {
          now: options.now,
          timeZone: options.timeZone,
        });
        const header = `[${relTime}] ${logType}: ${firstLine.replace(/^\[.*?\]\s*/, '')}`;
        const bodyText = restLines
          .map((line) => `  ${line}`)
          .join('\n')
          .trim();
        entries.push({
          timestamp,
          header,
          body: bodyText,
          lane: logType,
          itemKind: 'entry',
        });
      }
    } catch {
      // Skip unreadable files.
    }
  }

  if (entries.length === 0) return '';

  entries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  const params = options.rendererParams;
  let filtered: LaneTimelineEntry[];

  if (params?.ops && params.ops.length > 0) {
    // New ops-based pipeline
    filtered = applyRendererOps(entries, params.ops, options);
  } else if (params?.window || params?.minItems || params?.maxItems) {
    // Legacy flat params (backward compat)
    filtered = applyLegacyRendererParams(entries, params, options.now);
  } else {
    filtered = entries;
  }

  const lines = filtered.map((entry) =>
    entry.body ? `${entry.header}\n${entry.body}` : entry.header,
  );

  return `## ${directory} (timeline)\n\n${lines.join('\n\n')}`;
}

/** Apply legacy flat rendererParams (window/minItems/maxItems). */
function applyLegacyRendererParams(
  entries: LaneTimelineEntry[],
  params: RendererParams,
  now: Date,
): LaneTimelineEntry[] {
  let filtered = entries;
  if (params.window || params.minItems) {
    const windowMs = params.window ? parseWindowDuration(params.window) : 0;
    const minItems = params.minItems ?? 0;
    const cutoff = windowMs > 0 ? now.getTime() - windowMs : 0;
    const inWindow =
      windowMs > 0
        ? entries.filter((entry) => entry.timestamp.getTime() >= cutoff)
        : [];
    const lastN = minItems > 0 ? entries.slice(-minItems) : [];
    filtered = inWindow.length >= lastN.length ? inWindow : lastN;
  }
  if (params.maxItems && filtered.length > params.maxItems) {
    filtered = filtered.slice(-params.maxItems);
  }
  return filtered;
}

/**
 * Apply renderer ops pipeline sequentially.
 *
 * Each op acts only on entries matching its `where` clause.
 * Non-matching entries pass through untouched.
 * - `select` ops reach back to the full pool to guarantee minimums.
 * - `filter` ops remove entries from the working set.
 */
function applyRendererOps(
  fullPool: LaneTimelineEntry[],
  ops: RendererOp[],
  options: RenderOptions,
): LaneTimelineEntry[] {
  const concreteLane = options.lane;
  // Working set starts as a copy of the full pool
  let working = [...fullPool];

  for (const op of ops) {
    if ('select' in op) {
      working = applySelectOp(working, fullPool, op.select, concreteLane);
    } else {
      working = applyFilterOp(working, op.filter, concreteLane, options.now);
    }
  }

  return working;
}

function applySelectOp(
  working: LaneTimelineEntry[],
  fullPool: LaneTimelineEntry[],
  select: SelectOp['select'],
  concreteLane: string | undefined,
): LaneTimelineEntry[] {
  const matchingInWorking = working.filter((e) =>
    matchesWhere(e, select.where, concreteLane),
  );

  if (matchingInWorking.length >= select.at_least) {
    // Floor already met
    return working;
  }

  // Pull most-recent matching entries from the full pool that aren't already in working
  const workingSet = new Set(working);
  const candidates = fullPool
    .filter(
      (e) => !workingSet.has(e) && matchesWhere(e, select.where, concreteLane),
    )
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  const needed = select.at_least - matchingInWorking.length;
  const toAdd = candidates.slice(0, needed);

  if (toAdd.length === 0) return working;

  // Merge and re-sort chronologically
  const merged = [...working, ...toAdd];
  merged.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return merged;
}

function applyFilterOp(
  working: LaneTimelineEntry[],
  filter: FilterOp['filter'],
  concreteLane: string | undefined,
  now: Date,
): LaneTimelineEntry[] {
  if (filter.window) {
    const windowMs = parseWindowDuration(filter.window);
    if (windowMs > 0) {
      const cutoff = now.getTime() - windowMs;
      working = working.filter((entry) => {
        if (!matchesWhere(entry, filter.where, concreteLane)) return true;
        return entry.timestamp.getTime() >= cutoff;
      });
    }
  }

  if (filter.max_items != null) {
    const matching = working.filter((e) =>
      matchesWhere(e, filter.where, concreteLane),
    );
    if (matching.length > filter.max_items) {
      // Keep only the most recent max_items matching entries; non-matching pass through
      const toRemove = new Set(
        matching.slice(0, matching.length - filter.max_items),
      );
      working = working.filter((e) => !toRemove.has(e));
    }
  }

  return working;
}

/**
 * Test whether a timeline entry matches a `where` clause.
 * All fields use match-any semantics (entry matches if it matches any value in the array).
 * Missing/empty arrays or '*' values match everything.
 */
function matchesWhere(
  entry: LaneTimelineEntry,
  where: RendererOpWhere | undefined,
  concreteLane: string | undefined,
): boolean {
  if (!where) return true;

  if (where.lanes && where.lanes.length > 0 && !where.lanes.includes('*')) {
    const resolvedLanes = where.lanes.map((l) =>
      l === 'this' && concreteLane ? concreteLane : l,
    );
    if (!entry.lane || !resolvedLanes.includes(entry.lane)) return false;
  }

  if (
    where.entry_kinds &&
    where.entry_kinds.length > 0 &&
    !where.entry_kinds.includes('*')
  ) {
    if (!entry.entryKind || !where.entry_kinds.includes(entry.entryKind))
      return false;
  }

  if (
    where.item_kinds &&
    where.item_kinds.length > 0 &&
    !where.item_kinds.includes('*')
  ) {
    if (!entry.itemKind || !where.item_kinds.includes(entry.itemKind))
      return false;
  }

  return true;
}

async function isDirectoryPath(vfs: OverlayFs, path: string): Promise<boolean> {
  return vfs
    .list(path)
    .then((entries) => entries.length > 0)
    .catch(() => false);
}

async function buildDirectoryTimelineSummaryEntries(
  vfs: OverlayFs,
  directoryPath: string,
  explicitFilePaths: Set<string>,
  options: RenderOptions,
): Promise<LaneTimelineEntry[]> {
  const files = (await listFilesRecursive(vfs, directoryPath)).filter(
    (file) => file.path.endsWith('.log') && !explicitFilePaths.has(file.path),
  );
  const entries: LaneTimelineEntry[] = [];

  for (const file of files) {
    try {
      const content = await vfs.read(file.path);
      const parsed = parseContextFile(content);
      const meta = parsed.meta as Record<string, unknown>;
      if (!meta || Object.keys(meta).length === 0) {
        continue;
      }
      const logType =
        typeof meta.log_type === 'string'
          ? meta.log_type
          : guessLogType(file.path);
      const timestamp = resolveFrontmatterTimestamp(meta, options.now);
      const relative = formatRelativeTime(timestamp, {
        now: options.now,
        timeZone: options.timeZone,
      });
      const label = buildTimelineSummaryLabel(logType, file.path);
      entries.push({
        timestamp,
        header: `[${relative}] ${label}`,
        body: formatTimelineBody(
          formatTimelineFrontmatterSummary(meta),
          options.now,
          options.timeZone,
        ),
        lane: logType,
        itemKind: 'summary',
      });
    } catch {
      // Skip unreadable directory children.
    }
  }

  return entries;
}

function buildTimelineSummaryLabel(logType: string, path: string): string {
  const name = basename(path);
  if (logType === 'feedback') return `feedback:summary ${name}`;
  if (logType === 'steering') return `steering:summary ${name}`;
  if (logType === 'nap') return `nap:${name}`;
  return `${logType}:summary ${name}`;
}

function formatTimelineFrontmatterSummary(
  meta: Record<string, unknown>,
): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(meta)) {
    if (key === 'id' || key === 'type' || value == null || value === '') {
      continue;
    }
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.join(', ')}]`);
      continue;
    }
    if (typeof value === 'object') {
      lines.push(`${key}: ${JSON.stringify(value)}`);
      continue;
    }
    lines.push(`${key}: ${String(value)}`);
  }
  return lines.join('\n');
}

function formatTimelineBody(
  content: string,
  now: Date,
  timeZone?: string,
): string {
  const normalized = replaceIsoTimestamps(content, now, timeZone);
  return normalized
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

function resolveFrontmatterTimestamp(
  meta: Record<string, unknown> | undefined,
  fallback: Date,
): Date {
  const timestampKeys = ['updated', 'created', 'created_at'];
  for (const key of timestampKeys) {
    const value = meta?.[key];
    if (typeof value !== 'string') {
      continue;
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return fallback;
}

async function renderSummary(
  vfs: OverlayFs,
  directory: string,
  paths: string[],
  options: RenderOptions,
): Promise<string> {
  const sections: string[] = [];

  for (const path of paths) {
    try {
      const content = await vfs.read(path);
      const parsed = parseContextFile(content);
      const meta = parsed.meta;
      if (!meta || Object.keys(meta).length === 0) {
        // No frontmatter — show as compact content
        const trimmed = content.trim();
        if (trimmed) {
          sections.push(`**${basename(path)}**: ${trimmed.slice(0, 200)}`);
        }
        continue;
      }

      // Render frontmatter as compact key-value block
      const lines = [`**${basename(path)}**`];
      for (const [key, value] of Object.entries(meta)) {
        if (key === 'id' || key === 'type') continue; // Skip meta-meta
        if (value == null || value === '') continue;
        const rendered =
          typeof value === 'string'
            ? replaceIsoTimestamps(value, options.now, options.timeZone)
            : JSON.stringify(value);
        lines.push(`  ${key}: ${rendered}`);
      }

      // Include body if short
      const body = parsed.content.trim();
      if (body && body.length < 300) {
        lines.push(`  ${body}`);
      }

      sections.push(lines.join('\n'));
    } catch {
      // Skip unreadable files
    }
  }

  return sections.length > 0
    ? `## ${directory} (status)\n\n${sections.join('\n')}`
    : '';
}

function guessLogType(path: string): string {
  // Flat log structure: type is a suffix in the filename
  // e.g. "2026-03-24-0.conversation.log" → "conversation"
  const filename = path.split('/').pop() ?? '';
  const match = filename.match(/\.(\w+)\.log$/);
  if (match?.[1]) return match[1];
  return 'log';
}

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

// ---------------------------------------------------------------------------
// Context Resolution
// ---------------------------------------------------------------------------

const CONTEXT_MANIFEST_PATH = '/runtime/handles/context-dirs.yaml';
const LANES_YAML_PATH = '/developer/config/lanes.yaml';

export type ResolveContextOptions = {
  stage: string;
  now: Date;
  timeZone?: string;
  lane?: string;
};

/**
 * Resolve all context for a stage.
 *
 * Reads the context directory manifest, visits each directory's CONTEXT.yaml,
 * applies selectors per the override chain (lanes.{lane}.{stage} → stages.{stage}),
 * merges runtime pinned entries, and renders everything through renderers.
 *
 * Directories whose CONTEXT.yaml produces no content for the current
 * stage/lane are silently filtered out.
 */
export async function resolveStageContext(
  vfs: OverlayFs,
  options: ResolveContextOptions,
): Promise<string> {
  const { stage, now, timeZone, lane } = options;

  // 1. Read context directory manifest
  const manifest = await loadContextManifest(vfs);

  const sections: string[] = [];
  const renderOpts: RenderOptions = { now, timeZone, lane };

  // 2. Process each directory in the manifest
  for (const dir of manifest.directories) {
    if (dir === 'runtime-pinned') {
      const runtimeSection = await renderRuntimePinned(
        vfs,
        stage,
        lane,
        renderOpts,
      );
      if (runtimeSection) sections.push(runtimeSection);
      continue;
    }

    // Expand lane templates in directory path
    const expandedDir = lane ? expandLaneTemplate(dir, lane) : dir;

    const section = await resolveDirectoryContext(
      vfs,
      expandedDir,
      stage,
      lane,
      renderOpts,
    );
    if (section) sections.push(section);
  }

  return sections.join('\n\n');
}

async function resolveDirectoryContext(
  vfs: OverlayFs,
  directory: string,
  stage: string,
  lane: string | undefined,
  renderOpts: RenderOptions,
): Promise<string> {
  // Read CONTEXT.yaml for this directory
  const contextConfig = await loadContextConfig(vfs, directory);

  // Override chain: lanes.{lane}.{stage} → stages.{stage}
  const laneStageOverride = lane
    ? resolveLaneContextOverride(contextConfig, lane, stage)
    : undefined;
  const stageOverride = contextConfig.stages?.[stage];

  const renderer = laneStageOverride?.renderer ?? stageOverride?.renderer;
  const rendererParams =
    laneStageOverride?.rendererParams ?? stageOverride?.rendererParams;
  const pins = laneStageOverride?.pins ?? stageOverride?.pins ?? [];
  const selector = laneStageOverride?.selector ?? stageOverride?.selector;

  // Collect paths: static pins + selector results
  const paths: string[] = [];

  // Add pinned files (relative to directory)
  for (const pin of pins) {
    const fullPath = pin.path.startsWith('/')
      ? pin.path
      : `${directory}/${pin.path}`.replace(/\/+/g, '/');
    paths.push(fullPath);
  }

  // Evaluate selector
  if (selector) {
    const selected = await applySelector(
      vfs,
      directory,
      selector,
      renderOpts.now,
      lane,
    );
    for (const p of selected) {
      if (!paths.includes(p)) paths.push(p);
    }
  }

  // If this directory has no explicit config for the current stage, render nothing.
  if (paths.length === 0 || !renderer) return '';

  // Render through the directory's renderer, passing renderer params
  return renderSection(vfs, directory, paths, renderer, {
    ...renderOpts,
    rendererParams,
  });
}

/**
 * Render lane-aware runtime pinned entries (from /runtime/handles/pinned.md).
 * Only entries matching the current stage and lane are included.
 */
async function renderRuntimePinned(
  vfs: OverlayFs,
  stage: string,
  lane: string | undefined,
  renderOpts: RenderOptions,
): Promise<string> {
  const allPins = await loadPinnedState(vfs);
  const matching = queryPinnedEntries(allPins, stage, lane);
  if (matching.length === 0) return '';

  const paths = matching.map((p) => p.path);
  return renderSection(vfs, 'Runtime Pinned', paths, 'verbatim', renderOpts);
}

// ---------------------------------------------------------------------------
// Config Loading (with caching per VFS instance)
// ---------------------------------------------------------------------------

const manifestCache = new WeakMap<OverlayFs, ContextManifest>();
const contextConfigCache = new WeakMap<OverlayFs, Map<string, ContextConfig>>();
const lanesConfigCache = new WeakMap<OverlayFs, LanesConfig>();

async function loadContextManifest(vfs: OverlayFs): Promise<ContextManifest> {
  const cached = manifestCache.get(vfs);
  if (cached) return cached;

  let raw = '';
  try {
    raw = await vfs.read(CONTEXT_MANIFEST_PATH);
  } catch {
    // No manifest — return default
    const def = getDefaultContextManifest();
    manifestCache.set(vfs, def);
    return def;
  }

  const manifest = parseContextManifest(raw);
  manifestCache.set(vfs, manifest);
  return manifest;
}

async function loadContextConfig(
  vfs: OverlayFs,
  directory: string,
): Promise<ContextConfig> {
  let cache = contextConfigCache.get(vfs);
  if (!cache) {
    cache = new Map();
    contextConfigCache.set(vfs, cache);
  }

  const existing = cache.get(directory);
  if (existing) return existing;

  const yamlPath = `${directory}/CONTEXT.yaml`.replace(/\/+/g, '/');
  let raw = '';
  try {
    raw = await vfs.read(yamlPath);
  } catch {
    // No CONTEXT.yaml — this directory contributes no static context.
    const empty = EMPTY_CONTEXT_CONFIG;
    cache.set(directory, empty);
    return empty;
  }

  const config = parseContextYaml(raw);
  cache.set(directory, config);
  return config;
}

export async function loadLanesConfig(vfs: OverlayFs): Promise<LanesConfig> {
  const cached = lanesConfigCache.get(vfs);
  if (cached) return cached;

  let raw = '';
  try {
    raw = await vfs.read(LANES_YAML_PATH);
  } catch {
    const def: LanesConfig = {};
    lanesConfigCache.set(vfs, def);
    return def;
  }

  const config = parseLanesYaml(raw);
  lanesConfigCache.set(vfs, config);
  return config;
}

// ---------------------------------------------------------------------------
// Lane Helpers
// ---------------------------------------------------------------------------

/**
 * Three-tier lane matching: exact → prefix:* → fallback.
 * e.g. "workspace:frontend" matches "workspace:frontend" > "workspace:*" > fallback
 */
export function matchLanePattern(lane: string, pattern: string): boolean {
  if (pattern === lane) return true;
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -2);
    return lane.startsWith(`${prefix}:`);
  }
  return false;
}

/**
 * Expand lane template variables in a string.
 * Supported: ${lane}, ${lane.name}, ${lane.prefix}
 */
export function expandLaneTemplate(template: string, lane: string): string {
  if (!template.includes('${')) return template;
  const colonIdx = lane.indexOf(':');
  const prefix = colonIdx >= 0 ? lane.slice(0, colonIdx) : lane;
  const name = colonIdx >= 0 ? lane.slice(colonIdx + 1) : lane;
  return template
    .replace(/\$\{lane\}/g, lane)
    .replace(/\$\{lane\.name\}/g, name)
    .replace(/\$\{lane\.prefix\}/g, prefix);
}

/**
 * Resolve lane-specific context override from CONTEXT.yaml.
 * Tries exact match first, then pattern match.
 */
function resolveLaneContextOverride(
  config: ContextConfig,
  lane: string,
  stage: string,
): ContextStageOverride | undefined {
  if (!config.lanes) return undefined;

  // Exact match
  const exactLane = config.lanes[lane];
  if (exactLane?.[stage]) return exactLane[stage];

  // Pattern match
  for (const [pattern, stages] of Object.entries(config.lanes)) {
    if (matchLanePattern(lane, pattern) && stages[stage]) {
      return stages[stage];
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Context Trace (for UI debugging)
// ---------------------------------------------------------------------------

export type ContextTraceEntry = {
  path: string;
  type: 'file' | 'directory';
  source: 'pin' | 'selector' | 'runtime-pinned';
  renderer: RendererName;
  directory: string;
  selectorStrategy?: string;
};

export type ContextTraceSection = {
  directory: string;
  renderer: RendererName;
  rendererParams?: RendererParams;
  selectorConfig?: SelectorConfig;
  hasStageOverride: boolean;
  entries: ContextTraceEntry[];
  /** All paths passed to the renderer (pins + selector results combined) */
  rendererInputPaths: string[];
  renderedPreview: string;
};

export type ContextTrace = {
  stage: string;
  lane?: string;
  manifest: ContextManifest;
  sections: ContextTraceSection[];
  totalEntries: number;
  totalChars: number;
};

/**
 * Trace context resolution for a stage — returns metadata about what was
 * included and why, plus the rendered preview. Used by the UI debug panel.
 */
export async function traceStageContext(
  vfs: OverlayFs,
  options: ResolveContextOptions,
): Promise<ContextTrace> {
  const { stage, now, timeZone, lane } = options;
  const manifest = await loadContextManifest(vfs);

  const sections: ContextTraceSection[] = [];
  const renderOpts: RenderOptions = { now, timeZone, lane };

  for (const include of manifest.directories) {
    if (include === 'runtime-pinned') {
      const allPins = await loadPinnedState(vfs);
      const matching = queryPinnedEntries(allPins, stage, lane);
      if (matching.length > 0) {
        const paths = matching.map((p) => p.path);
        const preview = await renderSection(
          vfs,
          'Runtime Pinned',
          paths,
          'verbatim',
          renderOpts,
        );
        sections.push({
          directory: 'runtime-pinned',
          renderer: 'verbatim',
          hasStageOverride: false,
          entries: matching.map((p) => ({
            path: p.path,
            type: p.kind === 'directory' ? 'directory' : 'file',
            source: 'runtime-pinned' as const,
            renderer: 'verbatim' as const,
            directory: 'runtime-pinned',
          })),
          rendererInputPaths: paths,
          renderedPreview: preview,
        });
      }
      continue;
    }

    const expandedDir = lane ? expandLaneTemplate(include, lane) : include;
    const contextConfig = await loadContextConfig(vfs, expandedDir);

    const laneStageOverride = lane
      ? resolveLaneContextOverride(contextConfig, lane, stage)
      : undefined;
    const stageOverride = contextConfig.stages?.[stage];

    const renderer = laneStageOverride?.renderer ?? stageOverride?.renderer;
    const rendererParams =
      laneStageOverride?.rendererParams ?? stageOverride?.rendererParams;
    const pins = laneStageOverride?.pins ?? stageOverride?.pins ?? [];
    const selector = laneStageOverride?.selector ?? stageOverride?.selector;
    if (!renderer) continue;

    const entries: ContextTraceEntry[] = [];

    // Pinned files
    for (const pin of pins) {
      const fullPath = pin.path.startsWith('/')
        ? pin.path
        : `${expandedDir}/${pin.path}`.replace(/\/+/g, '/');
      entries.push({
        path: fullPath,
        type: 'file',
        source: 'pin',
        renderer,
        directory: expandedDir,
      });
    }

    // Selector results
    if (selector) {
      const selected = await applySelector(
        vfs,
        expandedDir,
        selector,
        now,
        lane,
      );
      for (const p of selected) {
        if (entries.some((e) => e.path === p)) continue;
        const isDir = await vfs
          .list(p)
          .then((e) => e.length > 0)
          .catch(() => false);
        entries.push({
          path: p,
          type: isDir ? 'directory' : 'file',
          source: 'selector',
          renderer,
          directory: expandedDir,
          selectorStrategy: selector.strategy,
        });
      }
    }

    const allPaths = entries.map((e) => e.path);
    const preview =
      allPaths.length > 0
        ? await renderSection(vfs, expandedDir, allPaths, renderer, {
            ...renderOpts,
            rendererParams,
          })
        : '';

    sections.push({
      directory: expandedDir,
      renderer,
      rendererParams,
      selectorConfig: selector,
      hasStageOverride: Boolean(laneStageOverride || stageOverride),
      entries,
      rendererInputPaths: allPaths,
      renderedPreview: preview,
    });
  }

  const totalEntries = sections.reduce((s, sec) => s + sec.entries.length, 0);
  const totalChars = sections.reduce(
    (s, sec) => s + sec.renderedPreview.length,
    0,
  );

  return { stage, lane, manifest, sections, totalEntries, totalChars };
}

/** Clear cached configs (call between flow runs if needed) */
export function clearContextCache(vfs: OverlayFs): void {
  manifestCache.delete(vfs);
  contextConfigCache.delete(vfs);
  lanesConfigCache.delete(vfs);
}

// ---------------------------------------------------------------------------
// Default context manifest (used when manifest file is missing)
// ---------------------------------------------------------------------------

function getDefaultContextManifest(): ContextManifest {
  return {
    directories: [
      '/agent/home/',
      '/agent/packages/',
      '/developer/packages/',
      '/developer/commands/',
      '/system/packages/',
      '/system/commands/',
      '/logs/',
      '/runtime/state/',
      '/runtime/queue/',
      'runtime-pinned',
    ],
  };
}
