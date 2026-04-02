# @inkibra/streams

Durable ordered stream primitives with Redis-first replay/tail and optional Postgres safety fallback.

## Cursor Model

- Streams expose opaque cursors for replay (`read`/`stream`) and reconnect flows.
- Cursors represent stream position, not consumer ownership.

## Consumer Cursor Storage

V1 integrations can keep committed consumer cursor state in their execution layer
(for example, workflow state for a single mailbox consumer per construct).

Future option:

- add a shared stream cursor store keyed by `(streamKey, consumerKey)` when
  multi-consumer/shared offset management is required across services.

## Install

```bash
bun add @inkibra/streams
```

## License

MIT
