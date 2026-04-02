type R2Bucket = any;
type R2ObjectBody = any;
type DurableObjectState = any;
type DurableObjectNamespace = any;
type ExecutionContext = any;

export interface Env {
  ASSET_ORIGIN_BASE: string; // origin server base url (dev/prod), e.g. https://example.com
  ASSET_ROOT?: string; // default '/assets'
  ASSET_BUILD_TOKEN?: string; // bearer token for build trigger
  ASSET_LATEST_KEY?: string; // default 'assets/latest.json'
  BUILD_ENDPOINT?: string; // default '/_internal/assets/build'
  ASSET_CACHE_TTLS_JSON?: string; // { assetsTtl, manifestTtl }
  ASSET_BASE_OVERRIDE?: string; // optional override for manifest rewrite base
  ASSET_BUCKET: R2Bucket;
  IOS_APP_DIR?: string; // directory name for iOS app (default: 'ios-app')
  ASSET_BUILD_LOCK: DurableObjectNamespace;
}

type CacheConfig = {
  assetsTtl: number;
  manifestTtl: number;
};

const DEFAULT_ASSET_ROOT = '/assets';
const DEFAULT_LATEST_KEY = 'assets/latest.json';
const DEFAULT_BUILD_ENDPOINT = '/_internal/assets/build';

export class AssetBuildLock {
  state: DurableObjectState;
  env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const version = url.searchParams.get('version');
    if (!version) {
      return new Response('Missing version', { status: 400 });
    }

    return this.state.blockConcurrencyWhile(async () => {
      const key = `build:${version}`;
      const existing = await this.state.storage.get(key);
      if (existing === 'done') {
        return new Response('ok', { status: 200 });
      }

      await this.state.storage.put(key, 'building');
      try {
        const buildResponse = await triggerBuild(this.env, version);
        if (!buildResponse.ok) {
          await this.state.storage.delete(key);
          return new Response('Build failed', { status: 500 });
        }
        await this.state.storage.put(key, 'done');
        return new Response('ok', { status: 200 });
      } catch (error) {
        await this.state.storage.delete(key);
        return new Response(`Build error: ${String(error)}`, { status: 500 });
      }
    });
  }
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const assetRoot = env.ASSET_ROOT || DEFAULT_ASSET_ROOT;

    const iosAppDir = env.IOS_APP_DIR || 'ios-app';
    if (url.pathname === `/${iosAppDir}/manifest.json`) {
      return await handleStableManifest(request, env, ctx, assetRoot);
    }

    if (!url.pathname.startsWith(assetRoot)) {
      return new Response('Not Found', { status: 404 });
    }

    const cacheKey = new Request(url.toString(), request);
    const cache = (caches as any).default ?? caches;
    const cached = await cache.match(cacheKey);
    if (cached) {
      return cached;
    }

    const bucketKey = stripAssetRoot(url.pathname, assetRoot);
    const r2Object = await env.ASSET_BUCKET.get(bucketKey);
    if (r2Object) {
      const response = buildR2Response(r2Object);
      const withHeaders = applyCacheHeaders(
        response,
        getCacheConfig(env),
        'asset',
      );
      ctx.waitUntil(cache.put(cacheKey, withHeaders.clone()));
      return withHeaders;
    }

    const version = extractVersion(url.pathname, assetRoot);
    if (!version) {
      return new Response('Not Found', { status: 404 });
    }

    const lockResponse = await ensureBuild(env, version);
    if (!lockResponse.ok) {
      return new Response('Build failed', { status: 500 });
    }

    // Re-fetch from origin and upload to R2
    const originAssetUrl = new URL(
      url.pathname,
      env.ASSET_ORIGIN_BASE,
    ).toString();
    const originResponse = await fetch(originAssetUrl, {
      headers: request.headers,
    });
    if (!originResponse.ok) {
      return new Response('Not Found', { status: 404 });
    }

    const body = await originResponse.clone().arrayBuffer();
    await env.ASSET_BUCKET.put(bucketKey, body, {
      httpMetadata: {
        contentType:
          originResponse.headers.get('Content-Type') ||
          'application/octet-stream',
      },
    });

    const response = new Response(body, { headers: originResponse.headers });
    const withHeaders = applyCacheHeaders(
      response,
      getCacheConfig(env),
      'asset',
    );
    ctx.waitUntil(cache.put(cacheKey, withHeaders.clone()));
    return withHeaders;
  },
};

async function handleStableManifest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  assetRoot: string,
): Promise<Response> {
  const cache = (caches as any).default ?? caches;
  const cacheKey = new Request(request.url, request);
  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached;
  }

  const latestKey = env.ASSET_LATEST_KEY || DEFAULT_LATEST_KEY;
  let version = await readLatestVersion(env, latestKey);
  if (!version) {
    version = await fetchOriginVersion(env);
    if (!version) {
      return new Response('Not Found', { status: 404 });
    }
  }

  const buildResponse = await ensureBuild(env, version);
  if (!buildResponse.ok) {
    return new Response('Build failed', { status: 500 });
  }

  await writeLatestVersion(env, latestKey, version);

  const iosAppDir = env.IOS_APP_DIR || 'ios-app';
  const manifestPath = `${assetRoot}/${version}/${iosAppDir}/manifest.json`;
  const originUrl = new URL(manifestPath, env.ASSET_ORIGIN_BASE).toString();
  const originResponse = await fetch(originUrl);
  if (!originResponse.ok) {
    return new Response('Not Found', { status: 404 });
  }

  const body = await originResponse.clone().arrayBuffer();
  const bucketKey = stripAssetRoot(manifestPath, assetRoot);
  await env.ASSET_BUCKET.put(bucketKey, body, {
    httpMetadata: {
      contentType:
        originResponse.headers.get('Content-Type') || 'application/json',
    },
  });

  const response = new Response(body, { headers: originResponse.headers });
  const withHeaders = applyCacheHeaders(
    response,
    getCacheConfig(env),
    'manifest',
  );
  ctx.waitUntil(cache.put(cacheKey, withHeaders.clone()));
  return withHeaders;
}

function stripAssetRoot(pathname: string, assetRoot: string): string {
  const trimmed = pathname.replace(assetRoot, '').replace(/^\//, '');
  return trimmed;
}

function extractVersion(pathname: string, assetRoot: string): string | null {
  const trimmed = stripAssetRoot(pathname, assetRoot);
  const [version] = trimmed.split('/');
  return version || null;
}

function getCacheConfig(env: Env): CacheConfig {
  try {
    if (!env.ASSET_CACHE_TTLS_JSON) {
      return { assetsTtl: 31536000, manifestTtl: 3600 };
    }
    const parsed = JSON.parse(env.ASSET_CACHE_TTLS_JSON) as CacheConfig;
    return {
      assetsTtl: Number(parsed.assetsTtl) || 31536000,
      manifestTtl: Number(parsed.manifestTtl) || 3600,
    };
  } catch {
    return { assetsTtl: 31536000, manifestTtl: 3600 };
  }
}

function applyCacheHeaders(
  response: Response,
  cache: CacheConfig,
  kind: 'asset' | 'manifest',
): Response {
  const headers = new Headers(response.headers);
  const ttl = kind === 'manifest' ? cache.manifestTtl : cache.assetsTtl;
  headers.set('Cache-Control', `public, max-age=${ttl}, immutable`);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  headers.set('Timing-Allow-Origin', '*');
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

async function triggerBuild(env: Env, version: string): Promise<Response> {
  const buildEndpoint = env.BUILD_ENDPOINT || DEFAULT_BUILD_ENDPOINT;
  const buildUrl = new URL(buildEndpoint, env.ASSET_ORIGIN_BASE);
  buildUrl.searchParams.set('version', version);
  const headers: HeadersInit = {};
  if (env.ASSET_BUILD_TOKEN) {
    headers.Authorization = `Bearer ${env.ASSET_BUILD_TOKEN}`;
  }
  return await fetch(buildUrl.toString(), {
    method: 'POST',
    headers,
  });
}

async function ensureBuild(env: Env, version: string): Promise<Response> {
  const doId = env.ASSET_BUILD_LOCK.idFromName(version);
  const durable = env.ASSET_BUILD_LOCK.get(doId);
  const lockUrl = new URL('https://asset-lock.local/');
  lockUrl.searchParams.set('version', version);
  return await durable.fetch(lockUrl.toString());
}

async function readLatestVersion(
  env: Env,
  latestKey: string,
): Promise<string | null> {
  const obj = await env.ASSET_BUCKET.get(latestKey);
  if (!obj) return null;
  try {
    const data = JSON.parse(await obj.text()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

async function writeLatestVersion(
  env: Env,
  latestKey: string,
  version: string,
): Promise<void> {
  await env.ASSET_BUCKET.put(latestKey, JSON.stringify({ version }), {
    httpMetadata: { contentType: 'application/json' },
  });
}

async function fetchOriginVersion(env: Env): Promise<string | null> {
  const versionUrl = new URL('/assets/version', env.ASSET_ORIGIN_BASE);
  const response = await fetch(versionUrl.toString());
  if (!response.ok) return null;
  try {
    const data = (await response.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

function buildR2Response(object: R2ObjectBody): Response {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag || object.etag || '');
  return new Response(object.body, { headers });
}
