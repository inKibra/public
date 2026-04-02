import { describe, expect, test } from 'bun:test';
import {
  filterPreviewSafe,
  isPreviewSafe,
  previewSafe,
  previewUnsafe,
} from './preview-safe';

describe('preview-safe metadata', () => {
  test('previewSafe creates safe metadata', () => {
    const meta = previewSafe();
    expect(meta.safety).toBe('preview-safe');
    expect(isPreviewSafe(meta)).toBe(true);
  });

  test('previewUnsafe creates unsafe metadata with reason', () => {
    const meta = previewUnsafe('Mutates Redis cache');
    expect(meta.safety).toBe('preview-unsafe');
    expect(meta.reason).toBe('Mutates Redis cache');
    expect(isPreviewSafe(meta)).toBe(false);
  });

  test('isPreviewSafe returns false for undefined', () => {
    expect(isPreviewSafe(undefined)).toBe(false);
  });

  test('filterPreviewSafe filters correctly', () => {
    const items = [
      { name: 'safe1', previewSafety: previewSafe() },
      { name: 'unsafe1', previewSafety: previewUnsafe('redis') },
      { name: 'safe2', previewSafety: previewSafe() },
      { name: 'noMeta' },
    ];
    const safe = filterPreviewSafe(items);
    expect(safe).toHaveLength(2);
    expect(safe.map((s) => s.name)).toEqual(['safe1', 'safe2']);
  });
});
