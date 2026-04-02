import type { SerializableResult } from './serializable-result';
import type { StatusCode } from './status-code';

export type SimpleSuccess = SerializableResult.OkWithStatusCode<
  true,
  StatusCode.OK
>;
