import type { ErrorDescriptor } from '@inkibra/error-base';

export type REQUEST_VALIDATION_ERROR_DESCRIPTOR = ErrorDescriptor<
  'REQUEST_VALIDATION_ERROR',
  `Request validation error: ${string}`,
  unknown
>;
export type RESPONSE_VALIDATION_ERROR_DESCRIPTOR = ErrorDescriptor<
  'RESPONSE_VALIDATION_ERROR',
  `Response validation error: ${string}`,
  unknown
>;
export type UNCAUGHT_SERVER_ERROR_DESCRIPTOR = ErrorDescriptor<
  'UNCAUGHT_SERVER_ERROR',
  `Uncaught server error: ${string}`,
  unknown
>;

export type INTERNAL_SERVER_ERROR_DESCRIPTOR = ErrorDescriptor<
  'INTERNAL_SERVER_ERROR',
  `Internal server error: ${string}`,
  { context: string }
>;
