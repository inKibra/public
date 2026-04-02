import type { MimeType } from '../constants/mime-type';

// take a Blob and give a certain MimeType
export class TypedBlob<TMimeType extends MimeType> extends Blob {
  public readonly mimeType: TMimeType;

  public constructor(
    blobParts: BlobPart[],
    options: BlobPropertyBag,
    mimeType: TMimeType,
  ) {
    super(blobParts, options);
    this.mimeType = mimeType;
  }

  public static fromBlob<TMimeType extends MimeType>(
    blob: Blob,
    mimeType: TMimeType,
  ): TypedBlob<TMimeType> {
    return new TypedBlob<TMimeType>(
      [blob],
      { type: mimeType as string },
      mimeType,
    );
  }
  public static fromUint8Array<TMimeType extends MimeType>(
    uint8Array: Uint8Array,
    mimeType: TMimeType,
  ): TypedBlob<TMimeType> {
    return new TypedBlob<TMimeType>(
      [uint8Array],
      { type: mimeType as string },
      mimeType,
    );
  }
  public static fromArrayBuffer<TMimeType extends MimeType>(
    arrayBuffer: ArrayBuffer,
    mimeType: TMimeType,
  ): TypedBlob<TMimeType> {
    return new TypedBlob<TMimeType>(
      [arrayBuffer],
      { type: mimeType as string },
      mimeType,
    );
  }
  public static fromBuffer<TMimeType extends MimeType>(
    buffer: Buffer,
    mimeType: TMimeType,
  ): TypedBlob<TMimeType> {
    return new TypedBlob<TMimeType>(
      [buffer],
      { type: mimeType as string },
      mimeType,
    );
  }
  public static fromString<TMimeType extends MimeType>(
    string: string,
    mimeType: TMimeType,
  ): TypedBlob<TMimeType> {
    return new TypedBlob<TMimeType>(
      [string],
      { type: mimeType as string },
      mimeType,
    );
  }
}
