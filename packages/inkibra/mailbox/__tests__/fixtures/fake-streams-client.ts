import type {
  StreamAppendArgs,
  StreamCursor,
  StreamItem,
  StreamMessage,
  StreamReadArgs,
  StreamsClient,
} from '@inkibra/streams';

type StoredMessage = {
  seq: number;
  event: string;
  data: unknown;
  cursor: StreamCursor;
  ts: string;
};

export class FakeStreamsClient implements StreamsClient {
  private seqByKey = new Map<string, number>();
  private messagesByKey = new Map<string, StoredMessage[]>();

  async append<TEvents extends object, K extends keyof TEvents & string>(
    args: StreamAppendArgs<TEvents, K>,
  ): Promise<{ cursor: StreamCursor }> {
    const current = (this.seqByKey.get(args.streamKey) ?? 0) + 1;
    this.seqByKey.set(args.streamKey, current);
    const cursor = `fake.${current}`;

    const list = this.messagesByKey.get(args.streamKey) ?? [];
    list.push({
      seq: current,
      event: args.event,
      data: args.data,
      cursor,
      ts: new Date().toISOString(),
    });
    this.messagesByKey.set(args.streamKey, list);

    return { cursor };
  }

  async read<TEvents extends object>(
    args: StreamReadArgs,
  ): Promise<{
    items: Array<StreamMessage<TEvents>>;
    nextCursor?: StreamCursor;
  }> {
    void ({} as TEvents);
    const list = this.messagesByKey.get(args.streamKey) ?? [];
    const after = decodeFakeCursor(args.cursor);
    const filtered = list.filter((item) => item.seq > after);
    const limited = filtered.slice(0, args.limit ?? 100);

    return {
      items: limited.map((item) => ({
        event: item.event,
        data: item.data as TEvents[keyof TEvents],
        cursor: item.cursor,
        ts: item.ts,
      })) as Array<StreamMessage<TEvents>>,
      nextCursor: limited[limited.length - 1]?.cursor,
    };
  }

  async latestCursor(args: { streamKey: string }): Promise<StreamCursor> {
    const current = this.seqByKey.get(args.streamKey) ?? 0;
    return `fake.${current}`;
  }

  async *stream<TEvents extends object>(): AsyncGenerator<
    StreamItem<TEvents>,
    void,
    unknown
  > {
    void ({} as TEvents);
    yield* [] as StreamItem<TEvents>[];
  }
}

function decodeFakeCursor(cursor: StreamCursor | undefined): number {
  if (!cursor) {
    return 0;
  }

  const [, seq] = cursor.split('.', 2);
  const value = Number(seq);
  return Number.isFinite(value) ? value : 0;
}
