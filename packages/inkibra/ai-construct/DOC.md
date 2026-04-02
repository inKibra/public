# ai-construct Runtime Integration Spec (Draft)

Status: Draft v0.1

## Spec Index (v0.2)

Detailed serving/client architecture specs now live in:

- `packages/inkibra/ai-construct/spec/architecture.md`
- `packages/inkibra/ai-construct/spec/security.md`
- `packages/inkibra/ai-construct/spec/api.md`
- `packages/inkibra/ai-construct/spec/operations.md`
- `packages/inkibra/ai-construct/spec/durable-runtime-test-plan.md`
- `packages/inkibra/ai-construct/spec/tonetempo.md`

This file remains a compact overview and planning context.

## Goal

Integrate `ai-construct` into systems like ToneTempo/Recordless with:

- pluggable tools from other packages,
- portable runtime execution (cloud or local device),
- stable API endpoints for clients,
- coarse activity notifications instead of raw impulse streaming.

## Architecture

### Control plane (server)

- Stable endpoint clients always call.
- Owns construct registry, leases, ingress queue, and activity fanout.
- Routes/proxies requests to whichever runtime currently owns the lease.

### Runtime plane (host)

- Executes the construct (`Construct`) on cloud worker or local device.
- Processes perceptions, scheduling, responses, and compaction.
- Emits activity/status events and periodic checkpoints.

### Storage plane

- Construct state is data: VFS + scheduler/runtime metadata.
- Versioned snapshots/checkpoints for handoff safety.

## Lease Model

Single active lease per construct.

Lifecycle:

1. Acquire lease (`constructId`, `hostId`, `mode`).
2. Renew lease heartbeat until done.
3. Release lease with checkpoint.
4. On lease expiry, server reclaims and can resume cloud runtime.

Server remains the stable endpoint regardless of where runtime executes.

## Tool Extensibility

Use package-provided tool providers.

- Providers register tools by scope (e.g. `impulse.think`, `response.generate`, `scheduler.decide`).
- Policies gate tool usage by stage/perception.
- Tool contract is host-agnostic so the same toolset works local/cloud.

## API Surface (initial)

- `POST /constructs/:id/ingest`
- `POST /constructs/:id/presence`
- `POST /constructs/:id/start`
- `POST /constructs/:id/stop`
- `GET /constructs/:id/state`
- `POST /constructs/:id/lease/acquire`
- `POST /constructs/:id/lease/renew`
- `POST /constructs/:id/lease/release`
- `GET /constructs/:id/activity` (SSE/WS)

## Activity Notifications (default client stream)

Expose coarse state transitions, not raw impulse internals:

- `idle`
- `impulse_active` (+ impulse type)
- `response_deciding`
- `response_generating`
- `response_evaluating`
- `response_typing`
- `response_delivered`
- `nap_running`
- `nap_error`

Debug streams can include detailed impulse/eval/tool traces.

## Self-host / Portable Handle

Constructs should be portable via lease + checkpoint.

- A user can lease runtime to local device.
- Server forwards ingress to local runtime while lease is active.
- On release, local runtime persists checkpoint and server resumes hosting.

Potential billing principal for each lease:

- server credits,
- client-provided credits.

## Profiles

- `managed`: locked model/prompt policy, editable identity/memory via VFS.
- `advanced`: allowlisted model/prompt overrides.
- `self_host`: full model/provider/prompt/tool control.

## Open Questions

1. Snapshot vs delta checkpoints for v1 handoff?
2. Lease TTL and renewal interval defaults?
3. Which profile is default for production ToneTempo?
4. Which scheduler tools (if any) should be enabled initially?
