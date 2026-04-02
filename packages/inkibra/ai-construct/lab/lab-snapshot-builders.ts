/**
 * Generic construct lab snapshot builders.
 *
 * Provides functions to build tool/decision logs from VFS or snapshot nodes.
 * These are app-agnostic and work with any construct, regardless of the
 * product-specific entity (persona, bot, etc.) layered on top.
 */

import { parseContextFile } from '@inkibra/ai-flow';
import type { Construct } from '../construct/construct';
import type {
  ConstructDecisionLogEvent,
  ConstructToolLogEvent,
} from '../live/snapshot-types';
import { listRecentConstructLogPaths } from '../live/transcript-snapshot';
import { parseFeedbackLog, parseSteeringLog } from '../vfs/feedback';
import { VFS_PATHS } from '../vfs/layout';
import { parseLogFile } from '../vfs/loader';
import type {
  ConstructRuntimeDecisionView,
  ConstructRuntimeToolEventView,
  ConstructSnapshotNode,
} from './types';

// ---------------------------------------------------------------------------
// Snapshot-node log helpers
// ---------------------------------------------------------------------------

/**
 * Filters and returns the most recent `.log` files under `baseDir`
 * from an array of snapshot nodes, sorted newest-first.
 */
export function listRecentConstructLogNodes(
  nodes: ConstructSnapshotNode[],
  baseDir: string,
  limit: number,
): ConstructSnapshotNode[] {
  if (limit <= 0) {
    return [];
  }

  const normalizedBase = baseDir.endsWith('/') ? baseDir : `${baseDir}/`;
  return nodes
    .filter(
      (node) =>
        node.kind === 'file' &&
        node.path.endsWith('.log') &&
        (node.path === baseDir || node.path.startsWith(normalizedBase)),
    )
    .sort((left, right) => right.path.localeCompare(left.path))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Tool & decision log result type
// ---------------------------------------------------------------------------

/**
 * The combined output of building tool/decision logs from a construct.
 * Contains both the full runtime-level views and the trimmed lab-level views.
 */
export type ConstructToolAndDecisionLogs = {
  /** Full runtime-level tool events (up to 40). */
  runtimeToolLog: ConstructRuntimeToolEventView[];
  /** Full runtime-level decision events (up to 40). */
  runtimeDecisionLog: ConstructRuntimeDecisionView[];
  /** Trimmed lab-level tool events (up to 20). */
  labToolLog: ConstructToolLogEvent[];
  /** Trimmed lab-level decision events (up to 20). */
  labDecisionLog: ConstructDecisionLogEvent[];
};

// ---------------------------------------------------------------------------
// Build from snapshot nodes
// ---------------------------------------------------------------------------

/**
 * Builds tool and decision log entries from pre-loaded snapshot nodes.
 * This is the fast path when a DAL snapshot is already available.
 */
export async function buildConstructToolAndDecisionLogsFromNodes(
  nodes: ConstructSnapshotNode[],
): Promise<ConstructToolAndDecisionLogs> {
  const now = new Date().toISOString();
  const runtimeToolLog: ConstructRuntimeToolEventView[] = [];
  const runtimeDecisionLog: ConstructRuntimeDecisionView[] = [];

  for (const node of listRecentConstructLogNodes(
    nodes,
    VFS_PATHS.logs.root,
    3,
  )) {
    try {
      const parsed = parseContextFile(node.content);
      const entries = parseLogFile(parsed.content);
      for (const entry of entries.slice(-8)) {
        runtimeDecisionLog.push({
          id: `${entry.impulseId}:decision:${entry.timestamp.toISOString()}`,
          stage: 'response/decide',
          intent: entry.trigger,
          rationale: entry.thinking.slice(0, 400),
          createdAt: entry.timestamp.toISOString(),
        });
        for (const tool of entry.toolHistory ?? []) {
          runtimeToolLog.push({
            id: `${entry.impulseId}:${tool.tool}:${tool.command}`,
            tool: tool.tool,
            command: tool.command,
            output: tool.output,
            createdAt: tool.timestamp.toISOString(),
          });
        }
      }
      appendLaneControlEntries(parsed.content, runtimeDecisionLog);
    } catch {
      // Skip unreadable log files.
    }
  }

  return sortAndSlice(runtimeToolLog, runtimeDecisionLog, now);
}

// ---------------------------------------------------------------------------
// Build from live VFS
// ---------------------------------------------------------------------------

/**
 * Builds tool and decision log entries by reading the construct's live VFS.
 * Falls back to snapshot nodes if provided.
 */
export async function buildConstructToolAndDecisionLogs(
  construct: Construct,
  snapshotNodes?: ConstructSnapshotNode[],
): Promise<ConstructToolAndDecisionLogs> {
  if (snapshotNodes) {
    return buildConstructToolAndDecisionLogsFromNodes(snapshotNodes);
  }

  const vfs = construct.getVfs();
  const now = new Date().toISOString();
  const runtimeToolLog: ConstructRuntimeToolEventView[] = [];
  const runtimeDecisionLog: ConstructRuntimeDecisionView[] = [];

  const conversationLogs = await listRecentConstructLogPaths(
    construct,
    VFS_PATHS.logs.root,
    3,
  );

  for (const path of conversationLogs) {
    try {
      const raw = await vfs.read(path);
      const parsed = parseContextFile(raw);
      const entries = parseLogFile(parsed.content);
      for (const entry of entries.slice(-8)) {
        runtimeDecisionLog.push({
          id: `${entry.impulseId}:decision:${entry.timestamp.toISOString()}`,
          stage: 'response/decide',
          intent: entry.trigger,
          rationale: entry.thinking.slice(0, 400),
          createdAt: entry.timestamp.toISOString(),
        });
        for (const tool of entry.toolHistory ?? []) {
          runtimeToolLog.push({
            id: `${entry.impulseId}:${tool.tool}:${tool.command}`,
            tool: tool.tool,
            command: tool.command,
            output: tool.output,
            createdAt: tool.timestamp.toISOString(),
          });
        }
      }
      appendLaneControlEntries(parsed.content, runtimeDecisionLog);
    } catch {
      // Skip unreadable log files.
    }
  }

  const recentNapToolLog =
    typeof (
      construct as {
        getRecentNapToolLog?: () => ConstructRuntimeToolEventView[];
      }
    ).getRecentNapToolLog === 'function'
      ? (
          construct as {
            getRecentNapToolLog: () => ConstructRuntimeToolEventView[];
          }
        ).getRecentNapToolLog()
      : [];

  if (recentNapToolLog.length > 0) {
    const seen = new Set(
      runtimeToolLog.map(
        (item) =>
          `${item.tool}|${item.command}|${item.output}|${item.createdAt}`,
      ),
    );

    for (const item of recentNapToolLog) {
      const key = `${item.tool}|${item.command}|${item.output}|${item.createdAt}`;
      if (seen.has(key)) {
        continue;
      }
      runtimeToolLog.push(item);
      seen.add(key);
    }
  }

  return sortAndSlice(runtimeToolLog, runtimeDecisionLog, now);
}

function appendLaneControlEntries(
  content: string,
  runtimeDecisionLog: ConstructRuntimeDecisionView[],
): void {
  for (const feedback of parseFeedbackLog(content).slice(-4)) {
    runtimeDecisionLog.push({
      id: `feedback:${feedback.timestamp.toISOString()}`,
      stage: 'feedback',
      intent: `rating:${feedback.rating}`,
      rationale: feedback.annotation ?? 'Feedback received',
      createdAt: feedback.timestamp.toISOString(),
    });
  }

  for (const steering of parseSteeringLog(content).slice(-4)) {
    runtimeDecisionLog.push({
      id: `steering:${steering.timestamp.toISOString()}`,
      stage: 'steering',
      intent: 'directive',
      rationale: steering.content,
      createdAt: steering.timestamp.toISOString(),
    });
  }
}

function sortAndSlice(
  runtimeToolLog: ConstructRuntimeToolEventView[],
  runtimeDecisionLog: ConstructRuntimeDecisionView[],
  now: string,
): ConstructToolAndDecisionLogs {
  runtimeToolLog.sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
  runtimeDecisionLog.sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );

  return {
    runtimeToolLog: runtimeToolLog.slice(0, 40),
    runtimeDecisionLog: runtimeDecisionLog.slice(0, 40),
    labToolLog: runtimeToolLog.slice(0, 20).map((item) => ({
      id: item.id,
      tool: item.tool,
      command: item.command,
      output: item.output,
      createdAt: item.createdAt || now,
    })),
    labDecisionLog: runtimeDecisionLog.slice(0, 20).map((item) => ({
      id: item.id,
      stage: item.stage,
      summary: item.rationale,
      createdAt: item.createdAt || now,
    })),
  };
}
