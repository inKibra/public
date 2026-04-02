/** @jsxImportSource react */
/**
 * Blog Layout
 *
 * Shows blog header with "Create New" button.
 * Main outlet renders child content (post detail or create form).
 * When main outlet is empty, shows the blog list as fallback.
 */
import type { RoutePageProps } from '@inkibra/router';
import { Link } from '@inkibra/router/react';
import { appRoutes } from '../../routes';

// V2 Page Props - derived from route tree via $pages accessor
// Structure: $pages.main.blog - the blog layout segment
type BlogLayoutProps = RoutePageProps<typeof appRoutes.$pages.main.blog>;

function BlogLayout({ loaderData, getOutlet, emptyOutlets }: BlogLayoutProps) {
  // loaderData type should be inferred from route's loader schema via $pages
  const posts = loaderData?.type === 'Ok' ? loaderData.value : [];

  const MainOutlet = getOutlet('main');
  const isMainEmpty = emptyOutlets.includes('main');

  return (
    <div
      style={{
        maxWidth: '800px',
        margin: '0 auto',
        padding: '32px 24px',
        fontFamily: 'Georgia, serif',
        background: '#fafafa', // Light background for dark text
        minHeight: '100vh',
      }}
    >
      {/* Header */}
      <header
        style={{
          marginBottom: '48px',
          borderBottom: '2px solid #1a1a1a',
          paddingBottom: '24px',
        }}
      >
        <h1
          style={{
            fontSize: '48px',
            fontWeight: '400',
            letterSpacing: '-1px',
            margin: '0 0 8px 0',
            color: '#1a1a1a',
          }}
        >
          The Blog
        </h1>
        <p
          style={{
            fontSize: '18px',
            color: '#666',
            margin: 0,
            fontStyle: 'italic',
          }}
        >
          Thoughts on code, design, and everything in between.
        </p>

        {/* Create New Blog button */}
        <div style={{ marginTop: '16px' }}>
          <Link
            to={appRoutes.$paths.blog.new.getPath({})}
            style={{
              padding: '8px 16px',
              background: '#1a1a1a',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            + New Post
          </Link>
        </div>
      </header>

      {/* Main content area */}
      {isMainEmpty ? (
        /* Fallback: show blog list when no child route */
        posts.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '64px 24px',
              color: '#666',
            }}
          >
            <p style={{ fontSize: '24px', margin: '0 0 8px 0' }}>
              No posts yet
            </p>
            <p style={{ fontSize: '16px', margin: 0 }}>
              Click &quot;+ New Post&quot; to create your first blog post.
            </p>
          </div>
        ) : (
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
            }}
          >
            {posts.map((post) => (
              <li
                key={post.id}
                style={{
                  marginBottom: '40px',
                  paddingBottom: '40px',
                  borderBottom: '1px solid #e5e5e5',
                }}
              >
                <article>
                  <Link
                    to={appRoutes.$paths.blog[':postId'].getPath({
                      postId: post.id,
                    })}
                    style={{
                      textDecoration: 'none',
                      color: 'inherit',
                    }}
                  >
                    <h2
                      style={{
                        fontSize: '28px',
                        fontWeight: '600',
                        margin: '0 0 12px 0',
                        color: '#1a1a1a',
                        lineHeight: 1.3,
                      }}
                    >
                      {post.title}
                    </h2>
                  </Link>
                  <p
                    style={{
                      fontSize: '16px',
                      color: '#666',
                      margin: '0 0 16px 0',
                      lineHeight: 1.6,
                    }}
                  >
                    {post.content.substring(0, 200)}
                    {post.content.length > 200 ? '...' : ''}
                  </p>
                  <div
                    style={{
                      fontSize: '14px',
                      color: '#999',
                    }}
                  >
                    <span>By {post.authorUsername}</span>
                    <span style={{ margin: '0 8px' }}>·</span>
                    <time dateTime={post.createdAt}>
                      {new Date(post.createdAt).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </time>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )
      ) : (
        /* Child route content (post detail or create form) */
        <MainOutlet />
      )}
    </div>
  );
}

export default BlogLayout;
