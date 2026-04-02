/**
 * Blog Data Access Layer
 *
 * In-memory storage for blog posts.
 * For demonstration purposes only.
 */

import type { BlogPost } from '../../shared/types';

// In-memory storage
const posts: Map<string, BlogPost> = new Map();

// Seed some initial posts
const seedPosts: BlogPost[] = [
  {
    id: 'post-1',
    title: 'Welcome to the Blog',
    slug: 'welcome-to-the-blog',
    content: `This is the first post on our new blog. We're excited to share our thoughts on code, design, and everything in between.

Static rendering is a powerful technique that allows us to serve pre-rendered HTML to users, resulting in faster page loads and better SEO. The trade-off is that the content doesn't update dynamically without a page refresh.

In this example, the blog list and individual posts are rendered statically. However, the "Create Post" button is a dynamic component that renders via a portal into the static parent.`,
    authorId: 'user-1',
    authorUsername: 'admin',
    createdAt: '2025-01-15T10:00:00Z',
    updatedAt: '2025-01-15T10:00:00Z',
  },
  {
    id: 'post-2',
    title: 'Understanding Static Islands',
    slug: 'understanding-static-islands',
    content: `Static islands are a novel approach to web rendering that inverts the traditional islands architecture.

Traditional islands (like in Astro or Fresh) have a sea of static HTML with interactive islands. Static islands flip this: a sea of interactive React with islands of static content.

This is perfect for content-heavy sections like blog posts, documentation, or legal text that don't need interactivity but are expensive to send in the JavaScript bundle.

The key insight is that you can preserve SSR HTML on the client side using dangerouslySetInnerHTML, avoiding the need to re-render the component or include its content in the JS bundle.`,
    authorId: 'user-1',
    authorUsername: 'admin',
    createdAt: '2025-01-18T14:30:00Z',
    updatedAt: '2025-01-18T14:30:00Z',
  },
  {
    id: 'post-3',
    title: 'The Portal Pattern for Dynamic Children',
    slug: 'portal-pattern-dynamic-children',
    content: `When you have a static parent component, how do you render dynamic children inside it?

The answer is React Portals. On the server, the static parent renders a placeholder div with a unique ID. On the client, the dynamic child component uses createPortal to render into that placeholder.

This maintains the React context chain while allowing the parent to be completely static. The parent's HTML is preserved, and the child's React tree is mounted into the placeholder.

This pattern is particularly useful when you want most of your page to be static for performance, but still need small interactive elements like buttons, forms, or modals.`,
    authorId: 'user-2',
    authorUsername: 'developer',
    createdAt: '2025-01-20T09:15:00Z',
    updatedAt: '2025-01-20T09:15:00Z',
  },
];

// Initialize with seed data
for (const post of seedPosts) {
  posts.set(post.id, post);
}

// Counter for generating unique IDs
let postCounter = 100;

/**
 * List all blog posts, sorted by creation date (newest first)
 */
export function listBlogPosts(): BlogPost[] {
  return Array.from(posts.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/**
 * Get a blog post by ID
 */
export function getBlogPost(postId: string): BlogPost | null {
  return posts.get(postId) ?? null;
}

/**
 * Create a new blog post
 */
export function createBlogPost(
  title: string,
  content: string,
  authorId: string,
  authorUsername: string,
): BlogPost {
  const id = `post-${++postCounter}`;
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  const now = new Date().toISOString();

  const post: BlogPost = {
    id,
    title,
    slug,
    content,
    authorId,
    authorUsername,
    createdAt: now,
    updatedAt: now,
  };

  posts.set(id, post);
  return post;
}
