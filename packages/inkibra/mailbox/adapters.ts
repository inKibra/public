import type {
  MailboxCursorStore,
  MailboxState,
  MailboxStateStore,
} from './types';

export type MailboxKeyValueStore = {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
};

export function createMailboxCursorStoreFromKeyValue(
  store: MailboxKeyValueStore,
  options: { key?: string } = {},
): MailboxCursorStore {
  const key = options.key ?? 'mailbox:cursors';

  return {
    async getCursor(mailboxKey, consumerKey) {
      const all = await readRecord(store, key);
      const value = all[composeCursorKey(mailboxKey, consumerKey)];
      return typeof value === 'string' ? value : undefined;
    },
    async setCursor(mailboxKey, consumerKey, cursor) {
      const all = await readRecord(store, key);
      all[composeCursorKey(mailboxKey, consumerKey)] = cursor;
      await store.set(key, all);
    },
  };
}

export function createMailboxStateStoreFromKeyValue(
  store: MailboxKeyValueStore,
  options: { key?: string } = {},
): MailboxStateStore {
  const key = options.key ?? 'mailbox:state';

  return {
    async getState(mailboxKey) {
      const all = await readRecord(store, key);
      const value = all[mailboxKey];
      if (!isMailboxState(value)) {
        return undefined;
      }
      return value;
    },
    async setState(mailboxKey, state) {
      const all = await readRecord(store, key);
      all[mailboxKey] = state;
      await store.set(key, all);
    },
  };
}

function composeCursorKey(mailboxKey: string, consumerKey: string): string {
  return `${mailboxKey}::${consumerKey}`;
}

async function readRecord(
  store: MailboxKeyValueStore,
  key: string,
): Promise<Record<string, unknown>> {
  const value = await store.get(key);
  if (isRecord(value)) {
    return { ...value };
  }

  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isMailboxState(value: unknown): value is MailboxState {
  if (!isRecord(value)) {
    return false;
  }

  const { lastWriteCursor, lastIdleMarkerCursor } = value;
  return (
    (lastWriteCursor === undefined || typeof lastWriteCursor === 'string') &&
    (lastIdleMarkerCursor === undefined ||
      typeof lastIdleMarkerCursor === 'string')
  );
}
