import { Storage as GoogleStorage } from '@google-cloud/storage';
import { StatusCode } from '@inkibra/api-base';
import type { MimeType } from '@inkibra/api-base/constants/mime-type';
import type {
  RemoteBinaryLocator,
  RemoteBinaryLocatorAccessTokenPayload,
  RemoteBinaryLocatorRequest,
  SignedRemoteBinaryLocatorRequest,
} from '@inkibra/api-base/constants/remote-binary-locator';
import { RemoteBinaryLocatorUtil } from '@inkibra/api-base/constants/remote-binary-locator';
import { issueJWT } from '@inkibra/crypto-jwt-claim';
import { toThrowable } from '@inkibra/error-base';
import type { Logger } from '@inkibra/logger';
import { Brand } from '@inkibra/observable-cache';
import { S3Client } from 'bun';
import { createHash } from 'crypto';
import { createReadStream, existsSync, mkdirSync } from 'fs';
import { readdir, stat, unlink } from 'fs/promises';
import { join } from 'path';
import { Readable } from 'stream';
import { BlobStorageEnoent } from './error-codes';

export namespace StorageEngineConfiguration {
  export type Local = Readonly<{
    basePath: string;
    serverPrefix: string;
    type: 'Local';
  }>;
  export type Google = Readonly<{
    bucket: string;
    credentialsJSON: string;
    type: 'Google';
  }>;

  export type GoogleFallbackLocal = Readonly<{
    localPath: string;
    serverPrefix: string;
    bucket: string;
    credentialsJSON: string;
    type: 'GoogleFallbackLocal';
  }>;
}

export type StorageEngineConfiguration =
  | StorageEngineConfiguration.Local
  | StorageEngineConfiguration.Google
  | StorageEngineConfiguration.GoogleFallbackLocal;

export type BucketConfig = Readonly<{
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  accessTtlSeconds: number;
}>;

abstract class DriverBase {
  private type: StorageEngineConfiguration['type'];
  protected constructor(type: StorageEngineConfiguration['type']) {
    this.type = type;
  }
  public abstract uploadStream(
    logger: Logger,
    blobName: string,
    inputStream: ReadableStream,
    encode: boolean,
  ): Promise<void>;
  public abstract downloadStream(
    logger: Logger,
    blobName: string,
  ): Promise<ReadableStream>;
  public abstract deleteBlob(logger: Logger, blobName: string): Promise<void>;
  public isType(type: StorageEngineConfiguration['type']) {
    return type === this.type;
  }
  public abstract getBlobUrl(
    logger: Logger,
    blobName: string,
    maxAgeInMs: number,
  ): Promise<string>;
  public abstract getBlobInfo(
    logger: Logger,
    blobName: string,
  ): Promise<{ size: number; lastModified: Date; contentHash: string } | false>;
  public abstract listDirectory(
    logger: Logger,
    prefix: string,
  ): Promise<string[]>;
}

class GoogleDriver extends DriverBase {
  private client: GoogleStorage;
  private bucket: string;
  public constructor(config: StorageEngineConfiguration.Google) {
    super('Google');
    this.client = new GoogleStorage({
      credentials: JSON.parse(config.credentialsJSON),
    });
    this.bucket = config.bucket;
  }
  public uploadStream(
    logger: Logger,
    blobName: string,
    inputStream: ReadableStream,
    encode: boolean,
  ) {
    logger = logger.child({
      component: 'blob-storage:google',
      method: 'uploadStream',
    });
    return new Promise<void>((resolve, reject) => {
      logger.trace('uploadStream', { blobName });
      const bucket = this.client.bucket(this.bucket);
      const file = bucket.file(blobName);
      logger.trace('uploadStream: got block blob client, connecting streams', {
        blobName,
      });

      const writeStream = file.createWriteStream({
        resumable: false,
        gzip: encode,
      });
      // biome-ignore lint/suspicious/noExplicitAny: TODO: remove this when type fixed
      (Readable as any).fromWeb(inputStream as any).pipe(writeStream);

      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });
  }
  public async downloadStream(
    logger: Logger,
    blobName: string,
  ): Promise<ReadableStream> {
    logger = logger.child({
      component: 'blob-storage:google',
      method: 'downloadStream',
    });
    logger.trace('downloadStream', { blobName });
    const bucket = this.client.bucket(this.bucket);
    const file = bucket.file(blobName);
    const [fileExists] = await file.exists();
    if (fileExists) {
      logger.trace(
        'downloadStream: got block blob client, connecting streams',
        { blobName },
      );

      const [link] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 15 * 60 * 1000,
      });
      const response = await fetch(link);
      if (!response.ok) {
        throw 'Failed to download file';
      }
      if (!response.body) {
        throw 'Response body is empty';
      }
      return response.body;
    }
    logger.warn('downloadStream: file does not exist', { blobName });
    throw toThrowable(
      BlobStorageEnoent.create('File does not exist', {}),
      StatusCode.NOT_FOUND,
    );
  }
  public async deleteBlob(logger: Logger, blobName: string) {
    logger = logger.child({
      component: 'blob-storage:google',
      method: 'deleteBlob',
    });
    logger.trace('deleteBlob', { blobName });
    const bucket = this.client.bucket(this.bucket);
    const file = bucket.file(blobName);
    await file.delete();
  }
  public async getBlobUrl(
    logger: Logger,
    blobName: string,
    maxAgeInMs: number,
  ) {
    logger = logger.child({
      component: 'blob-storage:google',
      method: 'getBlobUrl',
    });
    logger.trace('getBlobUrl', { blobName });
    const bucket = this.client.bucket(this.bucket);
    const file = bucket.file(blobName);
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + maxAgeInMs,
      version: 'v4',
    });
    return url;
  }
  public async getBlobInfo(logger: Logger, blobName: string) {
    logger = logger.child({
      component: 'blob-storage:google',
      method: 'getBlobInfo',
    });
    logger.trace('getBlobInfo', { blobName });
    const bucket = this.client.bucket(this.bucket);
    const file = bucket.file(blobName);
    const fileExistsServiceObject = await file.exists();
    if (fileExistsServiceObject[0] === false) {
      logger.warn('getBlobInfo: file does not exist', {
        blobName,
        fileExistsServiceObject,
      });
      return false;
    }
    const [metadata] = (await file.getMetadata()) as unknown as [
      { size: number; updated: Date; md5Hash: string },
    ];
    return {
      size: metadata.size,
      lastModified: new Date(metadata.updated),
      contentHash: metadata.md5Hash,
    };
  }

  public async listDirectory(logger: Logger, prefix: string) {
    logger = logger.child({
      component: 'blob-storage:google',
      method: 'listDirectory',
    });
    logger.trace('listDirectory', { prefix });
    const bucket = this.client.bucket(this.bucket);
    const [files] = await bucket.getFiles({ prefix });
    return files.map((file) => file.name);
  }
}

class LocalDriver extends DriverBase {
  private config: StorageEngineConfiguration.Local;
  public constructor(config: StorageEngineConfiguration.Local) {
    super('Local');
    this.config = config;
    mkdirSync(config.basePath, { recursive: true });
  }
  public async uploadStream(
    logger: Logger,
    blobName: string,
    inputStream: ReadableStream,
  ) {
    logger = logger.child({
      component: 'blob-storage:local',
      method: 'uploadStream',
    });
    logger.trace('uploadStream', { blobName });
    const path = join(this.config.basePath, blobName);
    logger.trace('uploadStream: using path', { path });
    // TODO: fix coming in future version of BUN.
    const buffer = await new Response(inputStream).arrayBuffer();
    await Bun.write(path, buffer);
    logger.trace('uploadStream: finished', { blobName });
  }
  public async downloadStream(
    logger: Logger,
    blobName: string,
  ): Promise<ReadableStream> {
    logger = logger.child({
      component: 'blob-storage:local',
      method: 'downloadStream',
    });
    logger.trace('downloadStream', { blobName });
    const path = join(this.config.basePath, blobName);
    logger.trace('downloadStream: using path', { path });

    if (!existsSync(path)) {
      throw toThrowable(
        BlobStorageEnoent.create('File does not exist', {}),
        StatusCode.NOT_FOUND,
      );
    }
    const file = await Bun.file(path);
    return file.stream();
  }
  public async deleteBlob(logger: Logger, blobName: string) {
    logger = logger.child({
      component: 'blob-storage:local',
      method: 'deleteBlob',
    });
    logger.trace('deleteBlob', { blobName });
    const path = join(this.config.basePath, blobName);
    logger.trace('deleteBlob: using path', { path });
    await unlink(path);
  }
  private async getContentHash(
    logger: Logger,
    blobName: string,
  ): Promise<string> {
    logger = logger.child({
      component: 'blob-storage:local',
      method: 'getContentHash',
    });
    logger.trace('getContentHash', { blobName });
    const path = join(this.config.basePath, blobName);
    logger.trace('getContentHash: using path', { path });
    const hash = createHash('md5');
    const stream = createReadStream(path);
    stream.on('data', (data) => {
      hash.update(data);
    });
    await new Promise<void>((resolve, reject) => {
      stream.on('end', () => {
        resolve();
      });
      stream.on('error', (err) => {
        reject(err);
      });
    });
    return hash.digest('base64');
  }
  public async getBlobUrl(
    logger: Logger,
    blobName: string,
    _: number,
  ): Promise<string> {
    logger = logger.child({
      component: 'blob-storage:local',
      method: 'getBlobUrl',
    });
    return new URL(blobName, this.config.serverPrefix).toString();
  }
  public async getBlobInfo(logger: Logger, blobName: string) {
    logger = logger.child({
      component: 'blob-storage:local',
      method: 'getBlobInfo',
    });
    logger.trace('getBlobInfo', { blobName });
    const path = join(this.config.basePath, blobName);
    logger.trace('getBlobInfo: using path', { path });
    if (!existsSync(path)) {
      return false;
    }
    const { size, mtime } = await stat(path);
    return {
      size,
      lastModified: mtime,
      contentHash: await this.getContentHash(logger, blobName),
    };
  }

  public async listDirectory(logger: Logger, prefix: string) {
    logger = logger.child({
      component: 'blob-storage:local',
      method: 'listDirectory',
    });
    logger.trace('listDirectory', { prefix });
    const path = join(this.config.basePath, prefix);
    logger.trace('listDirectory: using path', { path });

    try {
      const files = await readdir(path);
      return files;
    } catch (error) {
      logger.warn('listDirectory: error reading directory', { path, error });
      return [];
    }
  }
}

class GoogleFallbackLocalDriver extends LocalDriver {
  private googleDriver: GoogleDriver;

  public constructor(
    private _config: StorageEngineConfiguration.GoogleFallbackLocal,
  ) {
    super({
      basePath: _config.localPath,
      type: 'Local',
      serverPrefix: _config.serverPrefix,
    });
    this.googleDriver = new GoogleDriver({ ..._config, type: 'Google' });
  }

  private getLocalNameFromBlobName(blobName: string): string {
    return join(this._config.bucket, blobName);
  }

  public async uploadStream(
    logger: Logger,
    blobName: string,
    inputStream: ReadableStream,
  ): Promise<void> {
    await super.uploadStream(
      logger,
      this.getLocalNameFromBlobName(blobName),
      inputStream,
    );
  }
  public async downloadStream(
    logger: Logger,
    blobName: string,
  ): Promise<ReadableStream> {
    if (
      await super.getBlobInfo(logger, this.getLocalNameFromBlobName(blobName))
    ) {
      return await super.downloadStream(
        logger,
        this.getLocalNameFromBlobName(blobName),
      );
    }
    return await this.googleDriver.downloadStream(logger, blobName);
  }

  public async deleteBlob(logger: Logger, blobName: string): Promise<void> {
    await super.deleteBlob(logger, this.getLocalNameFromBlobName(blobName));
  }

  public async getBlobUrl(
    logger: Logger,
    blobName: string,
    maxAgeInMs: number,
  ): Promise<string> {
    if (
      await super.getBlobInfo(logger, this.getLocalNameFromBlobName(blobName))
    ) {
      return await super.getBlobUrl(
        logger,
        this.getLocalNameFromBlobName(blobName),
        maxAgeInMs,
      );
    }
    return await this.googleDriver.getBlobUrl(logger, blobName, maxAgeInMs);
  }

  public async getBlobInfo(
    logger: Logger,
    blobName: string,
  ): Promise<
    { size: number; lastModified: Date; contentHash: string } | false
  > {
    const localInfo = await super.getBlobInfo(
      logger,
      this.getLocalNameFromBlobName(blobName),
    );
    if (localInfo) {
      return localInfo;
    }
    return await this.googleDriver.getBlobInfo(logger, blobName);
  }

  public async listDirectory(
    logger: Logger,
    prefix: string,
  ): Promise<string[]> {
    const localFiles = await super.listDirectory(
      logger,
      join(this._config.bucket, prefix),
    );
    const googleFiles = await this.googleDriver.listDirectory(logger, prefix);
    return [...new Set([...localFiles, ...googleFiles])];
  }
}

export type BlobStorageEngine = DriverBase;

export default async function createEngine(config: StorageEngineConfiguration) {
  switch (config.type) {
    case 'Local': {
      return new LocalDriver(config);
    }
    case 'Google': {
      const driver = new GoogleDriver(config);
      return driver;
    }

    case 'GoogleFallbackLocal': {
      return new GoogleFallbackLocalDriver(config);
    }
  }
}

// Remote Binary Locator utilities
export async function writeRemoteBinaryLocator<
  Type extends string,
  TMimeType extends MimeType = MimeType,
>(
  logger: Logger,
  bucketConfig: BucketConfig,
  input: ReadableStream,
  options: {
    contentType: Type;
    contentMimeType: TMimeType;
    mediaType: 'media' | 'images' | 'video';
    ownerId: string | 'system';
    privacyLevel: 'public' | 'private';
    expires?: Date;
  },
): Promise<RemoteBinaryLocatorRequest<Type, TMimeType>> {
  logger = logger.child({
    component: 'blob-storage:remote-binary-locator',
    method: 'writeRemoteBinaryLocator',
  });

  const id = Brand.createId2('nkfileloc');
  const now = new Date();

  // Build storage path
  const extension = RemoteBinaryLocatorUtil.getFileExtensionFromMimeType(
    options.contentMimeType,
  );
  const storagePath = RemoteBinaryLocatorUtil.buildStoragePath({
    mediaType: options.mediaType,
    privacyLevel: options.privacyLevel,
    contentType: options.contentType,
    ownerId: options.ownerId,
    date: now,
    id: id,
    extension,
  });

  logger.trace('Uploading to S3', {
    bucket: bucketConfig.bucket,
    key: storagePath,
    contentType: options.contentType,
    contentMimeType: options.contentMimeType,
  });

  // Upload to S3 and get metadata including ETag (which is the MD5 hash)
  await S3Client.write(storagePath, new Response(input), {
    accessKeyId: bucketConfig.accessKeyId,
    secretAccessKey: bucketConfig.secretAccessKey,
    endpoint: bucketConfig.endpoint,
    bucket: bucketConfig.bucket,
    region: bucketConfig.region,
    type: options.contentMimeType,
    // Add expiration if provided
    ...(options.expires && {
      expires: options.expires,
    }),
  });

  // Get the file metadata from S3 to retrieve the ETag (MD5 hash)
  const stat = await S3Client.stat(storagePath, {
    accessKeyId: bucketConfig.accessKeyId,
    secretAccessKey: bucketConfig.secretAccessKey,
    endpoint: bucketConfig.endpoint,
    bucket: bucketConfig.bucket,
    region: bucketConfig.region,
  });

  // Extract MD5 hash from ETag (remove quotes if present)
  const contentHash = stat.etag.replace(/"/g, '');

  logger.info('Successfully uploaded remote binary locator', {
    id,
    bucket: bucketConfig.bucket,
    key: storagePath,
    contentHash,
  });

  return RemoteBinaryLocatorUtil.createRequest<Type, TMimeType>({
    contentType: options.contentType,
    bucket: bucketConfig.bucket,
    date: now.toISOString(),
    ownerId: options.ownerId,
    privacyLevel: options.privacyLevel,
    contentMimeType: options.contentMimeType,
    contentHash,
    mediaType: options.mediaType,
    expires: options.expires?.toISOString(),
    id,
  });
}

export async function getRemoteBinaryLocatorSignedUrl<
  TMimeType extends MimeType,
  Type extends string,
>(
  logger: Logger,
  bucketConfig: BucketConfig,
  request: RemoteBinaryLocatorRequest<Type, TMimeType>,
  maxAgeInMs?: number,
): Promise<RemoteBinaryLocator<TMimeType, Type>> {
  logger = logger.child({
    component: 'blob-storage:remote-binary-locator',
    method: 'getRemoteBinaryLocatorSignedUrl',
  });

  const expiresIn = maxAgeInMs
    ? Math.floor(maxAgeInMs / 1000)
    : bucketConfig.accessTtlSeconds;

  // Reconstruct storage path from request metadata
  const storagePath =
    RemoteBinaryLocatorUtil.buildStoragePathFromRequest(request);

  logger.trace('Generating signed URL', {
    bucket: request.bucket,
    key: storagePath,
    expiresIn,
  });

  const signedUrl = S3Client.presign(storagePath, {
    accessKeyId: bucketConfig.accessKeyId,
    secretAccessKey: bucketConfig.secretAccessKey,
    endpoint: bucketConfig.endpoint,
    bucket: bucketConfig.bucket,
    region: bucketConfig.region,
    expiresIn,
  });

  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  logger.info('Generated signed URL', {
    id: request.id,
    url: signedUrl,
    expiresAt: expiresAt.toISOString(),
  });

  return {
    id: request.id,
    associatedResources: [],
    url: signedUrl,
    contentHash: request.contentHash,
    contentMimeType: request.contentMimeType as TMimeType,
    contentType: request.contentType,
    type: `RemoteBinaryLocator<${request.contentType}>`,
    date: request.date,
    expires: expiresAt.toISOString(),
  };
}

type SignRemoteBinaryLocatorOptions = Readonly<{
  secret: string;
  issuer: string;
  expiresInSeconds?: number;
}>;

export async function signRemoteBinaryLocatorRequest<
  Type extends string,
  TMimeType extends MimeType = MimeType,
>(
  request: RemoteBinaryLocatorRequest<Type, TMimeType>,
  options: SignRemoteBinaryLocatorOptions,
): Promise<SignedRemoteBinaryLocatorRequest<Type>> {
  const expiresInSeconds = options.expiresInSeconds ?? 3600;
  const { tokenString } = await issueJWT<
    RemoteBinaryLocatorAccessTokenPayload<Type, TMimeType>
  >(
    options.secret,
    options.issuer,
    request.id,
    { request },
    expiresInSeconds / 60,
  );

  return RemoteBinaryLocatorUtil.createSignedRequest(request, tokenString);
}

/**
 * Get a public CDN URL for a RemoteBinaryLocatorRequest
 * @param cdnDomain - The CDN domain (e.g., "c.inkibra.com")
 * @param request - The RemoteBinaryLocatorRequest (must be public)
 * @returns Full CDN URL
 */
export function getRemoteBinaryLocatorPublicCdnUrl<Type extends string>(
  cdnDomain: string,
  request: RemoteBinaryLocatorRequest<Type>,
  signedRequest?: SignedRemoteBinaryLocatorRequest<Type>,
): string {
  return RemoteBinaryLocatorUtil.buildPublicCdnUrl(cdnDomain, request, {
    signedRequest,
  });
}

export function getRemoteBinaryLocatorPrivateCdnUrl<Type extends string>(
  cdnDomain: string,
  request: RemoteBinaryLocatorRequest<Type>,
  signedRequest: SignedRemoteBinaryLocatorRequest<Type>,
): string {
  return RemoteBinaryLocatorUtil.buildPrivateCdnUrl(
    cdnDomain,
    request,
    signedRequest,
  );
}

/**
 * Get a public CDN URL using a bucket-to-domain mapping
 * @param bucketToDomain - Map of bucket names to CDN domains
 * @param request - The RemoteBinaryLocatorRequest (must be public)
 * @returns Full CDN URL using the mapped domain
 */
export function getRemoteBinaryLocatorPublicCdnUrlFromMapping<
  Type extends string,
>(
  bucketToDomain: Record<string, string>,
  request: RemoteBinaryLocatorRequest<Type>,
  signedRequest?: SignedRemoteBinaryLocatorRequest<Type>,
): string {
  return RemoteBinaryLocatorUtil.buildPublicCdnUrlFromMapping(
    bucketToDomain,
    request,
    { signedRequest },
  );
}
