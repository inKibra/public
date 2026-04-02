import { describe, expect, test } from 'bun:test';
import { createOverlayFs } from '@inkibra/ai-flow';
import {
  loadIntentHints,
  matchIntentHints,
  parseIntentRegistry,
  saveIntentHints,
  serializeIntentRegistry,
} from './intent-hints';

const SAMPLE_TOML = `
[[intents]]
intent = "log-workouts"
hint = "what have i done this week"
command = "log-workouts --last 7d"

[[intents]]
intent = "check-streak"
hint = "how is my streak"
command = "streak-check"

[[intents]]
intent = "weekly-summary"
hint = "weekly summary report"
command = "weekly-report --weeks 1"
`;

describe('parseIntentRegistry', () => {
  test('parses TOML intent entries', () => {
    const intents = parseIntentRegistry(SAMPLE_TOML);
    expect(intents).toHaveLength(3);
    expect(intents[0]).toEqual({
      intent: 'log-workouts',
      hint: 'what have i done this week',
      command: 'log-workouts --last 7d',
    });
    expect(intents[2]!.intent).toBe('weekly-summary');
  });

  test('handles empty input', () => {
    expect(parseIntentRegistry('')).toEqual([]);
  });

  test('handles comments', () => {
    const toml = `# Comment\n[[intents]]\nintent = "test"\nhint = "test"\ncommand = "test"`;
    expect(parseIntentRegistry(toml)).toHaveLength(1);
  });
});

describe('serializeIntentRegistry', () => {
  test('round-trips with parser', () => {
    const intents = parseIntentRegistry(SAMPLE_TOML);
    const serialized = serializeIntentRegistry(intents);
    const reparsed = parseIntentRegistry(serialized);
    expect(reparsed).toEqual(intents);
  });
});

describe('matchIntentHints', () => {
  test('matches by keyword overlap', () => {
    const intents = parseIntentRegistry(SAMPLE_TOML);
    const matches = matchIntentHints(intents, 'show me my streak');
    expect(matches).toHaveLength(1);
    expect(matches[0]!.intent).toBe('check-streak');
  });

  test('matches multiple intents', () => {
    const intents = parseIntentRegistry(SAMPLE_TOML);
    const matches = matchIntentHints(intents, 'weekly summary of my streak');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  test('returns empty for no matches', () => {
    const intents = parseIntentRegistry(SAMPLE_TOML);
    const matches = matchIntentHints(
      intents,
      'completely unrelated query about cats',
    );
    expect(matches).toHaveLength(0);
  });

  test('respects maxResults', () => {
    const intents = parseIntentRegistry(SAMPLE_TOML);
    const matches = matchIntentHints(intents, 'week', 1);
    expect(matches.length).toBeLessThanOrEqual(1);
  });
});

describe('VFS load/save', () => {
  test('saves and loads intent hints', async () => {
    const fs = createOverlayFs();
    const intents = parseIntentRegistry(SAMPLE_TOML);
    await saveIntentHints(fs, intents);
    const loaded = await loadIntentHints(fs);
    expect(loaded).toEqual(intents);
  });

  test('loadIntentHints returns empty when file missing', async () => {
    const fs = createOverlayFs();
    const loaded = await loadIntentHints(fs);
    expect(loaded).toEqual([]);
  });
});
