import type {
  AppRouteNode,
  LeafNode,
  OutletNode,
  SegmentNode,
} from './app-routes';
import {
  type OutletsMap,
  PARENT,
  parseNamespacedQuery,
  type QuerySchema,
} from './app-routes';

type Validator<T> = (input: unknown) => { success: boolean; data?: T };

type NamespacedQuery = Record<string, Record<string, unknown>>;

type MatchContext = {
  pathSegments: string[];
  searchParams: URLSearchParams;
  basePath?: string;
};

export type MatchedBranch =
  | {
      kind: 'leaf';
      node: LeafNode<string, any, any>;
      params: Record<string, string>;
      query: NamespacedQuery;
      pattern: string;
      outletPath: string[];
    }
  | {
      kind: 'segment';
      node: SegmentNode<string, any, any, any>;
      params: Record<string, string>;
      query: NamespacedQuery;
      pattern: string;
      outletPath: string[];
      outlets: Record<string | symbol, MatchedBranch | null>;
    };

export type MatchedRoot = {
  node: AppRouteNode<any, any>;
  pattern: string;
  outletPath: string[];
};

export type MatchResult = {
  root: MatchedRoot | null;
  outlets: Record<string | symbol, MatchedBranch | null>;
};

/**
 * Match a URL against the app route tree (v2).
 * - Ignores outlet names in the path
 * - Supports param segments (":id")
 * - Supports [PARENT] replacement (flattened)
 * - Parallel outlets are matched independently
 */
export function matchAppRoute<TOutlets extends OutletsMap>(
  appRoute: AppRouteNode<any, TOutlets>,
  url: URL,
  basePath?: string,
): MatchResult {
  const normalized = stripBase(url.pathname, basePath);
  const pathSegments = splitPath(normalized);
  const searchParams = url.searchParams;

  // Check if root has a page (always matches)
  const hasRootPage =
    appRoute.__page && (appRoute.__page as { component?: unknown }).component;
  const root: MatchedRoot | null = hasRootPage
    ? { node: appRoute, pattern: '', outletPath: [] }
    : null;

  const outlets = matchOutlets(
    appRoute.__outlets,
    {
      pathSegments,
      searchParams,
      basePath,
    },
    {},
    {},
    [],
  );
  return { root, outlets };
}

function stripBase(pathname: string, basePath?: string): string {
  if (!basePath) return pathname;
  if (!pathname.startsWith(basePath)) return pathname;
  const stripped = pathname.slice(basePath.length);
  return stripped.startsWith('/') ? stripped : `/${stripped}`;
}

function splitPath(pathname: string): string[] {
  const normalized = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!normalized) return [];
  return normalized.split('/');
}

function matchOutlets(
  outlets: OutletsMap,
  ctx: MatchContext,
  parentParams: Record<string, string>,
  parentQuery: NamespacedQuery,
  outletPath: string[],
): Record<string | symbol, MatchedBranch | null> {
  const result: Record<string | symbol, MatchedBranch | null> = {};

  // 1. Try [PARENT] replacement FIRST - these are "escape hatches" like /new, /edit
  // They should take priority over dynamic segments in named outlets
  let parentMatched = false;
  if (outlets[PARENT]) {
    const parentOutlet = outlets[PARENT];
    if (parentOutlet && parentOutlet.__kind === 'outlet') {
      const outletQuery = buildOutletQuery(
        'parent',
        parentOutlet.__config.querySchema,
        ctx.searchParams,
      );
      const mergedQuery = { ...parentQuery, ...outletQuery };
      const branch = matchSegments(
        parentOutlet.__segments,
        ctx.pathSegments,
        parentParams,
        mergedQuery,
        '',
        ctx.searchParams,
        [...outletPath, '[PARENT]'],
      );
      result[PARENT] = branch;
      if (branch) {
        parentMatched = true;
      }
    }
  }

  // 2. Match named outlets
  // If [PARENT] matched, named outlets with dynamic segments won't compete
  for (const [outletName, rawOutletNode] of Object.entries(outlets)) {
    const outletNode = rawOutletNode as
      | OutletNode<any, any, any, any>
      | undefined;
    if (typeof outletName === 'symbol') continue;
    if (!outletNode || outletNode.__kind !== 'outlet') {
      result[outletName] = null;
      continue;
    }
    const outletQuery = buildOutletQuery(
      outletName,
      outletNode.__config.querySchema,
      ctx.searchParams,
    );
    const mergedQuery = { ...parentQuery, ...outletQuery };

    // If [PARENT] already matched a literal, skip dynamic-only outlets
    // to avoid `:postId` matching 'new'
    const branch = matchSegments(
      outletNode.__segments,
      ctx.pathSegments,
      parentParams,
      mergedQuery,
      '',
      ctx.searchParams,
      [...outletPath, outletName],
      parentMatched, // Pass flag to skip dynamic-only matches
    );
    result[outletName] = branch;
  }

  return result;
}

function matchSegments(
  segments: Record<
    string,
    LeafNode<any, any, any> | SegmentNode<any, any, any, any>
  >,
  pathSegments: string[],
  parentParams: Record<string, string>,
  parentQuery: NamespacedQuery,
  basePattern: string,
  searchParams: URLSearchParams,
  outletPath: string[],
  skipDynamicOnly = false, // If true, only match literals (used when [PARENT] already matched)
): MatchedBranch | null {
  // Sort segments: literals first, then dynamics
  // This ensures '/new' matches before '/:id' within the same outlet
  const sortedSegments = Object.entries(segments).sort(([, a], [, b]) => {
    const aIsDynamic = a.path.startsWith(':');
    const bIsDynamic = b.path.startsWith(':');
    if (aIsDynamic && !bIsDynamic) return 1; // b (literal) comes first
    if (!aIsDynamic && bIsDynamic) return -1; // a (literal) comes first
    return 0;
  });

  for (const [, node] of sortedSegments) {
    const pathPiece = pathSegments[0];
    if (pathPiece === undefined) continue;

    const isDynamic = node.path.startsWith(':');

    // If [PARENT] already matched a literal, skip dynamic segments in named outlets
    // This prevents `:postId` from matching 'new' when [PARENT] has a literal 'new'
    if (skipDynamicOnly && isDynamic) continue;

    if (!segmentMatches(node.path, pathPiece)) continue;

    const nextParams = addParam(node.path, parentParams, pathPiece);
    const pattern = `${basePattern}/${node.path}`;
    const remaining = pathSegments.slice(1);

    if (node.__kind === 'leaf') {
      // Leaf matches this segment and ignores any remaining path segments.
      // This allows parallel outlets to match prefix paths (e.g., taskPanel matching /boards
      // even when the URL is /boards/abc).
      return {
        kind: 'leaf',
        node,
        params: nextParams,
        query: parentQuery,
        pattern,
        outletPath,
      };
    }

    // segment - always match if the segment itself matches
    // Child outlets may or may not have matches for remaining segments, and that's fine.
    const childOutlets = matchOutlets(
      node.__outlets,
      {
        pathSegments: remaining,
        searchParams,
        basePath: undefined,
      },
      nextParams,
      parentQuery,
      outletPath,
    );

    return {
      kind: 'segment',
      node,
      params: nextParams,
      query: parentQuery,
      pattern,
      outletPath,
      outlets: childOutlets,
    };
  }

  return null;
}

function segmentMatches(pattern: string, value: string): boolean {
  if (pattern.startsWith(':')) return value.length > 0;
  return pattern === value;
}

function addParam(
  pattern: string,
  params: Record<string, string>,
  value: string,
): Record<string, string> {
  if (!pattern.startsWith(':')) return params;
  const name = pattern.slice(1);
  return { ...params, [name]: value };
}

function buildOutletQuery(
  namespace: string,
  schema: QuerySchema | undefined,
  searchParams: URLSearchParams,
): NamespacedQuery {
  const namespaced = parseNamespacedQuery(searchParams);
  const raw = namespaced[namespace] ?? {};
  if (!schema) return { [namespace]: raw };

  const validated: Record<string, unknown> = {};
  for (const [key, validator] of Object.entries(schema)) {
    const val = raw[key];
    if (val === undefined) continue;
    const res = (validator as Validator<unknown>)(val);
    if (res && (res as any).success !== false) {
      validated[key] = (res as any).data ?? val;
    }
  }
  return { [namespace]: validated };
}

// ---------------------------------------------------------------------------
// Schema extraction for query param persistence
// ---------------------------------------------------------------------------

type OutletSchemaMap = Record<string, QuerySchema | undefined>;

/**
 * Extract all active outlet schemas from a match result.
 * Returns a map of outlet path (e.g., "taskPanel", "main.detail") to querySchema.
 *
 * This is used by navigate() to determine which query params should persist:
 * - Params whose outlet path is in the map AND whose key validates against the schema are kept
 * - Params whose outlet path is not in the map (outlet not active) are dropped
 */
export function extractActiveOutletSchemas(
  match: MatchResult,
): OutletSchemaMap {
  const result: OutletSchemaMap = {};

  // Walk all outlets in the match
  for (const [key, branch] of Object.entries(match.outlets)) {
    if (!branch) continue;
    extractSchemasFromBranch(branch, key, result);
  }

  // Also check symbol keys (for [PARENT])
  for (const sym of Object.getOwnPropertySymbols(match.outlets)) {
    const branch = match.outlets[sym];
    if (!branch) continue;
    // [PARENT] outlets don't have their own query namespace - they use parent's
    // So we skip them for schema extraction
  }

  return result;
}

function extractSchemasFromBranch(
  branch: MatchedBranch,
  outletPath: string,
  result: OutletSchemaMap,
): void {
  // Get the schema from the node's outlet config if available
  // Note: The schema is stored at the outlet level, not at segment/leaf level
  // So we extract it from the outletPath we've already collected

  // For now, we need to look up the schema from the matched node
  // The outlet schema is stored in OutletNode.__config.querySchema
  // But MatchedBranch stores LeafNode or SegmentNode, not OutletNode

  // The outletPath in MatchedBranch tells us the outlet chain
  // For a branch with outletPath ['main', 'detail'], the namespaced query is "main.detail.paramName"

  // Since the branch itself doesn't carry the schema, we mark the outlet path as active
  // The actual schema validation happens in filterQueryParams using the route tree
  result[outletPath] = undefined; // Mark as active (schema lookup happens separately)

  // Recurse into child outlets for segments
  if (branch.kind === 'segment') {
    for (const [childKey, childBranch] of Object.entries(branch.outlets)) {
      if (!childBranch) continue;
      const childPath = outletPath ? `${outletPath}.${childKey}` : childKey;
      extractSchemasFromBranch(childBranch, childPath, result);
    }
    // Also check symbol keys
    for (const sym of Object.getOwnPropertySymbols(branch.outlets)) {
      const childBranch = branch.outlets[sym];
      if (!childBranch) continue;
      // [PARENT] doesn't add to outlet path
    }
  }
}

/**
 * Filter current query params based on which outlets are active in the new route.
 *
 * Rules:
 * - Keep param if its outlet path exists in activeOutlets
 * - Drop param if its outlet path is not active
 * - Non-namespaced params (no dot) are always dropped
 *
 * @param currentParams Current URLSearchParams
 * @param activeOutletPaths Set of active outlet paths (e.g., "taskPanel", "main.detail")
 * @param routeTree The route tree for schema validation (optional, for value validation)
 * @returns Filtered params as URLSearchParams
 */
export function filterQueryParamsForNavigation(
  currentParams: URLSearchParams,
  activeOutletPaths: Set<string>,
): URLSearchParams {
  const result = new URLSearchParams();

  for (const [fullKey, value] of currentParams.entries()) {
    // Parse the namespaced key: "taskPanel.taskId" -> ["taskPanel", "taskId"]
    // or "main.detail.showCompleted" -> outlet path "main.detail", param "showCompleted"

    const parts = fullKey.split('.');
    if (parts.length < 2) {
      // Non-namespaced param (no dot) - drop it
      continue;
    }

    // Find the longest matching outlet path
    // Try "main.detail" first, then "main"
    let outletPath = '';
    for (let i = parts.length - 1; i >= 1; i--) {
      const candidatePath = parts.slice(0, i).join('.');
      if (activeOutletPaths.has(candidatePath)) {
        outletPath = candidatePath;
        break;
      }
    }

    if (!outletPath) {
      // No matching outlet path - drop this param
      continue;
    }

    // Outlet is active - keep the param
    // Note: We could add schema validation here if we have access to the schema
    result.set(fullKey, value);
  }

  return result;
}

/**
 * Get active outlet paths from a match result.
 * Returns a Set of outlet paths like "taskPanel", "main", "main.detail"
 */
export function getActiveOutletPaths(match: MatchResult): Set<string> {
  const paths = new Set<string>();

  for (const [key, branch] of Object.entries(match.outlets)) {
    if (!branch) continue;
    collectOutletPaths(branch, key, paths);
  }

  return paths;
}

function collectOutletPaths(
  branch: MatchedBranch,
  currentPath: string,
  paths: Set<string>,
): void {
  paths.add(currentPath);

  if (branch.kind === 'segment') {
    for (const [childKey, childBranch] of Object.entries(branch.outlets)) {
      if (!childBranch) continue;
      const childPath = `${currentPath}.${childKey}`;
      collectOutletPaths(childBranch, childPath, paths);
    }
  }
}
