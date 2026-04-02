/**
 * Blog Backend
 *
 * Blog API handlers with typed implementations.
 * Uses in-memory storage (no external dependencies).
 */

import { createBackend } from '@inkibra/denzel-bun';
import {
  createBlogPostHandlerProvider,
  getBlogPostHandlerProvider,
  listBlogPostsHandlerProvider,
} from '../handlers/blog-handlers';

// ============================================================================
// Dependencies (none for blog)
// ============================================================================

export type BlogBackendDeps = Record<string, never>;

// ============================================================================
// Create Blog Backend
// ============================================================================

/**
 * Create the blog backend with typed handlers
 */
export function createBlogBackend(deps: BlogBackendDeps) {
  return createBackend({
    apiHandlers: {
      listBlogPosts: listBlogPostsHandlerProvider(deps),
      getBlogPost: getBlogPostHandlerProvider(deps),
      createBlogPost: createBlogPostHandlerProvider(deps),
    },
  });
}

// Type for the blog backend
export type BlogBackend = ReturnType<typeof createBlogBackend>;
