# CDN Worker

Cloudflare Worker for serving R2-stored content with caching and image transformation.

## Features

- Multi-bucket support via path-based routing
- Path-based authorization (only `/public/` paths allowed)
- Aggressive edge and client caching
- Optional Cloudflare Image Transformations via query params
- ETag support for conditional requests

## Path Pattern

```
/{bucketName}/{mediaType}/{privacyLevel}/{contentType}/{ownerId}/{year}/{month}/{day}/{id}.{extension}
```

**Example:**
```
https://c.inkibra.com/inkibra-site-images/images/public/blog/system/2025/10/18/nkfileloc_01k7xdf6k1f25tmx7rjje6hrgj.png
```

## Deployment

Deploy using the denzel-cli tool. The CLI is standalone and requires explicit configuration.

### 1. Create a configuration file

Create a JSON configuration file with your CDN domain and buckets:

```json
{
  "cdnDomain": "c.inkibra.com",
  "zoneName": "inkibra.com",
  "buckets": ["inkibra-site-images", "other-bucket-name"]
}
```

### 2. Deploy the worker

```bash
# Standalone deploy (no record tracking)
pulumi env open inkibra/04-inkibra-delivery/corp \
  | bun inkibra-denzel cdn-workers deploy \
    --worker-name inkibra-cdn-worker

# Deploy with record tracking
pulumi env open inkibra/04-inkibra-delivery/corp \
  | bun inkibra-denzel cdn-workers deploy \
    --worker-name inkibra-cdn-worker \
    --record-package packages/inkibra/recordless.web

# Using environment variable
export CDN_WORKER_NAME=inkibra-cdn-worker
pulumi env open inkibra/04-inkibra-delivery/corp \
  | bun inkibra-denzel cdn-workers deploy \
    --record-package packages/inkibra/recordless.web

# With config file instead of stdin
bun inkibra-denzel cdn-workers deploy \
  --config-file cdn-config.json \
  --worker-name inkibra-cdn-worker \
  --record-package packages/inkibra/recordless.web
```

### 3. Dry-run (preview configuration)

```bash
bun inkibra-denzel cdn-workers dry-run \
  --config-file cdn-config.json \
  --worker-name inkibra-cdn-worker
```

### 4. Tail logs

```bash
bun inkibra-denzel cdn-workers tail --worker-name inkibra-cdn-worker
```

### 5. Set or rotate secrets

Secrets are managed separately from deploys. Provide the CDN config (either via `CDN_CONFIG` env JSON or stdin) and run:

```bash
pulumi env run inkibra/01-infra/corp -- \
  bun inkibra-denzel cdn-workers set-secrets \
    --config-file packages/inkibra/recordless.web/workers/cdn-config.json \
    --worker-name inkibra-cdn-worker
```

Use `--dry-run` to inspect what would be applied without changing the worker:

```bash
pulumi env run inkibra/01-infra/corp -- \
  bun inkibra-denzel cdn-workers set-secrets \
    --config-file packages/inkibra/recordless.web/workers/cdn-config.json \
    --worker-name inkibra-cdn-worker \
    --dry-run
```

## Worker Name Resolution

The worker name is determined in this priority order:
1. `--worker-name` flag
2. `CDN_WORKER_NAME` environment variable
3. Error if neither provided

## Deployment Records

When using `--record-package`, the CLI writes to `<package>/workers/cdn-worker.json`:

```json
{
  "workers": [
    "inkibra-cdn-worker",
    "other-cdn-worker"
  ]
}
```

This allows tracking multiple deployed workers per package.

## Staging Directory

- Default: `.wrangler-stage/cdn-worker` (relative to current working directory)
- Override with `--stage-dir <path>`
- Staging directory is automatically cleaned up after deployment unless `--keep-stage` is used

