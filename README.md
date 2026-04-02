# inKibra Open Source

Open source packages from [inKibra](https://inkibra.com).

## Packages

### Core

- **@inkibra/api-base** -- Type-safe API route definitions, HTTP handling, SSE support, and SDK foundations
- **@inkibra/error-base** -- Structured error system with `defineError()` factory and error descriptors
- **@inkibra/logger** -- Pino-based structured logging with configurable levels and child loggers
- **@inkibra/router** -- Type-safe routing with query DSL, mutations, loaders, and React hooks
- **@inkibra/environment** -- Typed environment variable management with Pulumi ESC integration
- **@inkibra/observable-cache** -- RxJS-based caching with Immutable.js Maps and observable streams
- **@inkibra/query-cache** -- Cache with optimistic overlays, DSL querying, and SSR hydration
- **@inkibra/crypto-jwt-claim** -- JWT token issuance and validation using HS512
- **@inkibra/blob-storage** -- File storage across Local, GCS, and hybrid backends with signed URLs
- **@inkibra/storage-proxy** -- Browser localStorage/sessionStorage proxy wrapper (deprecated)

### Web Framework (Denzel)

- **@inkibra/denzel** -- Express-based HTTP server with context management and dependency injection
- **@inkibra/denzel-bun** -- Bun-native HTTP server with context codecs and Redis-backed routing
- **@inkibra/denzel-cli** -- CLI for site-asset management and Cloudflare Worker deployment
- **@inkibra/denzel-workers** -- Cloudflare Workers for R2 content serving and site asset routing
- **@inkibra/build-pack** -- Shared Bun build plugins for schema generation, assets, and codemode transforms
- **@inkibra/example-web-app** -- Example app demonstrating router and denzel-bun integration
- **@inkibra/storybook** -- AST-based storybook with automated story discovery and Playwright testing

### Data

- **@inkibra/dal-connection** -- Type-safe Data Access Layer supporting Postgres (Drizzle) and Couchbase
- **@inkibra/data-tool** -- CLI for managing Couchbase data operations in development
- **@inkibra/fsm-utils** -- Type-safe finite state machine utilities with instruction recording and replay

### AI

- **@inkibra/ai-flow** -- Streaming-first AI workflow orchestration with structured outputs and tool execution
- **@inkibra/ai-construct** -- Cognitive architecture for AI agents with persistent memory and impulse-driven processing
- **@inkibra/ai-sandbox-computer** -- Sandboxed command execution for AI constructs with preview/commit semantics

### Distributed Systems

- **@inkibra/streams** -- Durable ordered stream primitives with Redis-first replay and Postgres fallback
- **@inkibra/mailbox** -- Durable mailbox semantics built on streams with consumer progress tracking
- **@inkibra/actor** -- Mailbox-backed durable actor runtime with checkpointing and lease management
- **@inkibra/workflow** -- Type-safe resumable workflow system for long-running processes with event coordination

### Testing

- **@inkibra/test-support** -- Internal testing utilities and stubbing infrastructure

### Tauri Plugins

- **@inkibra/tauri-plugin-auth** -- iOS authentication via ASWebAuthenticationSession with keychain integration
- **@inkibra/tauri-plugin-context-menu** -- Native context menus for iOS with custom actions
- **@inkibra/tauri-plugin-geolocation** -- Device position tracking with altitude, heading, and speed
- **@inkibra/tauri-plugin-haptic-feedback** -- Haptic feedback patterns for iOS devices
- **@inkibra/tauri-plugin-iap** -- In-app purchases with product fetching and subscription validation
- **@inkibra/tauri-plugin-map-display** -- Interactive MapKit maps for iOS
- **@inkibra/tauri-plugin-notifications** -- Push notification management with permission handling
- **@inkibra/tauri-plugin-ota** -- Over-the-air frontend updates without App Store resubmission
- **@inkibra/tauri-plugin-sharing** -- Native iOS sharing via UIActivityViewController
- **@inkibra/tauri-plugin-example-app** -- Reference app demonstrating all Tauri plugins

## License

MIT - see [LICENSE](./LICENSE)
