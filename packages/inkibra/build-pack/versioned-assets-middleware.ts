/**
 * Versioned Assets Middleware
 *
 * Provides Express middleware for serving versioned assets with lazy build support.
 * Assets are served from /assets/:version/* where version is a build identifier.
 *
 * Features:
 * - Version validation (only serves assets for current version)
 * - Lazy builds in development (triggers builds when assets are missing)
 * - Bundle manifest serving with build triggering
 * - iOS app manifest support
 *
 * @example
 * ```typescript
 * import { createVersionedAssetsMiddleware } from '@inkibra/build-pack';
 *
 * const middleware = createVersionedAssetsMiddleware({
 *   version: getAssetVersion(),
 *   distDir: path.join(__dirname, 'dist'),
 *   buildFrontend: (clientDir) => buildFrontendBundle(clientDir),
 *   buildIos: () => buildIosBundle(),
 *   getManifestPath: (clientDir) => path.join(distDir, clientDir, 'bundle.json'),
 *   getIosManifestPath: () => path.join(distDir, 'ios-app', 'manifest.json'),
 * });
 *
 * // Mount on Denzel router
 * denzelApp.router.use(middleware);
 * ```
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// Generic types to avoid express dependency
// These match Express's interface but don't require the express package
type GenericRequest = {
  method: string;
  path: string;
};

type GenericResponse = {
  status(code: number): GenericResponse;
  send(body: string): void;
  type(contentType: string): GenericResponse;
  setHeader(name: string, value: string): void;
  sendFile(path: string): void;
};

type GenericNextFunction = () => void;

type GenericRouter = {
  use(middleware: GenericMiddleware): void;
};

type GenericMiddleware = (
  req: GenericRequest,
  res: GenericResponse,
  next: GenericNextFunction,
) => void;

export type VersionedAssetsMiddlewareOptions = {
  /**
   * Current asset version string (e.g., git commit hash, build ID)
   */
  version: string;

  /**
   * Directory containing built assets
   */
  distDir: string;

  /**
   * Function to trigger a frontend build for a given client directory.
   * Called when a manifest is requested but doesn't exist.
   */
  buildFrontend: (clientDir: string) => Promise<void>;

  /**
   * Function to trigger an iOS app build.
   * Called when the iOS manifest is requested but doesn't exist.
   */
  buildIos?: () => Promise<void>;

  /**
   * Function to get the manifest path for a given client directory.
   * Defaults to `{distDir}/{clientDir}/bundle.json`
   */
  getManifestPath?: (clientDir: string) => string;

  /**
   * Function to get the iOS manifest path.
   * Defaults to `{distDir}/{iosAppDir}/manifest.json`
   */
  getIosManifestPath?: () => string;

  /**
   * Directory name for the iOS app within distDir.
   * Used for default manifest path, route matching, and build triggering.
   * @default 'ios-app'
   */
  iosAppDir?: string;

  /**
   * Whether to set cache headers for production.
   * @default process.env.NODE_ENV === 'production'
   */
  enableCaching?: boolean;
};

/**
 * Creates Express middleware for serving versioned assets.
 */
export function createVersionedAssetsMiddleware(
  options: VersionedAssetsMiddlewareOptions,
) {
  const {
    version,
    distDir: rawDistDir,
    buildFrontend,
    buildIos,
    enableCaching = process.env.NODE_ENV === 'production',
    iosAppDir = 'ios-app',
  } = options;

  // Normalize distDir to prevent path traversal bypasses
  const distDir = path.resolve(rawDistDir);

  const {
    getManifestPath = (clientDir: string) =>
      path.join(distDir, clientDir, 'bundle.json'),
    getIosManifestPath = () => path.join(distDir, iosAppDir, 'manifest.json'),
  } = options;

  /**
   * Helper to set cache headers
   */
  function setCacheHeaders(res: GenericResponse, immutable = false) {
    if (enableCaching) {
      if (immutable) {
        // Versioned assets are immutable - cache forever
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        // Manifests can be cached for a short time
        res.setHeader('Cache-Control', 'public, max-age=60');
      }
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }

  /**
   * Middleware handler
   */
  return function versionedAssetsMiddleware(
    req: GenericRequest,
    res: GenericResponse,
    next: GenericNextFunction,
  ) {
    // Only handle GET requests to /assets/*
    if (req.method !== 'GET' || !req.path.startsWith('/assets/')) {
      return next();
    }

    const assetPath = req.path.slice('/assets/'.length);

    // Handle /assets/version
    if (assetPath === 'version') {
      res.type('application/json').send(JSON.stringify({ version }));
      return;
    }

    // Parse version from path: /assets/:version/...
    const pathParts = assetPath.split('/');
    const requestedVersion = pathParts[0];
    const remainingPath = pathParts.slice(1).join('/');

    // Version mismatch
    if (requestedVersion !== version) {
      res.status(404).send('Not Found');
      return;
    }

    // Handle bundle.json manifest requests
    if (remainingPath.endsWith('/bundle.json')) {
      const clientDir = remainingPath.slice(0, -'/bundle.json'.length);
      if (!clientDir) {
        res.status(404).send('Not Found');
        return;
      }
      handleManifestRequest(clientDir, res);
      return;
    }

    // Handle iOS manifest request
    if (remainingPath === `${iosAppDir}/manifest.json`) {
      handleIosManifestRequest(res);
      return;
    }

    // Handle static asset requests
    handleStaticAssetRequest(remainingPath, res);
  };

  async function handleManifestRequest(
    clientDir: string,
    res: GenericResponse,
  ) {
    try {
      await buildFrontend(clientDir);
      const manifestPath = getManifestPath(clientDir);

      if (!fs.existsSync(manifestPath)) {
        res.status(404).send('Not Found');
        return;
      }

      const data = fs.readFileSync(manifestPath, 'utf-8');
      setCacheHeaders(res, false);
      res.type('application/json').send(data);
    } catch (error) {
      console.error(`[versioned-assets] Build failed for ${clientDir}:`, error);
      res.status(500).send('Build failed');
    }
  }

  async function handleIosManifestRequest(res: GenericResponse) {
    try {
      if (buildIos) {
        await buildIos();
      }
      const manifestPath = getIosManifestPath();

      if (!fs.existsSync(manifestPath)) {
        res.status(404).send('Not Found');
        return;
      }

      const data = fs.readFileSync(manifestPath, 'utf-8');
      setCacheHeaders(res, false);
      res.type('application/json').send(data);
    } catch (error) {
      console.error('[versioned-assets] iOS build failed:', error);
      res.status(500).send('Build failed');
    }
  }

  async function handleStaticAssetRequest(
    assetPath: string,
    res: GenericResponse,
  ) {
    if (!assetPath) {
      res.status(404).send('Not Found');
      return;
    }
    const resolvedPath = path.resolve(distDir, assetPath);

    // Security: ensure we're not escaping the dist directory
    // Use path.sep suffix to prevent prefix attacks (e.g., /app/dist vs /app/distpwned)
    if (
      !resolvedPath.startsWith(distDir + path.sep) &&
      resolvedPath !== distDir
    ) {
      res.status(403).send('Forbidden');
      return;
    }

    // Try to trigger a build if the file doesn't exist
    if (!fs.existsSync(resolvedPath)) {
      const clientDir = assetPath.split('/')[0] || '';

      if (!clientDir) {
        res.status(404).send('Not Found');
        return;
      }

      try {
        if (clientDir === iosAppDir && buildIos) {
          await buildIos();
        } else if (clientDir && clientDir !== 'assets') {
          await buildFrontend(clientDir);
        }
      } catch (error) {
        console.error(
          `[versioned-assets] Build failed for ${clientDir}:`,
          error,
        );
      }
    }

    if (!fs.existsSync(resolvedPath)) {
      res.status(404).send('Not Found');
      return;
    }

    setCacheHeaders(res, true);
    res.sendFile(resolvedPath);
  }
}

/**
 * Helper to connect versioned assets middleware to a Denzel app.
 *
 * @example
 * ```typescript
 * connectVersionedAssets(denzelApp.router, {
 *   version: getAssetVersion(),
 *   distDir: path.join(__dirname, 'dist'),
 *   buildFrontend: ensureFrontendBuilt,
 *   buildIos: ensureIosBuilt,
 * });
 * ```
 */
export function connectVersionedAssets(
  router: GenericRouter,
  options: VersionedAssetsMiddlewareOptions,
) {
  const middleware = createVersionedAssetsMiddleware(options);
  router.use(middleware);
}
