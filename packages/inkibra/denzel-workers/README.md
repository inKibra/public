# Denzel Workers

Cloudflare Workers for the denzel deployment system.

## Workers

### CDN Worker

A Cloudflare Worker for serving R2-stored content with caching and image transformation.

**Location**: `workers/cdn-worker/`

**Features**:

- Multi-bucket support via path-based routing
- Path-based authorization (only `/public/` paths allowed)
- Aggressive edge and client caching
- Optional Cloudflare Image Transformations via query params
- ETag support for conditional requests

**Path Pattern**:

```text
/{bucketName}/{mediaType}/{privacyLevel}/{contentType}/{ownerId}/{year}/{month}/{day}/{id}.{extension}
```

### Site Asset Worker

A Cloudflare Worker for serving static site assets like favicons and other static files.

**Location**: `workers/site-asset-worker/`

**Features**:

- Serves static assets from R2 storage
- Domain-based routing for multi-site support
- Favicon and manifest file serving
- Well-known file serving
- Asset caching and optimization

## Development

```bash
# Type check
bun run check:tsc

# Build
bun run build

# Development mode (watch)
bun run dev
```

## Usage

This package is used by `@inkibra/denzel-cli` for deploying Cloudflare Workers. The workers are not meant to be used directly but through the denzel CLI commands.

See the [denzel-cli documentation](../../denzel-cli/README.md) for deployment instructions.
