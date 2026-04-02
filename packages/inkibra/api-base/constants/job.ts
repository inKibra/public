import type { ErrorDescriptor } from '@inkibra/error-base';
import type { Brand } from '@inkibra/observable-cache';

export type JobProgressType<JobBrand extends string, JobBody = undefined> = {
  jobId: Brand<JobBrand>;
  status: 'pending' | 'running';
  body: JobBody;
};

export type JobResultType<JobBrand extends string, Result> = {
  jobId: Brand<JobBrand>;
  status: 'complete';
  result: Result;
};

export type JobErrorType<JobBrand extends string, Error> = {
  jobId: Brand<JobBrand>;
  status: 'failed';
  error: Error;
};

export type UNHANDLED_JOB_FAILURE = ErrorDescriptor<
  'UNHANDLED_JOB_FAILURE',
  'Unhandled job failure',
  { reason: string }
>;

export type JOB_TIMEOUT_ERROR = ErrorDescriptor<
  'JOB_TIMEOUT',
  'Job aborted',
  { reason: string }
>;
