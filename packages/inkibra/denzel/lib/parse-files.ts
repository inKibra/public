import {
  type FileInputDescription,
  type MultipleFileKeys,
  type SingleFileKeys,
  TypedFormData,
} from '@inkibra/api-base';

export type MulterField<T extends FileInputDescription> =
  | {
      [P in keyof T]: { name: P; maxCount: number };
    }[keyof T][]
  | [{ name: 'body'; maxCount: 1 }];
export function mapToMulterFields<T extends FileInputDescription>(
  fileInputDescription: T,
): MulterField<T> {
  const fields = Object.entries(fileInputDescription).map(
    ([name, descriptor]) => {
      if ('maxCount' in descriptor) {
        // It's a MultipleFiles type
        return { name, maxCount: descriptor.maxCount } as const;
      }
      // It's a SingleFile type
      return { name, maxCount: 1 } as const;
    },
  );
  return [{ name: 'body', maxCount: 1 }].concat(fields);
}

type MulterMemoryFile = {
  encoding: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
};

export type ParsedFiles<
  TFileInputDescription extends FileInputDescription | undefined,
> = TFileInputDescription extends FileInputDescription
  ? {
      [K in SingleFileKeys<TFileInputDescription>]: [MulterMemoryFile];
    } & {
      [K in MultipleFileKeys<TFileInputDescription>]: MulterMemoryFile[];
    }
  : undefined;

// TODO: We can create a schema for a non-generic parsed file object and make sure we have the right thing...

// Function to parse Multer files into TypedFormData
export function parseMulterFilesToTypedFormData<
  TFileInputDescription extends FileInputDescription | undefined,
>(
  multerFiles: ParsedFiles<TFileInputDescription>,
  fileInputDescription: TFileInputDescription,
): TFileInputDescription extends FileInputDescription
  ? TypedFormData<TFileInputDescription>
  : undefined {
  if (fileInputDescription === undefined || multerFiles === undefined) {
    return undefined as TFileInputDescription extends FileInputDescription
      ? TypedFormData<TFileInputDescription>
      : undefined;
  }

  if (fileInputDescription === undefined) {
    throw new Error(
      'Cannot parse multer files when no file input description is provided',
    );
  }
  if (multerFiles === undefined) {
    throw new Error('Cannot parse undefined multer files');
  }
  const formData = new FormData();
  Object.entries(multerFiles).forEach(([name, files]) => {
    files.forEach((file) => {
      const blob = new Blob([file.buffer], { type: file.mimetype });
      formData.append(name, blob);
    });
  });

  const typedFormData = TypedFormData.fromFormData(
    formData,
    fileInputDescription,
  );

  return typedFormData as TFileInputDescription extends FileInputDescription
    ? TypedFormData<TFileInputDescription>
    : undefined;
}

export async function getBodyFromMulterFiles(
  multerFiles: ParsedFiles<FileInputDescription>,
) {
  const body = multerFiles.body;
  if (body === undefined) {
    return undefined;
  }
  if (body.length > 1) {
    // TODO: err descriptor for this
    throw new Error('Cannot have more than one file for body');
  }
  const blob = new Blob([body[0].buffer], { type: body[0].mimetype });
  const text = await blob.text();
  if (text === 'undefined') {
    return undefined;
  }
  return JSON.parse(text);
}
