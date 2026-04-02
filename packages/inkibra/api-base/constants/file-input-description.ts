import type { MimeType } from '../constants';

export type SingleFile<TMimeType extends MimeType> = {
  allowableMimeTypes: TMimeType[];
  /**
   * Whether this file is required. Defaults to true (required) if undefined.
   * Set to false to make the file optional.
   */
  required?: false;
};

export type MultipleFiles<TMimeType extends MimeType> = {
  allowableMimeTypes: TMimeType[];
  maxCount: number;
  /**
   * Whether these files are required. Defaults to true (required) if undefined.
   * Set to false to make the files optional.
   */
  required?: false;
};

/**
 * FileManifest is a type that represents a manifest of files.
 */
export type FileInputDescription = {
  [name: string]: SingleFile<MimeType> | MultipleFiles<MimeType>;
};

/**
 * Check if all files in a FileInputDescription are optional (required: false).
 * Returns true if all files have required: false, false otherwise.
 */
export type AllFilesOptional<T extends FileInputDescription> = {
  [K in keyof T]: T[K]['required'] extends false ? true : false;
}[keyof T] extends true
  ? true
  : false;
