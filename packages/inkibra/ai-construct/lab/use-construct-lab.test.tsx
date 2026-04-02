/// <reference lib="dom" />

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  mock,
  test,
} from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { Logger } from '@inkibra/logger';
import type { AnyEventStreamRoute } from '@inkibra/router/lib/event-stream-route';
import {
  createFetchTransport,
  createMemoryStorageAdapter,
} from '@inkibra/router/lib/fetch-provider';
import type { AnyEventStreamHandler } from '@inkibra/router/lib/use-event-stream-hooks';
import { stub } from '@inkibra/test-support/stub';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ConstructLabAction } from './types';
import {
  type ConstructLabCallbacks,
  type ConstructLabSnapshotBundle,
  useConstructLab,
} from './use-construct-lab';

const globalRegistrationKey = '__constructLabHookHappyDomRegistered__';
if (!(globalThis as Record<string, unknown>)[globalRegistrationKey]) {
  GlobalRegistrator.register();
  (globalThis as Record<string, unknown>)[globalRegistrationKey] = true;
}

class MockEventSource extends EventTarget {
  static readonly CONNECTING = 0 as const;
  static readonly OPEN = 1 as const;
  static readonly CLOSED = 2 as const;

  readonly url: string;
  readonly withCredentials = false;
  readonly CONNECTING = MockEventSource.CONNECTING;
  readonly OPEN = MockEventSource.OPEN;
  readonly CLOSED = MockEventSource.CLOSED;
  readyState: 0 | 1 | 2 = MockEventSource.CONNECTING;
  onopen: ((this: EventSource, event: Event) => unknown) | null = null;
  onerror: ((this: EventSource, event: Event) => unknown) | null = null;
  onmessage: ((this: EventSource, event: MessageEvent) => unknown) | null =
    null;

  constructor(url: string | URL, _eventSourceInitDict?: EventSourceInit) {
    super();
    this.url = String(url);
    queueMicrotask(() => {
      if (this.readyState === MockEventSource.CLOSED) {
        return;
      }
      this.readyState = MockEventSource.OPEN;
      this.onopen?.call(this as EventSource, new Event('open'));
    });
  }

  close(): void {
    this.readyState = MockEventSource.CLOSED;
  }
}

const originalEventSource = globalThis.EventSource;

function renderHookNoStrict<TResult>(callback: () => TResult) {
  return renderHook(callback, {
    reactStrictMode: false,
  });
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function makeConstructSnapshot() {
  return {
    transcript: [],
    hypno: {
      active: false,
      stage: 'idle' as const,
      pendingPlan: false,
      acceptRequiresConfirmation: false,
      updatedAt: '2026-03-15T18:00:00.000Z',
    },
    queuedNextNapPins: [],
    queuedNextNapImprints: [],
    toolLog: [],
    decisionLog: [],
    runtimeState: {
      activeImpulses: 0,
      scheduledResponses: 0,
      activeResponses: 0,
      schedulerBusy: false,
    },
  };
}

function makeRuntimeSnapshot() {
  return {
    runtimeState: {
      activeImpulses: 0,
      scheduledResponses: 0,
      activeResponses: 0,
      schedulerBusy: false,
    },
    residency: {
      awake: false,
      status: 'idle' as const,
      lastActiveAt: undefined,
    },
    impulses: [],
    sourceFacts: [],
    scheduledResponses: [],
    decisions: [],
    toolLog: [],
  };
}

const createMockLogger = (): Logger =>
  stub<Logger>({
    trace: mock(() => {}),
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    child: mock(() => createMockLogger()),
  });

function createSilentStreamHandler(): AnyEventStreamHandler {
  const transport = createFetchTransport({
    baseUrl: 'https://example.test',
    logger: createMockLogger(),
    includeCredentials: true,
    storageAdapters: {
      session: createMemoryStorageAdapter(),
      device: createMemoryStorageAdapter(),
    },
  });

  return transport.createEventStreamHandler(
    stub<AnyEventStreamRoute>({
      name: 'RuntimeStream',
      constructPath: () => '/runtime/events',
    }),
  );
}

function createUnusedCallbackResult(): Promise<unknown> {
  return Promise.resolve({
    type: 'Err',
    statusCode: 500,
    error: { type: 'UnusedInTest' },
  });
}

describe('useConstructLab', () => {
  beforeEach(() => {
    globalThis.EventSource = MockEventSource as typeof EventSource;
    jest.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
    jest.useRealTimers();
    globalThis.EventSource = originalEventSource;
  });

  test('refreshes snapshots after accepted chat when no runtime events arrive', async () => {
    const refreshSnapshot = mock(
      async (): Promise<ConstructLabSnapshotBundle | undefined> => ({
        cursor: 'cursor-1',
        constructSnapshot: {
          ...makeConstructSnapshot(),
          transcript: [
            {
              id: 'user-1',
              factId: 'fact-1',
              role: 'user',
              kind: 'chat',
              content: 'hello coach',
              createdAt: '2026-03-15T18:00:01.000Z',
            },
            {
              id: 'assistant-1',
              role: 'assistant',
              kind: 'chat',
              content: 'I am here now.',
              createdAt: '2026-03-15T18:00:02.000Z',
            },
          ],
        },
        runtimeSnapshot: makeRuntimeSnapshot(),
        contextFiles: [],
        activeContextFilePath: undefined,
      }),
    );

    const callbacks: ConstructLabCallbacks = {
      submitAction: async () =>
        ({
          type: 'Ok',
          statusCode: 202,
          value: {
            type: 'Accepted',
            action: 'chat',
            opId: 'fact-1',
            queuedAt: '2026-03-15T18:00:01.000Z',
          },
        }) as never,
      enterEditMode: () => createUnusedCallbackResult() as never,
      exitEditMode: () => createUnusedCallbackResult() as never,
      readFile: () => createUnusedCallbackResult() as never,
      writeFile: () => createUnusedCallbackResult() as never,
      deleteFile: () => createUnusedCallbackResult() as never,
      listFiles: () => createUnusedCallbackResult() as never,
      refreshSnapshot,
    };

    const { result } = renderHookNoStrict(() =>
      useConstructLab({
        snapshot: {
          cursor: undefined,
          constructSnapshot: makeConstructSnapshot(),
          runtimeSnapshot: makeRuntimeSnapshot(),
          contextFiles: [],
          activeContextFilePath: undefined,
        },
        streamHandler: createSilentStreamHandler(),
        pathParams: { constructId: 'construct-1' },
        callbacks,
      }),
    );

    await act(async () => {
      await flushMicrotasks();
    });

    await act(async () => {
      await result.current.submit({
        action: 'chat',
        message: 'hello coach',
        lane: 'conversation',
      } satisfies ConstructLabAction);
    });

    expect(
      result.current.transcript.some(
        (entry) => entry.deliveryState === 'sending',
      ),
    ).toBe(true);
    expect(refreshSnapshot).toHaveBeenCalledTimes(0);

    await act(async () => {
      jest.advanceTimersByTime(2_000);
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(refreshSnapshot).toHaveBeenCalledTimes(1);
    expect(result.current.transcript.map((entry) => entry.content)).toEqual([
      'hello coach',
      'I am here now.',
    ]);
    expect(
      result.current.transcript.some(
        (entry) => entry.deliveryState === 'sending',
      ),
    ).toBe(false);

    await act(async () => {
      jest.advanceTimersByTime(10_000);
      await flushMicrotasks();
    });

    expect(refreshSnapshot).toHaveBeenCalledTimes(1);
  });
});
