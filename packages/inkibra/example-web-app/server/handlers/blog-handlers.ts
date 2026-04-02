/**
 * Blog API Handlers
 *
 * Implementation of blog API routes using createApiRouteHandlerProvider.
 * Uses in-memory storage (no external dependencies).
 */

import { createApiRouteHandlerProvider } from '@inkibra/denzel-bun';
import {
  createApiRouteHandler,
  SerializableResult,
  StatusCode,
} from '@inkibra/router';
import {
  createBlogPostRoute,
  getBlogPostRoute,
  listBlogPostsRoute,
} from '../../api/routes/blog';
import type { SessionData } from '../../shared/types';
import * as blogDal from '../dal/blog-dal';

// ============================================================================
// Dependencies (none for blog - uses in-memory storage)
// ============================================================================

export type BlogDeps = Record<string, never>;

function getAuthenticatedSession(ctx: {
  session: { type: 'Ok' | 'Err'; value: SessionData | null };
}): SessionData | null {
  if (ctx.session.type === 'Err') {
    return null;
  }

  return ctx.session.value;
}

// ============================================================================
// Handlers
// ============================================================================

/**
 * List all blog posts
 */
export const listBlogPostsHandlerProvider = createApiRouteHandlerProvider(
  (_deps: BlogDeps) =>
    createApiRouteHandler({
      route: listBlogPostsRoute,
      handler: async () => {
        const posts = blogDal.listBlogPosts();
        return SerializableResult.toOk(posts, StatusCode.OK);
      },
    }),
);

/**
 * Get a single blog post by ID
 */
export const getBlogPostHandlerProvider = createApiRouteHandlerProvider(
  (_deps: BlogDeps) =>
    createApiRouteHandler({
      route: getBlogPostRoute,
      handler: async (args) => {
        const post = blogDal.getBlogPost(args.pathParams.postId);

        if (!post) {
          return SerializableResult.toErr(
            { type: 'PostNotFound' as const },
            StatusCode.NOT_FOUND,
          );
        }

        return SerializableResult.toOk(post, StatusCode.OK);
      },
    }),
);

/**
 * Create a new blog post
 */
export const createBlogPostHandlerProvider = createApiRouteHandlerProvider(
  (_deps: BlogDeps) =>
    createApiRouteHandler({
      route: createBlogPostRoute,
      handler: async (args, ctx) => {
        const session = getAuthenticatedSession(ctx);
        // Require authentication
        if (!session) {
          return SerializableResult.toErr(
            { type: 'Unauthorized' as const },
            StatusCode.NOT_AUTHENTICATED,
          );
        }

        const { title, content } = args.body;
        const post = blogDal.createBlogPost(
          title,
          content,
          session.userId,
          session.username,
        );

        return SerializableResult.toOk(post, StatusCode.CREATED);
      },
    }),
);
