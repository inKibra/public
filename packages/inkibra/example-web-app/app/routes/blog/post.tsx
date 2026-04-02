/** @jsxImportSource react */
/**
 * Blog Post Page - Static Rendering
 *
 * This component is rendered statically using strategy.static.
 * On the server, it renders normally. On the client, the SSR HTML
 * is preserved without re-rendering.
 */
import type { RoutePageProps } from '@inkibra/router';
import { Link } from '@inkibra/router/react';
import type { BlogPost } from '../../../shared/types';
import { appRoutes } from '../../routes';

// V2 Page Props - derived from route tree via $pages accessor
// Structure: $pages.main.blog.main[':postId'] - the post detail leaf
type BlogPostPageProps = RoutePageProps<
  (typeof appRoutes.$pages.main.blog.main)[':postId']
>;

function BlogPostPage({ loaderData, navigate }: BlogPostPageProps) {
  const post: BlogPost | null =
    loaderData?.type === 'Ok' ? loaderData.value : null;

  if (!post) {
    return (
      <div
        style={{
          maxWidth: '800px',
          margin: '0 auto',
          padding: '64px 24px',
          textAlign: 'center',
          fontFamily: 'Georgia, serif',
        }}
      >
        <h1
          style={{
            fontSize: '36px',
            fontWeight: '400',
            margin: '0 0 16px 0',
            color: '#1a1a1a',
          }}
        >
          Post Not Found
        </h1>
        <p style={{ fontSize: '18px', color: '#666', margin: '0 0 24px 0' }}>
          The post you&apos;re looking for doesn&apos;t exist or has been
          removed.
        </p>
        <button
          type="button"
          onClick={() => navigate(appRoutes.$paths.blog.getPath({}))}
          style={{
            padding: '12px 24px',
            background: '#1a1a1a',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '16px',
          }}
        >
          Back to Blog
        </button>
      </div>
    );
  }

  return (
    <article
      style={{
        maxWidth: '720px',
        margin: '0 auto',
        padding: '48px 24px',
        fontFamily: 'Georgia, serif',
      }}
    >
      {/* Back link */}
      <nav style={{ marginBottom: '32px' }}>
        <Link
          to={appRoutes.$paths.blog.getPath({})}
          style={{
            color: '#666',
            textDecoration: 'none',
            fontSize: '14px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          ← Back to all posts
        </Link>
      </nav>

      {/* Header */}
      <header style={{ marginBottom: '48px' }}>
        <h1
          style={{
            fontSize: '42px',
            fontWeight: '400',
            lineHeight: 1.2,
            margin: '0 0 24px 0',
            color: '#1a1a1a',
            letterSpacing: '-1px',
          }}
        >
          {post.title}
        </h1>
        <div
          style={{
            fontSize: '16px',
            color: '#666',
            borderBottom: '1px solid #e5e5e5',
            paddingBottom: '24px',
          }}
        >
          <span style={{ fontWeight: '500' }}>{post.authorUsername}</span>
          <span style={{ margin: '0 12px', color: '#ccc' }}>|</span>
          <time dateTime={post.createdAt}>
            {new Date(post.createdAt).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </time>
        </div>
      </header>

      {/* Content */}
      <div
        style={{
          fontSize: '18px',
          lineHeight: 1.8,
          color: '#333',
        }}
      >
        {/* Split content into paragraphs */}
        {post.content.split('\n\n').map((paragraph, index) => (
          <p
            key={index}
            style={{
              margin: '0 0 24px 0',
            }}
          >
            {paragraph}
          </p>
        ))}
      </div>

      {/* Footer */}
      <footer
        style={{
          marginTop: '64px',
          paddingTop: '32px',
          borderTop: '1px solid #e5e5e5',
        }}
      >
        <button
          type="button"
          onClick={() => navigate(appRoutes.$paths.blog.getPath({}))}
          style={{
            padding: '12px 24px',
            background: 'transparent',
            color: '#1a1a1a',
            border: '2px solid #1a1a1a',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '500',
          }}
        >
          ← Read more posts
        </button>
      </footer>
    </article>
  );
}

export default BlogPostPage;
