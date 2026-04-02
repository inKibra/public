/** @jsxImportSource react */
import React from 'react';

/**
 * Higher-order component that creates a "static island" - a component that
 * renders normally on the server but reads from existing DOM on the client.
 *
 * This is the inverse of traditional islands architecture (Astro, Fresh):
 * - Traditional islands: Sea of static HTML with islands of interactivity
 * - Static islands: Sea of interactivity with islands of static content
 *
 * Use this for content that is expensive to send in the JS bundle but should
 * remain in the DOM (blog posts, legal text, etc.).
 *
 * @param Component - The React component to wrap
 * @param getId - Function that returns a unique DOM ID for the component instance
 * @returns A wrapped component that behaves differently on server vs client
 *
 * @example
 * ```tsx
 * const StaticBlogPost = createStaticOnClient(
 *   BlogPostArticle,
 *   (props) => `blog-post-${props.slug}`
 * );
 *
 * // Server: Renders BlogPostArticle normally
 * // Client: Reads HTML from DOM, doesn't re-render BlogPostArticle
 * <StaticBlogPost slug="my-post" content={...} />
 * ```
 */
export function createStaticOnClient<P extends Record<string, unknown>>(
  Component: React.ComponentType<P>,
  getId: (props: P) => string,
): React.ComponentType<P> {
  const displayName = Component.displayName || Component.name || 'Component';

  const StaticOnClientWrapper = (props: P) => {
    const id = getId(props);
    const isServer = typeof window === 'undefined';

    if (isServer) {
      // Server: render component normally, wrapped in container with ID
      return React.createElement(
        'div',
        { id, 'data-static-on-client': 'true' },
        React.createElement(Component, props),
      );
    }

    // Client: read HTML from existing DOM element
    // This avoids re-rendering the component and duplicating HTML in the JS bundle
    const existingHtml =
      typeof window !== 'undefined'
        ? (document.getElementById(id)?.innerHTML ?? '')
        : '';

    return React.createElement('div', {
      id,
      'data-static-on-client': 'true',
      suppressHydrationWarning: true,
      dangerouslySetInnerHTML: { __html: existingHtml },
    });
  };

  StaticOnClientWrapper.displayName = `StaticOnClient(${displayName})`;

  return StaticOnClientWrapper;
}
