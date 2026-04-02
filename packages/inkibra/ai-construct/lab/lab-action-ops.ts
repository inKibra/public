/**
 * Generic construct lab action → op mapper.
 *
 * Converts a `ConstructLabAction` into a `ConstructOp` suitable for
 * submission to the construct runtime mailbox.
 */

import type { ConstructOp } from '../runtime/ops';
import type { ConstructLabAction } from './types';

// ---------------------------------------------------------------------------
// Context path normalization
// ---------------------------------------------------------------------------

/**
 * Ensures a context-file path is consistently prefixed with `/agent/home/`.
 */
export function normalizeContextPath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.startsWith('/agent/home/')) {
    return trimmed;
  }
  if (trimmed.startsWith('/')) {
    return `/agent/home${trimmed}`;
  }
  return `/agent/home/${trimmed}`;
}

// ---------------------------------------------------------------------------
// Action → Op
// ---------------------------------------------------------------------------

/**
 * Maps a `ConstructLabAction` into a `ConstructOp` for runtime submission.
 * The returned op has a unique `opId` and `createdAt` timestamp.
 */
export function buildConstructLabActionOp(
  constructId: string,
  action: ConstructLabAction,
): ConstructOp {
  const base = {
    opId: `partner-lab:${constructId}:${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
  };

  if (action.action === 'chat') {
    return {
      ...base,
      kind: 'user_message',
      payload: {
        content: action.message,
        lane: action.lane,
      },
    };
  }

  if (action.action === 'nap') {
    return {
      ...base,
      kind: 'run_nap',
      payload: {},
    };
  }

  if (action.action === 'startHypno') {
    return {
      ...base,
      kind: 'start_hypno',
      payload: {},
    };
  }

  if (action.action === 'chatHypnoReview') {
    return {
      ...base,
      kind: 'chat_hypno_review',
      payload: {
        text: action.text,
      },
    };
  }

  if (action.action === 'acceptHypno') {
    return {
      ...base,
      kind: 'accept_hypno',
      payload: {},
    };
  }

  if (action.action === 'updateHypno') {
    return {
      ...base,
      kind: 'update_hypno',
      payload: {},
    };
  }

  if (action.action === 'cancelHypno') {
    return {
      ...base,
      kind: 'cancel_hypno',
      payload: {},
    };
  }

  if (action.action === 'queueNextNapPin') {
    return {
      ...base,
      kind: 'next_nap_pin',
      payload: {
        path: normalizeContextPath(action.path),
      },
    };
  }

  if (action.action === 'queueNextNapImprint') {
    return {
      ...base,
      kind: 'next_nap_imprint',
      payload: {
        text: action.text,
      },
    };
  }

  if (action.action === 'rate') {
    return {
      ...base,
      kind: 'rate_response',
      payload: {
        rating: action.rating === 'helpful' ? 'good' : 'bad',
        annotation: action.annotation,
        source: 'partner-lab',
        lane: action.lane,
      },
    };
  }

  // steer
  return {
    ...base,
    kind: 'steer_directive',
    payload: {
      directive: action.directive,
      source: 'partner-lab',
      lane: action.lane,
    },
  };
}
