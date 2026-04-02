/**
 * Generic construct lab command lock management.
 *
 * Provides classification of lab actions (perception-lane vs exclusive command),
 * in-memory command-level locking, and pre-flight validation against construct state.
 */

import type { Construct } from '../construct/construct';
import type {
  ConstructLabAction,
  ConstructLabActionName,
  ConstructLabCommandRejectionReason,
} from './types';

// ---------------------------------------------------------------------------
// Exclusive command classification
// ---------------------------------------------------------------------------

/**
 * The subset of lab action names that require exclusive command locking.
 * Perception-lane actions (chat, rate, steer) are fire-and-forget and bypass locks.
 */
export type ConstructLabCommandAction = Exclude<
  ConstructLabActionName,
  'chat' | 'rate' | 'steer'
>;

/**
 * Returns true for perception-lane actions that do NOT require exclusive locking.
 * These are submitted to the runtime mailbox without waiting for completion.
 */
export function isConstructLabPerceptionAction(
  action: ConstructLabAction,
): action is Extract<
  ConstructLabAction,
  { action: 'chat' | 'rate' | 'steer' }
> {
  return (
    action.action === 'chat' ||
    action.action === 'rate' ||
    action.action === 'steer'
  );
}

/**
 * Returns true for actions that require exclusive command locking.
 */
export function isConstructLabExclusiveCommand(
  action: ConstructLabAction,
): action is Extract<
  ConstructLabAction,
  {
    action:
      | 'nap'
      | 'startHypno'
      | 'chatHypnoReview'
      | 'acceptHypno'
      | 'updateHypno'
      | 'cancelHypno';
  }
> {
  return (
    action.action === 'nap' ||
    action.action === 'startHypno' ||
    action.action === 'chatHypnoReview' ||
    action.action === 'acceptHypno' ||
    action.action === 'updateHypno' ||
    action.action === 'cancelHypno'
  );
}

/**
 * Maps an exclusive command action body to its command name.
 */
export function toConstructLabCommandAction(action: {
  action:
    | 'nap'
    | 'startHypno'
    | 'chatHypnoReview'
    | 'acceptHypno'
    | 'updateHypno'
    | 'cancelHypno';
}): ConstructLabCommandAction {
  switch (action.action) {
    case 'nap':
      return 'nap';
    case 'startHypno':
      return 'startHypno';
    case 'chatHypnoReview':
      return 'chatHypnoReview';
    case 'acceptHypno':
      return 'acceptHypno';
    case 'updateHypno':
      return 'updateHypno';
    case 'cancelHypno':
      return 'cancelHypno';
  }
}

// ---------------------------------------------------------------------------
// Pre-flight validation
// ---------------------------------------------------------------------------

export type ConstructLabCommandValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'CommandInvalidState';
      message: string;
    };

/**
 * Validates whether an exclusive command is valid given the current construct state.
 * For example, :nap is invalid while a hypno session is active.
 */
export function validateConstructLabExclusiveCommand(
  construct: Construct,
  action: ConstructLabCommandAction,
): ConstructLabCommandValidationResult {
  const hypnoActive = construct.isHypnoActive();

  if (action === 'nap' && hypnoActive) {
    return {
      ok: false,
      reason: 'CommandInvalidState',
      message: 'Cannot run :nap while hypno session is active.',
    };
  }

  if (action === 'startHypno' && hypnoActive) {
    return {
      ok: false,
      reason: 'CommandInvalidState',
      message: 'Hypno session is already active.',
    };
  }

  if (
    (action === 'chatHypnoReview' ||
      action === 'acceptHypno' ||
      action === 'updateHypno' ||
      action === 'cancelHypno') &&
    !hypnoActive
  ) {
    return {
      ok: false,
      reason: 'CommandInvalidState',
      message: 'No active hypno session for this command.',
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// In-memory command lock manager
// ---------------------------------------------------------------------------

export type ConstructLabCommandLockEntry = {
  action: ConstructLabCommandAction;
  startedAt: number;
};

export type ConstructLabCommandLockManager = {
  /**
   * Attempts to acquire a lock for the given construct + command.
   * Returns a rejection reason if the lock is already held.
   */
  tryAcquire(
    constructId: string,
    action: ConstructLabCommandAction,
  ):
    | { acquired: true; release: () => void }
    | {
        acquired: false;
        reason: ConstructLabCommandRejectionReason;
        message: string;
        activeCommand: ConstructLabCommandAction;
      };

  /**
   * Returns the currently-held lock for a construct, or undefined.
   */
  get(constructId: string): ConstructLabCommandLockEntry | undefined;
};

/**
 * Creates an in-memory command lock manager.
 * Each construct can have at most one exclusive command running at a time.
 */
export function createConstructLabCommandLockManager(): ConstructLabCommandLockManager {
  const locks = new Map<string, ConstructLabCommandLockEntry>();

  return {
    tryAcquire(constructId, action) {
      const existing = locks.get(constructId);
      if (existing) {
        const duplicate = existing.action === action;
        const reason: ConstructLabCommandRejectionReason = duplicate
          ? 'CommandDuplicate'
          : 'CommandBusy';
        return {
          acquired: false,
          reason,
          message: duplicate
            ? `Command :${action} is already in progress.`
            : `Command :${action} rejected while :${existing.action} is in progress.`,
          activeCommand: existing.action,
        };
      }

      locks.set(constructId, { action, startedAt: Date.now() });
      let released = false;
      return {
        acquired: true,
        release: () => {
          if (!released) {
            released = true;
            locks.delete(constructId);
          }
        },
      };
    },

    get(constructId) {
      return locks.get(constructId);
    },
  };
}
