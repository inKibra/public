import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './examples/drizzle-schema.ts',
  out: './examples/drizzle',
  dialect: 'postgresql',
  driver: 'pglite',
  dbCredentials: {
    // PGlite file path (studio should work with this)
    url: process.env.PGLITE_PATH || './dev-db',
  },
});
