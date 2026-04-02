/// <reference types="@cloudflare/workers-types" />
/**
 * Site Asset Worker Configuration
 *
 * Supports multiple origins with hostname-based routing.
 * Each origin can have multiple hosts with different route patterns.
 */

export type SiteAssetWorkerHost = {
  /** Hostname pattern, e.g., "example.com" or "ota.example.com" */
  pattern: string;
  /** Route patterns this host handles, e.g., ["/manifest*", "/dist/*"] */
  routes: string[];
};

export type SiteAssetWorkerOrigin = {
  /** Origin server base URL, e.g., "https://example.com" */
  url: string;
  /** Cloudflare zone name for route binding */
  zoneName: string;
  /** Hosts that route to this origin */
  hosts: SiteAssetWorkerHost[];
};

export type SiteAssetWorkerConfig = {
  /** Worker name for deployment */
  name: string;
  /** R2 bucket name for asset storage */
  r2Bucket: string;
  /** Origins keyed by identifier (e.g., "example", "inkibra") */
  origins: Record<string, SiteAssetWorkerOrigin>;
  /** Cache TTL configuration */
  cacheTtls?: {
    /** TTL for hashed assets in seconds (default: 31536000 = 1 year) */
    assetsTtl: number;
    /** TTL for manifests in seconds (default: 60) */
    manifestTtl: number;
    /** Stale-while-revalidate window for manifests (default: 300 = 5 min) */
    manifestStaleWhileRevalidate: number;
  };
  /** Wrangler compatibility date (default: "2024-10-01") */
  compatibilityDate?: string;
};

/**
 * Runtime environment bindings for the worker
 */
export type SiteAssetWorkerEnv = {
  /** JSON-encoded origin config: Record<hostname, { originUrl, originId }> */
  ORIGINS_JSON: string;
  /** JSON-encoded cache TTLs */
  CACHE_TTLS_JSON?: string;
  /** R2 bucket binding */
  ASSET_BUCKET: R2Bucket;
  /** Durable Object for manifest build locking */
  MANIFEST_LOCK: DurableObjectNamespace;
};

/**
 * Parsed origin mapping used at runtime
 */
export type OriginMapping = {
  originUrl: string;
  originId: string;
};

/**
 * Default cache TTLs
 */
export const DEFAULT_CACHE_TTLS = {
  assetsTtl: 31536000, // 1 year
  manifestTtl: 60, // 1 minute
  manifestStaleWhileRevalidate: 300, // 5 minutes
} as const;

/**
 * Parse origins config into hostname → origin mapping
 */
export function buildOriginMappings(
  origins: Record<string, SiteAssetWorkerOrigin>,
): Record<string, OriginMapping> {
  const mappings: Record<string, OriginMapping> = {};

  for (const [originId, origin] of Object.entries(origins)) {
    for (const host of origin.hosts) {
      mappings[host.pattern] = {
        originUrl: origin.url,
        originId,
      };
    }
  }

  return mappings;
}

/**
 * Build Cloudflare Worker routes from config
 */
export function buildRoutes(
  origins: Record<string, SiteAssetWorkerOrigin>,
): Array<{ pattern: string; zoneName: string }> {
  const routes: Array<{ pattern: string; zoneName: string }> = [];

  for (const origin of Object.values(origins)) {
    for (const host of origin.hosts) {
      for (const route of host.routes) {
        routes.push({
          pattern: `${host.pattern}${route}`,
          zoneName: origin.zoneName,
        });
      }
    }
  }

  return routes;
}
