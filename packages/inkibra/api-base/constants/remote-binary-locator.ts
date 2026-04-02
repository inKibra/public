import {
  type AssertLowercase,
  Brand,
  type BrandRegex,
} from '@inkibra/observable-cache';
import type { tags } from 'typia/lib';
import { MimeType } from './mime-type';

/**
 * @deprecated use RemoteBinaryLocatorRequest and Utils
 */
export type RemoteBinaryLocator<
  TMimeType extends MimeType,
  Type extends string,
> = {
  readonly id: Brand<'nkfileloc'> & BrandRegex<'nkfileloc'>;
  associatedResources: string[];
  readonly url: string & tags.Format<'url'>;
  readonly contentHash?: string;
  readonly contentMimeType: TMimeType;
  readonly contentType: Type;
  readonly type: `RemoteBinaryLocator<${Type}>`;
  readonly date: string & tags.Format<'date-time'>;
  readonly expires?: string & tags.Format<'date-time'>;
};

export type RemoteBinaryLocatorRequest<
  Type extends string,
  TMimeType extends MimeType = MimeType,
> = {
  readonly id: Brand<'nkfileloc'>;
  readonly type: `RemoteBinaryLocatorRequest<${Type}>`;
  readonly bucket: string;
  readonly date: string & tags.Format<'date-time'>;
  readonly ownerId: string;
  readonly privacyLevel: 'public' | 'private';
  readonly contentMimeType: TMimeType;
  readonly contentType: Type;
  readonly contentHash: string;
  readonly mediaType: 'media' | 'images' | 'video';
  readonly expires?: string & tags.Format<'date-time'>;
};

export type RemoteBinaryLocatorAccessTokenPayload<
  Type extends string,
  TMimeType extends MimeType = MimeType,
> = {
  readonly request: RemoteBinaryLocatorRequest<Type, TMimeType>;
};

export type SignedRemoteBinaryLocatorRequest<Type extends string> = {
  readonly id: Brand<'nksignedfileloc'>;
  readonly signature: string;
  readonly type: `SignedRemoteBinaryLocatorRequest<${Type}>`;
};

// TODO: rename to RemoteBinaryLocatorRequest
export namespace RemoteBinaryLocatorUtil {
  type BuildCdnUrlOptions<Type extends string> = Readonly<{
    signedRequest?: SignedRemoteBinaryLocatorRequest<Type>;
  }>;

  export function toContentId<const B extends string>(
    locator: { readonly id: Brand<'nkfileloc'> },
    type: B,
    ..._assert: AssertLowercase<B>
  ): Brand<B> {
    const suffix = Brand.getSuffix(locator.id, 'nkfileloc');
    if (suffix.isErr()) {
      throw new Error('Invalid nkfileloc id');
    }
    return Brand.createWithSuffix(suffix.value, type, ..._assert) as Brand<B>;
  }

  export function buildStoragePath(params: {
    mediaType: 'media' | 'images' | 'video';
    privacyLevel: 'public' | 'private';
    contentType: string;
    ownerId: string;
    date: Date;
    id: string;
    extension: string;
  }): string {
    const {
      mediaType,
      privacyLevel,
      contentType,
      ownerId,
      date,
      id,
      extension,
    } = params;
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');

    return `${mediaType}/${privacyLevel}/${contentType}/${ownerId}/${year}/${month}/${day}/${id}.${extension}`;
  }

  export function buildStoragePathFromRequest<
    Type extends string,
    TMimeType extends MimeType = MimeType,
  >(request: RemoteBinaryLocatorRequest<Type, TMimeType>): string {
    const extension = getFileExtensionFromMimeType(request.contentMimeType);
    return buildStoragePath({
      mediaType: request.mediaType,
      privacyLevel: request.privacyLevel,
      contentType: request.contentType,
      ownerId: request.ownerId,
      date: new Date(request.date),
      id: request.id,
      extension,
    });
  }

  export function getFileExtensionFromMimeType(mimeType: MimeType): string {
    switch (mimeType) {
      case MimeType.IMAGE_JPEG:
        return 'jpg';
      case MimeType.IMAGE_PNG:
        return 'png';
      case MimeType.IMAGE_WEBP:
        return 'webp';
      case MimeType.AUDIO_MPEG:
        return 'mp3';
      case MimeType.AUDIO_WAV:
        return 'wav';
      case MimeType.AUDIO_MP4:
        return 'm4a';
      case MimeType.VIDEO_MP4:
        return 'mp4';
      case MimeType.APPLICATION_PDF:
        return 'pdf';
      case MimeType.APPLICATION_JSON:
        return 'json';
      case MimeType.TEXT_HTML:
        return 'html';
      case MimeType.TEXT_CSS:
        return 'css';
      case MimeType.TEXT_JAVASCRIPT:
        return 'js';
      case MimeType.TEXT_XML:
        return 'xml';
      case MimeType.TEXT_PLAIN:
        return 'txt';
      default:
        return 'bin';
    }
  }

  /**
   * Build a public CDN URL for a RemoteBinaryLocatorRequest
   * @param cdnDomain - The CDN domain (e.g., "c.inkibra.com")
   * @param request - The RemoteBinaryLocatorRequest
   * @returns Full CDN URL (e.g., "https://c.inkibra.com/bucket/images/public/...")
   * @throws Error if the request is not for public content
   */
  export function buildPublicCdnUrl<Type extends string>(
    cdnDomain: string,
    request: RemoteBinaryLocatorRequest<Type>,
    options?: BuildCdnUrlOptions<Type>,
  ): string {
    if (request.privacyLevel !== 'public' && !options?.signedRequest) {
      throw new Error(
        'Cannot build CDN URL for private RemoteBinaryLocatorRequest without a signed request',
      );
    }

    const storagePath = buildStoragePathFromRequest(request);
    const baseUrl = `https://${cdnDomain}/${request.bucket}/${storagePath}`;

    if (!options?.signedRequest) {
      return baseUrl;
    }

    const url = new URL(baseUrl);
    url.searchParams.set('access_token', options.signedRequest.signature);
    return url.toString();
  }

  /**
   * Build a public CDN URL from a bucket-to-domain mapping
   * @param bucketToDomain - Map of bucket names to CDN domains
   * @param request - The RemoteBinaryLocatorRequest
   * @returns Full CDN URL using the mapped domain for the bucket
   * @throws Error if the request is not for public content or bucket not found in mapping
   */
  export function buildPublicCdnUrlFromMapping<
    Type extends string,
    TMimeType extends MimeType = MimeType,
  >(
    bucketToDomain: Record<string, string>,
    request: RemoteBinaryLocatorRequest<Type, TMimeType>,
    options?: BuildCdnUrlOptions<Type>,
  ): string {
    const cdnDomain = bucketToDomain[request.bucket];
    if (!cdnDomain) {
      throw new Error(
        `No CDN domain found for bucket '${request.bucket}' in mapping`,
      );
    }

    return buildPublicCdnUrl(cdnDomain, request, options);
  }

  /**
   * Get the type string for a RemoteBinaryLocatorRequest
   * @param contentType - The content type string
   * @returns The type string in the format `RemoteBinaryLocatorRequest<${contentType}>`
   */
  export function getTypeString<Type extends string>(
    contentType: Type,
  ): `RemoteBinaryLocatorRequest<${Type}>` {
    return `RemoteBinaryLocatorRequest<${contentType}>` as const;
  }

  /**
   * Create a RemoteBinaryLocatorRequest object
   * @param params - Parameters for creating the request
   * @returns A RemoteBinaryLocatorRequest object
   */
  export function createRequest<
    Type extends string,
    TMimeType extends MimeType = MimeType,
  >(params: {
    contentType: Type;
    bucket: string;
    date: string & tags.Format<'date-time'>;
    ownerId: 'system' | ({} & string);
    privacyLevel: 'public' | 'private';
    contentMimeType: TMimeType;
    contentHash: string;
    mediaType: 'media' | 'images' | 'video';
    expires?: string & tags.Format<'date-time'>;
    id?: Brand<'nkfileloc'>;
  }): RemoteBinaryLocatorRequest<Type, TMimeType> {
    return {
      id: params.id ?? Brand.createId2('nkfileloc'),
      type: getTypeString(params.contentType),
      bucket: params.bucket,
      date: params.date,
      ownerId: params.ownerId,
      privacyLevel: params.privacyLevel,
      contentMimeType: params.contentMimeType,
      contentType: params.contentType,
      contentHash: params.contentHash,
      mediaType: params.mediaType,
      expires: params.expires,
    };
  }

  export function createSignedRequest<
    Type extends string,
    TMimeType extends MimeType = MimeType,
  >(
    request: RemoteBinaryLocatorRequest<Type, TMimeType>,
    signature: string,
  ): SignedRemoteBinaryLocatorRequest<Type> {
    const id = Brand.changePrefix(request.id, 'nkfileloc', 'nksignedfileloc');
    if (id.isErr()) {
      throw new Error('Failed to create signed locator');
    }
    return {
      id: id.value,
      signature,
      type: `SignedRemoteBinaryLocatorRequest<${request.contentType}>`,
    };
  }

  export function buildPrivateCdnUrl<Type extends string>(
    cdnDomain: string,
    request: RemoteBinaryLocatorRequest<Type>,
    signedRequest: SignedRemoteBinaryLocatorRequest<Type>,
  ): string {
    if (request.privacyLevel !== 'private') {
      throw new Error(
        'Cannot build private CDN URL for a non-private RemoteBinaryLocatorRequest',
      );
    }
    return buildPublicCdnUrl(cdnDomain, request, { signedRequest });
  }

  /**
   * Get MIME type from file extension
   * @param extension - The file extension (without the dot)
   * @returns The corresponding MIME type or null if not recognized
   */
  function getMimeTypeFromExtension(extension: string): MimeType | null {
    switch (extension.toLowerCase()) {
      case 'jpg':
      case 'jpeg':
        return MimeType.IMAGE_JPEG;
      case 'png':
        return MimeType.IMAGE_PNG;
      case 'webp':
        return MimeType.IMAGE_WEBP;
      case 'mp3':
        return MimeType.AUDIO_MPEG;
      case 'wav':
        return MimeType.AUDIO_WAV;
      case 'm4a':
        return MimeType.AUDIO_MP4;
      case 'mp4':
        return MimeType.VIDEO_MP4;
      case 'pdf':
        return MimeType.APPLICATION_PDF;
      case 'json':
        return MimeType.APPLICATION_JSON;
      case 'html':
        return MimeType.TEXT_HTML;
      case 'css':
        return MimeType.TEXT_CSS;
      case 'js':
        return MimeType.TEXT_JAVASCRIPT;
      case 'xml':
        return MimeType.TEXT_XML;
      case 'txt':
        return MimeType.TEXT_PLAIN;
      default:
        return null;
    }
  }

  /**
   * Parse a storage path to extract metadata
   * Format: {mediaType}/{privacyLevel}/{contentType}/{ownerId}/{YYYY}/{MM}/{DD}/{id}.{ext}
   * @param storagePath - The storage path to parse
   * @returns Parsed metadata or null if the path doesn't match the expected format
   */
  export function parseStoragePath(storagePath: string): {
    mediaType: 'media' | 'images' | 'video';
    privacyLevel: 'public' | 'private';
    contentType: string;
    ownerId: string;
    year: string;
    month: string;
    day: string;
    id: string;
    extension: string;
    date: string;
  } | null {
    const parts = storagePath.split('/');
    if (parts.length < 8) {
      return null;
    }

    const [
      mediaType,
      privacyLevel,
      contentType,
      ownerId,
      year,
      month,
      day,
      filename,
    ] = parts;

    if (
      !mediaType ||
      !privacyLevel ||
      !contentType ||
      !ownerId ||
      !year ||
      !month ||
      !day ||
      !filename
    ) {
      return null;
    }

    // Validate mediaType
    if (
      mediaType !== 'media' &&
      mediaType !== 'images' &&
      mediaType !== 'video'
    ) {
      return null;
    }

    // Validate privacyLevel
    if (privacyLevel !== 'public' && privacyLevel !== 'private') {
      return null;
    }

    const filenameParts = filename.split('.');
    if (filenameParts.length < 2) {
      return null;
    }

    const id = filenameParts[0];
    if (!id) {
      return null;
    }

    const extension = filenameParts[filenameParts.length - 1];
    if (!extension) {
      return null;
    }

    // Construct ISO date string
    const date = new Date(
      Date.UTC(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10)),
    ).toISOString();

    return {
      mediaType: mediaType as 'media' | 'images' | 'video',
      privacyLevel: privacyLevel as 'public' | 'private',
      contentType,
      ownerId,
      year,
      month,
      day,
      id,
      extension,
      date,
    };
  }

  /**
   * Parse a storage path and create a RemoteBinaryLocatorRequest
   * Format: {mediaType}/{privacyLevel}/{contentType}/{ownerId}/{YYYY}/{MM}/{DD}/{id}.{ext}
   * @param storagePath - The storage path to parse
   * @param bucket - The bucket name
   * @param contentHash - The content hash (e.g., ETag from S3/R2)
   * @returns A RemoteBinaryLocatorRequest or null if the path doesn't match the expected format
   */
  export function parseStoragePathToRequest<
    Type extends string,
    TMimeType extends MimeType = MimeType,
  >(
    storagePath: string,
    bucket: string,
    contentHash: string,
  ): RemoteBinaryLocatorRequest<Type, TMimeType> | null {
    const parsed = parseStoragePath(storagePath);
    if (!parsed) {
      return null;
    }

    // Get MIME type from extension
    const mimeType = getMimeTypeFromExtension(parsed.extension);
    if (!mimeType) {
      return null;
    }

    // Validate that the ID is a valid Brand ID format
    if (!parsed.id.startsWith('nkfileloc_')) {
      return null;
    }

    return createRequest<Type, TMimeType>({
      id: parsed.id as Brand<'nkfileloc'>,
      contentType: parsed.contentType as Type,
      bucket,
      date: parsed.date as string & tags.Format<'date-time'>,
      ownerId: parsed.ownerId as 'system' | ({} & string),
      privacyLevel: parsed.privacyLevel,
      contentMimeType: mimeType as TMimeType,
      contentHash,
      mediaType: parsed.mediaType,
    });
  }
}

/**
 * Helper type to convert a RemoteBinaryLocatorRequest to a RemoteBinaryLocator.
 * This represents the type-level transformation from storage metadata to a signed URL locator.
 *
 * @example
 * ```typescript
 * // Using InkibraSocialLibraryImage.ImageContentType constant
 * type ImageRequest = RemoteBinaryLocatorRequest<InkibraSocialLibraryImage.ImageContentType, MimeType.IMAGE_JPEG>;
 * type ImageLocator = ToRemoteBinaryLocator<ImageRequest>;
 * // ImageLocator is now RemoteBinaryLocator<MimeType.IMAGE_JPEG, InkibraSocialLibraryImage.ImageContentType>
 * ```
 */
export type ToRemoteBinaryLocator<
  TRequest extends RemoteBinaryLocatorRequest<string, MimeType>,
> = RemoteBinaryLocator<TRequest['contentMimeType'], TRequest['contentType']>;
