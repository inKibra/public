import { TypedBlob } from '../classes/typed-blob';
import { MimeType } from '../constants';
import type {
  FileInputDescription,
  MultipleFiles,
  SingleFile,
} from '../constants/file-input-description';

export type SingleFileKeys<T> = {
  [P in keyof T]: T[P] extends SingleFile<infer _U> ? P : never;
}[keyof T];

export type MultipleFileKeys<T> = {
  [P in keyof T]: T[P] extends MultipleFiles<infer _U> ? P : never;
}[keyof T];

export class TypedFormData<TFileInputDescription extends FileInputDescription> {
  private formData: FormData;
  private readonly fileInputDescription: TFileInputDescription;

  public constructor(fileInputDescription: TFileInputDescription) {
    this.fileInputDescription = fileInputDescription;
    this.formData = new FormData();
  }

  public static fromFormData<
    TFileInputDescription extends FileInputDescription,
  >(
    formData: FormData,
    fileInputDescription: TFileInputDescription,
  ): TypedFormData<TFileInputDescription> {
    const typedFormData = new TypedFormData<TFileInputDescription>(
      fileInputDescription,
    );
    typedFormData.formData = formData;
    return typedFormData;
  }

  // Only allow append for multiple file inputs
  public append<K extends MultipleFileKeys<TFileInputDescription>>(
    name: K,
    value: Blob,
  ): void {
    const description = this.fileInputDescription[name];
    if (description === undefined) {
      throw new TypeError(`File ${String(name)} is not allowed`);
    }
    if (!description.allowableMimeTypes.includes(value.type as MimeType)) {
      throw new TypeError(`File ${String(name)} has incorrect MIME type`);
    }
    this.formData.append(name as string, value);
  }

  // Only allow getAll for multiple file inputs
  public getAll<K extends MultipleFileKeys<TFileInputDescription>>(
    name: K,
  ): TypedBlob<TFileInputDescription[K]['allowableMimeTypes'][number]>[] {
    const data = this.formData.getAll(name as string);
    return data.map((blob) => {
      return TypedBlob.fromBlob(
        blob as Blob,
        (blob as Blob)
          .type as TFileInputDescription[K]['allowableMimeTypes'][number],
      );
    });
  }

  // Only allow get for single file inputs
  public get<K extends SingleFileKeys<TFileInputDescription>>(
    name: K,
  ): TypedBlob<TFileInputDescription[K]['allowableMimeTypes'][number]> | null {
    const blob = this.formData.get(name as string) as Blob;
    return TypedBlob.fromBlob(
      blob,
      blob.type as TFileInputDescription[K]['allowableMimeTypes'][number],
    );
  }

  // Only allow set for single file inputs
  public set<K extends SingleFileKeys<TFileInputDescription>>(
    name: K,
    value: Blob,
  ): void {
    const description = this.fileInputDescription[name];
    if (description === undefined) {
      throw new TypeError(`File ${String(name)} is not allowed`);
    }
    if (!description.allowableMimeTypes.includes(value.type as MimeType)) {
      throw new TypeError(`File ${String(name)} has incorrect MIME type`);
    }
    this.formData.set(name as string, value);
  }

  public serializeWithBody(body: string): FormData {
    // Use File instead of Blob so multer treats it as a file upload, not a text field
    const bodyPart = new File([body], 'body.json', {
      type: MimeType.APPLICATION_JSON,
    });
    this.formData.set('body', bodyPart);
    return this.formData;
  }

  /* 
    TODO: create a class called ValidatedTypedFormData that is returned by a method on TypedFormData called validate
    This class only allows get and getAll.
    We then move serialize to ValidatedTypedFormData and make it return FormData.
  */
}
