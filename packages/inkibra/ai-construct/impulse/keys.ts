import type { ImpulseProfileMap } from './types';

export const IMPULSE_POOL_NAME = {
  CONVERSATION: 'conversation',
  BACKGROUND: 'background',
  INTERNAL: 'internal',
} as const;

export type CoreImpulsePoolName =
  (typeof IMPULSE_POOL_NAME)[keyof typeof IMPULSE_POOL_NAME];

export const CORE_IMPULSE_PROFILE_NAME = {
  CONVERSATION_USER_MESSAGE: 'conversation.user_message',
  SYSTEM_TIME_PASSED: 'system.time_passed',
  SYSTEM_SELF_REMINDER: 'system.self_reminder',
  BACKGROUND_DEFAULT: 'background.default',
} as const;

export type CoreImpulseProfileName =
  (typeof CORE_IMPULSE_PROFILE_NAME)[keyof typeof CORE_IMPULSE_PROFILE_NAME];

export const IMPULSE_PROFILE_PREFIX = {
  SYSTEM_EVENT: 'system_event',
} as const;

export type SystemEventImpulseProfileName<TEvent extends string = string> =
  `${typeof IMPULSE_PROFILE_PREFIX.SYSTEM_EVENT}.${TEvent}`;

export type SystemEventNameFromProfile<TProfile extends string> =
  string extends TProfile
    ? string
    : TProfile extends SystemEventImpulseProfileName<infer TEvent>
      ? TEvent
      : never;

export function systemEventImpulseProfile<TEvent extends string>(
  event: TEvent,
): SystemEventImpulseProfileName<TEvent> {
  return `${IMPULSE_PROFILE_PREFIX.SYSTEM_EVENT}.${event}`;
}

export const CONSTRUCT_SYSTEM_EVENT_NAME = {
  HEARTBEAT: 'heartbeat',
  MAILBOX_IDLE: 'mailbox_idle',
  CONTEXT_PRESSURE_AUTOCLOSE: 'context_pressure_autoclose',
  STEERING_DIRECTIVE: 'steering_directive',
} as const;

export type ConstructSystemEventName =
  (typeof CONSTRUCT_SYSTEM_EVENT_NAME)[keyof typeof CONSTRUCT_SYSTEM_EVENT_NAME];

/**
 * Default impulse profiles for a standard construct.
 */
export const DEFAULT_IMPULSE_PROFILES = {
  [CORE_IMPULSE_PROFILE_NAME.CONVERSATION_USER_MESSAGE]: {
    pool: IMPULSE_POOL_NAME.CONVERSATION,
  },
  [CORE_IMPULSE_PROFILE_NAME.SYSTEM_TIME_PASSED]: {
    pool: IMPULSE_POOL_NAME.BACKGROUND,
  },
  [CORE_IMPULSE_PROFILE_NAME.SYSTEM_SELF_REMINDER]: {
    pool: IMPULSE_POOL_NAME.BACKGROUND,
  },
  [CORE_IMPULSE_PROFILE_NAME.BACKGROUND_DEFAULT]: {
    pool: IMPULSE_POOL_NAME.BACKGROUND,
  },
  [systemEventImpulseProfile(CONSTRUCT_SYSTEM_EVENT_NAME.HEARTBEAT)]: {
    pool: IMPULSE_POOL_NAME.BACKGROUND,
  },
  [systemEventImpulseProfile(CONSTRUCT_SYSTEM_EVENT_NAME.MAILBOX_IDLE)]: {
    pool: IMPULSE_POOL_NAME.INTERNAL,
  },
  [systemEventImpulseProfile(
    CONSTRUCT_SYSTEM_EVENT_NAME.CONTEXT_PRESSURE_AUTOCLOSE,
  )]: {
    pool: IMPULSE_POOL_NAME.INTERNAL,
  },
  [systemEventImpulseProfile(CONSTRUCT_SYSTEM_EVENT_NAME.STEERING_DIRECTIVE)]: {
    pool: IMPULSE_POOL_NAME.INTERNAL,
  },
} as const satisfies ImpulseProfileMap<
  | (typeof CORE_IMPULSE_PROFILE_NAME)[keyof typeof CORE_IMPULSE_PROFILE_NAME]
  | ReturnType<
      typeof systemEventImpulseProfile<
        (typeof CONSTRUCT_SYSTEM_EVENT_NAME)[keyof typeof CONSTRUCT_SYSTEM_EVENT_NAME]
      >
    >,
  (typeof IMPULSE_POOL_NAME)[keyof typeof IMPULSE_POOL_NAME]
>;
