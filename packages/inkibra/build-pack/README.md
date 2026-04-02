# @inkibra/build-pack

Shared Bun build/preload utilities for Inkibra packages.

This package now supports marker-based schema and codemode transforms, so validators are generated on demand from TypeScript source instead of relying on pre-generated `.schemas.js` files.

## Installation

```bash
bun add @inkibra/build-pack
```

## Quick Start (Preload)

Use `createPreload` in your package-level `preload.ts`.

```ts
import { createPreload } from '@inkibra/build-pack';

createPreload({
  packageDir: import.meta.dir,
  matchScripts: {
    server: ['server.ts', '.test.ts', 'test', 'scripts'],
    buildClients: ['build-clients.ts'],
  },
  plugins: {
    loadSchemas: true,
    codeMode: true,
    assetsPath: true,
  },
});
```

`codeMode: true` auto-resolves `@inkibra/ai-flow/codemode/plugin` when available.

## Marker-Based Schemas

### What changed

- `loadSchemasPlugin` now transforms schema source directly (`schemas.ts`, `*.schemas.ts`).
- No sibling `.schemas.js` file is required for migrated packages.
- Marker calls like `defineRouteSchema<T>()` are expanded to typia validators at build time.

### Marker usage in app code

```ts
import { defineRouteSchema } from '@inkibra/router';

type LoginContract = {
  pathParams: {};
  pathQuery: {};
  body: { email: string; password: string };
  response: { ok: true };
};

export const loginSchema = defineRouteSchema<LoginContract>();
```

### Registering type macros in a package

Package authors declare macro files in `package.json`:

```json
{
  "inkibra": {
    "build-pack": {
      "type-macros": ["./type-macros/index.type-macros.ts"]
    }
  }
}
```

Macro files must:

- use the `*.type-macros.ts` suffix
- export generic functions that return a value
- be self-contained (no free globals/free variables)
- only use runtime imports they need (for example `typia`)

## Codemode Marker (`.tool.ts`)

Use `defineCodeBinding` for exported tool bindings in `.tool.ts` files.

```ts
import { defineCodeBinding } from '@inkibra/ai-flow/codemode';

/** Fetches a user by id */
export const fetchUser = defineCodeBinding(
  async function fetchUser(
    { userId }: { userId: string },
    { deps }: { deps: { db: { getUser(id: string): Promise<{ id: string }> } } },
  ) {
    return deps.db.getUser(userId);
  },
);
```

## Warm Typia Cache

Build-pack includes a warmup script that pre-transforms schema files and `.tool.ts` files.

From `packages/inkibra/build-pack`:

```bash
bun run warm:typia-cache
```

From another package (example):

```bash
bun run ../build-pack/warm-typia-cache.ts
```

Optional cache location override:

```bash
INKIBRA_TYPIA_CACHE_DIR=/tmp/inkibra-typia-cache bun test
```

## Available Exports

- `createPreload`
- `loadSchemasPlugin`
- `assetsPathPlugin`
- `clientBuildPlugin`
- `clientStubPlugin`
- `defineCodeBinding` (generic marker)
- `generateSchemas` (legacy/manual flow support)

## Migration Notes

- Migrated packages should prefer marker APIs + preload plugins.
- Non-migrated packages can keep `generate:schemas` scripts until they are moved.
- During migration, both models may coexist package-by-package.

## Related Docs

- `./plugins/CLIENT_BUILD_PLUGIN.md`

## Development

```bash
# Type check
bun run check:tsc

# Tests
bun test

# Clean
bun run clean
```

## License

SEE LICENSE

## Repository

https://github.com/inkibra/core
