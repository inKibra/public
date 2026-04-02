import type { StreamCursor, StreamsClient } from '@inkibra/streams';

export type MailboxOperation<TPayload = unknown> = {
  opId: string;
  kind: string;
  payload: TPayload;
  createdAt: string;
  traceId?: string;
  metadata?: Record<string, unknown>;
};

export type MailboxIdleEvent = {
  mailboxKey: string;
  markerCursor: StreamCursor;
  quietPeriodMs: number;
  emittedAt: string;
};

export type MailboxDeadLetterEvent = {
  mailboxKey: string;
  operation: MailboxOperation;
  reason: string;
  failedAt: string;
  error?: string;
};

export type MailboxStreamEvents = {
  op: {
    operation: MailboxOperation;
  };
  idle: MailboxIdleEvent;
  dlq: MailboxDeadLetterEvent;
};

export type MailboxMessage = {
  cursor: StreamCursor;
  ts: string;
} & (
  | {
      kind: 'op';
      operation: MailboxOperation;
    }
  | {
      kind: 'idle';
      idle: MailboxIdleEvent;
    }
  | {
      kind: 'dlq';
      deadLetter: MailboxDeadLetterEvent;
    }
);

export type MailboxCursorStore = {
  getCursor: (
    mailboxKey: string,
    consumerKey: string,
  ) => Promise<StreamCursor | undefined>;
  setCursor: (
    mailboxKey: string,
    consumerKey: string,
    cursor: StreamCursor,
  ) => Promise<void>;
};

export type MailboxState = {
  lastWriteCursor?: StreamCursor;
  lastIdleMarkerCursor?: StreamCursor;
};

export type MailboxStateStore = {
  getState: (mailboxKey: string) => Promise<MailboxState | undefined>;
  setState: (mailboxKey: string, state: MailboxState) => Promise<void>;
};

export type MailboxIdleScheduler = {
  schedule: (args: {
    mailboxKey: string;
    markerCursor: StreamCursor;
    quietPeriodMs: number;
    run: () => Promise<void>;
  }) => Promise<void>;
  cancel?: (mailboxKey: string) => Promise<void>;
};

export type CreateMailboxClientOptions = {
  streams: StreamsClient;
  cursorStore: MailboxCursorStore;
  stateStore: MailboxStateStore;
  idleScheduler?: MailboxIdleScheduler;
  streamPrefix?: string;
  quietPeriodMs?: number;
};

export type MailboxClient = {
  appendOperation: <TPayload = unknown>(args: {
    mailboxKey: string;
    operation: MailboxOperation<TPayload>;
    quietPeriodMs?: number;
  }) => Promise<{ cursor: StreamCursor }>;
  readBatch: (args: {
    mailboxKey: string;
    consumerKey: string;
    limit?: number;
  }) => Promise<{ messages: MailboxMessage[]; nextCursor?: StreamCursor }>;
  commit: (args: {
    mailboxKey: string;
    consumerKey: string;
    cursor: StreamCursor;
  }) => Promise<void>;
  sendToDlq: (args: {
    mailboxKey: string;
    operation: MailboxOperation;
    reason: string;
    error?: string;
  }) => Promise<{ cursor: StreamCursor }>;
  emitIdleIfQuiet: (args: {
    mailboxKey: string;
    markerCursor: StreamCursor;
    quietPeriodMs: number;
  }) => Promise<{ emitted: boolean; cursor?: StreamCursor }>;
  getConsumerCursor: (args: {
    mailboxKey: string;
    consumerKey: string;
  }) => Promise<StreamCursor | undefined>;
  /**
   * Non-consuming read: returns messages after the given cursor without
   * advancing or committing the consumer cursor. Useful for previewing
   * queued messages (e.g. cross-tab snapshot reconstruction).
   */
  peekBatch: (args: {
    mailboxKey: string;
    cursor?: StreamCursor;
    limit?: number;
  }) => Promise<{ messages: MailboxMessage[]; nextCursor?: StreamCursor }>;
};
