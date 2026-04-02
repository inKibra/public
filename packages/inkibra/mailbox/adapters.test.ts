import { describe, expect, test } from 'bun:test';
import {
  createMailboxCursorStoreFromKeyValue,
  createMailboxStateStoreFromKeyValue,
  type MailboxKeyValueStore,
} from './adapters';

function createInMemoryKeyValueStore(): MailboxKeyValueStore {
  const store = new Map<string, unknown>();
  return {
    async get(key: string) {
      return store.get(key);
    },
    async set(key: string, value: unknown) {
      store.set(key, value);
    },
  };
}

describe('mailbox adapters', () => {
  test('persists consumer cursors via key-value store', async () => {
    const kv = createInMemoryKeyValueStore();
    const cursorStore = createMailboxCursorStoreFromKeyValue(kv);

    expect(
      await cursorStore.getCursor('construct:1', 'consumer-a'),
    ).toBeUndefined();

    await cursorStore.setCursor('construct:1', 'consumer-a', 'cursor-1');
    await cursorStore.setCursor('construct:1', 'consumer-b', 'cursor-2');

    expect(await cursorStore.getCursor('construct:1', 'consumer-a')).toBe(
      'cursor-1',
    );
    expect(await cursorStore.getCursor('construct:1', 'consumer-b')).toBe(
      'cursor-2',
    );
  });

  test('persists mailbox state via key-value store', async () => {
    const kv = createInMemoryKeyValueStore();
    const stateStore = createMailboxStateStoreFromKeyValue(kv);

    expect(await stateStore.getState('construct:2')).toBeUndefined();

    await stateStore.setState('construct:2', {
      lastWriteCursor: 'cursor-10',
    });

    expect(await stateStore.getState('construct:2')).toEqual({
      lastWriteCursor: 'cursor-10',
    });
  });
});
