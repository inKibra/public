import type { Perception } from '../construct/types';
import {
  CONSTRUCT_SYSTEM_EVENT_NAME,
  CORE_IMPULSE_PROFILE_NAME,
  type SystemEventNameFromProfile,
  systemEventImpulseProfile,
} from '../impulse/keys';

export type ConstructOp<
  TImpulseProfileName extends string = string,
  TImpulsePoolName extends string = string,
  TSystemEventName extends
    string = SystemEventNameFromProfile<TImpulseProfileName>,
> =
  | (ConstructOpBase & {
      kind: 'user_message';
      payload: {
        content: string;
        timestamp?: string;
        metadata?: Record<string, unknown>;
        lane?: string;
      };
    })
  | (ConstructOpBase & {
      kind: 'impulse';
      payload: {
        profile: TImpulseProfileName;
        event?: TSystemEventName;
        pool?: TImpulsePoolName;
        lane?: string;
        payload?: Record<string, unknown>;
        occurredAt?: string;
      };
    })
  | (ConstructOpBase & {
      kind: 'system_event';
      payload: {
        event: TSystemEventName;
        payload?: Record<string, unknown>;
        occurredAt?: string;
        profile?: TImpulseProfileName;
        pool?: TImpulsePoolName;
        lane?: string;
      };
    })
  | (ConstructOpBase & {
      kind: 'self_reminder';
      payload: {
        memo: string;
        scheduledAt?: string;
        context?: Record<string, unknown>;
        lane?: string;
      };
    })
  | (ConstructOpBase & {
      kind: 'time_passed';
      payload: {
        elapsed: string;
        now?: string;
        lane?: string;
      };
    })
  | (ConstructOpBase & {
      kind: 'mailbox_idle';
      payload: {
        markerCursor: string;
        quietPeriodMs: number;
      };
    })
  | (ConstructOpBase & {
      kind: 'drain_only';
      payload?: Record<string, never>;
    })
  | (ConstructOpBase & {
      kind: 'next_nap_pin';
      payload: {
        path: string;
      };
    })
  | (ConstructOpBase & {
      kind: 'next_nap_imprint';
      payload: {
        text: string;
      };
    })
  | (ConstructOpBase & {
      kind: 'run_nap';
      payload?: Record<string, never>;
    })
  | (ConstructOpBase & {
      kind: 'start_hypno';
      payload?: Record<string, never>;
    })
  | (ConstructOpBase & {
      kind: 'chat_hypno_review';
      payload: {
        text: string;
      };
    })
  | (ConstructOpBase & {
      kind: 'accept_hypno';
      payload?: Record<string, never>;
    })
  | (ConstructOpBase & {
      kind: 'update_hypno';
      payload?: Record<string, never>;
    })
  | (ConstructOpBase & {
      kind: 'cancel_hypno';
      payload?: Record<string, never>;
    })
  | (ConstructOpBase & {
      kind: 'rate_response';
      payload: {
        rating: 'good' | 'bad' | 'neutral';
        annotation?: string;
        source?: string;
        lane: string;
      };
    })
  | (ConstructOpBase & {
      kind: 'steer_directive';
      payload: {
        directive: string;
        source?: string;
        lane: string;
      };
    })
  | (ConstructOpBase & {
      kind: 'shutdown';
      payload?: Record<string, never>;
    })
  | (ConstructOpBase & {
      kind: 'response_delivered';
      payload: {
        responseId: string;
        deliveredAt?: string;
      };
    });

type ConstructOpBase = {
  opId: string;
  createdAt: string;
  traceId?: string;
  sourceFactId?: string;
  sourceFactReflected?: boolean;
};

export type ConstructOpAction =
  | {
      type: 'perception';
      perception: Perception;
    }
  | {
      type: 'control';
      action: 'drain_only' | 'shutdown';
    }
  | {
      type: 'runtime';
      action: 'next_nap_pin' | 'next_nap_imprint' | 'response_delivered';
      payload: Record<string, unknown>;
    }
  | {
      type: 'command';
      action:
        | 'run_nap'
        | 'start_hypno'
        | 'chat_hypno_review'
        | 'accept_hypno'
        | 'update_hypno'
        | 'cancel_hypno'
        | 'rate_response'
        | 'steer_directive';
      payload: Record<string, unknown>;
    };

export function mapConstructOpToAction<
  TImpulseProfileName extends string,
  TImpulsePoolName extends string,
  TSystemEventName extends string,
>(
  op: ConstructOp<TImpulseProfileName, TImpulsePoolName, TSystemEventName>,
): ConstructOpAction {
  const createdAt = parseDate(op.createdAt);
  const sourceFactId = op.sourceFactId ?? op.opId;
  const sourceFactMetadata = op.sourceFactReflected
    ? { source_fact_reflected: true }
    : {};

  switch (op.kind) {
    case 'user_message': {
      return {
        type: 'perception',
        perception: {
          lane: op.payload.lane ?? 'conversation',
          role: 'user',
          source: 'user_message',
          content: op.payload.content,
          occurredAt: parseDate(op.payload.timestamp ?? op.createdAt),
          receivedAt: createdAt,
          metadata: {
            ...(op.payload.metadata ?? {}),
            op_id: sourceFactId,
            trace_id: op.traceId,
            ...sourceFactMetadata,
          },
        },
      };
    }

    case 'impulse': {
      return {
        type: 'perception',
        perception: {
          lane: resolveLegacyPerceptionLane(op),
          role: 'system',
          source: 'system_event',
          event: op.payload.event,
          content: op.payload.event ?? op.payload.profile,
          occurredAt: parseDate(op.payload.occurredAt ?? op.createdAt),
          metadata: {
            ...(op.payload.payload ?? {}),
            op_id: sourceFactId,
            trace_id: op.traceId,
            ...sourceFactMetadata,
          },
          profile: op.payload.profile,
          pool: op.payload.pool,
        },
      };
    }

    case 'system_event': {
      return {
        type: 'perception',
        perception: {
          lane: resolveLegacyPerceptionLane(op),
          role: 'system',
          source: 'system_event',
          event: op.payload.event,
          content: op.payload.event,
          occurredAt: parseDate(op.payload.occurredAt ?? op.createdAt),
          metadata: {
            ...(op.payload.payload ?? {}),
            op_id: sourceFactId,
            trace_id: op.traceId,
            ...sourceFactMetadata,
          },
          profile: op.payload.profile,
          pool: op.payload.pool,
        },
      };
    }

    case 'self_reminder': {
      return {
        type: 'perception',
        perception: {
          lane: op.payload.lane ?? 'heartbeat',
          role: 'system',
          source: 'self_reminder',
          content: op.payload.memo,
          occurredAt: parseDate(op.payload.scheduledAt ?? op.createdAt),
          createdAt,
          metadata: {
            ...(op.payload.context ?? {}),
            op_id: sourceFactId,
            trace_id: op.traceId,
            ...sourceFactMetadata,
          },
        },
      };
    }

    case 'time_passed': {
      return {
        type: 'perception',
        perception: {
          lane: op.payload.lane ?? 'heartbeat',
          role: 'system',
          source: 'time_passed',
          content: `${op.payload.elapsed} passed`,
          occurredAt: parseDate(op.payload.now ?? op.createdAt),
          elapsed: op.payload.elapsed,
          metadata: {
            op_id: sourceFactId,
            trace_id: op.traceId,
            ...sourceFactMetadata,
          },
        },
      };
    }

    case 'mailbox_idle': {
      return {
        type: 'perception',
        perception: {
          lane: 'conversation',
          role: 'system',
          source: 'system_event',
          event: CONSTRUCT_SYSTEM_EVENT_NAME.MAILBOX_IDLE,
          content: CONSTRUCT_SYSTEM_EVENT_NAME.MAILBOX_IDLE,
          occurredAt: createdAt,
          metadata: {
            marker_cursor: op.payload.markerCursor,
            quiet_period_ms: op.payload.quietPeriodMs,
            op_id: sourceFactId,
            trace_id: op.traceId,
            ...sourceFactMetadata,
          },
        },
      };
    }

    case 'drain_only':
      return {
        type: 'control',
        action: 'drain_only',
      };

    case 'next_nap_pin':
      return {
        type: 'runtime',
        action: 'next_nap_pin',
        payload: {
          path: op.payload.path,
          op_id: op.opId,
          trace_id: op.traceId,
        },
      };

    case 'next_nap_imprint':
      return {
        type: 'runtime',
        action: 'next_nap_imprint',
        payload: {
          text: op.payload.text,
          op_id: op.opId,
          trace_id: op.traceId,
        },
      };

    case 'response_delivered':
      return {
        type: 'runtime',
        action: 'response_delivered',
        payload: {
          responseId: op.payload.responseId,
          deliveredAt: op.payload.deliveredAt,
          op_id: op.opId,
          trace_id: op.traceId,
        },
      };

    case 'run_nap':
      return {
        type: 'command',
        action: 'run_nap',
        payload: {},
      };

    case 'start_hypno':
      return {
        type: 'command',
        action: 'start_hypno',
        payload: {},
      };

    case 'chat_hypno_review':
      return {
        type: 'command',
        action: 'chat_hypno_review',
        payload: {
          text: op.payload.text,
          op_id: op.opId,
          trace_id: op.traceId,
        },
      };

    case 'accept_hypno':
      return {
        type: 'command',
        action: 'accept_hypno',
        payload: {},
      };

    case 'update_hypno':
      return {
        type: 'command',
        action: 'update_hypno',
        payload: {},
      };

    case 'cancel_hypno':
      return {
        type: 'command',
        action: 'cancel_hypno',
        payload: {},
      };

    case 'rate_response':
      return {
        type: 'command',
        action: 'rate_response',
        payload: {
          rating: op.payload.rating,
          annotation: op.payload.annotation,
          source: op.payload.source,
          lane: op.payload.lane,
          op_id: sourceFactId,
          trace_id: op.traceId,
          ...sourceFactMetadata,
        },
      };

    case 'steer_directive':
      return {
        type: 'command',
        action: 'steer_directive',
        payload: {
          directive: op.payload.directive,
          source: op.payload.source,
          lane: op.payload.lane,
          op_id: sourceFactId,
          trace_id: op.traceId,
          ...sourceFactMetadata,
        },
      };

    case 'shutdown':
      return {
        type: 'control',
        action: 'shutdown',
      };

    default: {
      const neverKind: never = op;
      throw new Error(`Unknown construct op kind: ${String(neverKind)}`);
    }
  }
}

function resolveLegacyPerceptionLane(op: ConstructOp): string {
  switch (op.kind) {
    case 'user_message':
      return op.payload.lane ?? 'conversation';
    case 'self_reminder':
    case 'time_passed':
      return op.payload.lane ?? 'heartbeat';
    case 'mailbox_idle':
      return 'conversation';
    case 'impulse':
      return (
        op.payload.lane ??
        inferLegacyLaneFromProfile(op.payload.profile) ??
        inferLegacyLaneFromEvent(op.payload.event) ??
        'heartbeat'
      );
    case 'system_event':
      return (
        op.payload.lane ??
        inferLegacyLaneFromProfile(op.payload.profile) ??
        inferLegacyLaneFromEvent(op.payload.event) ??
        'heartbeat'
      );
    default:
      return 'conversation';
  }
}

function inferLegacyLaneFromProfile(
  profile: string | undefined,
): string | undefined {
  if (!profile) return undefined;
  switch (profile) {
    case CORE_IMPULSE_PROFILE_NAME.CONVERSATION_USER_MESSAGE:
      return 'conversation';
    case CORE_IMPULSE_PROFILE_NAME.SYSTEM_TIME_PASSED:
    case CORE_IMPULSE_PROFILE_NAME.SYSTEM_SELF_REMINDER:
    case CORE_IMPULSE_PROFILE_NAME.BACKGROUND_DEFAULT:
    case systemEventImpulseProfile(CONSTRUCT_SYSTEM_EVENT_NAME.HEARTBEAT):
      return 'heartbeat';
    case systemEventImpulseProfile(CONSTRUCT_SYSTEM_EVENT_NAME.MAILBOX_IDLE):
    case systemEventImpulseProfile(
      CONSTRUCT_SYSTEM_EVENT_NAME.CONTEXT_PRESSURE_AUTOCLOSE,
    ):
    case systemEventImpulseProfile(
      CONSTRUCT_SYSTEM_EVENT_NAME.STEERING_DIRECTIVE,
    ):
      return 'conversation';
    default:
      return undefined;
  }
}

function inferLegacyLaneFromEvent(
  event: string | undefined,
): string | undefined {
  if (!event) return undefined;
  switch (event) {
    case CONSTRUCT_SYSTEM_EVENT_NAME.HEARTBEAT:
      return 'heartbeat';
    case CONSTRUCT_SYSTEM_EVENT_NAME.MAILBOX_IDLE:
    case CONSTRUCT_SYSTEM_EVENT_NAME.CONTEXT_PRESSURE_AUTOCLOSE:
    case CONSTRUCT_SYSTEM_EVENT_NAME.STEERING_DIRECTIVE:
      return 'conversation';
    default:
      return undefined;
  }
}

function parseDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }
  return parsed;
}

export function createResponseDeliveredOpId(input: {
  constructId: string;
  responseId: string;
}): string {
  return `response-delivered:${input.constructId}:${encodeURIComponent(input.responseId)}`;
}

export function buildResponseDeliveredOp(input: {
  constructId: string;
  responseId: string;
  deliveredAt?: string;
  createdAt?: string;
  traceId?: string;
}): Extract<ConstructOp, { kind: 'response_delivered' }> {
  const createdAt =
    input.createdAt ?? input.deliveredAt ?? new Date().toISOString();

  return {
    opId: createResponseDeliveredOpId({
      constructId: input.constructId,
      responseId: input.responseId,
    }),
    kind: 'response_delivered',
    payload: {
      responseId: input.responseId,
      deliveredAt: input.deliveredAt,
    },
    createdAt,
    traceId: input.traceId,
  };
}

export function createHeartbeatSystemEventOpId(input: {
  constructId: string;
  dueAt: string;
}): string {
  return `heartbeat:${input.constructId}:${encodeURIComponent(input.dueAt)}`;
}

export function buildHeartbeatSystemEventOp(input: {
  constructId: string;
  dueAt: string;
  createdAt?: string;
  traceId?: string;
  payload?: Record<string, unknown>;
}): Extract<ConstructOp, { kind: 'system_event' }> {
  const createdAt = input.createdAt ?? input.dueAt;

  return {
    opId: createHeartbeatSystemEventOpId({
      constructId: input.constructId,
      dueAt: input.dueAt,
    }),
    kind: 'system_event',
    payload: {
      event: CONSTRUCT_SYSTEM_EVENT_NAME.HEARTBEAT,
      payload: input.payload,
      occurredAt: input.dueAt,
    },
    createdAt,
    traceId: input.traceId,
  };
}

export function createSelfReminderOpId(input: {
  reminderId: string;
  dueAt: string;
}): string {
  return `self-reminder:${encodeURIComponent(input.reminderId)}:${encodeURIComponent(input.dueAt)}`;
}

export function buildSelfReminderOp(input: {
  reminderId: string;
  message: string;
  dueAt: string;
  createdAt?: string;
  traceId?: string;
  context?: Record<string, unknown>;
}): Extract<ConstructOp, { kind: 'self_reminder' }> {
  const createdAt = input.createdAt ?? input.dueAt;

  return {
    opId: createSelfReminderOpId({
      reminderId: input.reminderId,
      dueAt: input.dueAt,
    }),
    kind: 'self_reminder',
    payload: {
      memo: input.message,
      scheduledAt: input.dueAt,
      context: {
        reminder_id: input.reminderId,
        ...(input.context ?? {}),
      },
    },
    createdAt,
    traceId: input.traceId,
  };
}

export function buildUserMessageOp(input: {
  constructId: string;
  content: string;
  lane?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  opId?: string;
  traceId?: string;
}): Extract<ConstructOp, { kind: 'user_message' }> {
  const createdAt =
    input.createdAt ?? input.timestamp ?? new Date().toISOString();

  return {
    opId:
      input.opId ?? `user-message:${input.constructId}:${crypto.randomUUID()}`,
    kind: 'user_message',
    payload: {
      content: input.content,
      lane: input.lane,
      timestamp: input.timestamp,
      metadata: input.metadata,
    },
    createdAt,
    traceId: input.traceId,
  };
}

export function buildSystemEventOp<
  TImpulseProfileName extends string = string,
  TImpulsePoolName extends string = string,
  TSystemEventName extends string = string,
>(input: {
  constructId: string;
  event: TSystemEventName;
  payload?: Record<string, unknown>;
  occurredAt?: string;
  profile?: TImpulseProfileName;
  pool?: TImpulsePoolName;
  lane?: string;
  createdAt?: string;
  opId?: string;
  traceId?: string;
}): Extract<
  ConstructOp<TImpulseProfileName, TImpulsePoolName, TSystemEventName>,
  { kind: 'system_event' }
> {
  const occurredAt =
    input.occurredAt ?? input.createdAt ?? new Date().toISOString();
  const createdAt = input.createdAt ?? occurredAt;

  return {
    opId:
      input.opId ??
      `system-event:${input.constructId}:${input.event}:${crypto.randomUUID()}`,
    kind: 'system_event',
    payload: {
      event: input.event,
      payload: input.payload,
      occurredAt,
      profile: input.profile,
      pool: input.pool,
      lane: input.lane,
    },
    createdAt,
    traceId: input.traceId,
  };
}

export function buildImpulseOp<
  TImpulseProfileName extends string = string,
  TImpulsePoolName extends string = string,
  TSystemEventName extends string = string,
>(input: {
  constructId: string;
  profile: TImpulseProfileName;
  event?: TSystemEventName;
  pool?: TImpulsePoolName;
  lane?: string;
  payload?: Record<string, unknown>;
  occurredAt?: string;
  createdAt?: string;
  opId?: string;
  traceId?: string;
}): Extract<
  ConstructOp<TImpulseProfileName, TImpulsePoolName, TSystemEventName>,
  { kind: 'impulse' }
> {
  const occurredAt =
    input.occurredAt ?? input.createdAt ?? new Date().toISOString();
  const createdAt = input.createdAt ?? occurredAt;

  return {
    opId:
      input.opId ??
      `impulse:${input.constructId}:${input.profile}:${crypto.randomUUID()}`,
    kind: 'impulse',
    payload: {
      profile: input.profile,
      event: input.event,
      pool: input.pool,
      lane: input.lane,
      payload: input.payload,
      occurredAt,
    },
    createdAt,
    traceId: input.traceId,
  };
}
