/// <reference types="@cloudflare/workers-types" />
/**
 * Site Asset Worker
 *
 * Cloudflare Worker for caching client assets and manifests with:
 * - Multi-origin support (hostname → origin mapping)
 * - R2 persistent storage
 * - Stale-while-revalidate for manifests
 * - Durable Object locking to prevent thundering herd
 * - Version-aware revalidation
 */

import {
  DEFAULT_CACHE_TTLS,
  type OriginMapping,
  type SiteAssetWorkerEnv,
} from './config';

// ============================================================================
// Types
// ============================================================================

type CacheConfig = {
  assetsTtl: number;
  manifestTtl: number;
  manifestStaleWhileRevalidate: number;
};

// ============================================================================
// Durable Object: ManifestLock
// ============================================================================

/**
 * Durable Object for coordinating manifest fetches.
 * Prevents thundering herd - only ONE request goes to origin at a time.
 *
 * Simple lock: tryAcquire / release
 */
export class ManifestLock {
  private locked = false;

  // Required by Cloudflare but we don't use storage
  constructor(_state: DurableObjectState, _env: SiteAssetWorkerEnv) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    if (action === 'tryAcquire') {
      if (this.locked) {
        return new Response('locked', { status: 409 });
      }
      this.locked = true;
      return new Response('acquired', { status: 200 });
    }

    if (action === 'release') {
      this.locked = false;
      return new Response('released', { status: 200 });
    }

    return new Response('Invalid action', { status: 400 });
  }
}

// ============================================================================
// Main Worker
// ============================================================================

export default {
  async fetch(
    request: Request,
    env: SiteAssetWorkerEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const hostname = url.hostname;

    // Parse origin mappings
    const origins = parseOrigins(env.ORIGINS_JSON);
    const origin = origins[hostname];

    if (!origin) {
      return new Response('Unknown host', { status: 404 });
    }

    const cacheConfig = parseCacheConfig(env.CACHE_TTLS_JSON);

    // Determine if this is a manifest or asset request
    const isManifest = isManifestPath(url.pathname);

    if (isManifest) {
      return handleManifestRequest(request, env, origin, url, cacheConfig);
    }
    return handleAssetRequest(request, env, ctx, origin, url, cacheConfig);
  },
};

// ============================================================================
// Request Handlers
// ============================================================================

async function handleManifestRequest(
  _request: Request,
  env: SiteAssetWorkerEnv,
  origin: OriginMapping,
  url: URL,
  cacheConfig: CacheConfig,
): Promise<Response> {
  const r2Key = buildR2Key(origin.originId, url.pathname);
  const manifestObject = await env.ASSET_BUCKET.get(r2Key);
  if (!manifestObject) {
    return new Response('Manifest not found', { status: 404 });
  }

  const body = await manifestObject.text();
  let version = 'unknown';
  try {
    const parsed = JSON.parse(body) as { version?: string };
    if (parsed.version) {
      version = parsed.version;
    }
  } catch {
    // Ignore parse errors; serve raw body
  }

  return buildManifestResponse(body, version, cacheConfig, 0, 'hit', 'fresh');
}

async function handleAssetRequest(
  request: Request,
  env: SiteAssetWorkerEnv,
  ctx: ExecutionContext,
  origin: OriginMapping,
  url: URL,
  cacheConfig: CacheConfig,
): Promise<Response> {
  const r2Key = buildR2Key(origin.originId, url.pathname);

  // Check Cloudflare cache first
  const cache = (caches as CacheStorage & { default: Cache }).default;
  const cacheKey = new Request(url.toString(), request);
  const cached = await cache.match(cacheKey);

  if (cached) {
    // Create new response with edge cache indicator
    const headers = new Headers(cached.headers);
    headers.set('X-Cache-Storage', 'edge');
    return new Response(cached.body, {
      status: cached.status,
      statusText: cached.statusText,
      headers,
    });
  }

  // Check R2
  const r2Object = await env.ASSET_BUCKET.get(r2Key);

  if (r2Object) {
    const response = buildR2Response(r2Object, cacheConfig);
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  }
  return new Response('Not Found', { status: 404 });
}

// ============================================================================
// Response Builders
// ============================================================================

function buildManifestResponse(
  body: string,
  version: string,
  cacheConfig: CacheConfig,
  age: number,
  cacheSource: 'hit' | 'miss' = 'miss',
  cacheStatus: 'fresh' | 'stale' | 'revalidated' | 'fetched' = 'fetched',
): Response {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'X-Version': version,
    'Cache-Control': `public, max-age=${cacheConfig.manifestTtl}, stale-while-revalidate=${cacheConfig.manifestStaleWhileRevalidate}`,
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    Age: String(Math.floor(age)),
    // Debug headers to indicate worker served this
    'X-Cache-Source': 'site-asset-worker',
    'X-Cache-Hit': cacheSource,
    'X-Cache-Status': cacheStatus,
  });

  return new Response(body, { headers });
}

function buildR2Response(
  object: R2ObjectBody,
  cacheConfig: CacheConfig,
): Response {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag || object.etag || '');
  headers.set(
    'Cache-Control',
    `public, max-age=${cacheConfig.assetsTtl}, immutable`,
  );
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  headers.set('Timing-Allow-Origin', '*');
  // Debug headers
  headers.set('X-Cache-Source', 'site-asset-worker');
  headers.set('X-Cache-Hit', 'hit');
  headers.set('X-Cache-Storage', 'r2');

  return new Response(object.body, { headers });
}

// ============================================================================
// Utility Functions
// ============================================================================

function parseOrigins(json: string): Record<string, OriginMapping> {
  try {
    return JSON.parse(json) as Record<string, OriginMapping>;
  } catch {
    return {};
  }
}

function parseCacheConfig(json: string | undefined): CacheConfig {
  try {
    if (!json) return { ...DEFAULT_CACHE_TTLS };
    const parsed = JSON.parse(json) as Partial<CacheConfig>;
    return {
      assetsTtl: parsed.assetsTtl ?? DEFAULT_CACHE_TTLS.assetsTtl,
      manifestTtl: parsed.manifestTtl ?? DEFAULT_CACHE_TTLS.manifestTtl,
      manifestStaleWhileRevalidate:
        parsed.manifestStaleWhileRevalidate ??
        DEFAULT_CACHE_TTLS.manifestStaleWhileRevalidate,
    };
  } catch {
    return { ...DEFAULT_CACHE_TTLS };
  }
}

function isManifestPath(pathname: string): boolean {
  return (
    /\/manifest-[^/]+\.json$/.test(pathname) ||
    pathname === '/.ios-app-manifest.json' ||
    pathname === '/.ios-app-bundle-manifest.json'
  );
}

function buildR2Key(originId: string, pathname: string): string {
  // Remove leading slash and combine with origin ID
  const path = pathname.replace(/^\//, '');
  return `${originId}/${path}`;
}
