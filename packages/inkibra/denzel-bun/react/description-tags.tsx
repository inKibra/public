/** @jsxImportSource react */
/**
 * DescriptionTags - SEO and Social Meta Tags
 *
 * Renders a complete set of meta tags for:
 * - Basic SEO (title, description)
 * - Open Graph (Facebook, LinkedIn, etc.)
 * - Twitter Cards
 */

import type React from 'react';

// ============================================================================
// Types
// ============================================================================

type DescriptionTagsProps = {
  /** Page title */
  title: string;
  /** Page description for SEO */
  description: string;
  /** Open Graph / Twitter image URL */
  image?: string;
  /** Canonical URL for this page */
  url?: string;
  /** Site name for Open Graph */
  siteName?: string;
  /** Twitter handle (e.g., '@ToneTempo') */
  twitterHandle?: string;
  /** Open Graph type (default: 'website') */
  ogType?: 'website' | 'article' | 'profile';
  /** Additional keywords for SEO */
  keywords?: string[];
};

// ============================================================================
// DescriptionTags
// ============================================================================

/**
 * Renders SEO and social meta tags.
 *
 * @example
 * ```tsx
 * <DescriptionTags
 *   title="MyApp - Description"
 *   description="Personalized workouts mixed to music"
 *   image="https://example.com/og-image.png"
 *   url="https://example.com"
 *   siteName="MyApp"
 *   twitterHandle="@MyApp"
 * />
 * ```
 *
 * Generates:
 * - `<title>`
 * - `<meta name="description">`
 * - `<meta name="keywords">` (if keywords provided)
 * - Open Graph tags (og:type, og:title, og:description, og:image, og:url, og:site_name)
 * - Twitter Card tags (twitter:card, twitter:site, twitter:title, twitter:description, twitter:image)
 */
function DescriptionTags({
  title,
  description,
  image,
  url,
  siteName,
  twitterHandle,
  ogType = 'website',
  keywords,
}: DescriptionTagsProps): React.ReactNode {
  return (
    <>
      {/* Basic SEO */}
      <title>{title}</title>
      <meta name="description" content={description} />
      {keywords && keywords.length > 0 && (
        <meta name="keywords" content={keywords.join(', ')} />
      )}

      {/* Open Graph */}
      <meta property="og:type" content={ogType} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      {image && <meta property="og:image" content={image} />}
      {url && <meta property="og:url" content={url} />}
      {siteName && <meta property="og:site_name" content={siteName} />}

      {/* Twitter Card */}
      <meta
        name="twitter:card"
        content={image ? 'summary_large_image' : 'summary'}
      />
      {twitterHandle && <meta name="twitter:site" content={twitterHandle} />}
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      {image && <meta name="twitter:image" content={image} />}
    </>
  );
}

export { DescriptionTags, type DescriptionTagsProps };
