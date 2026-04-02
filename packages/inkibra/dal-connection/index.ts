// Export new driver architecture
//
// IMPORTANT: This barrel must stay free of server-only transitive imports
// (postgres, couchbase, drizzle-orm/bun-sql, Node built-ins) because client
// packages like ai-construct re-export from here and end up in browser builds.
//
// Server-only modules are available via direct deep imports:
//   '@inkibra/dal-connection/drivers/drizzle-driver'
//   '@inkibra/dal-connection/drivers/couchbase-driver'
//   '@inkibra/dal-connection/create-driver'
//   '@inkibra/dal-connection/service'

export * from './collection-builder';
export * from './collections';
export * from './db-result';
export * from './driver';
export * from './error-codes';

export * from './transaction-runtime';
