import { defineCodeBinding } from '@inkibra/ai-flow/codemode';
import type { FsApi } from '@inkibra/ai-flow/codemode/types';
import type { NotificationDeps } from './notification-deps';

/** Queue a user-facing notification effect. */
export const sendNotification = defineCodeBinding(
  async function sendNotification(
    { target, message }: { target: string; message: string },
    { deps }: { deps: NotificationDeps; fs: FsApi },
  ): Promise<{ queued: true; target: string; message: string }> {
    await deps.notificationEffects.send({ target, message });
    return { queued: true, target, message };
  },
);
