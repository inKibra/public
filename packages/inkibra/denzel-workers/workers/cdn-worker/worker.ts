import {
  type RemoteBinaryLocatorRequest,
  RemoteBinaryLocatorUtil,
} from '@inkibra/api-base/constants/remote-binary-locator';
import { validateSignedRemoteBinaryLocatorRequest } from '../../lib/remote-binary-locator-signing';

/**
 * Cloudflare Worker for serving R2-stored content with caching and image transformation
 *
 * Path Pattern: /{bucketName}/{mediaType}/{privacyLevel}/{contentType}/{ownerId}/{year}/{month}/{day}/{id}.{extension}
 * Example: /inkibra-site-images/images/public/blog/system/2025/10/18/nkfileloc_01k7xdf6k1f25tmx7rjje6hrgj.png
 *
 * Origin Path: /raw/{bucketName}/... - serves ONLY from R2, no transforms
 * Transform Path: /{bucketName}/...?width=X - fetches from /raw/ with cf.image
 *
 * Features:
 * - Multi-bucket support via path-based routing
 * - Path-based authorization (only /public/ paths allowed)
 * - Aggressive edge and client caching
 * - Cloudflare Image Transformations via query params
 * - ETag support for conditional requests
 */

type Env = {
  [key: string]: R2Bucket | string | ImagesBinding | undefined;
  ENVIRONMENT?: string;
  IMAGES?: ImagesBinding;
  CDN_SIGNATURE_SECRET?: string;
  CDN_SIGNATURE_ISSUER?: string;
};

type ImageTransformOptions = {
  width?: number;
  height?: number;
  fit?: 'scale-down' | 'contain' | 'cover' | 'crop' | 'pad';
  format?: 'auto' | 'webp' | 'avif' | 'json' | 'jpeg' | 'png';
  quality?: number;
};

const CACHE_CONTROL_PUBLIC = 'public, max-age=31536000, immutable'; // 1 year
const CACHE_CONTROL_ERROR = 'public, max-age=300'; // 5 minutes for errors

// Default max width to apply when only format=auto is provided (no explicit size)
// This prevents very slow full-size re-encodes on large originals.
const DEFAULT_MAX_WIDTH_FOR_FORMAT_ONLY = 1600;

function createErrorResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      'Content-Type': 'text/plain',
      'Cache-Control': CACHE_CONTROL_ERROR,
    },
  });
}

/**
 * Extracts the bucket name from the URL path
 */
function getBucketName(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length < 1) return null;

  // First segment is the bucket name
  return parts[0] || null;
}

/**
 * Gets the R2 key by removing the bucket name from the path
 */
function getR2Key(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;

  // Remove bucket name (first segment) and return the rest as the key
  return parts.slice(1).join('/');
}

/**
 * Extracts the privacy level from the URL path
 */
function getPrivacyLevel(pathname: string): 'public' | 'private' | null {
  const parts = pathname.split('/').filter(Boolean);
  // Privacy level is the 3rd segment (after bucket and mediaType)
  if (parts.length < 3) return null;

  const privacyLevel = parts[2];
  if (privacyLevel === 'public' || privacyLevel === 'private') {
    return privacyLevel;
  }

  return null;
}

/**
 * Determines content type from file extension
 */
function getContentType(pathname: string): string {
  const ext = pathname.split('.').pop()?.toLowerCase();

  const mimeTypes: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    pdf: 'application/pdf',
    json: 'application/json',
    txt: 'text/plain',
    html: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
  };

  return mimeTypes[ext || ''] || 'application/octet-stream';
}

/**
 * Checks if the file is an image type
 */
function isImageType(contentType: string): boolean {
  return contentType.startsWith('image/') && !contentType.includes('svg');
}

/**
 * Parses image transformation options from URL query params
 */
function parseImageTransformOptions(url: URL): ImageTransformOptions | null {
  const width = url.searchParams.get('width');
  const height = url.searchParams.get('height');
  const fit = url.searchParams.get('fit');
  const format = url.searchParams.get('format');
  const quality = url.searchParams.get('quality');

  if (!width && !height && !fit && !format && !quality) {
    return null;
  }

  const options: ImageTransformOptions = {};

  if (width) {
    const parsed = Number.parseInt(width, 10);
    if (!Number.isNaN(parsed) && parsed > 0 && parsed <= 4096) {
      options.width = parsed;
    }
  }

  if (height) {
    const parsed = Number.parseInt(height, 10);
    if (!Number.isNaN(parsed) && parsed > 0 && parsed <= 4096) {
      options.height = parsed;
    }
  }

  if (fit && ['scale-down', 'contain', 'cover', 'crop', 'pad'].includes(fit)) {
    options.fit = fit as ImageTransformOptions['fit'];
  }

  if (
    format &&
    ['auto', 'webp', 'avif', 'json', 'jpeg', 'png'].includes(format)
  ) {
    options.format = format as ImageTransformOptions['format'];
  }

  if (quality) {
    const parsed = Number.parseInt(quality, 10);
    if (!Number.isNaN(parsed) && parsed > 0 && parsed <= 100) {
      options.quality = parsed;
    }
  }

  return Object.keys(options).length > 0 ? options : null;
}

/**
 * Applies Cloudflare Image Transformations using the Images binding
 * Uses env.IMAGES.input().transform().output() API
 */
async function applyImageTransformations(
  bucket: R2Bucket,
  key: string,
  options: ImageTransformOptions,
  request: Request,
  env: Env,
): Promise<Response> {
  const started = Date.now();

  console.log('cdn-worker: === ENTERING applyImageTransformations ===', {
    key,
    options,
    acceptHeader: request.headers.get('Accept'),
    hasImagesBinding: !!env.IMAGES,
  });

  // Fetch original image from R2
  const r2Started = Date.now();
  const object = await bucket.get(key);
  const r2Duration = Date.now() - r2Started;

  if (!object) {
    throw new Error(`Object not found in R2: ${key}`);
  }

  console.log(
    'cdn-worker: R2 fetch completed',
    JSON.stringify({
      r2Duration,
      objectSize: object.size,
      contentType: object.httpMetadata?.contentType,
    }),
  );

  // Get Images binding, throw if not available
  if (!env.IMAGES) {
    throw new Error('Images binding not configured on worker');
  }

  // Build transform options
  const acceptHeader = request.headers.get('Accept') || '';
  const hasExplicitSize = Boolean(options.width || options.height);

  const transformOptions: {
    width?: number;
    height?: number;
    fit?: 'scale-down' | 'contain' | 'cover' | 'crop' | 'pad';
    quality?: number;
  } = {};
  if (options.width) transformOptions.width = options.width;
  if (options.height) transformOptions.height = options.height;
  if (options.fit) transformOptions.fit = options.fit;
  if (options.quality) transformOptions.quality = options.quality;

  // If caller requested format change but no size, add default max width
  if (options.format && !hasExplicitSize) {
    transformOptions.width = DEFAULT_MAX_WIDTH_FOR_FORMAT_ONLY;
    if (!transformOptions.fit) {
      transformOptions.fit = 'scale-down';
    }
  }

  // Determine output format - format is required by Images binding
  // Default to WebP for best compression/quality ratio
  let outputFormat:
    | 'image/webp'
    | 'image/avif'
    | 'image/jpeg'
    | 'image/png'
    | 'image/gif'
    | 'rgb'
    | 'rgba' = 'image/webp';

  if (
    options.format &&
    options.format !== 'auto' &&
    options.format !== 'json'
  ) {
    // Map simple format names to MIME types for the output
    const formatMap: Record<
      string,
      | 'image/webp'
      | 'image/avif'
      | 'image/jpeg'
      | 'image/png'
      | 'image/gif'
      | 'rgb'
      | 'rgba'
    > = {
      webp: 'image/webp',
      avif: 'image/avif',
      jpeg: 'image/jpeg',
      png: 'image/png',
    };
    const mappedFormat = formatMap[options.format];
    if (mappedFormat) {
      outputFormat = mappedFormat;
    }
  } else if (options.format === 'auto') {
    // Prefer WebP over AVIF for better performance
    if (/image\/webp/.test(acceptHeader)) {
      outputFormat = 'image/webp';
    } else if (/image\/avif/.test(acceptHeader)) {
      outputFormat = 'image/avif';
    }
    // Otherwise use WebP as default
  }

  const outputOptions: {
    format:
      | 'image/webp'
      | 'image/avif'
      | 'image/jpeg'
      | 'image/png'
      | 'image/gif'
      | 'rgb'
      | 'rgba';
    quality?: number;
  } = {
    format: outputFormat,
  };

  if (options.quality) outputOptions.quality = options.quality;

  console.log('cdn-worker: calling IMAGES binding', {
    transformOptions,
    outputOptions,
  });

  try {
    // Build the transformation chain
    let transformer = env.IMAGES.input(object.body);

    // Apply transforms if we have any
    if (Object.keys(transformOptions).length > 0) {
      transformer = transformer.transform(transformOptions);
      console.log('cdn-worker: applied transform options', transformOptions);
    }

    // Call output and AWAIT the promise, then call .response()
    console.log('cdn-worker: calling transformer.output()');
    const result = await transformer.output(outputOptions);
    console.log('cdn-worker: output() resolved, calling .response()');
    const response = result.response();
    console.log('cdn-worker: .response() returned', {
      status: response.status,
      contentType: response.headers.get('Content-Type'),
    });

    console.log(
      'cdn-worker: image transformation completed',
      JSON.stringify({
        key,
        options,
        r2Duration,
        totalDuration: Date.now() - started,
        responseStatus: response.status,
        responseContentType: response.headers.get('Content-Type'),
      }),
    );

    return response;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('cdn-worker: transform failed', {
      error: errorMessage,
      stack: errorStack,
      key,
      transformOptions,
      outputOptions,
    });
    throw error;
  }
}

/**
 * Serves image from R2, with optional transformations using Images binding
 */
async function serveImage(
  request: Request,
  env: Env,
  pathname: string,
  imageTransformOptions?: ImageTransformOptions,
): Promise<Response> {
  const started = Date.now();
  const url = new URL(request.url);

  console.log('cdn-worker: serveImage called', {
    pathname,
    hasImageTransformOptions: !!imageTransformOptions,
    imageTransformOptions,
    url: url.toString(),
  });

  // Extract bucket name from path
  const bucketName = getBucketName(pathname);
  console.log('cdn-worker: extracted bucket name', { bucketName, pathname });
  if (!bucketName) {
    return createErrorResponse(
      'Bad Request: Bucket name required in path',
      400,
    );
  }

  // Get R2 bucket binding
  const bucket = env[bucketName];
  if (
    !bucket ||
    typeof bucket === 'string' ||
    typeof bucket !== 'object' ||
    !('get' in bucket)
  ) {
    return new Response(`Not Found: Bucket '${bucketName}' not found`, {
      status: 404,
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': CACHE_CONTROL_ERROR,
      },
    });
  }

  // Get R2 key (path without bucket name)
  const key = getR2Key(pathname);
  if (!key) {
    return new Response('Bad Request: Invalid path', {
      status: 400,
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': CACHE_CONTROL_ERROR,
      },
    });
  }

  // Check privacy level
  const privacyLevel = getPrivacyLevel(pathname);

  if (!privacyLevel) {
    return createErrorResponse('Unauthorized: Invalid privacy level', 401);
  }

  if (privacyLevel === 'private') {
    const privateAccess = await validatePrivateAccess(env, pathname, url);
    if (!privateAccess.ok) {
      return privateAccess.response;
    }
  }

  // Check if the client sent an If-None-Match header
  const ifNoneMatch = request.headers.get('If-None-Match');

  // Handle OPTIONS (CORS preflight) - before any R2 operations
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, If-None-Match',
      },
    });
  }

  // Hoist object variable declaration to prevent scope issues
  let object: R2ObjectBody | null = null;
  let r2Duration = 0;

  // If we have transform options, fetch object first for ETag, then apply transforms
  if (imageTransformOptions) {
    console.log('cdn-worker: transform options detected', {
      imageTransformOptions,
      key,
      bucketName,
    });
    // Pre-fetch object to get ETag for transformed response
    console.log('cdn-worker: fetching object from R2 for transform', { key });
    const r2Started = Date.now();
    object = await bucket.get(key);
    r2Duration = Date.now() - r2Started;

    if (!object) {
      console.error('cdn-worker: object not found in R2', { key });
      return new Response('Not Found', {
        status: 404,
        headers: {
          'Content-Type': 'text/plain',
          'Cache-Control': CACHE_CONTROL_ERROR,
        },
      });
    }

    console.log('cdn-worker: object fetched from R2', {
      key,
      size: object.size,
      contentType: object.httpMetadata?.contentType,
      etag: object.httpEtag,
    });

    try {
      console.log('cdn-worker: calling applyImageTransformations', {
        key,
        imageTransformOptions,
      });
      const transformedResponse = await applyImageTransformations(
        bucket,
        key,
        imageTransformOptions,
        request,
        env,
      );
      console.log('cdn-worker: applyImageTransformations returned', {
        status: transformedResponse.status,
        ok: transformedResponse.ok,
        contentType: transformedResponse.headers.get('Content-Type'),
      });

      if (transformedResponse.ok) {
        // Add CORS headers and ETag for transformed response
        const headers = new Headers(transformedResponse.headers);
        headers.set('Access-Control-Allow-Origin', '*');
        headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        headers.set('Access-Control-Allow-Headers', 'Range, If-None-Match');

        // Generate ETag for transformed image based on original ETag + transform params
        const originalEtag = object.httpEtag || object.etag || '';
        const transformKey = JSON.stringify(imageTransformOptions);
        const transformedEtag = `"${btoa(originalEtag + transformKey).slice(0, 32)}"`;
        headers.set('ETag', transformedEtag);

        const response = new Response(transformedResponse.body, {
          status: transformedResponse.status,
          headers,
        });

        console.log(
          'cdn-worker: transform success',
          JSON.stringify({
            url: request.url,
            totalDuration: Date.now() - started,
            responseContentType: response.headers.get('Content-Type'),
          }),
        );

        return response;
      }

      console.error(
        'cdn-worker: transform failed, falling back to original',
        JSON.stringify({ status: transformedResponse.status }),
      );
      // Fall through to serve original - refetch since stream was consumed
    } catch (error) {
      console.error(
        'cdn-worker: transform error, falling back to original',
        error,
      );
      // Fall through to serve original - refetch since stream was consumed
    }

    // Refetch object if transform failed (stream was consumed)
    console.log(
      'cdn-worker: refetching object for fallback after transform failure',
      { key },
    );
    const refetchStarted = Date.now();
    object = await bucket.get(key);
    r2Duration = Date.now() - refetchStarted;
    console.log('cdn-worker: refetched object from R2', {
      key,
      found: !!object,
      size: object?.size,
      contentType: object?.httpMetadata?.contentType,
      r2Duration,
    });
  } else {
    // No transforms, just fetch the original
    console.log('cdn-worker: no transform options, fetching original from R2', {
      key,
    });
    const r2Started = Date.now();
    object = await bucket.get(key);
    r2Duration = Date.now() - r2Started;
    console.log('cdn-worker: fetched original from R2', {
      key,
      found: !!object,
      size: object?.size,
      contentType: object?.httpMetadata?.contentType,
      r2Duration,
    });
  }

  if (!object) {
    return new Response('Not Found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': CACHE_CONTROL_ERROR,
      },
    });
  }

  // Get content type from R2 metadata or infer from extension
  const contentType =
    object.httpMetadata?.contentType || getContentType(pathname);

  // Generate ETag from object's httpEtag or create one
  const etag = object.httpEtag || object.etag;

  // Check if client has cached version (304 Not Modified)
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: etag,
        'Cache-Control': CACHE_CONTROL_PUBLIC,
      },
    });
  }

  // Build response headers
  const headers = new Headers({
    'Content-Type': contentType,
    ETag: etag,
    'Cache-Control': CACHE_CONTROL_PUBLIC,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, If-None-Match',
    'Content-Length': object.size.toString(),
  });

  // Add Last-Modified if available
  if (object.uploaded) {
    headers.set('Last-Modified', object.uploaded.toUTCString());
  }

  // Handle HEAD requests
  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers,
    });
  }

  // Create response with object body
  const response = new Response(object.body, {
    status: 200,
    headers,
  });

  console.log(
    'cdn-worker: served from R2',
    JSON.stringify({
      url: request.url,
      key,
      hasTransforms: !!imageTransformOptions,
      r2Duration: imageTransformOptions ? 'pre-fetched' : r2Duration,
      totalDuration: Date.now() - started,
      objectSize: object.size,
      contentType,
    }),
  );

  return response;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    try {
      const started = Date.now();
      const url = new URL(request.url);
      const pathname = url.pathname;
      const privacyLevel = getPrivacyLevel(pathname);
      const isPrivateRequest = privacyLevel === 'private';

      // Check if this is an image-resizing subrequest from Cloudflare
      // Per Cloudflare docs: detect "image-resizing" in Via header
      const viaHeader = request.headers.get('via') || '';
      const isImageResizingSubrequest = /image-resizing/i.test(viaHeader);

      console.log(
        'cdn-worker: request started',
        JSON.stringify({
          url: request.url,
          method: request.method,
          isImageResizingSubrequest,
          viaHeader,
        }),
      );

      // Check cache for GET requests
      if (!isPrivateRequest && request.method === 'GET') {
        const cache = await caches.open('default');
        const cachedResponse = await cache.match(request);
        if (cachedResponse) {
          console.log(
            'cdn-worker: cache hit',
            JSON.stringify({
              url: request.url,
              durationMs: Date.now() - started,
            }),
          );
          return cachedResponse;
        }
      }

      // Check for image transformation params
      const imageTransformOptions = parseImageTransformOptions(url);
      const contentType = getContentType(pathname);
      const hasTransforms = imageTransformOptions && isImageType(contentType);

      console.log('cdn-worker: parsed transform options', {
        imageTransformOptions,
        contentType,
        isImageType: isImageType(contentType),
        hasTransforms,
        pathname,
        url: url.toString(),
      });

      // Serve image with optional transformations
      console.log('cdn-worker: calling serveImage', {
        pathname,
        hasTransforms,
        willPassTransformOptions: hasTransforms
          ? imageTransformOptions
          : undefined,
      });
      const response = await serveImage(
        request,
        env,
        pathname,
        hasTransforms ? imageTransformOptions : undefined,
      );
      console.log('cdn-worker: serveImage returned', {
        status: response.status,
        ok: response.ok,
        contentType: response.headers.get('Content-Type'),
      });

      // Cache original responses
      if (!isPrivateRequest && response.ok && request.method === 'GET') {
        ctx.waitUntil(
          caches
            .open('default')
            .then((cache) => cache.put(request, response.clone())),
        );
      }

      return response;
    } catch (error) {
      console.error('cdn-worker: error', error);

      return new Response('Internal Server Error', {
        status: 500,
        headers: {
          'Content-Type': 'text/plain',
          'Cache-Control': CACHE_CONTROL_ERROR,
        },
      });
    }
  },
};

type PrivateAccessValidationResult =
  | { ok: true }
  | { ok: false; response: Response };

async function validatePrivateAccess(
  env: Env,
  pathname: string,
  url: URL,
): Promise<PrivateAccessValidationResult> {
  const secret = env.CDN_SIGNATURE_SECRET;
  if (typeof secret !== 'string' || secret.length === 0) {
    console.error('cdn-worker: CDN_SIGNATURE_SECRET is not configured');
    return {
      ok: false,
      response: createErrorResponse(
        'Service Unavailable: CDN signing secret missing',
        503,
      ),
    };
  }

  const token = url.searchParams.get('access_token');
  if (!token) {
    return {
      ok: false,
      response: createErrorResponse('Unauthorized: Missing access token', 401),
    };
  }

  const issuer = env.CDN_SIGNATURE_ISSUER;
  if (typeof issuer !== 'string' || issuer.length === 0) {
    console.error('cdn-worker: CDN_SIGNATURE_ISSUER is not configured');
    return {
      ok: false,
      response: createErrorResponse(
        'Service Unavailable: CDN signing issuer missing',
        503,
      ),
    };
  }

  let locatorRequest: RemoteBinaryLocatorRequest<string>;
  try {
    locatorRequest = await validateSignedRemoteBinaryLocatorRequest(
      token,
      secret,
      issuer,
    );
  } catch (error) {
    console.error(
      'cdn-worker: Failed to validate access token',
      error instanceof Error ? { message: error.message } : error,
    );
    console.error('cdn-worker: token debug info', {
      issuer,
      tokenIssuer: (() => {
        try {
          const [, payloadBase64] = token.split('.');
          if (!payloadBase64) {
            return 'unparseable';
          }
          const parsed = atob(payloadBase64);
          const json = JSON.parse(parsed);
          return json?.iss;
        } catch {
          return 'unparseable';
        }
      })(),
    });
    return {
      ok: false,
      response: createErrorResponse('Unauthorized: Invalid access token', 401),
    };
  }

  const expectedPathname = `/${locatorRequest.bucket}${RemoteBinaryLocatorUtil.buildStoragePathFromRequest(locatorRequest)}`;
  const bucketName = getBucketName(pathname);
  const requestedKey = getR2Key(pathname);

  if (!bucketName || !requestedKey) {
    return {
      ok: false,
      response: createErrorResponse('Unauthorized: Invalid request path', 401),
    };
  }

  const keySegments = requestedKey.split('/');
  const [
    requestedMediaType,
    requestedPrivacyLevel,
    requestedContentType,
    requestedOwnerId,
    requestedYear,
    requestedMonth,
    requestedDay,
    requestedFilename,
  ] = keySegments;
  const requestedId = requestedFilename?.split('.')[0];

  const coreMatches =
    bucketName === locatorRequest.bucket &&
    requestedMediaType === locatorRequest.mediaType &&
    requestedPrivacyLevel === locatorRequest.privacyLevel &&
    requestedContentType === locatorRequest.contentType &&
    requestedOwnerId === locatorRequest.ownerId &&
    requestedId === locatorRequest.id &&
    locatorRequest.privacyLevel === 'private';

  if (!coreMatches) {
    console.warn(
      'cdn-worker: Access token mismatch',
      JSON.stringify(
        {
          expectedPathname,
          requestedPathname: pathname,
          privacyLevel: locatorRequest.privacyLevel,
          bucket: locatorRequest.bucket,
          ownerId: locatorRequest.ownerId,
          requestedSegments: {
            requestedMediaType,
            requestedPrivacyLevel,
            requestedContentType,
            requestedOwnerId,
            requestedYear,
            requestedMonth,
            requestedDay,
            requestedFilename,
          },
        },
        null,
        2,
      ),
    );
    return {
      ok: false,
      response: createErrorResponse('Unauthorized: Invalid access token', 401),
    };
  }

  if (expectedPathname !== pathname) {
    console.warn(
      'cdn-worker: Access token path uses legacy date partitioning',
      JSON.stringify(
        {
          expectedPathname,
          requestedPathname: pathname,
          requestDateISO: locatorRequest.date,
          requestedDateSegments: {
            requestedYear,
            requestedMonth,
            requestedDay,
          },
        },
        null,
        2,
      ),
    );
  }

  return { ok: true };
}
