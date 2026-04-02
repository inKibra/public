import type { tags } from 'typia/lib';

export type CdnWorkerConfig = {
  cdnDomain: string & tags.Format<'hostname'>; // e.g. c.inkibra.com
  zoneName: string & tags.Format<'hostname'>; // e.g. inkibra.com
  buckets: (string & tags.MinLength<1>)[]; // allowed buckets bound to the worker
};

export type CdnWorkerDeploymentRecord = {
  workers: (string & tags.MinLength<1>)[];
};
