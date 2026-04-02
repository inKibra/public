/** @jsxImportSource react */
/**
 * FaviconLinks - Favicon and App Icon Links
 *
 * Renders link tags for various favicon and app icon formats.
 */

import type React from 'react';

// ============================================================================
// Types
// ============================================================================

type FaviconLinksProps = {
  /** Path to favicon.ico */
  ico?: string;
  /** Path to 16x16 PNG favicon */
  png16?: string;
  /** Path to 32x32 PNG favicon */
  png32?: string;
  /** Path to Apple Touch Icon (180x180) */
  appleTouchIcon?: string;
  /** Path to Android Chrome 192x192 icon */
  androidChrome192?: string;
  /** Path to Android Chrome 512x512 icon */
  androidChrome512?: string;
  /** Path to web manifest (manifest.json) */
  manifest?: string;
  /** Path to Safari pinned tab SVG */
  safariPinnedTab?: string;
  /** Color for Safari pinned tab */
  safariPinnedTabColor?: string;
  /** Theme color for mobile browsers */
  themeColor?: string;
  /** MS Tile color */
  msTileColor?: string;
};

// ============================================================================
// FaviconLinks
// ============================================================================

/**
 * Renders favicon and app icon link tags.
 *
 * @example
 * ```tsx
 * <FaviconLinks
 *   ico={faviconIco}
 *   png16={favicon16}
 *   png32={favicon32}
 *   appleTouchIcon={appleTouchIcon}
 *   androidChrome192={androidChrome192}
 *   androidChrome512={androidChrome512}
 *   themeColor="#6366f1"
 * />
 * ```
 */
function FaviconLinks({
  ico,
  png16,
  png32,
  appleTouchIcon,
  androidChrome192,
  androidChrome512,
  manifest,
  safariPinnedTab,
  safariPinnedTabColor = '#5bbad5',
  themeColor,
  msTileColor = '#da532c',
}: FaviconLinksProps): React.ReactNode {
  return (
    <>
      {/* Standard favicons */}
      {ico && <link rel="icon" href={ico} />}
      {png16 && <link rel="icon" type="image/png" sizes="16x16" href={png16} />}
      {png32 && <link rel="icon" type="image/png" sizes="32x32" href={png32} />}

      {/* Apple Touch Icon */}
      {appleTouchIcon && (
        <link rel="apple-touch-icon" sizes="180x180" href={appleTouchIcon} />
      )}

      {/* Android Chrome Icons */}
      {androidChrome192 && (
        <link
          rel="icon"
          type="image/png"
          sizes="192x192"
          href={androidChrome192}
        />
      )}
      {androidChrome512 && (
        <link
          rel="icon"
          type="image/png"
          sizes="512x512"
          href={androidChrome512}
        />
      )}

      {/* Web Manifest */}
      {manifest && <link rel="manifest" href={manifest} />}

      {/* Safari Pinned Tab */}
      {safariPinnedTab && (
        <link
          rel="mask-icon"
          href={safariPinnedTab}
          color={safariPinnedTabColor}
        />
      )}

      {/* Theme Color */}
      {themeColor && <meta name="theme-color" content={themeColor} />}

      {/* MS Tile */}
      <meta name="msapplication-TileColor" content={msTileColor} />
    </>
  );
}

export { FaviconLinks, type FaviconLinksProps };
