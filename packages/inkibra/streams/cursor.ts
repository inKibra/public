import type { CursorState, StreamCursor } from './types';

type CursorPayloadV1 = {
  v: 1;
  streamKey: string;
  seq: number;
  redisId: string;
};

function encodeBase64Url(value: string): string {
  const bufferCtor = (globalThis as { Buffer?: typeof Buffer }).Buffer;
  const encoded = bufferCtor
    ? bufferCtor.from(value, 'utf8').toString('base64')
    : globalThis.btoa(value);

  return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    '=',
  );
  const bufferCtor = (globalThis as { Buffer?: typeof Buffer }).Buffer;
  if (bufferCtor) {
    return bufferCtor.from(padded, 'base64').toString('utf8');
  }
  return globalThis.atob(padded);
}

export function encodeCursor(state: CursorState): StreamCursor {
  const payload: CursorPayloadV1 = {
    v: 1,
    streamKey: state.streamKey,
    seq: state.seq,
    redisId: state.redisId,
  };

  return `v1.${encodeBase64Url(JSON.stringify(payload))}`;
}

export function decodeCursor(cursor: StreamCursor): CursorState | null {
  if (!cursor || typeof cursor !== 'string') {
    return null;
  }

  const [version, encoded] = cursor.split('.', 2);
  if (version !== 'v1' || !encoded) {
    return null;
  }

  try {
    const decoded = decodeBase64Url(encoded);
    const parsed = JSON.parse(decoded) as CursorPayloadV1;
    if (
      parsed.v !== 1 ||
      typeof parsed.streamKey !== 'string' ||
      typeof parsed.seq !== 'number' ||
      typeof parsed.redisId !== 'string'
    ) {
      return null;
    }

    return {
      streamKey: parsed.streamKey,
      seq: parsed.seq,
      redisId: parsed.redisId,
    };
  } catch {
    return null;
  }
}
