/**
 * A generic error descriptor.
 */
export type ErrorDescriptor<
  Code extends string,
  Message extends string,
  Data,
> = {
  /**
   * The error code.
   */
  code: Code;
  /**
   * The error message.
   */
  message: Message;
  /**
   * The error data.
   */
  data: Data;
  /**
   * Optional original error that caused this error.
   */
  causedBy?: unknown;
};

/**
 * Safely stringifies data, handling circular references gracefully.
 * If circular references are detected, returns a descriptive fallback message.
 */
function safeStringify(data: unknown, space?: number): string {
  const visited = new WeakSet<object>();

  try {
    return JSON.stringify(
      data,
      (_key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (visited.has(value)) {
            return '[Circular Reference]';
          }
          visited.add(value);
        }
        return value;
      },
      space,
    );
  } catch {
    // Fallback if JSON.stringify still fails (e.g., BigInt, functions, etc.)
    try {
      // Try to get a meaningful string representation
      if (data && typeof data === 'object' && 'toString' in data) {
        const str = data.toString();
        if (str !== '[object Object]') {
          return str;
        }
      }
      return '[Unable to stringify data: contains circular references or unsupported types]';
    } catch {
      return '[Unable to stringify data: contains circular references or unsupported types]';
    }
  }
}

export namespace ErrorDescriptor {
  /**
   * Creates an error descriptor.
   * @param code The error code.
   * @param message The error message.
   * @param data The error data.
   * @returns
   */
  export function create<E extends ErrorDescriptor<string, string, unknown>>(
    code: E['code'],
    message: E['message'],
    data: E['data'],
    causedBy?: unknown,
  ): E {
    return {
      code,
      message,
      data,
      ...(causedBy !== undefined && { causedBy }),
    } as E;
  }

  export function toError<E extends ErrorDescriptor<string, string, unknown>>(
    errorDescriptor: E,
  ): Error {
    return new Error(
      `${errorDescriptor.code}: ${errorDescriptor.message}.\n${safeStringify(
        errorDescriptor.data,
        4,
      )}`,
    );
  }
}

// -------------------------------------------------------------------------------------
// defineError - Factory for creating typed error definitions
// -------------------------------------------------------------------------------------

/**
 * The final defined error type with create and is methods.
 */
type DefinedError<
  DataType,
  Code extends string,
  MessageTemplate extends string,
> = {
  /**
   * The error code for this error type.
   */
  readonly code: Code;

  /**
   * Creates an instance of this error descriptor.
   * @param message The error message (must match MessageTemplate)
   * @param data The error data (must match DataType)
   * @param causedBy Optional original error that caused this error
   */
  create<Message extends MessageTemplate, Data extends DataType>(
    message: Message,
    data: Data,
    causedBy?: unknown,
  ): ErrorDescriptor<Code, Message, Data>;

  /**
   * Type guard to check if an unknown error descriptor matches this error type.
   * @param descriptor The descriptor to check
   */
  is(
    descriptor: ErrorDescriptor<string, string, unknown>,
  ): descriptor is ErrorDescriptor<Code, MessageTemplate, DataType>;
};

/**
 * Builder for defining an error type. Call .message<T>() to add a message template.
 */
type ErrorBuilder<DataType, Code extends string> = DefinedError<
  DataType,
  Code,
  string
> & {
  /**
   * Adds a message template constraint to this error type.
   * @example
   * const MyError = defineError('MY_ERROR')
   *   .message<`Failed for ID: ${string}`>();
   */
  message<MessageTemplate extends string>(): DefinedError<
    DataType,
    Code,
    MessageTemplate
  >;
};

function createDefinedError<
  DataType,
  Code extends string,
  MessageTemplate extends string,
>(code: Code): DefinedError<DataType, Code, MessageTemplate> {
  return {
    code,

    create<Message extends MessageTemplate, Data extends DataType>(
      message: Message,
      data: Data,
      causedBy?: unknown,
    ): ErrorDescriptor<Code, Message, Data> {
      const descriptor: ErrorDescriptor<Code, Message, Data> = {
        code,
        message,
        data,
      };
      if (causedBy !== undefined) {
        descriptor.causedBy = causedBy;
      }
      return descriptor;
    },

    is(
      descriptor: ErrorDescriptor<string, string, unknown>,
    ): descriptor is ErrorDescriptor<Code, MessageTemplate, DataType> {
      return descriptor.code === code;
    },
  };
}

/**
 * Defines a reusable error type with a factory for creating instances.
 *
 * @example
 * // Define an error with typed data and message template
 * const NetworkError = defineError<{ url: string; status: number }>('NETWORK_ERROR')
 *   .message<`Failed to fetch: ${string}`>();
 *
 * // Create an instance
 * const error = NetworkError.create(
 *   'Failed to fetch: /api/users',
 *   { url: '/api/users', status: 500 }
 * );
 *
 * // Without explicit data type (uses unknown)
 * const SimpleError = defineError('SIMPLE_ERROR');
 *
 * // Extract the type
 * type NetworkErrorDescriptor = ErrorDescriptorType<typeof NetworkError>;
 *
 * @param code The error code
 * @returns An error builder - call .message<T>() to add a message template
 */
export function defineError<const Code extends string, DataType = unknown>(
  code: Code,
): ErrorBuilder<DataType, Code> {
  return {
    code,

    create<Message extends string, Data extends DataType>(
      message: Message,
      data: Data,
      causedBy?: unknown,
    ): ErrorDescriptor<Code, Message, Data> {
      const descriptor: ErrorDescriptor<Code, Message, Data> = {
        code,
        message,
        data,
      };
      if (causedBy !== undefined) {
        descriptor.causedBy = causedBy;
      }
      return descriptor;
    },

    is(
      descriptor: ErrorDescriptor<string, string, unknown>,
    ): descriptor is ErrorDescriptor<Code, string, DataType> {
      return descriptor.code === code;
    },

    message<MessageTemplate extends string>(): DefinedError<
      DataType,
      Code,
      MessageTemplate
    > {
      return createDefinedError<DataType, Code, MessageTemplate>(code);
    },
  };
}

/**
 * Extracts the ErrorDescriptor type from a defined error.
 *
 * @example
 * const ValidationError = defineError('VALIDATION_ERROR')
 *   .message<'Field validation failed'>();
 *
 * type ValidationErrorDescriptor = ErrorDescriptorType<typeof ValidationError>;
 * // = ErrorDescriptor<'VALIDATION_ERROR', 'Field validation failed', unknown>
 */
export type ErrorDescriptorType<T> = T extends {
  create: (
    ...args: never[]
  ) => ErrorDescriptor<infer Code, infer Message, infer Data>;
}
  ? ErrorDescriptor<Code, Message, Data>
  : never;

/**
 * Converts an ErrorDescriptor to a throwable Error instance.
 * Handles error chaining via the `causedBy` field if present.
 *
 * @example
 * const descriptor = UnauthenticatedError.create(
 *   'You must authenticate your request using the auth api first',
 *   { path: '/api/users' }
 * );
 * throw toThrowable(descriptor);
 *
 * @example
 * // With error chaining and status code
 * try {
 *   await someOperation();
 * } catch (originalError) {
 *   const descriptor = UnauthenticatedError.create(
 *     'You must authenticate your request using the auth api first',
 *     { path: '/api/users' },
 *     originalError
 *   );
 *   throw toThrowable(descriptor, StatusCode.NOT_AUTHENTICATED);
 * }
 *
 * @param descriptor The error descriptor to convert
 * @param status Optional HTTP status code to preserve for error handling middleware
 * @returns A throwable Error instance
 */
export function toThrowable<E extends ErrorDescriptor<string, string, unknown>>(
  descriptor: E,
  status?: number,
): Error {
  const error = new Error(
    `${descriptor.code}: ${descriptor.message}.\n${safeStringify(
      descriptor.data,
      4,
    )}`,
  );

  if (descriptor.causedBy) {
    const causeName =
      descriptor.causedBy instanceof Error
        ? descriptor.causedBy.name
        : 'Unknown';
    const causeStack =
      descriptor.causedBy instanceof Error
        ? descriptor.causedBy.stack
        : String(descriptor.causedBy);
    error.message = `${error.message}\nCaused By ${causeName}`;
    if (causeStack) {
      error.stack = error.stack
        ? `${error.stack}\nCaused By ${causeStack}`
        : `Caused By ${causeStack}`;
    }
  }

  // Add descriptor properties to error for easy access
  // biome-ignore lint/suspicious/noExplicitAny: intentionally adding properties to Error
  (error as any).code = descriptor.code;
  // biome-ignore lint/suspicious/noExplicitAny: intentionally adding properties to Error
  (error as any).data = descriptor.data;
  if (status !== undefined) {
    // biome-ignore lint/suspicious/noExplicitAny: intentionally adding properties to Error
    (error as any).status = status;
  }

  return error;
}

// -------------------------------------------------------------------------------------
// Built-in Error Types (using the new defineError pattern)
// -------------------------------------------------------------------------------------

/**
 * Error for uncaught/unhandled errors.
 *
 * @example
 * const error = UncaughtError.create(
 *   'Uncaught error purpose: Database connection failed',
 *   { originalError: err }
 * );
 */
export const UncaughtError = defineError<
  'UNCAUGHT',
  { originalError?: unknown }
>('UNCAUGHT').message<`Uncaught error purpose: ${string}`>();
