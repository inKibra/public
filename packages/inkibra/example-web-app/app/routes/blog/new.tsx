/** @jsxImportSource react */
/**
 * Create New Blog Post Form
 *
 * Lazy-loaded form for creating new blog posts.
 * Renders in the Blog layout's main outlet via [PARENT] replacement.
 */

import type { RoutePageProps } from '@inkibra/router';
import { useState } from 'react';
import { appRoutes } from '../../routes';

// V2 Page Props - for [PARENT] replacement route at /blog/new
// Structure: $pages.main.blog.new - [PARENT] replacement shows at same level
type BlogNewProps = RoutePageProps<typeof appRoutes.$pages.main.blog.new>;

export function BlogNewPage({
  apiImplementations,
  navigate,
  ctx,
}: BlogNewProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const result = await apiImplementations.createBlogPost.execute(
        {
          pathParams: {},
          pathQuery: {},
          body: { title, content },
          files: undefined,
        },
        ctx,
      );

      if (result.type === 'Ok') {
        // Navigate to the new post
        navigate(
          appRoutes.$paths.blog[':postId'].getPath({ postId: result.value.id }),
        );
      } else {
        setError('Failed to create post. Please try again.');
      }
    } catch (err) {
      console.error('Failed to create post:', err);
      setError('Failed to create post. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '24px',
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: '24px',
            fontWeight: '600',
            color: '#1a1a1a',
          }}
        >
          Create New Post
        </h2>
        <button
          type="button"
          onClick={() => navigate(appRoutes.$paths.blog.getPath({}))}
          style={{
            padding: '8px 16px',
            background: 'transparent',
            color: '#666',
            border: '1px solid #ddd',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          Cancel
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: '12px',
            background: '#fee',
            border: '1px solid #fcc',
            borderRadius: '4px',
            color: '#c00',
            marginBottom: '16px',
            fontSize: '14px',
          }}
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '16px' }}>
          <label
            htmlFor="title"
            style={{
              display: 'block',
              marginBottom: '8px',
              fontWeight: '500',
              fontSize: '14px',
              color: '#333',
            }}
          >
            Title
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter post title..."
            style={{
              width: '100%',
              padding: '12px',
              fontSize: '16px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label
            htmlFor="content"
            style={{
              display: 'block',
              marginBottom: '8px',
              fontWeight: '500',
              fontSize: '14px',
              color: '#333',
            }}
          >
            Content
          </label>
          <textarea
            id="content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write your post content..."
            rows={15}
            style={{
              width: '100%',
              padding: '12px',
              fontSize: '16px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              resize: 'vertical',
              boxSizing: 'border-box',
              fontFamily: 'inherit',
              lineHeight: 1.6,
            }}
          />
        </div>

        <div
          style={{
            display: 'flex',
            gap: '12px',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="submit"
            disabled={isSubmitting || !title.trim() || !content.trim()}
            style={{
              padding: '12px 24px',
              background: isSubmitting ? '#666' : '#1a1a1a',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: '500',
            }}
          >
            {isSubmitting ? 'Publishing...' : 'Publish Post'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default BlogNewPage;
