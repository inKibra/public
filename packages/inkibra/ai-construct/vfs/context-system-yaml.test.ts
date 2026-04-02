/**
 * Tests for YAML parsing, lane matching, and lane grouping.
 */

import { describe, expect, test } from 'bun:test';
import {
  expandLaneTemplate,
  matchLanePattern,
  parseContextManifest,
  parseContextYaml,
  parseLanesYaml,
} from './context-system';

// ---------------------------------------------------------------------------
// parseContextYaml
// ---------------------------------------------------------------------------

describe('parseContextYaml', () => {
  test('parses explicit stage config', () => {
    const config = parseContextYaml(`
stages:
  impulse:
    renderer:
      type: verbatim
    pins:
      - path: SOUL.md
      - path: USER.md
        meta: true
    selector:
      strategy: all
`);
    expect(config.stages?.impulse).toEqual({
      renderer: 'verbatim',
      pins: [{ path: 'SOUL.md' }, { path: 'USER.md', meta: true }],
      selector: { strategy: 'all' },
    });
  });

  test('parses renderer as object with type + params inside a stage', () => {
    const config = parseContextYaml(`
stages:
  response:
    renderer:
      type: timeline
      min_items: 15
      window: "15m"
      max_items: 50
`);
    expect(config.stages?.response).toEqual({
      renderer: 'timeline',
      rendererParams: {
        minItems: 15,
        window: '15m',
        maxItems: 50,
      },
    });
  });

  test('parses lane overrides at lanes.{lane}.{stage}', () => {
    const config = parseContextYaml(`
stages:
  impulse:
    renderer:
      type: verbatim
lanes:
  "workspace:frontend":
    impulse:
      selector:
        strategy: latest
        count: 10
`);
    expect(config.lanes?.['workspace:frontend']?.impulse).toEqual({
      selector: { strategy: 'latest', count: 10 },
    });
  });

  test('parses explicit global stage overrides', () => {
    const config = parseContextYaml(`
stages:
  nap/commit:
    renderer:
      type: summary
    pins:
      - path: SOUL.md
`);
    expect(config.stages?.['nap/commit']).toEqual({
      renderer: 'summary',
      pins: [{ path: 'SOUL.md' }],
    });
  });

  test('rejects legacy default-based shape', () => {
    const config = parseContextYaml(`
default:
  renderer:
    type: verbatim
  pins:
    - path: SOUL.md
`);
    expect(config).toEqual({});
  });

  test('rejects unknown top-level keys', () => {
    const config = parseContextYaml(`
nap:
  pins:
    - path: SOUL.md
`);
    expect(config).toEqual({});
  });

  test('returns empty config on invalid YAML', () => {
    const config = parseContextYaml('not: [valid: yaml: syntax');
    expect(config).toEqual({});
  });

  test('returns empty config on empty string', () => {
    const config = parseContextYaml('');
    expect(config).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// parseContextManifest
// ---------------------------------------------------------------------------

describe('parseContextManifest', () => {
  test('parses directory list', () => {
    const manifest = parseContextManifest(`
directories:
  - /agent/home/
  - /logs/
  - /context/notes/
`);
    expect(manifest.directories).toEqual([
      '/agent/home/',
      '/logs/',
      '/context/notes/',
    ]);
  });

  test('returns empty on invalid YAML', () => {
    const manifest = parseContextManifest(':::bad');
    expect(manifest.directories).toEqual([]);
  });

  test('returns empty on missing directories key', () => {
    const manifest = parseContextManifest('foo: bar');
    expect(manifest.directories).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseLanesYaml
// ---------------------------------------------------------------------------

describe('parseLanesYaml', () => {
  test('parses lane declarations', () => {
    const config = parseLanesYaml(`
conversation:
  can_respond_to:
    - workspace:*

heartbeat:
  can_respond_to:
    - conversation
`);
    expect(config.conversation).toEqual({
      can_respond_to: ['workspace:*'],
    });
    expect(config.heartbeat).toEqual({
      can_respond_to: ['conversation'],
    });
  });

  test('returns empty on invalid YAML', () => {
    const config = parseLanesYaml(':::bad');
    expect(Object.keys(config).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// matchLanePattern
// ---------------------------------------------------------------------------

describe('matchLanePattern', () => {
  test('exact match', () => {
    expect(matchLanePattern('conversation', 'conversation')).toBe(true);
    expect(matchLanePattern('conversation', 'heartbeat')).toBe(false);
  });

  test('prefix wildcard match', () => {
    expect(matchLanePattern('workspace:frontend', 'workspace:*')).toBe(true);
    expect(matchLanePattern('workspace:backend', 'workspace:*')).toBe(true);
    expect(matchLanePattern('conversation', 'workspace:*')).toBe(false);
  });

  test('exact takes precedence over pattern', () => {
    expect(matchLanePattern('workspace:frontend', 'workspace:frontend')).toBe(
      true,
    );
  });

  test('no partial match without wildcard', () => {
    expect(matchLanePattern('workspace:frontend', 'workspace')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// expandLaneTemplate
// ---------------------------------------------------------------------------

describe('expandLaneTemplate', () => {
  test('expands ${lane}', () => {
    expect(expandLaneTemplate('/logs/${lane}/', 'workspace:frontend')).toBe(
      '/logs/workspace:frontend/',
    );
  });

  test('expands ${lane.name}', () => {
    expect(
      expandLaneTemplate('/workspaces/${lane.name}/', 'workspace:frontend'),
    ).toBe('/workspaces/frontend/');
  });

  test('expands ${lane.prefix}', () => {
    expect(
      expandLaneTemplate('/types/${lane.prefix}/', 'workspace:frontend'),
    ).toBe('/types/workspace/');
  });

  test('no templates returns unchanged', () => {
    expect(expandLaneTemplate('/agent/home/', 'conversation')).toBe(
      '/agent/home/',
    );
  });

  test('lane without colon uses full name for both name and prefix', () => {
    expect(
      expandLaneTemplate('${lane.name}-${lane.prefix}', 'conversation'),
    ).toBe('conversation-conversation');
  });
});
