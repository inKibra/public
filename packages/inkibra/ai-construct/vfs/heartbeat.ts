import type { ContextMeta, OverlayFs } from '@inkibra/ai-flow';
import {
  contextPathToId,
  createVfsContextManager,
} from './context-persistence';
import { VFS_PATHS } from './layout';

export type HeartbeatMeta = {
  heartbeat_rate_ms?: number;
  estimated_next_heartbeat_at?: string;
  last_pulse_at?: string;
  last_pulse_source?: 'developer' | 'user' | 'runtime';
  last_user_message_at?: string;
  last_response_at?: string;
  last_heartbeat_at?: string;
  timezone?: string;
};

export async function loadHeartbeatMeta(
  vfs: OverlayFs,
): Promise<HeartbeatMeta> {
  const manager = createVfsContextManager(vfs);
  const loaded = await manager.load(contextPathToId(VFS_PATHS.core.heartbeat));

  if (!loaded) {
    return {};
  }

  return {
    heartbeat_rate_ms: loaded.meta.heartbeat_rate_ms as number | undefined,
    estimated_next_heartbeat_at: readOptionalString(
      loaded.meta.estimated_next_heartbeat_at,
    ),
    last_pulse_at: readOptionalString(loaded.meta.last_pulse_at),
    last_pulse_source: loaded.meta.last_pulse_source as
      | 'developer'
      | 'user'
      | 'runtime'
      | undefined,
    last_user_message_at: readOptionalString(loaded.meta.last_user_message_at),
    last_response_at: readOptionalString(loaded.meta.last_response_at),
    last_heartbeat_at: readOptionalString(loaded.meta.last_heartbeat_at),
    timezone: readOptionalString(loaded.meta.timezone),
  };
}

export async function updateHeartbeatMeta(
  vfs: OverlayFs,
  patch: HeartbeatMeta,
): Promise<void> {
  const manager = createVfsContextManager(vfs);
  const id = contextPathToId(VFS_PATHS.core.heartbeat);
  const loaded = await manager.load(id);
  const now = new Date().toISOString();
  const nextMeta: Record<string, unknown> = {
    ...(loaded?.meta as ContextMeta | undefined),
  };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete nextMeta[key];
      continue;
    }
    nextMeta[key] = value;
  }

  await manager.stage({
    id,
    tags: loaded?.meta.tags,
    meta: {
      ...nextMeta,
      updated: now,
    },
    content: loaded?.content ?? '',
  });
  await manager.commit(id);
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
