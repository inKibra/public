import { describe, expect, test } from 'bun:test';
import {
  createOverlayFs,
  parseContextFile,
  serializeContextFile,
} from '@inkibra/ai-flow';
import { VFS_PATHS } from './layout';
import {
  applyNextNapPins,
  consumeNextNapImprints,
  consumeNextNapPins,
  enqueueNextNapImprint,
  enqueueNextNapPin,
  loadPendingNextNapImprints,
  loadPendingNextNapPins,
  type NextNapPinEntry,
} from './nap-instructions';

// Queue path for nap-pin entries
const NAP_PIN_QUEUE_PATH = '/runtime/queue/nap-pin.md';
// Pinned state path (persistent runtime state)
const PINNED_PATH = '/runtime/handles/pinned.md';

describe('next nap queues', () => {
  test('loads and consumes pending nap-pin entries', async () => {
    const now = new Date().toISOString();
    const queue: NextNapPinEntry[] = [
      {
        id: 'next-open-1',
        path: '/agent/home/stories/story-a.md',
        kind: 'file',
        mode: 'full',
        scope: '*',
        source: 'queue',
        createdAt: now,
        status: 'pending',
      },
      {
        id: 'next-open-2',
        path: '/agent/home/stories/story-b.md',
        kind: 'file',
        mode: 'full',
        scope: '*',
        source: 'queue',
        createdAt: now,
        status: 'consumed',
      },
    ];

    const fs = createOverlayFs({
      mount: {
        [NAP_PIN_QUEUE_PATH]: serializeContextFile(
          {
            id: 'nap-pin-queue',
            tags: ['nap', 'queue'],
            created: now,
            updated: now,
            queue,
          },
          '# NAP_PIN_QUEUE',
        ),
      },
    });

    const pending = await loadPendingNextNapPins(fs);
    expect(pending.length).toBe(1);
    expect(pending[0]?.id).toBe('next-open-1');

    await consumeNextNapPins(fs, ['next-open-1']);

    const pendingAfter = await loadPendingNextNapPins(fs);
    expect(pendingAfter.length).toBe(0);
  });

  test('persists pin entries to pinned state', async () => {
    const now = new Date().toISOString();
    const fs = createOverlayFs({
      mount: {
        '/agent/home/stories/story-a.md': '# Story A',
      },
    });

    await applyNextNapPins(fs, [
      {
        id: 'next-open-1',
        path: '/agent/home/stories/story-a.md',
        kind: 'file',
        mode: 'full',
        scope: '*',
        source: 'queue',
        createdAt: now,
      },
    ]);

    // Verify pin was persisted to pinned.md
    const pinnedContent = await fs.read(PINNED_PATH);
    const parsed = parseContextFile(pinnedContent);
    const pins = Array.isArray(parsed.meta.pins) ? parsed.meta.pins : [];
    expect(
      pins.some(
        (pin: Record<string, unknown>) =>
          pin.path === '/agent/home/stories/story-a.md',
      ),
    ).toBe(true);
  });

  test('enqueue helper appends pending nap-pin entry', async () => {
    const now = new Date().toISOString();
    const fs = createOverlayFs({
      mount: {
        [NAP_PIN_QUEUE_PATH]: serializeContextFile(
          {
            id: 'nap-pin-queue',
            tags: ['nap', 'queue'],
            created: now,
            updated: now,
            queue: [],
          },
          '',
        ),
      },
    });

    const queued = await enqueueNextNapPin(fs, {
      path: '/agent/home/stories/story-c.md',
      id: 'next-open-queue-1',
    });

    expect(queued.id).toBe('next-open-queue-1');

    const pending = await loadPendingNextNapPins(fs);
    expect(pending.length).toBe(1);
    expect(pending[0]?.path).toBe('/agent/home/stories/story-c.md');
  });

  test('enqueue and consume next nap imprints', async () => {
    const now = new Date().toISOString();
    const fs = createOverlayFs({
      mount: {
        [VFS_PATHS.queue.nextNapImprintQueue]: serializeContextFile(
          {
            id: 'next-nap-imprint-queue',
            tags: ['nap', 'queue'],
            created: now,
            updated: now,
            queue: [],
          },
          '',
        ),
      },
    });

    const imprint = await enqueueNextNapImprint(fs, {
      id: 'imprint-1',
      text: 'Bias toward concise behavior updates in PRINCIPLES.md.',
    });
    expect(imprint.id).toBe('imprint-1');

    const pending = await loadPendingNextNapImprints(fs);
    expect(pending.length).toBe(1);
    expect(pending[0]?.text).toContain('PRINCIPLES.md');

    await consumeNextNapImprints(fs, ['imprint-1']);
    const pendingAfter = await loadPendingNextNapImprints(fs);
    expect(pendingAfter.length).toBe(0);
  });
});
