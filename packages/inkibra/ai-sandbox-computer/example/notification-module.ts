import { defineAiComputerModule } from '../define-module';
import { sendNotification } from './notification-api.tool';
import { createNotificationDeps } from './notification-deps';

export const notificationsModule = defineAiComputerModule({
  name: 'notifications',
  readme: `# notifications

Effect-backed helper for queueing notifications from preview code.

Use this package when your workflow needs to ask the host to notify a user or another target without writing that effect plumbing inline in preview code.
`,
  deps: createNotificationDeps,
  bindings: {
    sendNotification,
  },
});
