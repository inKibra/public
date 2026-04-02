import type { Logger } from '@inkibra/logger';
import type { Request, RequestHandler, Response } from 'express';
import { type ErrorClientView, fromAnyError } from './error-utils';

/**
 * A Response type that requires a `send` method that takes a `TResponseData` or an `ErrorClientView`.
 */
export type TResponse<TResponseData> = Omit<Response, 'send'> & {
  send: (data: TResponseData | ErrorClientView) => TResponse<void>;
};
/**
 * A Request type that requires `body`, `params` and `query` to be of type `unknown` so that we force validation to happen.
 */
export type TRequest = Omit<Request, 'body' | 'params'> & {
  body: unknown;
  params: unknown;
};

/**
 * A function that wraps a middleware function and catches any errors that it throws.
 * @param logger
 * @param middleware
 * @returns A `RequestHandler` that wraps the given middleware function.
 */
export function guardAsyncMiddleware(
  logger: Logger,
  middleware: RequestHandler,
): RequestHandler {
  return (req, res, next) => {
    middleware(req, res, (error) => {
      if (error) {
        const standardError = fromAnyError(error);
        res.statusCode = standardError.status;
        res.type('json');
        logger.error(
          `Error handling middleware: ${standardError.message}`,
          standardError,
        );
        return res.send(standardError.clientView);
      }
      return next();
    });
  };
}
