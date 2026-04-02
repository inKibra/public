/**
 * Standard shape for error data sent to clients.
 */
export type ErrorClientView = {
  message: string;
  code: string;
  status: number;
};

/**
 * Standardized error result from fromAnyError.
 */
export type StandardizedError = {
  message: string;
  status: number;
  code: string;
  clientView: ErrorClientView;
};

/**
 * Converts any thrown error to a standardized format for HTTP responses.
 */
export function fromAnyError(error: unknown): StandardizedError {
  // Handle errors created via toThrowable() - have code/status properties
  if (error instanceof Error && 'code' in error) {
    const errorWithProps = error as Error & {
      code?: unknown;
      status?: unknown;
    };
    const status =
      typeof errorWithProps.status === 'number' ? errorWithProps.status : 500;
    const code =
      typeof errorWithProps.code === 'string'
        ? errorWithProps.code
        : 'UNCAUGHT';
    return {
      message: error.message,
      status,
      code,
      clientView: { message: error.message, code, status },
    };
  }

  // Handle generic Error instances
  if (error instanceof Error) {
    const errorWithProps = error as Error & { status?: unknown };
    const status =
      typeof errorWithProps.status === 'number' ? errorWithProps.status : 500;
    return {
      message: error.message,
      status,
      code: 'UNCAUGHT',
      clientView: { message: error.message, code: 'UNCAUGHT', status },
    };
  }

  // Handle unknown error types
  let errorString: string;
  try {
    errorString = JSON.stringify(error);
  } catch {
    // Try to get a meaningful string representation of the original error
    if (error && typeof error === 'object' && 'toString' in error) {
      try {
        errorString = error.toString();
      } catch {
        errorString = '[object Object] (circular reference)';
      }
    } else {
      errorString = String(error);
    }
  }
  return {
    message: `Uncaught error: ${errorString}`,
    status: 500,
    code: 'UNCAUGHT',
    clientView: {
      message: `Uncaught error: ${errorString}`,
      code: 'UNCAUGHT',
      status: 500,
    },
  };
}
