import type {
  MailboxCursorStore,
  MailboxIdleScheduler,
  MailboxState,
  MailboxStateStore,
} from './types';

export function createInMemoryMailboxCursorStore(): MailboxCursorStore {
  const cursors = new Map<string, string>();

  return {
    async getCursor(mailboxKey, consumerKey) {
      return cursors.get(composeKey(mailboxKey, consumerKey));
    },
    async setCursor(mailboxKey, consumerKey, cursor) {
      cursors.set(composeKey(mailboxKey, consumerKey), cursor);
    },
  };
}

export function createInMemoryMailboxStateStore(): MailboxStateStore {
  const stateByMailbox = new Map<string, MailboxState>();

  return {
    async getState(mailboxKey) {
      return stateByMailbox.get(mailboxKey);
    },
    async setState(mailboxKey, state) {
      stateByMailbox.set(mailboxKey, state);
    },
  };
}

export function createInMemoryIdleScheduler(): MailboxIdleScheduler {
  const timerByMailbox = new Map<string, ReturnType<typeof setTimeout>>();

  return {
    async schedule({ mailboxKey, quietPeriodMs, run }) {
      const existing = timerByMailbox.get(mailboxKey);
      if (existing) {
        clearTimeout(existing);
      }

      const timer = setTimeout(() => {
        void run();
      }, quietPeriodMs);

      timerByMailbox.set(mailboxKey, timer);
    },
    async cancel(mailboxKey) {
      const existing = timerByMailbox.get(mailboxKey);
      if (!existing) {
        return;
      }
      clearTimeout(existing);
      timerByMailbox.delete(mailboxKey);
    },
  };
}

function composeKey(mailboxKey: string, consumerKey: string): string {
  return `${mailboxKey}::${consumerKey}`;
}
