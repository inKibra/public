# @inkibra/mailbox

Durable mailbox semantics built on top of `@inkibra/streams`.

## Responsibilities

- Ordered mailbox operations (`appendOperation`, `readBatch`)
- Consumer progress (`commit`/cursor)
- DLQ event emission (`sendToDlq`)
- Quiet-period synthetic events (`emitIdleIfQuiet`)

## Cursor Strategy (V1)

- V1 keeps mailbox committed cursor in the execution layer (for example,
  workflow state per construct consumer).
- `@inkibra/mailbox` supports pluggable cursor stores so integrations can choose
  where to persist consumer progress.

Future option:

- shared stream cursor store keyed by `(streamKey, consumerKey)` for
  multi-consumer/shared offset management across services.

## Install

```bash
bun add @inkibra/mailbox
```

## License

MIT
