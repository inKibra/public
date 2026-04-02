/**
 * Test stub helper — creates a typed stub from a partial implementation.
 *
 * Use this when a test only needs a subset of an interface's fields.
 * Instead of `as any` or `as never`, provide only the fields the test uses:
 *
 * ```ts
 * const vfs = stub<OverlayFs>({ read: async () => 'content', write: async () => {} });
 * const ctx = stub<FunctionContext<{}, MyDeps, {}>>({ deps: { db: mockDb } });
 * ```
 *
 * The returned value is typed as `T` so call sites don't need casts.
 * Missing fields will be `undefined` at runtime — if the test touches them,
 * it will fail with a clear error rather than silently passing via `any`.
 */
export function stub<T>(partial: Partial<T> = {}): T {
  return partial as T;
}
