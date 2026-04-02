/**
 * Intent Hint Registry — Maps natural-language phrases to command invocations.
 *
 * Intents are TOML entries stored in the VFS at:
 *   /agent/intents/registry.toml (agent intents)
 *   /developer/intents/registry.toml (developer intents)
 *
 * Each entry has: intent (name), hint (natural language), command (string).
 * The system auto-previews matched intents at impulse start.
 *
 * See spec §18.
 */

import type { OverlayFs } from '@inkibra/ai-flow';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IntentHint = {
  intent: string;
  hint: string;
  command: string;
};

const AGENT_REGISTRY_PATH = '/agent/intents/registry.toml';
const DEVELOPER_REGISTRY_PATH = '/developer/intents/registry.toml';

// ---------------------------------------------------------------------------
// TOML Parser (Bun native)
// ---------------------------------------------------------------------------

/**
 * Parse a TOML intent registry file using Bun's native TOML parser.
 */
export function parseIntentRegistry(toml: string): IntentHint[] {
  try {
    const parsed = Bun.TOML.parse(toml) as {
      intents?: Array<Record<string, unknown>>;
    };
    if (!Array.isArray(parsed.intents)) return [];
    return parsed.intents
      .filter(
        (e) =>
          typeof e.intent === 'string' &&
          typeof e.hint === 'string' &&
          typeof e.command === 'string',
      )
      .map((e) => ({
        intent: e.intent as string,
        hint: e.hint as string,
        command: e.command as string,
      }));
  } catch {
    return [];
  }
}

/**
 * Serialize intent hints to TOML format.
 */
export function serializeIntentRegistry(intents: IntentHint[]): string {
  return intents
    .map(
      (i) =>
        `[[intents]]\nintent = "${i.intent}"\nhint = "${i.hint}"\ncommand = "${i.command}"`,
    )
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// VFS operations
// ---------------------------------------------------------------------------

/**
 * Load intent hints from the VFS registry file.
 */
export async function loadIntentHints(fs: OverlayFs): Promise<IntentHint[]> {
  const results: IntentHint[] = [];

  // Load from both agent and developer registries
  for (const registryPath of [DEVELOPER_REGISTRY_PATH, AGENT_REGISTRY_PATH]) {
    try {
      const content = await fs.read(registryPath);
      results.push(...parseIntentRegistry(content));
    } catch {
      // Registry doesn't exist yet — skip
    }
  }

  return results;
}

/**
 * Save intent hints to the VFS registry file.
 */
export async function saveIntentHints(
  fs: OverlayFs,
  intents: IntentHint[],
): Promise<void> {
  // Agent intents are saved to the agent registry
  await fs.write(AGENT_REGISTRY_PATH, serializeIntentRegistry(intents));
}

// ---------------------------------------------------------------------------
// Similarity matching — TF-IDF cosine similarity (spec §18.3)
// ---------------------------------------------------------------------------

/** Tokenize text into lowercase words, removing stop words. */
function tokenize(text: string): string[] {
  const stops = new Set([
    'a',
    'an',
    'the',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'being',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
    'will',
    'would',
    'could',
    'should',
    'may',
    'might',
    'can',
    'shall',
    'to',
    'of',
    'in',
    'for',
    'on',
    'with',
    'at',
    'by',
    'from',
    'it',
    'its',
    'this',
    'that',
    'i',
    'me',
    'my',
    'we',
    'our',
    'you',
    'your',
    'he',
    'she',
    'they',
    'them',
    'and',
    'or',
    'but',
    'not',
    'no',
    'so',
    'if',
    'then',
    'than',
    'just',
  ]);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !stops.has(w));
}

/** Build a term frequency vector from tokens. */
function tfVector(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  // Normalize by max frequency
  const maxFreq = Math.max(...tf.values(), 1);
  for (const [term, freq] of tf) {
    tf.set(term, freq / maxFreq);
  }
  return tf;
}

/** Compute cosine similarity between two TF vectors. */
function cosineSimilarity(
  a: Map<string, number>,
  b: Map<string, number>,
): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  const allTerms = new Set([...a.keys(), ...b.keys()]);
  for (const term of allTerms) {
    const va = a.get(term) ?? 0;
    const vb = b.get(term) ?? 0;
    dotProduct += va * vb;
    normA += va * va;
    normB += vb * vb;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

/**
 * Find intent hints that match the given text using TF-IDF cosine similarity.
 *
 * Uses term-frequency vectors with stop word removal and cosine similarity
 * scoring. When an external embedding provider is available (Phase 3+),
 * this can be replaced with real embeddings.
 */
export function matchIntentHints(
  intents: IntentHint[],
  text: string,
  maxResults = 3,
): IntentHint[] {
  const textTokens = tokenize(text);
  if (textTokens.length === 0) return [];

  const textVec = tfVector(textTokens);

  const scored = intents
    .map((intent) => {
      const hintTokens = tokenize(intent.hint);
      if (hintTokens.length === 0) return { intent, score: 0 };
      const hintVec = tfVector(hintTokens);
      const score = cosineSimilarity(textVec, hintVec);
      return { intent, score };
    })
    .filter((s) => s.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  return scored.map((s) => s.intent);
}
