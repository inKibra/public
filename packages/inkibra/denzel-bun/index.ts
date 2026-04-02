/**
 * @inkibra/denzel-bun
 *
 * Bun-native HTTP server for @inkibra/router with:
 * - Context codec providers (HTTP-aware context handling)
 * - API route handlers with dependency injection
 * - EventStream handlers with generator pattern
 * - Redis-backed channel factory for multi-server event routing
 * - Bun.serve wrapper with URLPattern routing
 */

export * from './lib';
