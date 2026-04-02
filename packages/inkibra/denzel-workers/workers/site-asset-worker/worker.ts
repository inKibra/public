export interface Env {
  DOMAIN_MAPPINGS_JSON: string;
  INTERCEPT_ALLOWLIST_JSON?: string;
  ASSET_ROOT?: string; // default '/assets'
  CACHE_TTLS_JSON?: string; // { assetsTtl, wellKnownTtl }
  DEPLOY_VERSION?: string;
}

const FAVICON_FILES = new Set([
  '/favicon.ico',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  '/apple-touch-icon.png',
  '/android-chrome-192x192.png',
  '/android-chrome-512x512.png',
]);

function getApex(host: string): string {
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  return parts.slice(-2).join('.');
}

function getMappedDomain(host: string, map: Record<string, string>): string {
  return map[host] ?? getApex(host);
}

function isFaviconPath(pathname: string): boolean {
  return FAVICON_FILES.has(pathname);
}

function apexAssetKey(domain: string, pathname: string): string {
  if (pathname.startsWith('/.well-known/')) {
    const tail = pathname.replace(/^\/.well-known\//, '');
    return `${domain}/.well-known/${tail}`;
  }
  const file = pathname.replace(/^\//, '');
  return `${domain}/favicon/${file}`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const host = url.host;
    const mappings: Record<string, string> = safeParseMap(
      env.DOMAIN_MAPPINGS_JSON,
    );

    // Apex interception: serve known favicon and well-known paths
    const allowlist = safeParseArray(env.INTERCEPT_ALLOWLIST_JSON);
    if (allowlist.includes(url.pathname) || isFaviconPath(url.pathname)) {
      const domain = getMappedDomain(host, mappings);
      const assetPath = `/${(env.ASSET_ROOT || '/assets').replace(/^\//, '')}/${apexAssetKey(domain, url.pathname)}`;
      return await proxyFromOrigin(request, assetPath, env, 'wellKnown');
    }

    // Assets pass-through (long TTL) on same host
    if (url.pathname.startsWith(env.ASSET_ROOT || '/assets')) {
      return await proxyFromOrigin(request, url.pathname, env, 'asset');
    }

    return new Response('Not Found', { status: 404 });
  },
} as unknown as { fetch: (request: Request, env: Env) => Promise<Response> };

async function proxyFromOrigin(
  request: Request,
  assetPath: string,
  env: Env,
  kind: 'asset' | 'wellKnown',
): Promise<Response> {
  const cache = safeParseCache(env.CACHE_TTLS_JSON);
  const target = new URL(request.url);
  target.pathname = assetPath;
  const resp = await fetch(target.toString(), {
    headers: request.headers,
  });
  if (!resp.ok) return new Response('Not Found', { status: 404 });
  const headers = new Headers(resp.headers);
  headers.set(
    'Cache-Control',
    kind === 'wellKnown'
      ? `public, max-age=${cache.wellKnownTtl}`
      : `public, max-age=${cache.assetsTtl}, immutable`,
  );
  return new Response(resp.body, { headers, status: resp.status });
}

function safeParseMap(json: string): Record<string, string> {
  try {
    const v = JSON.parse(json);
    if (v && typeof v === 'object') return v as Record<string, string>;
    return {};
  } catch {
    return {};
  }
}

function safeParseArray(json: string | undefined): string[] {
  try {
    if (!json) return [];
    const v = JSON.parse(json);
    if (Array.isArray(v)) return v as string[];
    return [];
  } catch {
    return [];
  }
}

function safeParseCache(json: string | undefined): {
  assetsTtl: number;
  wellKnownTtl: number;
} {
  try {
    if (!json) return { assetsTtl: 31536000, wellKnownTtl: 3600 };
    const v = JSON.parse(json);
    const assetsTtl = Number(v.assetsTtl) || 31536000;
    const wellKnownTtl = Number(v.wellKnownTtl) || 3600;
    return { assetsTtl, wellKnownTtl };
  } catch {
    return { assetsTtl: 31536000, wellKnownTtl: 3600 };
  }
}
