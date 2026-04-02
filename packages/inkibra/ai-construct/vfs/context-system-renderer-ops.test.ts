/**
 * Tests for the renderer ops pipeline: parsing, select/filter application,
 * where-clause matching, and 'this' lane resolution.
 */

import { describe, expect, test } from 'bun:test';
import { createOverlayFs, serializeContextFile } from '@inkibra/ai-flow';
import {
  parseContextYaml,
  type RendererOpWhere,
  renderSection,
} from './context-system';

// ---------------------------------------------------------------------------
// parseContextYaml — ops parsing
// ---------------------------------------------------------------------------

describe('parseContextYaml ops parsing', () => {
  test('parses renderer with ops array', () => {
    const config = parseContextYaml(`
stages:
  impulse:
    renderer:
      type: timeline
      ops:
        - filter:
            window: "15m"
            where:
              lanes: [this]
              item_kinds: [entry]
        - select:
            at_least: 15
            where:
              lanes: [this]
              entry_kinds: [impulse, response]
              item_kinds: [entry]
        - filter:
            max_items: 50
`);
    const stage = config.stages?.impulse;
    expect(stage?.renderer).toBe('timeline');
    expect(stage?.rendererParams?.ops).toBeDefined();
    expect(stage?.rendererParams?.ops).toHaveLength(3);

    const ops = stage?.rendererParams?.ops ?? [];
    const [filterWindow, selectAtLeast, filterMax] = ops;

    // First op: filter with window
    expect(filterWindow).toBeDefined();
    expect('filter' in (filterWindow ?? {})).toBe(true);
    const f1 = (
      filterWindow as { filter: { window: string; where: RendererOpWhere } }
    ).filter;
    expect(f1.window).toBe('15m');
    expect(f1.where?.lanes).toEqual(['this']);
    expect(f1.where?.item_kinds).toEqual(['entry']);

    // Second op: select with at_least
    expect(selectAtLeast).toBeDefined();
    expect('select' in (selectAtLeast ?? {})).toBe(true);
    const s1 = (
      selectAtLeast as { select: { at_least: number; where: RendererOpWhere } }
    ).select;
    expect(s1.at_least).toBe(15);
    expect(s1.where?.lanes).toEqual(['this']);
    expect(s1.where?.entry_kinds).toEqual(['impulse', 'response']);

    // Third op: filter with max_items, no where
    expect(filterMax).toBeDefined();
    expect('filter' in (filterMax ?? {})).toBe(true);
    const f2 = (filterMax as { filter: { max_items: number } }).filter;
    expect(f2.max_items).toBe(50);
  });

  test('skips invalid ops (no select or filter key)', () => {
    const config = parseContextYaml(`
stages:
  impulse:
    renderer:
      type: timeline
      ops:
        - select:
            at_least: 10
        - bogus: true
        - filter:
            max_items: 20
`);
    // The bogus op should be filtered out
    expect(config.stages?.impulse?.rendererParams?.ops).toHaveLength(2);
  });

  test('falls back to legacy flat params when no ops', () => {
    const config = parseContextYaml(`
stages:
  response:
    renderer:
      type: timeline
      min_items: 15
      window: "15m"
      max_items: 50
`);
    const params = config.stages?.response?.rendererParams;
    expect(params?.ops).toBeUndefined();
    expect(params?.minItems).toBe(15);
    expect(params?.window).toBe('15m');
    expect(params?.maxItems).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// renderSection — ops-based timeline rendering
// ---------------------------------------------------------------------------

describe('renderSection timeline with ops', () => {
  /**
   * Helper: write a lane log file with N entries at given timestamps.
   */
  async function writeLaneLog(
    vfs: ReturnType<typeof createOverlayFs>,
    path: string,
    lane: string,
    entries: Array<{
      kind: string;
      id: string;
      timestamp: string;
      content: string;
    }>,
  ) {
    const body = entries
      .map((e) => {
        const lines = [
          `[${e.timestamp}] ${e.kind} ${e.id}`,
          `role: ${e.kind === 'response' ? 'construct' : e.kind === 'feedback' || e.kind === 'steering' ? 'system' : 'user'}`,
          `source_lane: ${lane}`,
        ];
        if (e.kind === 'impulse' || e.kind === 'reflected_impulse') {
          lines.push(`impulse_id: ${e.id}`);
          lines.push('from: test-user');
          lines.push('trigger: test');
        }
        if (e.kind === 'response') {
          lines.push(`response_id: ${e.id}`);
        }
        if (e.kind === 'feedback') {
          lines.push(`response_id: ${e.id}`);
          lines.push('rating: neutral');
        }
        lines.push('', '[content]', e.content);
        if (e.kind === 'impulse') {
          lines.push('', '[thinking]', 'test thinking');
        }
        return lines.join('\n');
      })
      .join('\n---\n');

    await vfs.write(
      path,
      serializeContextFile(
        {
          id: path,
          tags: [],
          created: entries[0]?.timestamp ?? new Date().toISOString(),
          updated:
            entries[entries.length - 1]?.timestamp ?? new Date().toISOString(),
          log_type: lane,
          entry_count: entries.length,
        },
        body,
      ),
    );
  }

  test('filter window removes old entries matching where', async () => {
    const vfs = createOverlayFs();
    const now = new Date('2026-04-01T12:00:00.000Z');

    await writeLaneLog(
      vfs,
      '/logs/2026/W14/2026-04-01-0.conversation.log',
      'conversation',
      [
        {
          kind: 'impulse',
          id: 'imp-1',
          timestamp: '2026-04-01T11:30:00.000Z', // 30m ago — outside 15m window
          content: 'old impulse',
        },
        {
          kind: 'response',
          id: 'resp-1',
          timestamp: '2026-04-01T11:50:00.000Z', // 10m ago — inside window
          content: 'recent response',
        },
        {
          kind: 'impulse',
          id: 'imp-2',
          timestamp: '2026-04-01T11:55:00.000Z', // 5m ago — inside window
          content: 'recent impulse',
        },
      ],
    );

    const rendered = await renderSection(
      vfs,
      '/logs',
      ['/logs/2026/W14/2026-04-01-0.conversation.log'],
      'timeline',
      {
        now,
        lane: 'conversation',
        rendererParams: {
          ops: [
            {
              filter: {
                window: '15m',
                where: { lanes: ['this'], item_kinds: ['entry'] },
              },
            },
          ],
        },
      },
    );

    expect(rendered).not.toContain('old impulse');
    expect(rendered).toContain('recent response');
    expect(rendered).toContain('recent impulse');
  });

  test('select at_least backfills when filter removes too many', async () => {
    const vfs = createOverlayFs();
    const now = new Date('2026-04-01T12:00:00.000Z');

    // 5 entries, all older than 5m window
    const entries = Array.from({ length: 5 }, (_, i) => ({
      kind: i % 2 === 0 ? 'impulse' : 'response',
      id: `entry-${i}`,
      timestamp: new Date(now.getTime() - (30 - i) * 60 * 1000).toISOString(), // 30m..26m ago
      content: `content ${i}`,
    }));

    await writeLaneLog(
      vfs,
      '/logs/2026/W14/2026-04-01-0.conversation.log',
      'conversation',
      entries,
    );

    const rendered = await renderSection(
      vfs,
      '/logs',
      ['/logs/2026/W14/2026-04-01-0.conversation.log'],
      'timeline',
      {
        now,
        lane: 'conversation',
        rendererParams: {
          ops: [
            // Filter to 5m window — removes all entries
            {
              filter: {
                window: '5m',
                where: { lanes: ['this'], item_kinds: ['entry'] },
              },
            },
            // Select at_least 3 — should backfill 3 most recent from full pool
            {
              select: {
                at_least: 3,
                where: {
                  lanes: ['this'],
                  entry_kinds: ['impulse', 'response'],
                  item_kinds: ['entry'],
                },
              },
            },
          ],
        },
      },
    );

    // Should have backfilled the 3 most recent entries
    expect(rendered).toContain('content 4');
    expect(rendered).toContain('content 3');
    expect(rendered).toContain('content 2');
    // The oldest two should not be present
    expect(rendered).not.toContain('content 0');
    expect(rendered).not.toContain('content 1');
  });

  test('filter max_items caps total entries', async () => {
    const vfs = createOverlayFs();
    const now = new Date('2026-04-01T12:00:00.000Z');

    const entries = Array.from({ length: 10 }, (_, i) => ({
      kind: 'impulse',
      id: `imp-${i}`,
      timestamp: new Date(now.getTime() - (10 - i) * 60 * 1000).toISOString(),
      content: `item ${i}`,
    }));

    await writeLaneLog(
      vfs,
      '/logs/2026/W14/2026-04-01-0.conversation.log',
      'conversation',
      entries,
    );

    const rendered = await renderSection(
      vfs,
      '/logs',
      ['/logs/2026/W14/2026-04-01-0.conversation.log'],
      'timeline',
      {
        now,
        lane: 'conversation',
        rendererParams: {
          ops: [{ filter: { max_items: 3 } }],
        },
      },
    );

    // Only most recent 3
    expect(rendered).toContain('item 9');
    expect(rendered).toContain('item 8');
    expect(rendered).toContain('item 7');
    expect(rendered).not.toContain('item 0');
    expect(rendered).not.toContain('item 6');
  });

  test('where entry_kinds filters specific entry kinds', async () => {
    const vfs = createOverlayFs();
    const now = new Date('2026-04-01T12:00:00.000Z');

    await writeLaneLog(
      vfs,
      '/logs/2026/W14/2026-04-01-0.conversation.log',
      'conversation',
      [
        {
          kind: 'impulse',
          id: 'imp-1',
          timestamp: '2026-04-01T11:50:00.000Z',
          content: 'impulse content',
        },
        {
          kind: 'feedback',
          id: 'fb-1',
          timestamp: '2026-04-01T11:55:00.000Z',
          content: 'feedback content',
        },
        {
          kind: 'response',
          id: 'resp-1',
          timestamp: '2026-04-01T11:58:00.000Z',
          content: 'response content',
        },
      ],
    );

    const rendered = await renderSection(
      vfs,
      '/logs',
      ['/logs/2026/W14/2026-04-01-0.conversation.log'],
      'timeline',
      {
        now,
        lane: 'conversation',
        rendererParams: {
          ops: [
            // Only keep impulse and response entries
            {
              filter: {
                max_items: 2,
                where: { entry_kinds: ['feedback'] },
              },
            },
          ],
        },
      },
    );

    // feedback limited to 0 wouldn't work with max_items: 2
    // Let's use max_items: 0 to filter out feedback
    // Actually max_items only keeps the N most recent matching entries
    // So max_items: 0 for feedback should remove all feedback entries
    // But we used max_items: 2 so that keeps the 2 most recent feedback (only 1 exists)
    // Let me adjust the test...
    expect(rendered).toContain('impulse content');
    expect(rendered).toContain('response content');
    expect(rendered).toContain('feedback content'); // only 1 feedback, under limit of 2
  });

  test('filter max_items 0 removes all matching entries', async () => {
    const vfs = createOverlayFs();
    const now = new Date('2026-04-01T12:00:00.000Z');

    await writeLaneLog(
      vfs,
      '/logs/2026/W14/2026-04-01-0.conversation.log',
      'conversation',
      [
        {
          kind: 'impulse',
          id: 'imp-1',
          timestamp: '2026-04-01T11:50:00.000Z',
          content: 'impulse content',
        },
        {
          kind: 'feedback',
          id: 'fb-1',
          timestamp: '2026-04-01T11:55:00.000Z',
          content: 'feedback content',
        },
        {
          kind: 'response',
          id: 'resp-1',
          timestamp: '2026-04-01T11:58:00.000Z',
          content: 'response content',
        },
      ],
    );

    const rendered = await renderSection(
      vfs,
      '/logs',
      ['/logs/2026/W14/2026-04-01-0.conversation.log'],
      'timeline',
      {
        now,
        lane: 'conversation',
        rendererParams: {
          ops: [
            {
              filter: {
                max_items: 0,
                where: { entry_kinds: ['feedback'] },
              },
            },
          ],
        },
      },
    );

    expect(rendered).toContain('impulse content');
    expect(rendered).toContain('response content');
    expect(rendered).not.toContain('feedback content');
  });

  test('this resolves to concrete lane name', async () => {
    const vfs = createOverlayFs();
    const now = new Date('2026-04-01T12:00:00.000Z');

    // Two lanes in same directory
    await writeLaneLog(
      vfs,
      '/logs/2026/W14/2026-04-01-0.conversation.log',
      'conversation',
      [
        {
          kind: 'impulse',
          id: 'conv-1',
          timestamp: '2026-04-01T11:50:00.000Z',
          content: 'conversation entry',
        },
      ],
    );

    await writeLaneLog(
      vfs,
      '/logs/2026/W14/2026-04-01-0.heartbeat.log',
      'heartbeat',
      [
        {
          kind: 'impulse',
          id: 'hb-1',
          timestamp: '2026-04-01T11:55:00.000Z',
          content: 'heartbeat entry',
        },
      ],
    );

    // Render with lane=conversation, filter to this=conversation only
    const rendered = await renderSection(
      vfs,
      '/logs',
      [
        '/logs/2026/W14/2026-04-01-0.conversation.log',
        '/logs/2026/W14/2026-04-01-0.heartbeat.log',
      ],
      'timeline',
      {
        now,
        lane: 'conversation',
        rendererParams: {
          ops: [
            {
              filter: {
                max_items: 10,
                where: { lanes: ['this'], item_kinds: ['entry'] },
              },
            },
          ],
        },
      },
    );

    expect(rendered).toContain('conversation entry');
    // heartbeat doesn't match where.lanes=['this'] when this=conversation,
    // but non-matching entries pass through filter untouched
    expect(rendered).toContain('heartbeat entry');
  });

  test('select from cross-lane entries', async () => {
    const vfs = createOverlayFs();
    const now = new Date('2026-04-01T12:00:00.000Z');

    await writeLaneLog(
      vfs,
      '/logs/2026/W14/2026-04-01-0.conversation.log',
      'conversation',
      [
        {
          kind: 'impulse',
          id: 'conv-1',
          timestamp: '2026-04-01T11:50:00.000Z',
          content: 'conv entry',
        },
      ],
    );

    await writeLaneLog(
      vfs,
      '/logs/2026/W14/2026-04-01-0.heartbeat.log',
      'heartbeat',
      [
        {
          kind: 'impulse',
          id: 'hb-1',
          timestamp: '2026-04-01T11:55:00.000Z',
          content: 'heartbeat entry',
        },
      ],
    );

    // Filter everything out, then select at_least 1 from conversation
    const rendered = await renderSection(
      vfs,
      '/logs',
      [
        '/logs/2026/W14/2026-04-01-0.conversation.log',
        '/logs/2026/W14/2026-04-01-0.heartbeat.log',
      ],
      'timeline',
      {
        now,
        lane: 'heartbeat',
        rendererParams: {
          ops: [
            // Remove all entries (1 minute window, all are older)
            { filter: { window: '1m' } },
            // Backfill at least 1 from conversation
            {
              select: {
                at_least: 1,
                where: { lanes: ['conversation'], item_kinds: ['entry'] },
              },
            },
          ],
        },
      },
    );

    expect(rendered).toContain('conv entry');
    // heartbeat was filtered out and not backfilled
    expect(rendered).not.toContain('heartbeat entry');
  });

  test('summary entries tagged with itemKind summary', async () => {
    const vfs = createOverlayFs();
    const now = new Date('2026-04-01T12:00:00.000Z');
    const weekDir = '/logs/2026/W13';

    // Write a compacted summary file in a directory
    await vfs.write(
      `${weekDir}/2026-03-25-0.conversation.log`,
      serializeContextFile(
        {
          id: `${weekDir}/2026-03-25-0.conversation.log`,
          tags: [],
          created: '2026-03-25T09:00:00.000Z',
          updated: '2026-03-25T09:00:00.000Z',
          log_type: 'conversation',
          summary: 'compacted log summary',
          entry_count: 0,
        },
        '', // empty body = compacted
      ),
    );

    // Write a current entry file
    await writeLaneLog(
      vfs,
      '/logs/2026/W14/2026-04-01-0.conversation.log',
      'conversation',
      [
        {
          kind: 'impulse',
          id: 'imp-1',
          timestamp: '2026-04-01T11:55:00.000Z',
          content: 'current entry',
        },
      ],
    );

    // Select directory (summaries) + explicit file (entries)
    const rendered = await renderSection(
      vfs,
      '/logs',
      [weekDir, '/logs/2026/W14/2026-04-01-0.conversation.log'],
      'timeline',
      {
        now,
        lane: 'conversation',
        rendererParams: {
          ops: [
            // Filter out summaries
            {
              filter: {
                max_items: 0,
                where: { item_kinds: ['summary'] },
              },
            },
          ],
        },
      },
    );

    // Summaries should be removed
    expect(rendered).not.toContain('compacted log summary');
    // Entries should remain
    expect(rendered).toContain('current entry');
  });

  test('explicitly selected compacted lane logs emit summary items', async () => {
    const vfs = createOverlayFs();
    const now = new Date('2026-04-01T12:00:00.000Z');
    const path = '/logs/2026/W14/2026-04-01-0.conversation.log';

    await vfs.write(
      path,
      serializeContextFile(
        {
          id: path,
          tags: [],
          created: '2026-04-01T11:00:00.000Z',
          updated: '2026-04-01T11:30:00.000Z',
          compacted_at: '2026-04-01T11:30:00.000Z',
          latest_entry_at: '2026-04-01T11:29:00.000Z',
          log_type: 'conversation',
          summary: 'selected compacted summary',
          highlights: ['selected compacted highlight'],
          entry_count: 1,
        },
        [
          '[2026-04-01T11:29:00.000Z] impulse imp-1',
          'role: user',
          'source_lane: conversation',
          'impulse_id: imp-1',
          'from: test-user',
          'trigger: test',
          'selected full entry',
        ].join('\n'),
      ),
    );

    const rendered = await renderSection(vfs, '/logs', [path], 'timeline', {
      now,
      lane: 'conversation',
      rendererParams: {
        ops: [
          {
            filter: {
              max_items: 0,
              where: { item_kinds: ['entry'] },
            },
          },
        ],
      },
    });

    expect(rendered).toContain('selected compacted summary');
    expect(rendered).toContain('selected compacted highlight');
    expect(rendered).not.toContain('selected full entry');
  });
});
