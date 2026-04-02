/**
 * Blog API Routes
 *
 * CRUD operations for blog posts (in-memory storage)
 */

import { createAPIRoute } from '@inkibra/router';
import { HttpMethod } from '@inkibra/router/constants/http-method';
import type { CreateBlogPost, GetBlogPost, ListBlogPosts } from '../../schemas';
import {
  createBlogPostSchema as createBlogPostRouteSchema,
  getBlogPostSchema as getBlogPostRouteSchema,
  listBlogPostsSchema as listBlogPostsRouteSchema,
} from '../../schemas';
import { SessionCodec } from './auth';

// ============================================================================
// List Blog Posts
// ============================================================================

export const listBlogPostsSchema = listBlogPostsRouteSchema;

export const listBlogPostsRoute = createAPIRoute({
  name: 'listBlogPosts',
  method: HttpMethod.GET,
  path: '/api/blog',
  schema: listBlogPostsSchema,
  // No session required - blog is public
});

// ============================================================================
// Get Blog Post
// ============================================================================

export const getBlogPostSchema = getBlogPostRouteSchema;

export const getBlogPostRoute = createAPIRoute({
  name: 'getBlogPost',
  method: HttpMethod.GET,
  path: '/api/blog/:postId',
  schema: getBlogPostSchema,
  // No session required - blog is public
});

// ============================================================================
// Create Blog Post
// ============================================================================

export const createBlogPostSchema = createBlogPostRouteSchema;

export const createBlogPostRoute = createAPIRoute({
  name: 'createBlogPost',
  method: HttpMethod.POST,
  path: '/api/blog',
  schema: createBlogPostSchema,
  contextCodec: { session: SessionCodec },
});

// ============================================================================
// Export Types and Routes
// ============================================================================

export type { ListBlogPosts, GetBlogPost, CreateBlogPost };

export const blogRoutes = {
  listBlogPosts: listBlogPostsRoute,
  getBlogPost: getBlogPostRoute,
  createBlogPost: createBlogPostRoute,
};
