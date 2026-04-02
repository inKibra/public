import { defineError } from '@inkibra/error-base';

export const BlobStorageEnoent =
  defineError('ENOENT').message<'File does not exist'>();
