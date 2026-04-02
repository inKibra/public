import type { ConstructEvent } from '../construct/types';
import type { ConstructInFlightItem } from './in-flight';
import type { ConstructLiveResponseHistory } from './selectors';
import type { ConstructSnapshotTranscriptMessage } from './snapshot-types';
import type { ConstructViewStreamEventMap } from './view-event-adapter';
import type { ConstructViewProjection } from './view-machine';

export type ConstructLatencyPhase =
  | 'client:chat-submit'
  | 'client:chat-accepted'
  | 'event:impulse-started'
  | 'event:response-scheduled'
  | 'event:response-selected'
  | 'event:response-executing'
  | 'event:response-delivered'
  | 'event:response-batch-started'
  | 'event:response-batch-completed'
  | 'event:frontier-advanced'
  | 'event:frontier-advanced-pre-response'
  | 'event:frontier-advanced-post-response'
  // Stream delivery timing — measures the publish-to-client blind spot
  | 'stream:first-delta' // first responseDelta token arrives at client reducer
  | 'stream:deliver-lag' // response:delivered event received at client (vs server ts)
  | 'render:user-message'
  | 'render:user-delivery-sending'
  | 'render:user-delivery-sent'
  | 'render:user-delivery-seen'
  | 'render:user-delivery-durable'
  | 'render:in-flight-visible'
  | 'render:in-flight-stage-sent'
  | 'render:in-flight-stage-seen'
  | 'render:in-flight-stage-impulse-running'
  | 'render:in-flight-stage-scheduler-running'
  | 'render:in-flight-stage-scheduled'
  | 'render:in-flight-stage-responding'
  | 'render:in-flight-stage-durable'
  | 'render:response-status-scheduled'
  | 'render:response-status-running'
  | 'render:response-status-executing'
  | 'render:response-status-delivered'
  | 'render:assistant-message'
  | 'render:in-flight-cleared'
  | 'render:in-flight-cleared-pre-response'
  | 'render:in-flight-cleared-post-response'
  | `event:source-fact-${string}`
  | `render:response-status-${string}`
  | `render:in-flight-stage-${string}`;

export type ConstructLatencyPoint = {
  phase: ConstructLatencyPhase;
  clientAtMs: number;
  clientAtIso: string;
  perfNowMs?: number;
  serverTs?: string;
  detail?: Record<string, unknown>;
};

export type ConstructLatencyTrace = {
  traceId: string;
  message: string;
  constructId?: string;
  pendingIds: string[];
  factIds: string[];
  impulseIds: string[];
  responseIds: string[];
  createdAtMs: number;
  createdAtIso: string;
  points: ConstructLatencyPoint[];
  pointPhases: Record<string, number>;
};

export type ConstructLatencyStore = {
  order: string[];
  tracesById: Record<string, ConstructLatencyTrace>;
  messageToTraceIds: Record<string, string[]>;
  pendingIdToTraceId: Record<string, string>;
  factIdToTraceId: Record<string, string>;
  impulseIdToTraceId: Record<string, string>;
  responseIdToTraceId: Record<string, string>;
};

const GLOBAL_KEY = '__inkibraConstructLatency';
const MAX_TRACE_COUNT = 40;

function createStore(): ConstructLatencyStore {
  return {
    order: [],
    tracesById: {},
    messageToTraceIds: {},
    pendingIdToTraceId: {},
    factIdToTraceId: {},
    impulseIdToTraceId: {},
    responseIdToTraceId: {},
  };
}

function getGlobalScope(): Record<string, unknown> {
  return globalThis as Record<string, unknown>;
}

function getStore(): ConstructLatencyStore {
  const scope = getGlobalScope();
  const existing = scope[GLOBAL_KEY];
  if (existing && typeof existing === 'object') {
    return existing as ConstructLatencyStore;
  }
  const next = createStore();
  scope[GLOBAL_KEY] = next;
  return next;
}

function nowPoint(): Pick<
  ConstructLatencyPoint,
  'clientAtMs' | 'clientAtIso' | 'perfNowMs'
> {
  return {
    clientAtMs: Date.now(),
    clientAtIso: new Date().toISOString(),
    perfNowMs:
      typeof performance !== 'undefined' &&
      typeof performance.now === 'function'
        ? performance.now()
        : undefined,
  };
}

function pushUnique(values: string[], value: string | undefined): string[] {
  if (!value || values.includes(value)) {
    return values;
  }
  values.push(value);
  return values;
}

function bindMessage(
  store: ConstructLatencyStore,
  message: string,
  traceId: string,
) {
  const existing = store.messageToTraceIds[message] ?? [];
  if (!existing.includes(traceId)) {
    store.messageToTraceIds[message] = [...existing, traceId].slice(-8);
  }
}

function resolveTraceId(
  store: ConstructLatencyStore,
  args: {
    traceId?: string;
    pendingId?: string;
    factId?: string;
    impulseId?: string;
    responseId?: string;
    message?: string;
  },
): string | undefined {
  if (args.traceId && store.tracesById[args.traceId]) return args.traceId;
  if (args.pendingId && store.pendingIdToTraceId[args.pendingId]) {
    return store.pendingIdToTraceId[args.pendingId];
  }
  if (args.factId && store.factIdToTraceId[args.factId]) {
    return store.factIdToTraceId[args.factId];
  }
  if (args.impulseId && store.impulseIdToTraceId[args.impulseId]) {
    return store.impulseIdToTraceId[args.impulseId];
  }
  if (args.responseId && store.responseIdToTraceId[args.responseId]) {
    return store.responseIdToTraceId[args.responseId];
  }
  if (args.message) {
    const matches = store.messageToTraceIds[args.message] ?? [];
    return matches[matches.length - 1];
  }
  return undefined;
}

function ensureTrace(
  store: ConstructLatencyStore,
  args: {
    traceId: string;
    message: string;
    constructId?: string;
  },
): ConstructLatencyTrace {
  const existing = store.tracesById[args.traceId];
  if (existing) {
    return existing;
  }

  const now = nowPoint();
  const trace: ConstructLatencyTrace = {
    traceId: args.traceId,
    message: args.message,
    constructId: args.constructId,
    pendingIds: [],
    factIds: [],
    impulseIds: [],
    responseIds: [],
    createdAtMs: now.clientAtMs,
    createdAtIso: now.clientAtIso,
    points: [],
    pointPhases: {},
  };
  store.tracesById[args.traceId] = trace;
  store.order.push(args.traceId);
  bindMessage(store, args.message, args.traceId);

  while (store.order.length > MAX_TRACE_COUNT) {
    const removedId = store.order.shift();
    if (!removedId) {
      break;
    }
    delete store.tracesById[removedId];
  }

  return trace;
}

function bindTraceAliases(
  trace: ConstructLatencyTrace,
  store: ConstructLatencyStore,
  args: {
    pendingId?: string;
    factId?: string;
    impulseId?: string;
    responseId?: string;
    message?: string;
  },
) {
  if (args.pendingId) {
    pushUnique(trace.pendingIds, args.pendingId);
    store.pendingIdToTraceId[args.pendingId] = trace.traceId;
  }
  if (args.factId) {
    pushUnique(trace.factIds, args.factId);
    store.factIdToTraceId[args.factId] = trace.traceId;
  }
  if (args.impulseId) {
    pushUnique(trace.impulseIds, args.impulseId);
    store.impulseIdToTraceId[args.impulseId] = trace.traceId;
  }
  if (args.responseId) {
    pushUnique(trace.responseIds, args.responseId);
    store.responseIdToTraceId[args.responseId] = trace.traceId;
  }
  if (args.message) {
    bindMessage(store, args.message, trace.traceId);
  }
}

function recordPoint(
  trace: ConstructLatencyTrace,
  point: Omit<
    ConstructLatencyPoint,
    'clientAtMs' | 'clientAtIso' | 'perfNowMs'
  >,
) {
  if (trace.pointPhases[point.phase] != null) {
    return;
  }
  const now = nowPoint();
  trace.pointPhases[point.phase] = now.clientAtMs;
  trace.points.push({
    phase: point.phase,
    clientAtMs: now.clientAtMs,
    clientAtIso: now.clientAtIso,
    perfNowMs: now.perfNowMs,
    serverTs: point.serverTs,
    detail: point.detail,
  });
}

function findUserTranscriptEntry(
  transcript: ConstructSnapshotTranscriptMessage[],
  trace: ConstructLatencyTrace,
): ConstructSnapshotTranscriptMessage | undefined {
  return transcript.find(
    (entry) =>
      entry.role === 'user' &&
      ((entry.factId ? trace.factIds.includes(entry.factId) : false) ||
        entry.content === trace.message),
  );
}

function findInFlightItem(
  items: ConstructInFlightItem[],
  trace: ConstructLatencyTrace,
): ConstructInFlightItem | undefined {
  return items.find(
    (item) =>
      (item.factId ? trace.factIds.includes(item.factId) : false) ||
      item.message === trace.message ||
      item.responseIds.some((responseId) =>
        trace.responseIds.includes(responseId),
      ),
  );
}

function findResponseHistory(
  histories: ConstructLiveResponseHistory[],
  trace: ConstructLatencyTrace,
): ConstructLiveResponseHistory | undefined {
  return histories.find((history) =>
    trace.responseIds.includes(history.responseId),
  );
}

function findAssistantTranscriptEntry(
  transcript: ConstructSnapshotTranscriptMessage[],
  trace: ConstructLatencyTrace,
): ConstructSnapshotTranscriptMessage | undefined {
  return transcript.find(
    (entry) =>
      entry.role === 'assistant' &&
      trace.responseIds.some((responseId) =>
        entry.id.startsWith(`${responseId}:delivered:`),
      ),
  );
}

export function resetConstructLatencyStore() {
  getGlobalScope()[GLOBAL_KEY] = createStore();
}

export function getConstructLatencyStoreSnapshot(): ConstructLatencyStore {
  return structuredClone(getStore());
}

export function noteConstructLatencyChatSubmit(args: {
  constructId?: string;
  pendingId: string;
  message: string;
}): string {
  const store = getStore();
  const trace = ensureTrace(store, {
    traceId: args.pendingId,
    message: args.message,
    constructId: args.constructId,
  });
  bindTraceAliases(trace, store, {
    pendingId: args.pendingId,
    message: args.message,
  });
  recordPoint(trace, {
    phase: 'client:chat-submit',
    detail: {
      pendingId: args.pendingId,
    },
  });
  return trace.traceId;
}

export function noteConstructLatencyChatAccepted(args: {
  pendingId: string;
  message?: string;
  factId?: string;
  opId?: string;
  queuedAt?: string;
}) {
  const store = getStore();
  const traceId = resolveTraceId(store, {
    pendingId: args.pendingId,
    factId: args.factId,
    message: args.message,
  });
  if (!traceId) {
    return;
  }
  const trace = store.tracesById[traceId];
  if (!trace) {
    return;
  }
  bindTraceAliases(trace, store, {
    pendingId: args.pendingId,
    factId: args.factId,
    message: args.message,
  });
  recordPoint(trace, {
    phase: 'client:chat-accepted',
    detail: {
      opId: args.opId,
      queuedAt: args.queuedAt,
    },
  });
}

export function noteConstructLatencyStreamEvent(args: {
  type: keyof ConstructViewStreamEventMap;
  event: ConstructViewStreamEventMap[keyof ConstructViewStreamEventMap];
}) {
  if (!args.event) return;
  const store = getStore();

  if (args.type === 'sourceFactLifecycle') {
    const event =
      args.event as ConstructViewStreamEventMap['sourceFactLifecycle'];
    const traceId =
      resolveTraceId(store, {
        factId: event.factId,
        message: event.previewText,
        impulseId: event.impulseId,
        responseId: event.responseId,
      }) ??
      (event.previewText
        ? ensureTrace(store, {
            traceId: `incoming:${event.factId}`,
            message: event.previewText,
            constructId: event.constructId,
          }).traceId
        : undefined);
    if (!traceId) {
      return;
    }
    const trace = store.tracesById[traceId];
    if (!trace) {
      return;
    }
    bindTraceAliases(trace, store, {
      factId: event.factId,
      impulseId: event.impulseId,
      responseId: event.responseId,
      message: event.previewText,
    });
    recordPoint(trace, {
      phase: `event:source-fact-${event.phase}`,
      serverTs: event.ts,
      detail: {
        factId: event.factId,
        factType: event.factType,
        queueRef: event.queueRef,
      },
    });
    return;
  }

  if (args.type === 'constructEvent') {
    const event = args.event as ConstructViewStreamEventMap['constructEvent'];
    const constructEvent = event.event as ConstructEvent;

    if (constructEvent.type === 'impulse:started') {
      const messages =
        constructEvent.perception.role === 'user'
          ? [constructEvent.perception.content]
          : [];
      const trace = messages
        .map(
          (message) =>
            resolveTraceId(store, {
              impulseId: constructEvent.impulseId,
              message,
            }) ??
            ensureTrace(store, {
              traceId: `incoming:impulse:${constructEvent.impulseId}`,
              message,
              constructId: event.constructId,
            }).traceId,
        )
        .map((traceId) => (traceId ? store.tracesById[traceId] : undefined))
        .find(Boolean);
      if (!trace) {
        return;
      }
      bindTraceAliases(trace, store, {
        impulseId: constructEvent.impulseId,
      });
      recordPoint(trace, {
        phase: 'event:impulse-started',
        serverTs: event.ts,
        detail: {
          impulseId: constructEvent.impulseId,
        },
      });
      return;
    }

    const responseIds = (() => {
      switch (constructEvent.type) {
        case 'response:scheduled':
        case 'response:selected':
        case 'response:executing':
        case 'response:delivered':
        case 'response:dropped':
        case 'response:cleared':
          return [constructEvent.responseId];
        case 'response:batch_started':
        case 'response:batch_completed':
          return constructEvent.respondTo;
        default:
          return [];
      }
    })();

    for (const responseId of responseIds) {
      const traceId = resolveTraceId(store, {
        responseId,
        impulseId:
          constructEvent.type === 'response:scheduled'
            ? constructEvent.scheduledBy
            : undefined,
      });
      if (!traceId) {
        continue;
      }
      const trace = store.tracesById[traceId];
      if (!trace) {
        continue;
      }
      bindTraceAliases(trace, store, {
        responseId,
        impulseId:
          constructEvent.type === 'response:scheduled'
            ? constructEvent.scheduledBy
            : undefined,
      });
      const phase = (() => {
        switch (constructEvent.type) {
          case 'response:scheduled':
            return 'event:response-scheduled';
          case 'response:selected':
            return 'event:response-selected';
          case 'response:executing':
            return 'event:response-executing';
          case 'response:delivered':
            return 'event:response-delivered';
          case 'response:batch_started':
            return 'event:response-batch-started';
          case 'response:batch_completed':
            return 'event:response-batch-completed';
          default:
            return undefined;
        }
      })();
      if (!phase) {
        continue;
      }
      recordPoint(trace, {
        phase,
        serverTs: event.ts,
        detail: {
          responseId,
        },
      });

      // Capture server-to-client delivery lag for response:delivered
      if (constructEvent.type === 'response:delivered') {
        const now = nowPoint();
        const serverMs = Date.parse(event.ts);
        const lagMs = Number.isFinite(serverMs)
          ? now.clientAtMs - serverMs
          : undefined;
        recordPoint(trace, {
          phase: 'stream:deliver-lag',
          serverTs: event.ts,
          detail: { responseId, lagMs },
        });
      }
    }
    return;
  }

  if (args.type === 'frontierAdvanced') {
    const event = args.event as ConstructViewStreamEventMap['frontierAdvanced'];
    for (const trace of Object.values(store.tracesById)) {
      if (trace.factIds.length === 0) {
        continue;
      }
      recordPoint(trace, {
        phase: 'event:frontier-advanced',
        serverTs: event.ts,
        detail: {
          processedCursor: event.processedCursor,
          committedCursor: event.committedCursor,
        },
      });
      recordPoint(trace, {
        phase:
          trace.pointPhases['event:response-delivered'] != null
            ? 'event:frontier-advanced-post-response'
            : 'event:frontier-advanced-pre-response',
        serverTs: event.ts,
        detail: {
          processedCursor: event.processedCursor,
          committedCursor: event.committedCursor,
        },
      });
    }
  }
}

/**
 * Record when the first responseDelta token for a response arrives at the client.
 * Call this in the `responseDelta` stream reducer on the very first delta.
 */
export function noteConstructLatencyFirstDelta(args: {
  responseId: string;
  serverTs: string;
}) {
  const store = getStore();
  const traceId = resolveTraceId(store, { responseId: args.responseId });
  if (!traceId) {
    return;
  }
  const trace = store.tracesById[traceId];
  if (!trace) {
    return;
  }
  const now = nowPoint();
  const serverMs = Date.parse(args.serverTs);
  const lagMs = Number.isFinite(serverMs)
    ? now.clientAtMs - serverMs
    : undefined;
  recordPoint(trace, {
    phase: 'stream:first-delta',
    serverTs: args.serverTs,
    detail: {
      responseId: args.responseId,
      lagMs,
    },
  });
}

/**
 * Record stream delivery lag for response:delivered.
 * lagMs = client receive time - server publish timestamp.
 */
export function noteConstructLatencyDeliverLag(args: {
  responseId: string;
  serverTs: string;
}) {
  const store = getStore();
  const traceId = resolveTraceId(store, { responseId: args.responseId });
  if (!traceId) {
    return;
  }
  const trace = store.tracesById[traceId];
  if (!trace) {
    return;
  }
  const now = nowPoint();
  const serverMs = Date.parse(args.serverTs);
  const lagMs = Number.isFinite(serverMs)
    ? now.clientAtMs - serverMs
    : undefined;
  recordPoint(trace, {
    phase: 'stream:deliver-lag',
    serverTs: args.serverTs,
    detail: {
      responseId: args.responseId,
      lagMs,
    },
  });
}

// ---------------------------------------------------------------------------
// Latency report — human-readable summary accessible from devtools
// ---------------------------------------------------------------------------

type LatencyReportRow = {
  phase: string;
  clientAtMs: number;
  sinceSubmitMs?: number;
  sincePrevMs?: number;
  lagMs?: number;
  serverTs?: string;
  detail?: Record<string, unknown>;
};

type LatencyReport = {
  traceId: string;
  message: string;
  constructId?: string;
  createdAtIso: string;
  rows: LatencyReportRow[];
  summary: {
    totalMs?: number;
    submitToDeliveredMs?: number;
    deliveredToFirstDeltaMs?: number;
    firstDeltaToAssistantMs?: number;
    submitToAssistantMs?: number;
  };
};

export function getConstructLatencyReport(
  traceId?: string,
): LatencyReport | LatencyReport[] | null {
  const store = getStore();

  function buildReport(trace: ConstructLatencyTrace): LatencyReport {
    const sorted = [...trace.points].sort(
      (a, b) => a.clientAtMs - b.clientAtMs,
    );
    const rows: LatencyReportRow[] = sorted.map((point, i) => {
      const lagMs = point.serverTs
        ? point.clientAtMs - Date.parse(point.serverTs)
        : (point.detail?.lagMs as number | undefined);
      return {
        phase: point.phase,
        clientAtMs: point.clientAtMs,
        sinceSubmitMs:
          trace.createdAtMs > 0
            ? point.clientAtMs - trace.createdAtMs
            : undefined,
        sincePrevMs:
          i > 0
            ? point.clientAtMs - (sorted[i - 1]?.clientAtMs ?? 0)
            : undefined,
        lagMs: Number.isFinite(lagMs) ? lagMs : undefined,
        serverTs: point.serverTs,
        detail: point.detail,
      };
    });

    const get = (phase: string) => trace.pointPhases[phase];
    const gap = (a: string, b: string) => {
      const ta = get(a);
      const tb = get(b);
      return ta != null && tb != null ? tb - ta : undefined;
    };

    return {
      traceId: trace.traceId,
      message: trace.message,
      constructId: trace.constructId,
      createdAtIso: trace.createdAtIso,
      rows,
      summary: {
        totalMs:
          rows.length > 0
            ? (rows[rows.length - 1]?.clientAtMs ?? 0) - trace.createdAtMs
            : undefined,
        submitToDeliveredMs: gap(
          'client:chat-submit',
          'event:response-delivered',
        ),
        deliveredToFirstDeltaMs: gap(
          'event:response-delivered',
          'stream:first-delta',
        ),
        firstDeltaToAssistantMs: gap(
          'stream:first-delta',
          'render:assistant-message',
        ),
        submitToAssistantMs: gap(
          'client:chat-submit',
          'render:assistant-message',
        ),
      },
    };
  }

  if (traceId) {
    const trace = store.tracesById[traceId];
    return trace ? buildReport(trace) : null;
  }

  const all = store.order
    .map((id) => store.tracesById[id])
    .filter((t): t is ConstructLatencyTrace => t != null);
  if (all.length === 0) {
    return null;
  }
  const reports = all.map(buildReport);
  return reports.length === 1 ? (reports[0] ?? null) : reports;
}

/**
 * Print a human-readable latency report to the console.
 * Call from browser devtools: `__constructLatency()` or `__constructLatency('traceId')`.
 */
export function printConstructLatencyReport(traceId?: string): void {
  const report = getConstructLatencyReport(traceId);
  if (!report) {
    console.log('[construct:latency] No traces found.');
    return;
  }
  const reports = Array.isArray(report) ? report : [report];
  for (const r of reports) {
    console.group(
      `[construct:latency] "${r.message.slice(0, 60)}" — ${r.traceId}`,
    );
    console.log('Summary:', r.summary);
    console.table(
      r.rows.map((row) => ({
        phase: row.phase,
        sinceSubmit: row.sinceSubmitMs != null ? `${row.sinceSubmitMs}ms` : '—',
        gap: row.sincePrevMs != null ? `+${row.sincePrevMs}ms` : '—',
        serverLag: row.lagMs != null ? `${row.lagMs}ms lag` : '—',
      })),
    );
    console.groupEnd();
  }
}

/**
 * Install devtools helpers on globalThis so they're callable from the browser console.
 *
 *   __constructLatency()          → prints all recent traces
 *   __constructLatency('id')      → prints a specific trace
 *   __constructLatencyStore()     → raw store data
 */
export function installConstructLatencyDevtools(): void {
  if (typeof globalThis === 'undefined') return;
  const g = globalThis as Record<string, unknown>;
  g['__constructLatency'] = (traceId?: string) =>
    printConstructLatencyReport(traceId);
  g['__constructLatencyStore'] = () => getConstructLatencyStoreSnapshot();
  g['__constructLatencyReset'] = () => resetConstructLatencyStore();
}

export function noteConstructLatencyProjectionRender(
  projection: ConstructViewProjection,
) {
  const store = getStore();
  for (const trace of Object.values(store.tracesById)) {
    const userEntry = findUserTranscriptEntry(
      projection.constructSnapshot.transcript,
      trace,
    );
    if (userEntry) {
      recordPoint(trace, {
        phase: 'render:user-message',
        detail: {
          factId: userEntry.factId,
          deliveryState: userEntry.deliveryState,
        },
      });
      if (userEntry.deliveryState) {
        recordPoint(trace, {
          phase: `render:user-delivery-${userEntry.deliveryState}`,
        });
      }
    }

    const inFlightItem = findInFlightItem(projection.inFlightItems, trace);
    if (inFlightItem) {
      recordPoint(trace, {
        phase: 'render:in-flight-visible',
        detail: {
          stage: inFlightItem.stage,
        },
      });
      recordPoint(trace, {
        phase: `render:in-flight-stage-${inFlightItem.stage}`,
      });
    } else if (
      trace.responseIds.length > 0 ||
      trace.pointPhases['event:response-delivered'] != null
    ) {
      recordPoint(trace, {
        phase: 'render:in-flight-cleared',
      });
      recordPoint(trace, {
        phase:
          trace.pointPhases['event:response-delivered'] != null
            ? 'render:in-flight-cleared-post-response'
            : 'render:in-flight-cleared-pre-response',
      });
    }

    const responseHistory = findResponseHistory(
      projection.liveResponseHistories,
      trace,
    );
    if (responseHistory) {
      recordPoint(trace, {
        phase: `render:response-status-${responseHistory.status}`,
        detail: {
          responseId: responseHistory.responseId,
        },
      });
    }

    const assistantEntry = findAssistantTranscriptEntry(
      projection.constructSnapshot.transcript,
      trace,
    );
    if (assistantEntry) {
      recordPoint(trace, {
        phase: 'render:assistant-message',
        detail: {
          transcriptId: assistantEntry.id,
        },
      });
    }
  }
}
