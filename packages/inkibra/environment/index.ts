// Package-local, bootstrap-safe structured logger for early environment diagnostics
// Writes newline-delimited JSON to stderr; no external dependencies.
const envLogger = (() => {
  type Level = 'trace' | 'debug' | 'info' | 'warn' | 'error';
  const loggerName = 'inkibra.environment';
  const order: Record<Level, number> = {
    trace: 10,
    debug: 20,
    info: 30,
    warn: 40,
    error: 50,
  };
  const configuredLevel = (
    process.env.INKIBRA_LOG_LEVEL || 'trace'
  ).toLowerCase() as Level;
  const min = order[configuredLevel] ?? order.trace;
  function write(level: Level, msg: string, fields?: Record<string, unknown>) {
    if (order[level] < min) return;
    const ts = new Date().toISOString();
    const entry: Record<string, unknown> = {
      ts,
      level,
      logger: loggerName,
      msg,
    };
    if (fields && Object.keys(fields).length) entry.fields = fields;
    const serialized = JSON.stringify(entry);
    // Browser environment — no process.stderr
    if (typeof process === 'undefined' || !process.stderr?.write) {
      const consoleFn =
        level === 'error'
          ? console.error
          : level === 'warn'
            ? console.warn
            : level === 'debug' || level === 'trace'
              ? console.debug
              : console.log;
      consoleFn(serialized);
      return;
    }
    try {
      process.stderr.write(`${serialized}\n`);
    } catch {
      // Fallback formatting if JSON serialization fails for any reason
      process.stderr.write(
        `[${ts}] ${loggerName} ${level} ${msg} ${fields ? JSON.stringify(fields) : ''}\n`,
      );
    }
  }
  return {
    trace: (m: string, f?: Record<string, unknown>) => write('trace', m, f),
    debug: (m: string, f?: Record<string, unknown>) => write('debug', m, f),
    info: (m: string, f?: Record<string, unknown>) => write('info', m, f),
    warn: (m: string, f?: Record<string, unknown>) => write('warn', m, f),
    error: (m: string, f?: Record<string, unknown>) => write('error', m, f),
  };
})();

export function GetEnvironmentVariable(
  name: string,
  defaultValue?: string,
): string {
  const value = process.env[name];
  envLogger.trace('env.lookup', { name, source: 'process.env' });
  if (value === undefined) {
    envLogger.trace('env.miss', { name });
    if (defaultValue === undefined) {
      envLogger.error('env.required.missing', { name });
      throw new Error(`Environment Variable ${name} is not set.`);
    }
    envLogger.trace('env.default', { name, defaultValue });
    return defaultValue;
  }
  envLogger.trace('env.hit', { name });
  return value;
}

export function GetOptionalEnvironmentVariable(
  name: string,
): string | undefined {
  const value = process.env[name];
  envLogger.trace('env.lookup', { name, source: 'process.env' });
  if (value === undefined) {
    envLogger.trace('env.miss', { name });
    return undefined;
  }
  envLogger.trace('env.hit', { name });
  return value;
}

export function GetEnvironmentNumber(
  name: string,
  defaultValue?: number,
): number {
  const value = process.env[name];
  envLogger.trace('env.lookup', { name, source: 'process.env' });
  if (value === undefined) {
    envLogger.trace('env.miss', { name });
    if (defaultValue === undefined) {
      envLogger.error('env.required.missing', { name });
      throw new Error(`Environment Variable ${name} is not set.`);
    }
    envLogger.trace('env.default', { name, defaultValue });
    return defaultValue;
  }
  envLogger.trace('env.hit', { name });
  const parsedValue = parseFloat(value);
  if (Number.isNaN(parsedValue)) {
    envLogger.error('env.invalid', { name, expected: 'number', raw: value });
    throw new Error(`Environment Variable ${name} is not a number.`);
  }
  return parsedValue;
}

/**
 * Gets an environment variable that is an enum.
 * @param name The name of the environment variable
 * @param values The first value is the default value. The rest are the valid values.
 * @returns The value of the environment variable or the default value if it is not set.
 */
export function GetEnvironmentEnum<T extends string>(
  name: string,
  defaultValue: T,
  ...values: T[]
): T {
  const value = process.env[name] as T;
  envLogger.trace('env.lookup', { name, source: 'process.env' });
  if (value === undefined) {
    envLogger.trace('env.miss', { name });
    if (defaultValue === undefined) {
      envLogger.error('env.required.missing', { name });
      throw new Error(`Environment Variable ${name} is not set.`);
    }
    envLogger.trace('env.default', { name, defaultValue });
    return defaultValue;
  }
  if (!values.includes(value) && value !== defaultValue) {
    envLogger.error('env.invalid', {
      name,
      expected: [defaultValue, ...values],
      raw: value,
    });
    throw new Error(
      `Environment Variable ${name} is not the default value (${defaultValue}) or one of ${values.join(', ')}.`,
    );
  }
  envLogger.trace('env.hit', { name });
  return value;
}

// Get rid of this and replace with GetEnvironmentEnum
export function GetEnvironmentFlag(
  name: string,
  defaultValue?: boolean,
): boolean {
  const value = process.env[name];
  envLogger.trace('env.lookup', { name, source: 'process.env' });
  if (value === undefined) {
    envLogger.trace('env.miss', { name });
    if (defaultValue === undefined) {
      envLogger.error('env.required.missing', { name });
      throw new Error(`Environment Variable ${name} is not set.`);
    }
    envLogger.trace('env.default', { name, defaultValue });
    return defaultValue;
  }
  envLogger.trace('env.hit', { name });
  if (typeof value === 'boolean') {
    return value;
  }
  return value === 'true';
}

export function GetEnvironmentArray(
  name: string,
  defaultValue?: string[],
): string[] {
  const value = process.env[name];
  envLogger.trace('env.lookup', { name, source: 'process.env' });
  if (value === undefined) {
    envLogger.trace('env.miss', { name });
    if (defaultValue === undefined) {
      envLogger.error('env.required.missing', { name });
      throw new Error(`Environment Variable ${name} is not set.`);
    }
    envLogger.trace('env.default', { name, defaultValue });
    return defaultValue;
  }
  envLogger.trace('env.hit', { name });
  return value.split(',');
}

export type LoadEnvOptions = {
  organization: string;
  project: string;
  scope: string;
  envName: string;
  envKey: string;
};

/**
 * Loads an environment value either from the local process env override or from
 * Pulumi ESC. Returns the raw string (no parsing). Throws with context on
 * missing keys or lookup failures.
 */
export async function loadEnv(options: LoadEnvOptions): Promise<string> {
  const { organization, project, scope, envName, envKey } = options;

  const localValue = process.env[envKey];
  if (typeof localValue === 'string') {
    return localValue;
  }

  const envIdentifier = `${project}/${envName}`;

  const esc = await import('@pulumi/esc-sdk');

  const defaultClient = esc?.DefaultClient || esc?.default?.DefaultClient;
  if (typeof defaultClient !== 'function') {
    throw new Error(
      'Unable to find DefaultClient on @pulumi/esc-sdk; verify package version and exports.',
    );
  }

  const client = defaultClient();

  if (typeof client.openAndReadEnvironment !== 'function') {
    throw new Error(
      'ESC client does not expose openAndReadEnvironment; please verify @pulumi/esc-sdk API.',
    );
  }

  const environmentResponse = await client.openAndReadEnvironment(
    organization,
    project,
    envName,
  );

  const values = environmentResponse?.values ?? {};

  const remoteValue =
    values?.environmentVariables?.[envKey] ?? values?.[envKey];

  if (typeof remoteValue !== 'string') {
    throw new Error(
      `ESC environment missing key "${envKey}" in ${envIdentifier}`,
    );
  }

  const resolvedScope =
    values?.server?.scope ?? values?.scope ?? values?.server?.envScope;
  if (resolvedScope && resolvedScope !== scope) {
    envLogger.warn('esc.scope.mismatch', {
      expected: scope,
      got: resolvedScope,
      envIdentifier,
    });
  }

  return remoteValue;
}
