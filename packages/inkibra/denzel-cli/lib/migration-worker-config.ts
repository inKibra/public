import type { tags } from 'typia/lib';

export type MigrationWorkerConfig = {
  r2BucketName: string & tags.MinLength<1>; // R2 bucket to migrate files into
};
