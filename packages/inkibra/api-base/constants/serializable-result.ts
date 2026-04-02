import { err, ok, type Result } from 'neverthrow';
import type { StatusCode } from '../constants/status-code';

/**
 * SerializableResult is a type that represents a result that can be serialized.
 * It can be of type 'Ok' or 'Err', each with a value and a status code.
 */

type NonUndefined<T> = Exclude<T, undefined>;

export type SerializableResult<OkType, ErrType> =
  | { type: 'Ok'; value: NonUndefined<OkType>; statusCode: StatusCode }
  | { type: 'Err'; error: NonUndefined<ErrType>; statusCode: StatusCode };

export namespace SerializableResult {
  /**
   * OkWithStatusCode is a type that represents a successful result with a status code.
   * OkType cannot be undefined (but can be null).
   */
  export type OkWithStatusCode<OkType, S extends StatusCode> = {
    type: 'Ok';
    value: NonUndefined<OkType>;
    statusCode: S;
  };

  export type OkWithStatusCodeAndMetadata<
    OkType,
    S extends StatusCode,
    Metadata,
  > = {
    type: 'Ok';
    value: NonUndefined<OkType>;
    statusCode: S;
    meta: Metadata;
  };

  /**
   * ErrWithStatusCode is a type that represents an error result with a status code.
   * ErrType cannot be undefined (but can be null).
   */
  export type ErrWithStatusCode<ErrType, S extends StatusCode> = {
    type: 'Err';
    error: NonUndefined<ErrType>;
    statusCode: S;
  };

  /**
   * fromOk is a function that converts a successful result with a status code to a Result type.
   */
  export function fromOk<OkType, S extends StatusCode>(
    result: OkWithStatusCode<OkType, S>,
  ): Result<OkType, never> {
    return ok(result.value);
  }

  /**
   * fromErr is a function that converts an error result with a status code to a Result type.
   */
  export function fromErr<ErrType, S extends StatusCode>(
    result: ErrWithStatusCode<ErrType, S>,
  ): Result<never, ErrType> {
    return err(result.error);
  }

  /**
   * toOk is a function that creates a successful result with a status code.
   * The value cannot be undefined (but can be null).
   */
  export function toOk<OkType, S extends StatusCode>(
    value: NonUndefined<OkType>,
    statusCode: S,
  ): SerializableResult.OkWithStatusCode<OkType, S> {
    return { type: 'Ok', value, statusCode };
  }

  export function toOkWithMetadata<OkType, S extends StatusCode, Metadata>(
    value: NonUndefined<OkType>,
    statusCode: S,
    meta: Metadata,
  ): SerializableResult.OkWithStatusCodeAndMetadata<OkType, S, Metadata> {
    return { type: 'Ok', value, statusCode, meta };
  }

  /**
   * toErr is a function that creates an error result with a status code.
   * The error cannot be undefined (but can be null).
   */
  export function toErr<ErrType, S extends StatusCode>(
    error: NonUndefined<ErrType>,
    statusCode: S,
  ): SerializableResult.ErrWithStatusCode<ErrType, S> {
    return { type: 'Err', error, statusCode };
  }
}
