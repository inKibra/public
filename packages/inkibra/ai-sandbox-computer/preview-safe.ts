/**
 * Preview-safe route metadata.
 *
 * Routes/handlers declare whether they are safe to call during preview
 * (forked VFS + rollback transaction) or only during commit (real state).
 *
 * Preview-unsafe routes mutate Redis/cache/session state or other
 * non-transactional side stores.
 *
 * See spec §24.5a #6 and §25.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PreviewSafety = 'preview-safe' | 'preview-unsafe';

export type PreviewSafeMetadata = {
  /** Whether this route/handler can be called during preview mode. */
  safety: PreviewSafety;
  /** Human-readable reason why it's unsafe (if applicable). */
  reason?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mark a route/handler as preview-safe.
 * Safe routes only mutate transactional state (DB via Driver, VFS via OverlayFs).
 */
export function previewSafe(): PreviewSafeMetadata {
  return { safety: 'preview-safe' };
}

/**
 * Mark a route/handler as preview-unsafe.
 * Unsafe routes mutate non-transactional state (Redis, cache, session, external APIs).
 */
export function previewUnsafe(reason: string): PreviewSafeMetadata {
  return { safety: 'preview-unsafe', reason };
}

/**
 * Check if a route's metadata indicates it's safe for preview execution.
 */
export function isPreviewSafe(metadata?: PreviewSafeMetadata): boolean {
  return metadata?.safety === 'preview-safe';
}

/**
 * Filter a set of bindings/routes to only those safe for preview.
 */
export function filterPreviewSafe<
  T extends { previewSafety?: PreviewSafeMetadata },
>(items: T[]): T[] {
  return items.filter((item) => isPreviewSafe(item.previewSafety));
}
