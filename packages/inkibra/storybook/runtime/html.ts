/**
 * @inkibra/storybook - HTML Templates
 *
 * Minimal HTML templates for chrome and iframe entrypoints.
 */

export type HtmlOptions = {
  scriptSrc: string;
  title?: string;
  /** CSS file paths to inject as <link> tags */
  css?: string[];
  /** Raw HTML strings to inject in <head> */
  head?: string[];
};

/**
 * Generate CSS link tags from paths.
 */
function renderCssLinks(cssPaths: string[]): string {
  return cssPaths
    .map((path) => `  <link rel="stylesheet" href="${escapeHtml(path)}">`)
    .join('\n');
}

/**
 * Generate the chrome (parent window) HTML.
 */
export function renderChromeHtml(options: HtmlOptions): string {
  const { scriptSrc, title = 'Storybook', css = [], head = [] } = options;
  const cssLinks = css.length > 0 ? '\n' + renderCssLinks(css) : '';
  const headContent = head.length > 0 ? '\n  ' + head.join('\n  ') : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; height: 100%; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    #root { height: 100%; }
  </style>${cssLinks}${headContent}
</head>
<body>
  <div id="root"></div>
  <script type="module" src="${escapeHtml(scriptSrc)}"></script>
</body>
</html>`;
}

/**
 * Generate the iframe (story renderer) HTML.
 * This is where stories render, so CSS injection is critical for styling.
 */
export function renderIframeHtml(options: HtmlOptions): string {
  const { scriptSrc, title = 'Story', css = [], head = [] } = options;
  const cssLinks = css.length > 0 ? '\n' + renderCssLinks(css) : '';
  const headContent = head.length > 0 ? '\n  ' + head.join('\n  ') : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; min-height: 100%; }
  </style>${cssLinks}${headContent}
</head>
<body>
  <div id="root" data-storybook-root></div>
  <script type="module" src="${escapeHtml(scriptSrc)}"></script>
</body>
</html>`;
}

/**
 * Basic HTML escaping.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}
