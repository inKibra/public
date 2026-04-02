import {
  encoding_for_model,
  get_encoding,
  type TiktokenModel,
} from '@dqbd/tiktoken';

const DEFAULT_MODEL = 'moonshotai/kimi-k2.5';
const DEFAULT_ENCODING = 'o200k_base';

type Encoder = ReturnType<typeof get_encoding>;

const encoderCache = new Map<string, Encoder>();
let fallbackEncoder: Encoder | null = null;

function getEncoder(model: string): Encoder {
  const cached = encoderCache.get(model);
  if (cached) return cached;

  try {
    // Cast: model is an arbitrary string; encoding_for_model expects TiktokenModel.
    // If the model isn't recognized, the catch block falls back to DEFAULT_ENCODING.
    const encoder = encoding_for_model(model as TiktokenModel);
    encoderCache.set(model, encoder);
    return encoder;
  } catch {
    if (!fallbackEncoder) {
      fallbackEncoder = get_encoding(DEFAULT_ENCODING);
    }
    return fallbackEncoder;
  }
}

export function countTokens(text: string, model = DEFAULT_MODEL): number {
  if (!text) return 0;
  const encoder = getEncoder(model);
  return encoder.encode(text).length;
}

export function estimateTokensFromBytes(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.ceil(bytes / 4);
}
