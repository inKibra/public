#!/usr/bin/env bun
/**
 * Integration test for the new batch scheduler + response flow.
 *
 * Exercises the full pipeline:
 *   impulse → scheduler (procedural fast path) → generate → evalDraft → deliver
 *
 * Uses real OpenRouter API calls with Kimi.
 */

import 'dotenv/config';
import { execSync } from 'node:child_process';
import initLogger from '@inkibra/logger';
import OpenAI from 'openai';
import type { ConstructEvent } from '../construct/types';
import {
  createConstruct,
  createFileStorage,
  DEFAULT_CONSTRUCT_LANES,
  DEFAULT_IMPULSE_PROFILES,
} from '../index';

// ── Config ──────────────────────────────────────────────────────

const apiKey =
  process.env.OPENROUTER_API_KEY ??
  (() => {
    try {
      return execSync(
        "docker inspect inkibra-bifrost-gateway --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^OPENROUTER_API_KEY=//p'",
        { encoding: 'utf8' },
      ).trim();
    } catch {
      return undefined;
    }
  })();

if (!apiKey) {
  console.error('ERROR: OPENROUTER_API_KEY not found. Set it or run bifrost.');
  process.exit(1);
}

const baseURL = 'https://openrouter.ai/api/v1';
const model = 'moonshotai/kimi-k2.5';
const constructId = `integration-test-batch-${Date.now()}`;
const storagePath = `/tmp/ai-construct-integration-test-${Date.now()}`;
const logger = initLogger('integration-test-batch');

console.log('=== Integration Test: Batch Scheduler + Response Flow ===');
console.log(`constructId: ${constructId}`);
console.log(`model: ${model}`);
console.log(`storage: ${storagePath}`);
console.log('');

// ── Create construct ────────────────────────────────────────────

const openAI = new OpenAI({ apiKey, baseURL });
const deps = { openAI, logger };

const construct = await createConstruct({
  id: constructId,
  storage: createFileStorage(storagePath),
  deps,
  model,
  impulseProfiles: DEFAULT_IMPULSE_PROFILES,
  computerConfig: {},
  lanes: DEFAULT_CONSTRUCT_LANES,
});

// ── Event tracking ──────────────────────────────────────────────

const events: ConstructEvent[] = [];
const eventTimeline: Array<{ type: string; ts: number; detail?: string }> = [];
const startMs = Date.now();

construct.onEvent((event) => {
  events.push(event);
  const elapsed = Date.now() - startMs;
  let detail = '';

  switch (event.type) {
    case 'impulse:started':
      detail = `impulseId=${event.impulseId}`;
      break;
    case 'impulse:completed':
      detail = `impulseId=${event.impulseId} durationMs=${event.durationMs}`;
      break;
    case 'response:scheduled':
      detail = `responseId=${event.responseId} intent="${event.intent}"`;
      break;
    case 'scheduler:considered':
      detail = `ready=${event.consideration.readyIds.length} blocked=${event.consideration.blockedIds.length} activeImpulses=${event.consideration.activeImpulseIds.length} usedAi=${event.consideration.usedAi} gateDelayMs=${event.consideration.gateDelayMs} gateReason=${event.consideration.gateReason}`;
      break;
    case 'scheduler:decided':
      if (event.decision.action === 'wait') {
        const waitUntil = event.decision.waitUntil
          ? JSON.stringify(event.decision.waitUntil)
          : 'none';
        detail = `action=wait waitUntil=${waitUntil} reason="${event.decision.reason}" aiMs=${event.metrics?.aiDecisionMs ?? '?'}ms totalMs=${event.metrics?.totalSchedulerMs ?? '?'}ms`;
      } else {
        detail = `action=act respondTo=[${event.decision.respondTo.join(',')}] drop=[${event.decision.drop.join(',')}] gateMs=${event.metrics?.gateDelayMs ?? '?'}ms aiMs=${event.metrics?.aiDecisionMs ?? '?'}ms totalMs=${event.metrics?.totalSchedulerMs ?? '?'}ms`;
      }
      break;
    case 'response:batch_started':
      detail = `respondTo=[${event.respondTo.join(',')}]`;
      break;
    case 'response:batch_completed':
      detail = `disposition=${event.disposition} durationMs=${event.durationMs}`;
      break;
    case 'response:selected':
      detail = `responseId=${event.responseId}`;
      break;
    case 'response:executing':
      detail = `responseId=${event.responseId}`;
      break;
    case 'response:delivered':
      detail = `responseId=${event.responseId}`;
      break;
    case 'response:dropped':
      detail = `responseId=${event.responseId} reason=${event.reason}`;
      break;
    case 'response:thinking':
      if (event.delta.startsWith('[[stage:')) {
        detail = `stage=${event.stage}`;
      } else {
        return; // skip thinking deltas from timeline
      }
      break;
    default:
      return; // skip other events from timeline
  }

  eventTimeline.push({ type: event.type, ts: elapsed, detail });
  console.log(`  [${elapsed}ms] ${event.type} ${detail}`);
});

let deliveredContent = '';
construct.onResponse((response) => {
  deliveredContent += (deliveredContent ? '\n\n' : '') + response.content;
});

// ── Start and send message ──────────────────────────────────────

construct.start();

console.log('Sending: "Hey, what is 2+2? Also, what day is it?"');
console.log('');

await construct.ingest({
  lane: 'conversation',
  role: 'user',
  source: 'user_message',
  content: 'Hey, what is 2+2? Also, what day is it?',
  occurredAt: new Date(),
  receivedAt: new Date(),
});

// ── Wait for terminal event ─────────────────────────────────────

const deadline = Date.now() + 120_000;
let terminal = false;

while (Date.now() < deadline) {
  const state = await construct.getRuntimeState();
  if (
    events.some(
      (e) =>
        e.type === 'response:delivered' ||
        e.type === 'response:batch_completed',
    ) &&
    state.activeResponses === 0 &&
    state.scheduledResponses === 0 &&
    state.activeImpulses === 0
  ) {
    terminal = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 200));
}

construct.stop();
const totalMs = Date.now() - startMs;

// ── Report ──────────────────────────────────────────────────────

console.log('');
console.log('=== Results ===');
console.log(`Terminal: ${terminal}`);
console.log(`Total: ${totalMs}ms`);
console.log('');

// Key events check
const hasSchedulerConsidered = events.some(
  (e) => e.type === 'scheduler:considered',
);
const hasSchedulerDecided = events.some((e) => e.type === 'scheduler:decided');
const hasBatchStarted = events.some((e) => e.type === 'response:batch_started');
const hasBatchCompleted = events.some(
  (e) => e.type === 'response:batch_completed',
);
const hasDelivered = events.some((e) => e.type === 'response:delivered');
const hasDecide = events.some(
  (e) => e.type === 'response:thinking' && e.stage === 'response/decide',
);
const hasGenerate = events.some(
  (e) => e.type === 'response:thinking' && e.stage === 'response/generate',
);
const hasEvalDraft = events.some(
  (e) => e.type === 'response:thinking' && e.stage === 'response/evalDraft',
);

// Extract scheduler metrics
const decidedEvent = events.find((e) => e.type === 'scheduler:decided') as
  | Extract<(typeof events)[number], { type: 'scheduler:decided' }>
  | undefined;
const consideredEvent = events.find((e) => e.type === 'scheduler:considered') as
  | Extract<(typeof events)[number], { type: 'scheduler:considered' }>
  | undefined;
const metrics = decidedEvent?.metrics;

console.log('Event checks:');
console.log(
  `  scheduler:considered  = ${hasSchedulerConsidered ? 'YES' : 'NO'}`,
);
console.log(`  scheduler:decided     = ${hasSchedulerDecided ? 'YES' : 'NO'}`);
console.log(`  response:batch_started    = ${hasBatchStarted ? 'YES' : 'NO'}`);
console.log(
  `  response:batch_completed  = ${hasBatchCompleted ? 'YES' : 'NO'}`,
);
console.log(`  response:delivered    = ${hasDelivered ? 'YES' : 'NO'}`);
console.log(
  `  response/decide stage = ${hasDecide ? 'YES (BAD - should be removed!)' : 'NO (good)'}`,
);
console.log(`  response/generate     = ${hasGenerate ? 'YES' : 'NO'}`);
console.log(`  response/evalDraft    = ${hasEvalDraft ? 'YES' : 'NO'}`);
console.log('');
console.log('Gate + AI metrics:');
console.log(
  `  gateReason     = ${consideredEvent?.consideration.gateReason ?? '?'}`,
);
console.log(`  gateDelayMs    = ${metrics?.gateDelayMs ?? '?'}ms`);
console.log(`  aiDecisionMs   = ${metrics?.aiDecisionMs ?? '?'}ms`);
console.log(`  aiWaitCount    = ${metrics?.aiWaitCount ?? '?'}`);
console.log(`  totalMs        = ${metrics?.totalSchedulerMs ?? '?'}ms`);
console.log('');

if (deliveredContent) {
  console.log('Delivered response:');
  console.log(
    `  "${deliveredContent.slice(0, 200)}${deliveredContent.length > 200 ? '...' : ''}"`,
  );
} else {
  console.log('WARNING: No response delivered!');
}

console.log('');
console.log('=== Event Timeline ===');
for (const entry of eventTimeline) {
  console.log(`  [${entry.ts}ms] ${entry.type} ${entry.detail ?? ''}`);
}

// ── Assertions ──────────────────────────────────────────────────

let passed = true;
function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    passed = false;
  } else {
    console.log(`PASS: ${message}`);
  }
}

console.log('');
console.log('=== Assertions ===');
assert(terminal, 'Reached terminal state');
assert(hasSchedulerConsidered, 'scheduler:considered event emitted');
assert(hasSchedulerDecided, 'scheduler:decided event emitted');
assert(hasBatchStarted, 'response:batch_started event emitted');
assert(hasBatchCompleted, 'response:batch_completed event emitted');
assert(hasDelivered, 'response:delivered event emitted');
assert(!hasDecide, 'response/decide stage NOT used (removed)');
assert(hasGenerate, 'response/generate stage used');
assert(deliveredContent.length > 0, 'Response content is non-empty');
assert(totalMs < 120_000, 'Completed within timeout');
// Gate: should not delay when impulse completed before scheduler ran
assert(
  (metrics?.gateDelayMs ?? 999) < 1000,
  `Gate delay was small (${metrics?.gateDelayMs ?? '?'}ms) — impulse completed before scheduler`,
);
// AI: should have run once (no wait loops)
assert((metrics?.aiWaitCount ?? 99) === 0, 'AI scheduler did not need to wait');

console.log('');
if (passed) {
  console.log('ALL PASSED');
  process.exit(0);
} else {
  console.log('SOME FAILURES');
  process.exit(1);
}
