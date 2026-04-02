type SocialMetaTagsProps = {
  type?: 'website' | 'article';
  title: string;
  description?: string;
  image?: string;
  url?: string;
  siteName?: string;
  // Article-specific
  author?: string;
  publishedTime?: string;
  tags?: string[];
  // Twitter-specific
  twitterCreator?: string;
  twitterCard?: 'summary' | 'summary_large_image';
};

export function SocialMetaTags(props: SocialMetaTagsProps) {
  const {
    type = 'website',
    title,
    description,
    image,
    url,
    siteName,
    author,
    publishedTime,
    tags,
    twitterCreator,
    twitterCard = 'summary',
  } = props;

  return (
    <>
      {/* OpenGraph meta tags */}
      <meta property="og:type" content={type} />
      <meta property="og:title" content={title} />
      {description && <meta property="og:description" content={description} />}
      {image && <meta property="og:image" content={image} />}
      {url && <meta property="og:url" content={url} />}
      {siteName && <meta property="og:site_name" content={siteName} />}

      {/* Article-specific OpenGraph tags */}
      {type === 'article' && author && (
        <meta property="article:author" content={author} />
      )}
      {type === 'article' && publishedTime && (
        <meta property="article:published_time" content={publishedTime} />
      )}
      {type === 'article' &&
        tags?.map((tag) => (
          <meta key={tag} property="article:tag" content={tag} />
        ))}

      {/* Twitter Card meta tags */}
      <meta name="twitter:card" content={twitterCard} />
      <meta name="twitter:title" content={title} />
      {description && <meta name="twitter:description" content={description} />}
      {image && <meta name="twitter:image" content={image} />}
      {twitterCreator && (
        <meta name="twitter:creator" content={`@${twitterCreator}`} />
      )}
    </>
  );
}
