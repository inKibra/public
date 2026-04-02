/**
 * Constants exports
 */

export {
  decodeQuery,
  type EmptyObject,
  encodeQuery,
  type NoData,
  type SimpleQuery,
} from './common';
// EventStream
export {
  type BaseEventStreamEventTypes,
  createEventStreamEvent,
  type EventDataType,
  type EventStreamEvent,
  type EventStreamEventTypes,
  formatEventStreamEvent,
  parseEventStreamEvent,
  type SystemEventStreamEventTypes,
} from './event-stream';
export { HttpMethod } from './http-method';
export { MimeType } from './mime-type';
export { StatusCode } from './status-code';
