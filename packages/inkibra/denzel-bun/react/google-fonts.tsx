/** @jsxImportSource react */
/**
 * GoogleFonts - Google Fonts Integration
 *
 * Renders preconnect and font stylesheet links for Google Fonts.
 */

import type React from 'react';

// ============================================================================
// Types
// ============================================================================

type GoogleFontsProps = {
  /** Font family names to load */
  families: string[];
  /** Font weights to load (default: [400, 500, 600, 700]) */
  weights?: number[];
  /** Whether to include italic variants */
  italic?: boolean;
  /** Display strategy (default: 'swap') */
  display?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional';
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build Google Fonts URL from families and options
 */
function buildGoogleFontsUrl(
  families: string[],
  weights: number[],
  italic: boolean,
  display: string,
): string {
  const familySpecs = families.map((family) => {
    const encodedFamily = family.replace(/ /g, '+');

    // Build weight specifications
    const weightSpec = weights.map((w) => {
      if (italic) {
        return `0,${w};1,${w}`;
      }
      return String(w);
    });

    if (italic) {
      return `family=${encodedFamily}:ital,wght@${weightSpec.join(';')}`;
    }
    return `family=${encodedFamily}:wght@${weightSpec.join(';')}`;
  });

  return `https://fonts.googleapis.com/css2?${familySpecs.join('&')}&display=${display}`;
}

// ============================================================================
// GoogleFonts
// ============================================================================

/**
 * Renders preconnect and stylesheet links for Google Fonts.
 *
 * @example
 * ```tsx
 * // Simple usage
 * <GoogleFonts families={['Inter', 'Orbitron']} />
 *
 * // Custom weights
 * <GoogleFonts
 *   families={['Inter']}
 *   weights={[400, 600, 700]}
 *   italic
 * />
 * ```
 *
 * Generates:
 * ```html
 * <link rel="preconnect" href="https://fonts.googleapis.com" />
 * <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
 * <link href="https://fonts.googleapis.com/css2?family=..." rel="stylesheet" />
 * ```
 */
function GoogleFonts({
  families,
  weights = [400, 500, 600, 700],
  italic = false,
  display = 'swap',
}: GoogleFontsProps): React.ReactNode {
  if (families.length === 0) {
    return <></>;
  }

  const fontsUrl = buildGoogleFontsUrl(families, weights, italic, display);

  return (
    <>
      {/* Preconnect for faster loading */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link
        rel="preconnect"
        href="https://fonts.gstatic.com"
        crossOrigin="anonymous"
      />

      {/* Font stylesheet */}
      <link href={fontsUrl} rel="stylesheet" />
    </>
  );
}

export { GoogleFonts, type GoogleFontsProps };
