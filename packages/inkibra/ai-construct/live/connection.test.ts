import { describe, expect, test } from 'bun:test';
import {
  buildConstructLivePathQuery,
  createConstructLiveConnectionState,
  isConstructLiveReconnectStatus,
  observeConstructLiveCursor,
  syncConstructLiveConnectCursor,
} from './connection';

describe('ai-construct live connection', () => {
  test('starts with matching latest and connect cursor', () => {
    expect(createConstructLiveConnectionState('cursor-1')).toEqual({
      latestCursor: 'cursor-1',
      connectCursor: 'cursor-1',
    });
  });

  test('updates latest cursor without changing current connect cursor', () => {
    const next = observeConstructLiveCursor(
      createConstructLiveConnectionState('cursor-1'),
      'cursor-2',
    );

    expect(next).toEqual({
      latestCursor: 'cursor-2',
      connectCursor: 'cursor-1',
    });
  });

  test('promotes latest cursor to connect cursor only on reconnect statuses', () => {
    const state = {
      latestCursor: 'cursor-2',
      connectCursor: 'cursor-1',
    };

    expect(
      syncConstructLiveConnectCursor({ state, status: 'connected' }),
    ).toEqual(state);
    expect(
      syncConstructLiveConnectCursor({ state, status: 'disconnected' }),
    ).toEqual({
      latestCursor: 'cursor-2',
      connectCursor: 'cursor-2',
    });
  });

  test('identifies reconnect statuses', () => {
    expect(isConstructLiveReconnectStatus('disconnected')).toBe(true);
    expect(isConstructLiveReconnectStatus('error')).toBe(true);
    expect(isConstructLiveReconnectStatus('completed')).toBe(true);
    expect(isConstructLiveReconnectStatus('connected')).toBe(false);
  });

  test('builds path query with optional connect cursor', () => {
    expect(
      buildConstructLivePathQuery(
        { gymTrainerBindingId: 'binding-1', ignored: undefined },
        'cursor-1',
      ),
    ).toEqual({
      gymTrainerBindingId: 'binding-1',
      cursor: 'cursor-1',
    });
  });
});
