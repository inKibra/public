/**
 * @inkibra/storybook - Server
 *
 * Bun server that serves:
 * - GET / → Chrome HTML (story list + iframe container)
 * - GET /__sb/iframe.html → Iframe HTML (story renderer)
 * - GET /__sb/manifest.json → Manifest JSON
 * - GET /dist/* → Static bundles (or JIT compiled)
 * - GET /__sb/css/* → CSS files from configured paths
 *
 * JIT Mode (default):
 * Bundles are compiled on-demand when requested.
 * Use --no-jit for pre-built bundles.
 *
 * Configuration:
 * Build options (plugins, css, head, preload) are loaded from storybook.config.ts
 */

import type { BunPlugin } from 'bun';
import { isAbsolute, join } from 'path';
import { loadConfig } from '../discovery';
import { getManifest } from '../plugin';
import { renderChromeHtml, renderIframeHtml } from '../runtime/html';
import {
  type BuildResult,
  buildStorybookRuntime,
  type PreloadResult,
} from './build';
import { jitCompileBundle } from './jit-builder';

export type ServeOptions = {
  /** Package root directory (defaults to cwd) */
  packageRoot?: string;
  /** Port to listen on (defaults to 6006) */
  port?: number;
  /** Host to bind to (defaults to localhost) */
  host?: string;
  /** Whether to auto-rebuild on start (ignored if jit=true) */
  build?: boolean;
  /**
   * Enable JIT (Just-In-Time) compilation mode.
   * When true (default), bundles are compiled on-demand when requested.
   * Set to false to use pre-built bundles instead.
   */
  jit?: boolean;
  /** Enable verbose logging */
  verbose?: boolean;
};

function installCtrlCKeypressShutdownFallback(input: {
  shutdown: () => Promise<void>;
}): () => void {
  const stdin = process.stdin as NodeJS.ReadStream & {
    isRaw?: boolean;
    setRawMode?: (mode: boolean) => void;
  };

  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    return () => {};
  }

  const wasRawMode = Boolean(stdin.isRaw);
  let isAwaitingConfirmation = false;
  let isShuttingDown = false;

  const cleanup = () => {
    stdin.off('data', onData);
    if (!wasRawMode) {
      stdin.setRawMode(false);
    }
  };

  const requestShutdownAndExit = async () => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    process.stdout.write('\nShutting down storybook server...\n');

    try {
      await input.shutdown();
      process.stdout.write('Shutdown complete; exiting process\n');
      process.exit(0);
    } catch (error) {
      console.error('Shutdown failed; exiting process', error);
      process.exit(1);
    }
  };

  const onData = (chunk: Buffer | string) => {
    if (isShuttingDown) {
      return;
    }

    const value = typeof chunk === 'string' ? chunk : chunk.toString('utf8');

    if (isAwaitingConfirmation) {
      if (value.includes('\u0003') || value.toLowerCase().includes('y')) {
        void requestShutdownAndExit();
        return;
      }

      if (
        value.toLowerCase().includes('n') ||
        value.includes('\r') ||
        value.includes('\n') ||
        value.includes('\u001b')
      ) {
        isAwaitingConfirmation = false;
        process.stdout.write('Shutdown cancelled.\n');
      }

      return;
    }

    if (!value.includes('\u0003')) {
      return;
    }

    isAwaitingConfirmation = true;
    process.stdout.write(
      '\nCtrl+C detected. Close server? [y/N] (or press Ctrl+C again)\n',
    );
  };

  if (!wasRawMode) {
    stdin.setRawMode(true);
  }
  stdin.resume();
  stdin.on('data', onData);

  return cleanup;
}

/**
 * Create and start the storybook server.
 */
export async function serveStorybook(
  options: ServeOptions = {},
): Promise<void> {
  const packageRoot = options.packageRoot ?? process.cwd();
  const port = options.port ?? 6006;
  const host = options.host ?? 'localhost';
  const jitMode = options.jit ?? true; // JIT is the default
  const shouldBuild = jitMode ? false : (options.build ?? true);
  const verbose = options.verbose ?? false;

  const log = verbose ? console.log.bind(console) : () => {};
  const distDir = join(packageRoot, 'dist');

  // Load storybook config
  const config = await loadConfig(packageRoot);
  const buildConfig = config?.build;

  // Run preload if configured (for both JIT and prebuild modes)
  let preloadResult: PreloadResult = {};
  if (buildConfig?.preload) {
    console.log('[storybook] Running preload...');
    preloadResult = await buildConfig.preload();
    console.log('[storybook] Preload complete');
  }

  // Merge plugins from config and preload
  const plugins: BunPlugin[] = [
    ...(buildConfig?.plugins ?? []),
    ...(preloadResult.plugins ?? []),
  ];

  // Merge CSS paths from config and preload
  const cssPaths: string[] = [
    ...(buildConfig?.css ?? []),
    ...(preloadResult.css ?? []),
  ];

  // Merge head content from config and preload
  const headContent: string[] = [
    ...(buildConfig?.head ?? []),
    ...(preloadResult.head ?? []),
  ];

  // Build if requested (not in JIT mode)
  let buildResult: BuildResult | null = null;
  if (shouldBuild) {
    console.log('[storybook] Building runtime...');
    buildResult = await buildStorybookRuntime({
      packageRoot,
      plugins,
      css: cssPaths,
      head: headContent,
    });
    console.log('[storybook] Build complete');
  }

  // Get manifest for the JSON endpoint
  const { manifest } = await getManifest(packageRoot);

  // Convert CSS paths to serveable URLs
  const cssUrls = cssPaths.map((_, i) => `/__sb/css/${i}.css`);

  // Create a map from URL to file path for serving CSS
  const cssFileMap = new Map<string, string>();
  cssPaths.forEach((filePath, i) => {
    const absolutePath = isAbsolute(filePath)
      ? filePath
      : join(packageRoot, filePath);
    cssFileMap.set(`/__sb/css/${i}.css`, absolutePath);
  });

  // Pre-render HTML templates
  const chromeHtml = renderChromeHtml({
    scriptSrc: buildResult?.chromeBundle ?? '/dist/chrome.js',
    title: 'Storybook',
    css: cssUrls,
    head: headContent,
  });

  const iframeHtml = renderIframeHtml({
    scriptSrc: buildResult?.iframeBundle ?? '/dist/iframe.js',
    title: 'Story',
    css: cssUrls,
    head: headContent,
  });

  const manifestJson = JSON.stringify(manifest, null, 2);

  const server = Bun.serve({
    port,
    hostname: host,

    async fetch(req) {
      const url = new URL(req.url);
      const pathname = url.pathname;

      // Chrome app (root)
      if (pathname === '/' || pathname === '/index.html') {
        return new Response(chromeHtml, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      // Iframe app
      if (pathname === '/__sb/iframe.html') {
        return new Response(iframeHtml, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      // Manifest JSON
      if (pathname === '/__sb/manifest.json') {
        return new Response(manifestJson, {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // CSS files from configured paths
      if (pathname.startsWith('/__sb/css/')) {
        const cssFilePath = cssFileMap.get(pathname);
        if (cssFilePath) {
          const file = Bun.file(cssFilePath);
          if (await file.exists()) {
            return new Response(file, {
              headers: { 'Content-Type': 'text/css' },
            });
          }
        }
        return new Response('CSS not found', { status: 404 });
      }

      // JIT compiled bundles
      if (jitMode && pathname === '/dist/chrome.js') {
        try {
          const result = await jitCompileBundle('chrome', {
            packageRoot,
            plugins,
            verbose,
          });

          return new Response(result.js, {
            headers: {
              'Content-Type': 'application/javascript',
              'X-JIT-Timestamp': result.timestamp.toString(),
            },
          });
        } catch (error) {
          console.error('[JIT] Chrome build failed:', error);
          return new Response(`console.error("JIT build failed: ${error}")`, {
            status: 500,
            headers: { 'Content-Type': 'application/javascript' },
          });
        }
      }

      if (jitMode && pathname === '/dist/iframe.js') {
        try {
          const result = await jitCompileBundle('iframe', {
            packageRoot,
            plugins,
            verbose,
          });

          return new Response(result.js, {
            headers: {
              'Content-Type': 'application/javascript',
              'X-JIT-Timestamp': result.timestamp.toString(),
            },
          });
        } catch (error) {
          console.error('[JIT] Iframe build failed:', error);
          return new Response(`console.error("JIT build failed: ${error}")`, {
            status: 500,
            headers: { 'Content-Type': 'application/javascript' },
          });
        }
      }

      // Static assets from dist/ (non-JIT mode)
      if (pathname.startsWith('/dist/')) {
        const filePath = join(distDir, pathname.slice(6)); // Remove '/dist/'
        const file = Bun.file(filePath);

        if (await file.exists()) {
          const ext = filePath.split('.').pop();
          const contentType = getContentType(ext);

          return new Response(file, {
            headers: { 'Content-Type': contentType },
          });
        }

        return new Response('Not found', { status: 404 });
      }

      // 404 for anything else
      return new Response('Not found', { status: 404 });
    },
  });

  const cleanupCtrlC = installCtrlCKeypressShutdownFallback({
    shutdown: async () => {
      server.stop(true);
    },
  });

  process.once('exit', cleanupCtrlC);

  if (jitMode) {
    console.log(`[storybook] JIT server running at http://${host}:${port}`);
    console.log('[storybook] Bundles will be compiled on-demand');
  } else {
    console.log(`[storybook] Server running at http://${host}:${port}`);
  }
  console.log(`[storybook] Stories: ${manifest.length}`);
  if (cssPaths.length > 0) {
    console.log(`[storybook] CSS files: ${cssPaths.length}`);
  }
}

/**
 * Get content type for file extension.
 */
function getContentType(ext: string | undefined): string {
  switch (ext) {
    case 'js':
    case 'mjs':
      return 'application/javascript';
    case 'css':
      return 'text/css';
    case 'json':
      return 'application/json';
    case 'html':
      return 'text/html';
    case 'svg':
      return 'image/svg+xml';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'woff':
      return 'font/woff';
    case 'woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}

// CLI entrypoint
if (import.meta.main) {
  const args = process.argv.slice(2);
  const options: ServeOptions = {};

  // Parse simple CLI args
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;

    if (arg === '--port' || arg === '-p') {
      const portArg = args[++i];
      if (portArg) options.port = parseInt(portArg, 10);
    } else if (arg === '--host') {
      const hostArg = args[++i];
      if (hostArg) options.host = hostArg;
    } else if (arg === '--no-build') {
      options.build = false;
    } else if (arg === '--no-jit') {
      options.jit = false;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (!arg.startsWith('-')) {
      options.packageRoot = arg;
    }
  }

  serveStorybook(options).catch((err) => {
    console.error('[storybook] Server error:', err);
    process.exit(1);
  });
}
