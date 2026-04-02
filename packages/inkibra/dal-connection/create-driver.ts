import type { Driver } from './driver';
import { DrizzleDriver } from './drivers/drizzle-driver';

/**
 * Preferred database driver type.
 * - 'postgres-js': Use postgres-js driver (works in Node.js and Bun)
 * - 'bun-sql': Use Bun's built-in SQL driver (only works in Bun runtime)
 * - 'auto': Auto-detect based on runtime (Bun uses bun-sql, Node uses postgres-js)
 */
export type PreferredDriver = 'postgres-js' | 'bun-sql' | 'auto';

export type CreateDriverOptions = {
  /** Database URL (required for non-test environments) */
  databaseUrl?: string;
  /** Force test mode (uses PGlite in-memory) */
  forceTest?: boolean;
  /** Maximum connections for connection pool */
  maxConnections?: number;
  /** SSL configuration (auto-detected for PlanetScale) */
  ssl?: boolean | 'require' | 'prefer';
  /** PGLite data directory for file-based persistence (test mode only) */
  dataDir?: string;
  /**
   * Preferred database driver.
   * - 'postgres-js': Use postgres-js driver (works in Node.js and Bun)
   * - 'bun-sql': Use Bun's built-in SQL driver (only works in Bun runtime)
   * - 'auto': Auto-detect based on runtime (Bun uses bun-sql, Node uses postgres-js)
   *
   * Can also be set via DAL_DRIVER environment variable.
   * Priority: options.preferredDriver > DAL_DRIVER env var > 'auto'
   *
   * @default 'auto'
   */
  preferredDriver?: PreferredDriver;
};

/**
 * Create a database driver based on environment
 *
 * - In test environments (NODE_ENV=test): Uses PGlite in-memory
 * - In all other environments: Uses DrizzleDriver with the provided DATABASE_URL
 *
 * @example
 * ```typescript
 * // In application code
 * const driver = await createDriver({
 *   databaseUrl: process.env.DATABASE_URL,
 * });
 *
 * // In tests (automatically uses PGlite)
 * const driver = await createDriver();
 * ```
 */
export async function createDriver(
  options: CreateDriverOptions = {},
): Promise<Driver> {
  const isTest = options.forceTest || process.env.NODE_ENV === 'test';

  const isBun =
    typeof globalThis.Bun !== 'undefined' || Boolean(process.versions?.bun);

  const databaseUrl = options.databaseUrl || process.env.DATABASE_URL;
  let ssl: CreateDriverOptions['ssl'] = options.ssl;

  // Determine preferred driver: options > env var > auto
  const envDriver = process.env.DAL_DRIVER as PreferredDriver | undefined;
  const preferredDriver = options.preferredDriver ?? envDriver ?? 'auto';

  // Determine if we should use Bun SQL
  const useBunSql =
    preferredDriver === 'bun-sql' || (preferredDriver === 'auto' && isBun);

  // Validate: can't use bun-sql outside of Bun runtime
  if (useBunSql && !isBun) {
    throw new Error(
      "Cannot use 'bun-sql' driver outside of Bun runtime. " +
        "Either run with Bun or set preferredDriver to 'postgres-js'.",
    );
  }

  // Test environment: Use PGlite (in-memory or file-based)
  if (isTest) {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');

    // Use dataDir if provided for file-based persistence, otherwise in-memory
    const pglite = options.dataDir ? new PGlite(options.dataDir) : new PGlite();
    const db = drizzle(pglite);

    return DrizzleDriver.fromDb({ db, driverType: 'pglite' });
  }

  // Production/Development: Require DATABASE_URL
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is required. Set it in your environment or pass it via options.databaseUrl',
    );
  }

  // If caller didn't specify ssl, infer it from common Postgres connection params.
  // postgres.js requires `ssl` to be set explicitly; `?sslmode=require` isn't automatically honored.
  if (ssl === undefined) {
    try {
      const url = new URL(databaseUrl);
      const sslMode = url.searchParams.get('sslmode')?.toLowerCase();
      if (sslMode === 'require') ssl = 'require';
      if (sslMode === 'prefer') ssl = 'prefer';
      if (sslMode === 'disable') ssl = false;
      // libpq modes that still imply SSL; postgres.js doesn't implement the full matrix,
      // but requiring SSL is the correct baseline behavior here.
      if (sslMode === 'verify-ca' || sslMode === 'verify-full') ssl = 'require';
    } catch {
      // ignore parse errors; fallback to driver heuristics
    }
  }

  // Use Bun SQL driver when in Bun runtime (unless explicitly using postgres-js)
  if (useBunSql) {
    const { drizzle } = await import('drizzle-orm/bun-sql');

    // Bun doesn't support libpq sslmode matrix; "require"/"prefer" both map to enabling TLS.
    const tls = ssl === false ? false : true;

    const db = drizzle({
      connection: {
        url: databaseUrl,
        max: options.maxConnections ?? 10,
        tls,
      },
    });

    return DrizzleDriver.fromDb({
      db,
      client: db.$client,
      driverType: 'bun-sql',
    });
  }

  // Default: Use postgres-js driver
  return new DrizzleDriver({
    connectionString: databaseUrl,
    maxConnections: options.maxConnections,
    ssl,
  });
}

/**
 * Create a PGlite-based driver for testing
 * By default creates an in-memory database, but can use a file-based database
 * for shared state between processes (e.g., server and E2E seed scripts)
 *
 * @example
 * ```typescript
 * // In-memory (default)
 * const driver = await createTestDriver();
 *
 * // File-based for shared state
 * const driver = await createTestDriver({ dataDir: './e2e-pglite' });
 * ```
 */
export async function createTestDriver(
  options: { dataDir?: string } = {},
): Promise<Driver> {
  return createDriver({ forceTest: true, dataDir: options.dataDir });
}
