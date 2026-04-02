import { MimeType } from '@inkibra/api-base/constants/mime-type';
import {
  type RemoteBinaryLocatorRequest,
  RemoteBinaryLocatorUtil,
} from '@inkibra/api-base/constants/remote-binary-locator';
import { Brand } from '@inkibra/observable-cache';

/**
 * Migration Worker for GCS to R2 migration
 *
 * This worker handles individual file migrations from Google Cloud Storage to Cloudflare R2.
 * It's designed to be called concurrently by the CLI tool for parallel migration.
 *
 * Endpoint: POST /migrate
 * Body: {
 *   gcsPath: string,           // e.g., "media/music/album/song.m4a"
 *   contentType: string,       // e.g., "nksong", "nkalbumart", "nkcltnart", "nkwaveform"
 *   privacyLevel: "public" | "private",
 *   gcsSignedUrl: string,      // Pre-signed URL to fetch from GCS
 *   mimeType: string,          // e.g., "audio/mp4", "image/jpeg"
 * }
 *
 * Response: {
 *   success: boolean,
 *   gcsPath: string,
 *   r2Path: string,
 *   locatorRequest: RemoteBinaryLocatorRequest,
 *   error?: string,
 * }
 */

type Env = {
  R2_BUCKET: R2Bucket;
  MIGRATION_SECRET: string;
};

type MigrationRequest = {
  gcsPath: string;
  contentType: string;
  privacyLevel: 'public' | 'private';
  gcsSignedUrl: string;
  mimeType: string;
};

type MigrationResponse = {
  success: boolean;
  gcsPath: string;
  r2Path?: string;
  locatorRequest?: RemoteBinaryLocatorRequest<string>;
  error?: string;
  bytesTransferred?: number;
};

function createErrorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function getMediaType(mimeType: MimeType): 'images' | 'media' {
  if (
    mimeType === MimeType.IMAGE_JPEG ||
    mimeType === MimeType.IMAGE_PNG ||
    mimeType === MimeType.IMAGE_WEBP
  ) {
    return 'images';
  }
  return 'media';
}

function parseMimeType(mimeType: string): MimeType {
  // Map string mime types to MimeType enum
  const mimeMap: Record<string, MimeType> = {
    'image/jpeg': MimeType.IMAGE_JPEG,
    'image/png': MimeType.IMAGE_PNG,
    'image/webp': MimeType.IMAGE_WEBP,
    'audio/mpeg': MimeType.AUDIO_MPEG,
    'audio/mp4': MimeType.AUDIO_MP4,
    'audio/x-m4a': MimeType.AUDIO_MP4, // M4A files use this mime type
    'audio/wav': MimeType.AUDIO_WAV,
    'video/mp4': MimeType.VIDEO_MP4,
    'application/json': MimeType.APPLICATION_JSON,
    'application/pdf': MimeType.APPLICATION_PDF,
    'text/plain': MimeType.TEXT_PLAIN,
    'text/html': MimeType.TEXT_HTML,
    'text/css': MimeType.TEXT_CSS,
    'text/javascript': MimeType.TEXT_JAVASCRIPT,
  };

  const parsed = mimeMap[mimeType];
  if (!parsed) {
    throw new Error(`Unsupported mime type: ${mimeType}`);
  }
  return parsed;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    // Only accept POST requests
    if (request.method !== 'POST') {
      return createErrorResponse('Method not allowed', 405);
    }

    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Migration endpoint
    if (url.pathname !== '/migrate') {
      return createErrorResponse('Not found', 404);
    }

    // Validate authorization
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return createErrorResponse('Unauthorized', 401);
    }

    const token = authHeader.slice(7);
    if (token !== env.MIGRATION_SECRET) {
      return createErrorResponse('Unauthorized', 401);
    }

    // Parse request body
    let body: MigrationRequest;
    try {
      body = await request.json();
    } catch {
      return createErrorResponse('Invalid JSON body', 400);
    }

    // Validate required fields
    if (
      !body.gcsPath ||
      !body.contentType ||
      !body.privacyLevel ||
      !body.gcsSignedUrl ||
      !body.mimeType
    ) {
      return createErrorResponse('Missing required fields', 400);
    }

    if (body.privacyLevel !== 'public' && body.privacyLevel !== 'private') {
      return createErrorResponse('Invalid privacyLevel', 400);
    }

    try {
      // Parse and validate mime type
      const contentMimeType = parseMimeType(body.mimeType);

      // Fetch from GCS using the signed URL
      console.log(`migration-worker: fetching from GCS: ${body.gcsPath}`);
      const gcsResponse = await fetch(body.gcsSignedUrl);

      if (!gcsResponse.ok) {
        return createErrorResponse(
          `Failed to fetch from GCS: ${gcsResponse.status} ${gcsResponse.statusText}`,
          502,
        );
      }

      // Generate new ID and build R2 path
      const fileId = Brand.createId2('nkfileloc');
      const mediaType = getMediaType(contentMimeType);
      const now = new Date();

      // Create the locator request
      const locatorRequest = RemoteBinaryLocatorUtil.createRequest({
        id: fileId,
        contentType: body.contentType,
        privacyLevel: body.privacyLevel,
        mediaType,
        ownerId: 'system',
        date: now.toISOString() as string & { __format: 'date-time' },
        contentMimeType,
        contentHash: '', // Will be populated after upload if needed
        bucket: 'library-api',
      });

      // Build the R2 storage path
      const r2Path =
        RemoteBinaryLocatorUtil.buildStoragePathFromRequest(locatorRequest);

      // Stream to R2
      console.log(`migration-worker: uploading to R2: ${r2Path}`);
      await env.R2_BUCKET.put(r2Path, gcsResponse.body, {
        httpMetadata: {
          contentType: body.mimeType,
        },
      });

      // Verify the upload
      const r2Object = await env.R2_BUCKET.head(r2Path);
      if (!r2Object) {
        return createErrorResponse('Failed to verify R2 upload', 500);
      }

      const response: MigrationResponse = {
        success: true,
        gcsPath: body.gcsPath,
        r2Path,
        locatorRequest,
        bytesTransferred: r2Object.size,
      };

      console.log(
        `migration-worker: success - ${body.gcsPath} -> ${r2Path} (${r2Object.size} bytes)`,
      );

      return new Response(JSON.stringify(response), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        `migration-worker: error migrating ${body.gcsPath}:`,
        error,
      );

      return createErrorResponse(`Migration failed: ${errorMessage}`, 500);
    }
  },
};
