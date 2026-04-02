import {
  createAPIRoute,
  createContextCodec,
  createEventStreamRoute,
  defineContextSchema,
  defineEventStreamSchema,
  defineRouteSchema,
  HttpMethod,
  type SerializableResult,
} from '@inkibra/router';

type SessionContextContract = {
  data: { userId: string } | null;
  warning: never;
  error: { type: 'InvalidSession' };
};

type EchoRouteContract = {
  pathParams: { id: string };
  pathQuery: { q?: string };
  body: { message: string };
  response: SerializableResult<
    { echo: string; id: string; q?: string },
    { type: 'EchoError' }
  >;
};

type LoginRouteContract = {
  pathParams: Record<string, never>;
  pathQuery: Record<string, never>;
  body: { userId: string };
  response: SerializableResult<{ ok: true }, { type: 'LoginError' }>;
};

type ProfileRouteContract = {
  pathParams: Record<string, never>;
  pathQuery: Record<string, never>;
  body: Record<string, never>;
  response: SerializableResult<
    { userId: string | null },
    { type: 'AuthError' }
  >;
};

type CrashRouteContract = {
  pathParams: Record<string, never>;
  pathQuery: Record<string, never>;
  body: Record<string, never>;
  response: SerializableResult<{ ok: true }, { type: 'CrashError' }>;
};

type NotificationsStreamContract = {
  pathParams: { roomId: string };
  pathQuery: { since?: string };
  eventTypes: {
    connection: { status: 'connected'; timestamp?: number };
    disconnect: { reason?: string; timestamp?: number };
    heartbeat: { timestamp: number };
    error: { message: string; code?: string; details?: unknown };
    message: { text: string };
  };
  completionData: { done: true };
  completionError: { code: string };
};

export const sessionContextSchema =
  defineContextSchema<SessionContextContract>();

export const sessionCodec = createContextCodec({
  name: 'session',
  scope: 'session',
  schema: sessionContextSchema,
  defaultValue: null,
});

export const echoSchema = defineRouteSchema<EchoRouteContract>();
export const echoRoute = createAPIRoute({
  name: 'echo',
  method: HttpMethod.POST,
  path: '/api/echo/:id',
  schema: echoSchema,
});

export const loginSchema = defineRouteSchema<LoginRouteContract>();
export const loginRoute = createAPIRoute({
  name: 'login',
  method: HttpMethod.POST,
  path: '/api/login',
  schema: loginSchema,
  createsContextCodec: { session: sessionCodec },
});

export const profileSchema = defineRouteSchema<ProfileRouteContract>();
export const profileRoute = createAPIRoute({
  name: 'profile',
  method: HttpMethod.GET,
  path: '/api/profile',
  schema: profileSchema,
  contextCodec: { session: sessionCodec },
});

export const crashSchema = defineRouteSchema<CrashRouteContract>();
export const crashRoute = createAPIRoute({
  name: 'crash',
  method: HttpMethod.GET,
  path: '/api/crash',
  schema: crashSchema,
});

export const notificationsStreamSchema =
  defineEventStreamSchema<NotificationsStreamContract>();
export const notificationsStreamRoute = createEventStreamRoute({
  name: 'notifications',
  path: '/api/stream/:roomId',
  schema: notificationsStreamSchema,
  contextCodec: { session: sessionCodec },
});
