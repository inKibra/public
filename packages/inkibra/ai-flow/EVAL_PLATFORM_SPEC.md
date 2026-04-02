# AI Flow Evaluation Platform Specification

**Version:** 1.0.0
**Status:** Draft
**Last Updated:** 2025-01-17
**Author:** Engineering Team

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Goals & Non-Goals](#2-goals--non-goals)
3. [Architecture Overview](#3-architecture-overview)
4. [Core Components](#4-core-components)
   - 4.1 [Evaluation Engine](#41-evaluation-engine)
   - 4.2 [Trace Collection](#42-trace-collection)
   - 4.3 [Pattern Mining](#43-pattern-mining)
   - 4.4 [Synthetic Generation](#44-synthetic-generation)
   - 4.5 [Observability Layer](#45-observability-layer)
5. [Data Models](#5-data-models)
6. [API Specification](#6-api-specification)
7. [UI/UX Specification](#7-uiux-specification)
8. [Integration Points](#8-integration-points)
9. [Implementation Phases](#9-implementation-phases)
10. [Success Metrics](#10-success-metrics)
11. [Open Questions](#11-open-questions)

---

## 1. Executive Summary

### Problem Statement

Our AI flows produce complex, multi-stage outputs (workout routines, conversations, descriptions). Currently, we lack:

- Systematic quality measurement beyond "did it run"
- Regression detection when prompts or models change
- Realistic test data that reflects actual usage patterns
- Developer visibility into production quality
- A/B testing capabilities for prompt iterations

### Proposed Solution

Build an integrated evaluation platform that:

1. **Evaluates outputs** using configurable evaluators (schema, assertions, LLM judges)
2. **Supports multiple modes**: blocking (quality gates) and sampled (observability)
3. **Mines production traces** to extract interaction patterns
4. **Generates realistic synthetic data** from those patterns
5. **Provides rich developer UX** for exploration, debugging, and comparison

### Key Innovation

Use real production traces as seeds to generate realistic synthetic variations. At each turn in a flow, branch into multiple variations to explore the interaction space while maintaining realistic distribution.

---

## 2. Goals & Non-Goals

### Goals

| ID | Goal | Priority |
|----|------|----------|
| G1 | Enable blocking evaluations that reject low-quality outputs with feedback | P0 |
| G2 | Enable sampled evaluations for production observability without latency impact | P0 |
| G3 | Extract patterns from production traces automatically | P0 |
| G4 | Generate synthetic test data that reflects real usage distribution | P0 |
| G5 | Provide visual dashboard for quality monitoring | P0 |
| G6 | Support trace exploration, filtering, and drill-down | P0 |
| G7 | Enable A/B comparison of prompt/model changes | P1 |
| G8 | Auto-curate generated traces into datasets | P1 |
| G9 | Detect quality regressions automatically | P1 |
| G10 | Support multi-turn conversation simulation | P1 |

### Non-Goals

| ID | Non-Goal | Rationale |
|----|----------|-----------|
| NG1 | Real-time inference optimization | Focus is on evaluation, not serving |
| NG2 | Model fine-tuning infrastructure | Separate concern |
| NG3 | General-purpose A/B testing platform | Only for AI flow evaluation |
| NG4 | Production traffic replay (full fidelity) | Privacy concerns; use synthetic instead |
| NG5 | Custom evaluator marketplace | Build internal evaluators only |

---

## 3. Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            AI Flow Runtime                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   Stage 1   │→ │   Stage 2   │→ │   Stage 3   │→ │   Stage N   │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
│         │                │                │                │                │
│         ▼                ▼                ▼                ▼                │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     Evaluation Interceptor                           │   │
│  │  • Check eval config  • Route to blocking/sampled  • Emit traces    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
         │                                              │
         ▼                                              ▼
┌─────────────────────┐                    ┌─────────────────────────────────┐
│  Evaluation Engine  │                    │      Trace Collector            │
│  ┌───────────────┐  │                    │  ┌────────────────────────────┐ │
│  │  Evaluators   │  │                    │  │  Trace Storage (SQLite)    │ │
│  │  • Schema     │  │                    │  └────────────────────────────┘ │
│  │  • Assertion  │  │                    │  ┌────────────────────────────┐ │
│  │  • LLM Judge  │  │                    │  │  Metrics Aggregator        │ │
│  └───────────────┘  │                    │  └────────────────────────────┘ │
└─────────────────────┘                    └─────────────────────────────────┘
                                                        │
                                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Pattern Mining                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │ Trace Clustering│→ │Template Extract │→ │ Pattern Library │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
└─────────────────────────────────────────────────────────────────────────────┘
                                                        │
                                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Synthetic Generation                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │ Variation Engine│→ │ Turn Branching  │→ │ Trace Tree      │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
└─────────────────────────────────────────────────────────────────────────────┘
                                                        │
                                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Developer Interface                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │Dashboard │  │ Explorer │  │Gen Studio│  │ Compare  │  │   CLI    │     │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Package Structure

```
@inkibra/ai-flow/
├── src/
│   ├── eval/                          # Evaluation platform
│   │   ├── core/
│   │   │   ├── evaluator.ts           # Evaluator interface & base classes
│   │   │   ├── stage-config.ts        # Per-stage eval configuration
│   │   │   ├── interceptor.ts         # Runtime evaluation interceptor
│   │   │   └── result.ts              # Evaluation result types
│   │   │
│   │   ├── evaluators/
│   │   │   ├── schema.ts              # Schema validation evaluator
│   │   │   ├── assertion.ts           # Custom assertion evaluator
│   │   │   ├── llm-judge.ts           # LLM-as-judge evaluator
│   │   │   ├── composite.ts           # Combine multiple evaluators
│   │   │   └── index.ts
│   │   │
│   │   ├── trace/
│   │   │   ├── collector.ts           # Trace collection
│   │   │   ├── store.ts               # Trace persistence
│   │   │   ├── query.ts               # Trace querying
│   │   │   └── types.ts               # Trace data types
│   │   │
│   │   ├── mining/
│   │   │   ├── clustering.ts          # Trace clustering
│   │   │   ├── template.ts            # Template extraction
│   │   │   ├── pattern.ts             # Pattern representation
│   │   │   └── miner.ts               # Pattern mining orchestration
│   │   │
│   │   ├── generation/
│   │   │   ├── variation.ts           # Variation strategies
│   │   │   ├── branching.ts           # Turn-by-turn branching
│   │   │   ├── generator.ts           # Trace generation
│   │   │   ├── curation.ts            # Auto-curation logic
│   │   │   └── job.ts                 # Generation job management
│   │   │
│   │   ├── metrics/
│   │   │   ├── aggregator.ts          # Metrics aggregation
│   │   │   ├── timeseries.ts          # Time-series storage
│   │   │   └── alerts.ts              # Alert definitions
│   │   │
│   │   ├── comparison/
│   │   │   ├── diff.ts                # Run comparison
│   │   │   ├── statistics.ts          # Statistical tests
│   │   │   └── report.ts              # Comparison reports
│   │   │
│   │   ├── cli/
│   │   │   ├── commands/              # CLI command implementations
│   │   │   ├── dashboard.ts           # Terminal dashboard
│   │   │   └── index.ts
│   │   │
│   │   ├── ui/
│   │   │   ├── server.ts              # Web UI server
│   │   │   ├── api/                   # REST API handlers
│   │   │   └── components/            # React components (if applicable)
│   │   │
│   │   └── index.ts                   # Public API exports
│   │
│   ├── codemode/                      # Existing code execution
│   ├── context/                       # Existing context management
│   └── flow.ts                        # Existing flow runtime
│
└── package.json
```

---

## 4. Core Components

### 4.1 Evaluation Engine

#### 4.1.1 Evaluator Interface

```typescript
/**
 * Base evaluator interface. All evaluators implement this.
 */
interface Evaluator<TInput = unknown> {
  /** Unique identifier for this evaluator */
  readonly name: string;

  /** Human-readable description */
  readonly description?: string;

  /**
   * Evaluate an input and return a result.
   *
   * @param input - The value to evaluate (stage output, flow snapshot, etc.)
   * @param context - Additional context for evaluation
   * @returns Evaluation result with score, pass/fail, and details
   */
  evaluate(
    input: TInput,
    context: EvalContext,
  ): Promise<EvalResult>;
}

interface EvalContext {
  /** The complete flow snapshot at evaluation time */
  flowSnapshot: FlowSnapshot<any, any>;

  /** Which stage is being evaluated (if stage-level) */
  stageName?: string;

  /** The original test case (if from dataset) */
  testCase?: TestCase;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

interface EvalResult {
  /** Normalized score from 0.0 to 1.0 */
  score: number;

  /** Binary pass/fail based on evaluator logic */
  passed: boolean;

  /** Human-readable explanation */
  reason?: string;

  /** Structured issues found */
  issues?: EvalIssue[];

  /** Additional evaluator-specific data */
  details?: unknown;

  /** Cost incurred (for LLM evaluators) */
  cost?: EvalCost;

  /** Time taken to evaluate */
  durationMs?: number;
}

interface EvalIssue {
  /** Issue severity */
  severity: 'critical' | 'major' | 'minor' | 'info';

  /** Issue category/type */
  category: string;

  /** Description of the issue */
  message: string;

  /** Path to problematic data (e.g., "blocks[2].exerciseId") */
  path?: string;

  /** Suggestion for fixing */
  suggestion?: string;
}

interface EvalCost {
  inputTokens: number;
  outputTokens: number;
  usd: number;
}
```

#### 4.1.2 Built-in Evaluators

**Schema Evaluator**

```typescript
interface SchemaEvaluatorConfig<T> {
  /** Typia validator function */
  validate: (input: unknown) => Validation<T>;

  /** Optional: treat validation warnings as failures */
  strictMode?: boolean;
}

function createSchemaEvaluator<T>(
  config: SchemaEvaluatorConfig<T>,
): Evaluator<unknown>;

// Usage
const routineSchemaEval = createSchemaEvaluator({
  validate: typia.createValidate<RoutineOutput>(),
});
```

**Assertion Evaluator**

```typescript
interface AssertionEvaluatorConfig<T> {
  /** Unique name */
  name: string;

  /** Assertion function - return true if passed */
  assert: (input: T, context: EvalContext) => boolean | Promise<boolean>;

  /** Error message when assertion fails */
  message: string;

  /** Issue severity when failed */
  severity?: 'critical' | 'major' | 'minor';
}

function createAssertionEvaluator<T>(
  config: AssertionEvaluatorConfig<T>,
): Evaluator<T>;

// Usage
const hasWarmupEval = createAssertionEvaluator({
  name: 'has-warmup',
  assert: (routine: RoutineOutput) =>
    routine.blocks.some(b => b.type === 'nktbreakblock' && b.breakKind === 'preparation'),
  message: 'Routine should include a warmup block',
  severity: 'major',
});
```

**LLM Judge Evaluator**

```typescript
interface LLMJudgeConfig<TInput, TOutput> {
  /** Unique name */
  name: string;

  /** Model to use for evaluation */
  model: string;

  /** System instructions for the judge */
  instructions: string | ((context: EvalContext) => string);

  /** Format input for the judge */
  formatInput: (input: TInput, context: EvalContext) => string;

  /** Output schema for structured response */
  outputSchema: Record<string, unknown>;

  /** Validate and parse judge output */
  validate: (raw: string) => Validation<TOutput>;

  /** Extract score from parsed output */
  extractScore: (output: TOutput) => number;

  /** Extract issues from parsed output */
  extractIssues?: (output: TOutput) => EvalIssue[];

  /** Optional: temperature for evaluation */
  temperature?: number;
}

function createLLMJudgeEvaluator<TInput, TOutput>(
  config: LLMJudgeConfig<TInput, TOutput>,
): Evaluator<TInput>;

// Usage
const qualityJudge = createLLMJudgeEvaluator({
  name: 'routine-quality',
  model: 'claude-3-haiku-20240307',
  instructions: `You are evaluating workout routine quality...`,
  formatInput: (routine, ctx) => `
    User Level: ${ctx.flowSnapshot.flowContext.userLevel}
    Routine: ${JSON.stringify(routine)}
  `,
  outputSchema: {
    type: 'object',
    properties: {
      score: { type: 'number', minimum: 0, maximum: 10 },
      issues: { type: 'array', items: { type: 'string' } },
      recommendation: { type: 'string' },
    },
    required: ['score', 'issues'],
  },
  validate: typia.createValidate<{ score: number; issues: string[]; recommendation?: string }>(),
  extractScore: (output) => output.score / 10,
  extractIssues: (output) => output.issues.map(msg => ({
    severity: 'major' as const,
    category: 'quality',
    message: msg,
  })),
});
```

**Composite Evaluator**

```typescript
interface CompositeEvaluatorConfig {
  /** Unique name */
  name: string;

  /** Evaluators with weights */
  evaluators: Array<{
    evaluator: Evaluator<any>;
    weight: number;
  }>;

  /** How to combine scores */
  combineMode: 'weighted-average' | 'minimum' | 'all-must-pass';
}

function createCompositeEvaluator(
  config: CompositeEvaluatorConfig,
): Evaluator<unknown>;

// Usage
const overallQuality = createCompositeEvaluator({
  name: 'overall-quality',
  evaluators: [
    { evaluator: routineSchemaEval, weight: 0.3 },
    { evaluator: hasWarmupEval, weight: 0.2 },
    { evaluator: qualityJudge, weight: 0.5 },
  ],
  combineMode: 'weighted-average',
});
```

#### 4.1.3 Stage Evaluation Configuration

```typescript
interface StageEvalConfig {
  /** The evaluator to use */
  evaluator: Evaluator<any>;

  /** Mode configuration by environment */
  mode: {
    development: EvalMode;
    staging: EvalMode;
    production: EvalMode;
  };

  /** Thresholds for blocking mode */
  thresholds?: {
    /** Score below this triggers rejection */
    block: number;
    /** Score below this triggers warning (but passes) */
    warn: number;
  };

  /** Generate feedback message when blocked */
  feedback?: (result: EvalResult) => { text: string };

  /** Sample rate override (for sampled mode) */
  sampleRate?: number;
}

type EvalMode =
  | 'blocking'              // Always evaluate, block on failure
  | 'sampled'               // Sample percentage of traffic
  | 'shadow'                // Evaluate but never block (A/B testing)
  | 'disabled'              // No evaluation
  | {
      type: 'sampled';
      sampleRate: number;           // 0.0 to 1.0
      escalateOnCritical?: boolean; // Block if critical issues found
    };
```

#### 4.1.4 Runtime Integration

```typescript
// In stage definition
export const generateRoutineStage = createAiOutputStage('generateRoutine', {
  // ... existing config ...

  eval: {
    evaluator: overallQuality,
    mode: {
      development: 'blocking',
      staging: 'blocking',
      production: { type: 'sampled', sampleRate: 0.1, escalateOnCritical: true },
    },
    thresholds: {
      block: 0.3,
      warn: 0.7,
    },
    feedback: (result) => ({
      text: `Quality issues found: ${result.issues?.map(i => i.message).join(', ')}. Please revise.`,
    }),
  },
});
```

---

### 4.2 Trace Collection

#### 4.2.1 Trace Data Model

```typescript
interface EvalTrace {
  // ─── Identity ────────────────────────────────────────────────────────────

  /** Unique trace identifier */
  id: string;

  /** Parent flow execution ID */
  flowId: string;

  /** Specific run ID within flow */
  runId: string;

  /** Stage that was evaluated */
  stageName: string;

  /** Evaluator that produced this trace */
  evaluatorName: string;

  // ─── Source ──────────────────────────────────────────────────────────────

  /** How this trace was created */
  source: 'production' | 'staging' | 'development' | 'generated' | 'manual';

  /** For generated traces, the seed trace ID */
  seedTraceId?: string;

  /** For generated traces, the variation strategy used */
  variationStrategy?: string;

  // ─── Timing ──────────────────────────────────────────────────────────────

  /** When evaluation started */
  startedAt: Date;

  /** When evaluation completed */
  completedAt: Date;

  /** Evaluation duration in milliseconds */
  durationMs: number;

  // ─── Evaluation Mode ─────────────────────────────────────────────────────

  /** How this evaluation was triggered */
  mode: 'blocking' | 'sampled' | 'shadow';

  /** What action was taken based on result */
  action: 'passed' | 'warned' | 'blocked' | 'observed';

  // ─── Input/Output ────────────────────────────────────────────────────────

  /** The stage output that was evaluated */
  stageOutput: unknown;

  /** Snapshot of flow context at evaluation time */
  flowContext: Record<string, unknown>;

  /** The stage input (for reproducibility) */
  stageInput?: unknown;

  // ─── Evaluation Result ───────────────────────────────────────────────────

  /** Full evaluation result */
  evalResult: EvalResult;

  // ─── Cost ────────────────────────────────────────────────────────────────

  /** API costs incurred */
  cost: EvalCost;

  // ─── Metadata ────────────────────────────────────────────────────────────

  /** Environment where trace was collected */
  environment: 'development' | 'staging' | 'production';

  /** Code/deployment version */
  version: string;

  /** Git commit SHA */
  commitSha?: string;

  /** User-added tags */
  tags?: string[];

  /** Arbitrary metadata */
  metadata?: Record<string, unknown>;
}
```

#### 4.2.2 Trace Storage Interface

```typescript
interface TraceStore {
  // ─── Write Operations ────────────────────────────────────────────────────

  /** Save a trace */
  save(trace: EvalTrace): Promise<void>;

  /** Save multiple traces */
  saveMany(traces: EvalTrace[]): Promise<void>;

  /** Update trace metadata */
  update(id: string, updates: Partial<EvalTrace>): Promise<void>;

  /** Add tags to a trace */
  addTags(id: string, tags: string[]): Promise<void>;

  // ─── Read Operations ─────────────────────────────────────────────────────

  /** Get trace by ID */
  get(id: string): Promise<EvalTrace | null>;

  /** Get multiple traces by ID */
  getMany(ids: string[]): Promise<EvalTrace[]>;

  /** Query traces with filters */
  query(query: TraceQuery): Promise<TraceQueryResult>;

  /** Get trace count matching filters */
  count(query: TraceQuery): Promise<number>;

  // ─── Aggregation ─────────────────────────────────────────────────────────

  /** Get aggregated metrics */
  aggregate(query: TraceQuery, aggregation: Aggregation): Promise<AggregationResult>;

  /** Get time-series metrics */
  timeseries(query: TraceQuery, options: TimeseriesOptions): Promise<TimeseriesResult>;

  // ─── Maintenance ─────────────────────────────────────────────────────────

  /** Delete old traces */
  prune(olderThan: Date): Promise<number>;
}

interface TraceQuery {
  // Time range
  startTime?: Date;
  endTime?: Date;

  // Filters
  flowId?: string;
  stageName?: string | string[];
  evaluatorName?: string | string[];
  source?: EvalTrace['source'] | EvalTrace['source'][];
  mode?: EvalTrace['mode'] | EvalTrace['mode'][];
  action?: EvalTrace['action'] | EvalTrace['action'][];
  environment?: EvalTrace['environment'];

  // Score filters
  minScore?: number;
  maxScore?: number;

  // Tag filters
  tags?: string[];

  // Text search
  search?: string;

  // Pagination
  limit?: number;
  offset?: number;

  // Sorting
  orderBy?: 'startedAt' | 'score' | 'durationMs';
  orderDirection?: 'asc' | 'desc';
}

interface TraceQueryResult {
  traces: EvalTrace[];
  total: number;
  hasMore: boolean;
}
```

#### 4.2.3 SQLite Implementation

```typescript
// Storage schema
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS traces (
    id TEXT PRIMARY KEY,
    flow_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    stage_name TEXT NOT NULL,
    evaluator_name TEXT NOT NULL,
    source TEXT NOT NULL,
    seed_trace_id TEXT,
    variation_strategy TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    mode TEXT NOT NULL,
    action TEXT NOT NULL,
    stage_output TEXT NOT NULL,  -- JSON
    flow_context TEXT NOT NULL,  -- JSON
    stage_input TEXT,            -- JSON
    eval_result TEXT NOT NULL,   -- JSON
    cost_input_tokens INTEGER NOT NULL,
    cost_output_tokens INTEGER NOT NULL,
    cost_usd REAL NOT NULL,
    environment TEXT NOT NULL,
    version TEXT NOT NULL,
    commit_sha TEXT,
    tags TEXT,                   -- JSON array
    metadata TEXT,               -- JSON

    -- Denormalized for fast queries
    score REAL NOT NULL,
    passed INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_traces_time ON traces(started_at);
  CREATE INDEX IF NOT EXISTS idx_traces_stage ON traces(stage_name);
  CREATE INDEX IF NOT EXISTS idx_traces_score ON traces(score);
  CREATE INDEX IF NOT EXISTS idx_traces_action ON traces(action);
  CREATE INDEX IF NOT EXISTS idx_traces_flow ON traces(flow_id);
`;
```

---

### 4.3 Pattern Mining

#### 4.3.1 Pattern Data Model

```typescript
interface TracePattern {
  /** Unique pattern identifier */
  id: string;

  /** Human-readable name (auto-generated or user-provided) */
  name: string;

  /** Description of what this pattern represents */
  description?: string;

  // ─── Structure ───────────────────────────────────────────────────────────

  /** Sequence of stages in this pattern */
  stageSequence: string[];

  /** Distribution of turn counts per stage */
  turnDistribution: Record<string, Distribution>;

  // ─── Request Patterns ────────────────────────────────────────────────────

  /** Parameterized templates extracted from requests */
  requestTemplates: RequestTemplate[];

  /** Embedding centroid for similarity matching */
  embeddingCentroid?: number[];

  // ─── Behavioral Patterns ─────────────────────────────────────────────────

  /** How often users accept first output */
  firstAcceptRate: number;

  /** Common modification patterns */
  modificationPatterns: ModificationPattern[];

  /** Signals that lead to abandonment */
  abandonmentSignals: string[];

  // ─── Statistics ──────────────────────────────────────────────────────────

  /** How common this pattern is (0.0 to 1.0) */
  frequency: number;

  /** Number of traces that match this pattern */
  traceCount: number;

  /** Example trace IDs (for reference) */
  exampleTraceIds: string[];

  /** Average quality score for traces matching this pattern */
  avgScore: number;

  // ─── Metadata ────────────────────────────────────────────────────────────

  /** When this pattern was first detected */
  createdAt: Date;

  /** When this pattern was last updated */
  updatedAt: Date;

  /** Whether this pattern is active/valid */
  status: 'active' | 'deprecated' | 'merged';
}

interface RequestTemplate {
  /** Template string with slots, e.g., "I want a {duration}-minute {goal} workout" */
  template: string;

  /** Slot definitions */
  slots: Record<string, SlotDefinition>;

  /** Embedding for semantic matching */
  embedding?: number[];

  /** How common this template is within the pattern */
  frequency: number;
}

interface SlotDefinition {
  /** Type of slot */
  type: 'categorical' | 'numeric' | 'freetext';

  /** For categorical: value distribution */
  values?: Record<string, number>;

  /** For numeric: range */
  range?: { min: number; max: number; mean: number; stddev: number };

  /** For freetext: example values */
  examples?: string[];
}

interface Distribution {
  min: number;
  max: number;
  mean: number;
  median: number;
  stddev: number;
  histogram: Array<{ bucket: string; count: number }>;
}

interface ModificationPattern {
  /** What the user asked to change */
  type: 'harder' | 'easier' | 'shorter' | 'longer' | 'different-focus' | 'other';

  /** Template for the modification request */
  template: string;

  /** How often this modification is requested */
  frequency: number;
}
```

#### 4.3.2 Pattern Mining Pipeline

```typescript
interface PatternMiner {
  /**
   * Extract patterns from a set of traces.
   *
   * @param config - Mining configuration
   * @returns Extracted patterns
   */
  extract(config: PatternMiningConfig): Promise<PatternMiningResult>;

  /**
   * Match a trace against known patterns.
   *
   * @param trace - Trace to match
   * @param patterns - Patterns to match against
   * @returns Best matching pattern with confidence
   */
  match(trace: EvalTrace, patterns: TracePattern[]): Promise<PatternMatch>;

  /**
   * Update patterns with new traces (incremental mining).
   *
   * @param patterns - Existing patterns
   * @param newTraces - New traces to incorporate
   * @returns Updated patterns
   */
  update(patterns: TracePattern[], newTraces: EvalTrace[]): Promise<TracePattern[]>;
}

interface PatternMiningConfig {
  // ─── Input ───────────────────────────────────────────────────────────────

  /** Traces to mine */
  traces: EvalTrace[] | TraceQuery;

  // ─── Privacy Controls ────────────────────────────────────────────────────

  /** Remove PII before mining */
  redactPII: boolean;

  /** Only extract structural patterns, not content */
  extractStructureOnly: boolean;

  /** Minimum traces for a pattern (k-anonymity) */
  minTracesPerPattern: number;

  // ─── Clustering ──────────────────────────────────────────────────────────

  /** Clustering algorithm */
  clusteringMethod: 'hierarchical' | 'kmeans' | 'dbscan';

  /** Similarity threshold for clustering */
  similarityThreshold: number;

  /** Minimum cluster size to form a pattern */
  minClusterSize: number;

  // ─── Template Extraction ─────────────────────────────────────────────────

  /** How to detect variable slots */
  slotDetection: 'heuristic' | 'llm';

  /** Model for LLM-based slot detection */
  slotDetectionModel?: string;

  // ─── Filtering ───────────────────────────────────────────────────────────

  /** Only include traces with score above this */
  minScore?: number;

  /** Only include completed flows */
  completedOnly?: boolean;
}

interface PatternMiningResult {
  /** Extracted patterns */
  patterns: TracePattern[];

  /** What percentage of traces match at least one pattern */
  coverage: number;

  /** Traces that didn't match any pattern */
  unmatchedTraceIds: string[];

  /** Mining statistics */
  stats: {
    totalTraces: number;
    clustersFound: number;
    patternsCreated: number;
    durationMs: number;
  };
}

interface PatternMatch {
  /** Matched pattern */
  pattern: TracePattern;

  /** Confidence of match (0.0 to 1.0) */
  confidence: number;

  /** Which template matched */
  matchedTemplate?: RequestTemplate;

  /** Extracted slot values */
  slotValues?: Record<string, unknown>;
}
```

---

### 4.4 Synthetic Generation

#### 4.4.1 Variation Strategies

```typescript
type VariationStrategy =
  | SlotVariation
  | SemanticVariation
  | IntensityVariation
  | CompositionVariation
  | EdgeVariation
  | AdversarialVariation;

interface SlotVariation {
  type: 'slot';

  /** How to vary categorical slots */
  categorical: 'sample-weighted' | 'sample-uniform' | 'all-values';

  /** How to vary numeric slots */
  numeric: {
    method: 'range' | 'gaussian' | 'uniform';
    padding?: number;  // Extend range by this factor
  };

  /** How to vary freetext slots */
  freetext: {
    method: 'examples' | 'llm-paraphrase';
    model?: string;
  };
}

interface SemanticVariation {
  type: 'semantic';

  /** Model for paraphrasing */
  model: string;

  /** Prompt template for paraphrasing */
  prompt: string;

  /** Communication styles to vary */
  styles?: ('terse' | 'verbose' | 'casual' | 'formal' | 'questioning')[];

  /** How different the paraphrase should be (0.0 to 1.0) */
  divergence?: number;
}

interface IntensityVariation {
  type: 'intensity';

  /** Scale factors to apply */
  scales: number[];  // e.g., [0.5, 0.75, 1.25, 1.5]

  /** Which aspects to scale */
  aspects: ('duration' | 'difficulty' | 'specificity' | 'urgency')[];
}

interface CompositionVariation {
  type: 'composition';

  /** Combine elements from multiple patterns */
  combinePatterns: boolean;

  /** Add elements from other patterns */
  addElements: boolean;

  /** Remove optional elements */
  removeElements: boolean;
}

interface EdgeVariation {
  type: 'edge';

  /** Edge cases to inject */
  injections: Array<{
    name: string;
    probability: number;
    generator: (input: string, context: EvalContext) => Promise<string>;
  }>;
}

interface AdversarialVariation {
  type: 'adversarial';

  /** Types of adversarial inputs to generate */
  attacks: Array<{
    name: string;
    probability: number;
    generator: (input: string, context: EvalContext) => Promise<string>;
  }>;
}
```

#### 4.4.2 Generation Job

```typescript
interface GenerationJob {
  /** Unique job identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Job description */
  description?: string;

  // ─── Seed Selection ──────────────────────────────────────────────────────

  /** How to select seed traces */
  seedSelection: {
    source: 'production' | 'dataset' | 'manual';

    /** For production: query to find seeds */
    query?: TraceQuery;

    /** For dataset: dataset name */
    datasetName?: string;

    /** For manual: specific trace IDs */
    traceIds?: string[];

    /** Number of seeds to select */
    sampleSize: number;

    /** Diversity preference (0.0 = random, 1.0 = max diversity) */
    diversity?: number;
  };

  // ─── Patterns ────────────────────────────────────────────────────────────

  /** Patterns to use (or 'auto' to detect) */
  patterns: string[] | 'auto';

  // ─── Variation Config ────────────────────────────────────────────────────

  /** Variation strategies with weights */
  variations: Array<{
    strategy: VariationStrategy;
    weight: number;
  }>;

  // ─── Branching Config ────────────────────────────────────────────────────

  /** Turn-by-turn branching configuration */
  branching: {
    /** How many variations to create at each turn */
    branchFactor: number;

    /** Maximum turns to branch */
    maxDepth: number;

    /** Maximum total traces to generate */
    maxTotalTraces: number;

    /** Pruning configuration */
    pruning: {
      /** Prune branches with probability below this */
      minProbability: number;

      /** Prune branches too similar to existing ones */
      diversityThreshold: number;
    };
  };

  // ─── Execution Config ────────────────────────────────────────────────────

  /** Maximum cost budget */
  maxCost?: number;

  /** Maximum time budget (ms) */
  maxDuration?: number;

  /** Parallelism level */
  concurrency?: number;

  // ─── Evaluation Config ───────────────────────────────────────────────────

  /** Evaluators to run on generated traces */
  evaluators: Evaluator[];

  // ─── Curation Config ─────────────────────────────────────────────────────

  /** Auto-curation rules */
  autoCurate?: {
    /** Add to dataset if score above threshold */
    addToDataset?: {
      minScore: number;
      datasetName: string;
    };

    /** Flag for review if score below threshold */
    flagForReview?: {
      maxScore: number;
    };

    /** Discard if score below threshold */
    discard?: {
      maxScore: number;
    };
  };
}

interface GenerationJobResult {
  /** Job that was executed */
  jobId: string;

  /** Job status */
  status: 'completed' | 'failed' | 'cancelled' | 'timeout';

  // ─── Timing ──────────────────────────────────────────────────────────────

  startedAt: Date;
  completedAt: Date;
  durationMs: number;

  // ─── Counts ──────────────────────────────────────────────────────────────

  /** Total traces generated */
  totalGenerated: number;

  /** Traces that passed curation */
  curated: number;

  /** Traces flagged for review */
  flagged: number;

  /** Traces discarded */
  discarded: number;

  // ─── Cost ────────────────────────────────────────────────────────────────

  totalCost: EvalCost;

  // ─── Score Distribution ──────────────────────────────────────────────────

  scoreDistribution: Distribution;

  // ─── By Strategy ─────────────────────────────────────────────────────────

  byStrategy: Record<string, {
    count: number;
    avgScore: number;
    passRate: number;
  }>;

  // ─── Pattern Coverage ────────────────────────────────────────────────────

  patternCoverage: Record<string, {
    count: number;
    coverage: number;  // 0.0 to 1.0
  }>;

  // ─── New Patterns ────────────────────────────────────────────────────────

  /** Patterns discovered during generation */
  newPatterns?: TracePattern[];

  // ─── Errors ──────────────────────────────────────────────────────────────

  errors?: Array<{
    traceId?: string;
    error: string;
  }>;
}
```

#### 4.4.3 Turn Branching

```typescript
interface BranchingEngine {
  /**
   * Generate a tree of traces by branching at each turn.
   *
   * @param seed - Seed trace to start from
   * @param pattern - Pattern to guide generation
   * @param config - Branching configuration
   * @param flow - Flow to execute variations through
   * @param deps - Dependencies for flow execution
   * @returns Tree of generated traces
   */
  generateTree(
    seed: EvalTrace,
    pattern: TracePattern,
    config: GenerationJob['branching'],
    flow: FlowBuilder<any, any>,
    deps: AIDeps,
  ): Promise<TraceTree>;
}

interface TraceTree {
  /** Root trace (the seed) */
  root: TraceNode;

  /** Total nodes in tree */
  totalNodes: number;

  /** Maximum depth reached */
  maxDepth: number;

  /** Get all leaf traces */
  getLeaves(): EvalTrace[];

  /** Get all traces (flattened) */
  getAllTraces(): EvalTrace[];

  /** Get traces at specific depth */
  getAtDepth(depth: number): EvalTrace[];

  /** Prune tree based on criteria */
  prune(criteria: PruneCriteria): void;
}

interface TraceNode {
  /** The trace at this node */
  trace: EvalTrace;

  /** Depth in tree (0 for root) */
  depth: number;

  /** Parent node (null for root) */
  parent: TraceNode | null;

  /** Child nodes (variations) */
  children: TraceNode[];

  /** Variation strategy used to create this node */
  variationStrategy?: string;

  /** Probability of this branch (for pruning) */
  probability?: number;
}

interface PruneCriteria {
  /** Prune if score below threshold */
  minScore?: number;

  /** Prune if probability below threshold */
  minProbability?: number;

  /** Prune if too similar to sibling */
  maxSimilarity?: number;

  /** Keep only top N branches at each node */
  topN?: number;
}
```

---

### 4.5 Observability Layer

#### 4.5.1 Metrics

```typescript
interface MetricsCollector {
  /** Record an evaluation event */
  recordEvaluation(trace: EvalTrace): void;

  /** Get aggregated metrics */
  getMetrics(query: MetricsQuery): Promise<EvalMetrics>;

  /** Get time-series data */
  getTimeseries(query: MetricsQuery): Promise<TimeseriesData>;
}

interface MetricsQuery {
  /** Time range */
  startTime: Date;
  endTime: Date;

  /** Filters */
  stageName?: string;
  evaluatorName?: string;
  environment?: string;

  /** Granularity for time-series */
  granularity?: 'minute' | 'hour' | 'day';
}

interface EvalMetrics {
  // ─── Time Window ─────────────────────────────────────────────────────────

  windowStart: Date;
  windowEnd: Date;

  // ─── Counts ──────────────────────────────────────────────────────────────

  totalEvaluations: number;

  byAction: {
    passed: number;
    warned: number;
    blocked: number;
    observed: number;
  };

  // ─── Scores ──────────────────────────────────────────────────────────────

  scoreStats: {
    mean: number;
    median: number;
    p5: number;
    p25: number;
    p75: number;
    p95: number;
    stddev: number;
  };

  scoreHistogram: Array<{
    bucket: string;
    count: number;
    percentage: number;
  }>;

  // ─── By Stage ────────────────────────────────────────────────────────────

  byStage: Record<string, {
    count: number;
    avgScore: number;
    passRate: number;
    blockRate: number;
    avgDurationMs: number;
  }>;

  // ─── By Evaluator ────────────────────────────────────────────────────────

  byEvaluator: Record<string, {
    count: number;
    avgScore: number;
    passRate: number;
    avgDurationMs: number;
    totalCostUsd: number;
  }>;

  // ─── Issues ──────────────────────────────────────────────────────────────

  topIssues: Array<{
    category: string;
    message: string;
    count: number;
    avgScore: number;
    exampleTraceIds: string[];
  }>;

  // ─── Cost ────────────────────────────────────────────────────────────────

  totalCost: EvalCost;
  costPerEvaluation: number;
}

interface TimeseriesData {
  granularity: 'minute' | 'hour' | 'day';

  points: Array<{
    timestamp: Date;
    count: number;
    avgScore: number;
    passRate: number;
    blockRate: number;
    costUsd: number;
  }>;
}
```

#### 4.5.2 Alerting

```typescript
interface Alert {
  /** Unique alert identifier */
  id: string;

  /** Alert name */
  name: string;

  /** Alert description */
  description?: string;

  /** Condition that triggers the alert */
  condition: AlertCondition;

  /** How to notify */
  channels: AlertChannel[];

  /** Alert state */
  state: 'active' | 'firing' | 'resolved' | 'silenced';

  /** When alert started firing */
  firingAt?: Date;

  /** When alert was resolved */
  resolvedAt?: Date;
}

type AlertCondition =
  | { type: 'score-below'; stage: string; threshold: number; window: string }
  | { type: 'pass-rate-below'; stage: string; threshold: number; window: string }
  | { type: 'block-rate-above'; stage: string; threshold: number; window: string }
  | { type: 'cost-above'; threshold: number; window: string }
  | { type: 'error-rate-above'; threshold: number; window: string }
  | { type: 'custom'; evaluate: (metrics: EvalMetrics) => boolean };

type AlertChannel =
  | { type: 'slack'; webhookUrl: string }
  | { type: 'email'; addresses: string[] }
  | { type: 'pagerduty'; routingKey: string }
  | { type: 'webhook'; url: string };
```

---

## 5. Data Models

### 5.1 Dataset

```typescript
interface Dataset {
  /** Unique dataset identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Description */
  description?: string;

  /** Tags for organization */
  tags?: string[];

  /** When created */
  createdAt: Date;

  /** When last modified */
  updatedAt: Date;

  /** Number of items in dataset */
  itemCount: number;
}

interface DatasetItem {
  /** Unique item identifier */
  id: string;

  /** Dataset this item belongs to */
  datasetId: string;

  /** Source trace ID (if from trace) */
  sourceTraceId?: string;

  /** Flow context for this test case */
  flowContext: Record<string, unknown>;

  /** Which stage to start from */
  firstStage: string;

  /** Expected outputs (for regression testing) */
  expected?: {
    stages?: Record<string, unknown>;
    finalContext?: Record<string, unknown>;
  };

  /** Tags for organization */
  tags?: string[];

  /** When added */
  addedAt: Date;

  /** Metadata */
  metadata?: Record<string, unknown>;
}
```

### 5.2 Comparison Run

```typescript
interface ComparisonRun {
  /** Unique identifier */
  id: string;

  /** Comparison name */
  name: string;

  // ─── What's Being Compared ───────────────────────────────────────────────

  /** Baseline (A) */
  baseline: {
    source: 'branch' | 'commit' | 'run' | 'production';
    identifier: string;  // branch name, commit sha, run id, or time range
  };

  /** Candidate (B) */
  candidate: {
    source: 'branch' | 'commit' | 'run' | 'current';
    identifier: string;
  };

  // ─── Configuration ───────────────────────────────────────────────────────

  /** Dataset used for comparison */
  datasetId: string;

  /** Evaluators used */
  evaluators: string[];

  // ─── Results ─────────────────────────────────────────────────────────────

  status: 'pending' | 'running' | 'completed' | 'failed';

  startedAt?: Date;
  completedAt?: Date;

  /** Overall comparison result */
  result?: {
    /** Statistical summary */
    summary: {
      baselineAvgScore: number;
      candidateAvgScore: number;
      scoreDelta: number;
      scoreDeltaPercent: number;
      pValue: number;
      significant: boolean;
    };

    /** By evaluator */
    byEvaluator: Record<string, {
      baselineAvgScore: number;
      candidateAvgScore: number;
      scoreDelta: number;
      pValue: number;
      significant: boolean;
    }>;

    /** By stage */
    byStage: Record<string, {
      baselineAvgScore: number;
      candidateAvgScore: number;
      scoreDelta: number;
      pValue: number;
      significant: boolean;
    }>;

    /** Issue changes */
    issueChanges: {
      improved: Array<{ issue: string; baselineCount: number; candidateCount: number }>;
      regressed: Array<{ issue: string; baselineCount: number; candidateCount: number }>;
      new: Array<{ issue: string; count: number }>;
      resolved: Array<{ issue: string; count: number }>;
    };

    /** Recommendation */
    recommendation: 'approve' | 'review' | 'reject';
    recommendationReason: string;
  };
}
```

---

## 6. API Specification

### 6.1 REST API Endpoints

```yaml
# Traces
GET    /api/traces                    # List/search traces
GET    /api/traces/:id                # Get trace by ID
POST   /api/traces/:id/tags           # Add tags to trace
DELETE /api/traces/:id                # Delete trace

# Metrics
GET    /api/metrics                   # Get aggregated metrics
GET    /api/metrics/timeseries        # Get time-series data

# Patterns
GET    /api/patterns                  # List patterns
GET    /api/patterns/:id              # Get pattern by ID
POST   /api/patterns/mine             # Trigger pattern mining

# Generation
GET    /api/generation/jobs           # List generation jobs
POST   /api/generation/jobs           # Create generation job
GET    /api/generation/jobs/:id       # Get job status/result
DELETE /api/generation/jobs/:id       # Cancel job

# Datasets
GET    /api/datasets                  # List datasets
POST   /api/datasets                  # Create dataset
GET    /api/datasets/:id              # Get dataset
PUT    /api/datasets/:id              # Update dataset
DELETE /api/datasets/:id              # Delete dataset
GET    /api/datasets/:id/items        # List dataset items
POST   /api/datasets/:id/items        # Add items to dataset
DELETE /api/datasets/:id/items/:itemId # Remove item from dataset

# Comparison
GET    /api/comparisons               # List comparison runs
POST   /api/comparisons               # Create comparison run
GET    /api/comparisons/:id           # Get comparison result

# Alerts
GET    /api/alerts                    # List alerts
POST   /api/alerts                    # Create alert
PUT    /api/alerts/:id                # Update alert
DELETE /api/alerts/:id                # Delete alert
```

### 6.2 WebSocket API

```typescript
// Real-time trace streaming
interface TraceStreamMessage {
  type: 'trace';
  trace: EvalTrace;
}

// Metrics updates
interface MetricsUpdateMessage {
  type: 'metrics';
  metrics: EvalMetrics;
}

// Alert notifications
interface AlertMessage {
  type: 'alert';
  alert: Alert;
  action: 'firing' | 'resolved';
}

// Generation job progress
interface JobProgressMessage {
  type: 'job-progress';
  jobId: string;
  progress: {
    generated: number;
    target: number;
    curated: number;
    flagged: number;
  };
}
```

---

## 7. UI/UX Specification

### 7.1 Navigation Structure

```
┌─────────────────────────────────────────────────────────────────┐
│  AI Flow Studio                                                  │
├─────────────┬───────────────────────────────────────────────────┤
│             │                                                    │
│  Dashboard  │  [Content Area]                                    │
│  Traces     │                                                    │
│  Evaluations│                                                    │
│  Generation │                                                    │
│  Datasets   │                                                    │
│  Comparison │                                                    │
│  Alerts     │                                                    │
│  Settings   │                                                    │
│             │                                                    │
└─────────────┴───────────────────────────────────────────────────┘
```

### 7.2 Screen Specifications

#### 7.2.1 Dashboard

**Purpose:** High-level overview of evaluation health.

**Components:**
- Health score card (overall quality score with trend)
- Production stats (flows/hr, eval rate, block rate, cost)
- Active alerts summary
- Score trend chart (7 days, by stage)
- Stage health table
- Top issues list
- Recent activity feed
- Quick action buttons

**Data refresh:** Real-time via WebSocket

#### 7.2.2 Trace Explorer

**Purpose:** Search, filter, and explore evaluation traces.

**Components:**
- Search bar with full-text search
- Filter panel (flow, stage, score range, time, action, source, tags)
- Trace list with key metrics
- Preview panel (shows on hover/select)
- Bulk action toolbar
- Pagination/infinite scroll

**Interactions:**
- Click trace → Open detail view
- Hover trace → Show preview
- Select multiple → Enable bulk actions (tag, export, delete)
- Keyboard navigation (j/k, enter, /)

#### 7.2.3 Trace Detail

**Purpose:** Deep dive into a single trace.

**Components:**
- Header with key info (ID, flow, stage, score, action, time)
- Flow timeline (visual stage progression)
- Turn navigator (for multi-turn flows)
- Input panel (stage input, context)
- Output panel (stage output)
- Evaluation result panel (score, issues, recommendation)
- Context snapshot (collapsible JSON)
- Action buttons (replay, dataset, tags, tune, export)

**Interactions:**
- Tab between panels
- Expand/collapse sections
- Copy values
- Navigate to related traces

#### 7.2.4 Generation Studio

**Purpose:** Configure and run synthetic data generation.

**Components:**
- Job configuration wizard
  - Step 1: Seed selection
  - Step 2: Pattern selection
  - Step 3: Variation strategies
  - Step 4: Branching config
  - Step 5: Curation rules
- Seed preview list
- Pattern detection results
- Variation preview panel
- Cost/time estimates
- Job execution progress
- Result summary

**Interactions:**
- Configure job step-by-step
- Preview variations before running
- Monitor progress in real-time
- Review and curate results

#### 7.2.5 Trace Tree Visualization

**Purpose:** Explore branching structure of generated traces.

**Components:**
- Tree visualization (collapsible nodes)
- Node details on hover
- Score color coding
- Strategy indicators
- Path highlighting
- Zoom/pan controls

**Interactions:**
- Expand/collapse branches
- Click node → Open trace detail
- Filter by strategy
- Search within tree

#### 7.2.6 Comparison View

**Purpose:** Compare two runs/branches side-by-side.

**Components:**
- Header with A/B identification
- Overall metrics comparison table
- Score distribution charts (overlaid)
- By-stage comparison table
- Issue changes summary
- Side-by-side example viewer
- Statistical significance indicators
- Recommendation panel

**Interactions:**
- Toggle between metrics
- Navigate through examples
- Drill into specific stages
- Export report

### 7.3 Design System

#### Colors

```
Primary:     #2563EB (blue-600)
Success:     #16A34A (green-600)
Warning:     #CA8A04 (yellow-600)
Error:       #DC2626 (red-600)
Info:        #0891B2 (cyan-600)

Background:  #FFFFFF (white)
Surface:     #F9FAFB (gray-50)
Border:      #E5E7EB (gray-200)
Text:        #111827 (gray-900)
TextMuted:   #6B7280 (gray-500)
```

#### Score Visualization

```
0.0 - 0.3:  Red (error)
0.3 - 0.5:  Orange (warning)
0.5 - 0.7:  Yellow (caution)
0.7 - 0.9:  Green (good)
0.9 - 1.0:  Blue (excellent)
```

#### Typography

```
Headings:    Inter, system-ui, sans-serif
Body:        Inter, system-ui, sans-serif
Monospace:   JetBrains Mono, monospace
```

### 7.4 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `/` | Focus search |
| `j` / `k` | Navigate list up/down |
| `Enter` | Open selected item |
| `Esc` | Close modal / clear selection |
| `g` then `d` | Go to dashboard |
| `g` then `t` | Go to traces |
| `g` then `g` | Go to generation |
| `?` | Show shortcuts help |

---

## 8. Integration Points

### 8.1 Flow Runtime Integration

```typescript
// In flow.ts - add evaluation interceptor

export function createAiFlow<...>(...): FlowBuilder<...> {
  // ... existing code ...

  // Wrap stage execution with evaluation
  const originalStep = run.step;
  run.step = async () => {
    const snapshot = await originalStep();

    // Check if current stage has eval config
    const stageDef = defs.get(snapshot.currentStage);
    if (stageDef?.eval) {
      await evaluateStage(stageDef, snapshot, deps);
    }

    return snapshot;
  };
}
```

### 8.2 CI/CD Integration

```yaml
# .github/workflows/eval.yml
name: AI Flow Evaluation

on:
  pull_request:
    branches: [main, develop]

jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup
        run: bun install

      - name: Run Evaluations
        run: bun run ai-flow eval run --ci

      - name: Compare with Baseline
        run: bun run ai-flow eval compare --baseline main --candidate HEAD

      - name: Upload Report
        uses: actions/upload-artifact@v4
        with:
          name: eval-report
          path: eval-report.html
```

### 8.3 Observability Integration

```typescript
// Prometheus metrics export
interface PrometheusExporter {
  // Counters
  evalTotal: Counter<['stage', 'evaluator', 'action']>;

  // Gauges
  evalScore: Gauge<['stage', 'evaluator']>;

  // Histograms
  evalDuration: Histogram<['stage', 'evaluator']>;
  evalCost: Histogram<['stage', 'evaluator']>;
}

// OpenTelemetry tracing
interface OTelIntegration {
  traceEvaluation(trace: EvalTrace): void;
  addEvalAttributes(span: Span, result: EvalResult): void;
}
```

---

## 9. Implementation Phases

### Phase 1: Foundation (Weeks 1-2)

**Goal:** Basic evaluation infrastructure and trace collection.

**Deliverables:**
- [ ] Evaluator interface and base implementations
- [ ] Schema evaluator
- [ ] Assertion evaluator
- [ ] Stage eval configuration API
- [ ] Evaluation interceptor in flow runtime
- [ ] Blocking/sampled mode switching
- [ ] Trace data model and SQLite storage
- [ ] Basic trace collector

**Success Criteria:**
- Can configure evaluators on stages
- Blocking evals reject low-quality outputs
- Sampled evals collect traces without blocking
- Traces are persisted to SQLite

### Phase 2: Observability (Weeks 3-4)

**Goal:** Developer visibility into evaluation results.

**Deliverables:**
- [ ] LLM judge evaluator
- [ ] Composite evaluator
- [ ] Metrics aggregation
- [ ] Time-series storage
- [ ] Terminal dashboard (live tail)
- [ ] Trace query API
- [ ] Basic web UI (dashboard, explorer, detail)

**Success Criteria:**
- Developers can see real-time eval results
- Historical metrics are available
- Can search and filter traces
- Can drill into trace details

### Phase 3: Pattern Mining (Weeks 5-6)

**Goal:** Extract patterns from production traces.

**Deliverables:**
- [ ] Trace clustering
- [ ] Template extraction
- [ ] Slot detection (heuristic + LLM)
- [ ] Pattern storage and management
- [ ] Pattern matching
- [ ] Pattern library UI

**Success Criteria:**
- Can extract patterns from traces
- Patterns capture realistic usage distribution
- New traces can be matched to patterns

### Phase 4: Synthetic Generation (Weeks 7-8)

**Goal:** Generate realistic synthetic data from patterns.

**Deliverables:**
- [ ] Variation strategies (slot, semantic, edge, adversarial)
- [ ] Turn-by-turn branching engine
- [ ] Generation job management
- [ ] Auto-curation logic
- [ ] Generation Studio UI
- [ ] Tree visualization

**Success Criteria:**
- Can generate variations from seed traces
- Branching explores interaction space
- Generated traces are realistic and diverse
- Auto-curation filters quality traces

### Phase 5: Comparison & Polish (Weeks 9-10)

**Goal:** A/B testing and production readiness.

**Deliverables:**
- [ ] Comparison run infrastructure
- [ ] Statistical significance testing
- [ ] Comparison UI
- [ ] Alert system
- [ ] CI/CD integration
- [ ] CLI tool
- [ ] Documentation

**Success Criteria:**
- Can compare branches/commits
- Regressions are detected automatically
- Alerts fire on quality drops
- CI blocks on quality regression
- System is production-ready

---

## 10. Success Metrics

### 10.1 Platform Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Trace collection reliability | 99.9% | Traces collected / evals run |
| Eval latency (blocking) | < 500ms p95 | Trace duration |
| Eval latency (sampled) | < 2s p95 | Trace duration |
| Pattern coverage | > 80% | Traces matching a pattern |
| Generation realism | > 0.8 similarity | LLM-judged similarity to real |

### 10.2 Developer Experience Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Time to first eval | < 30 min | Onboarding survey |
| Dashboard load time | < 2s | Performance monitoring |
| Search response time | < 500ms | API latency |
| Useful eval rate | > 70% | Developer survey |

### 10.3 Quality Impact Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Regression detection | > 90% | Known regressions caught |
| False positive rate | < 10% | Blocked but actually good |
| Quality improvement | > 10% score increase | Before/after comparison |
| Production incidents from AI | 50% reduction | Incident tracking |

---

## 11. Open Questions

### 11.1 Technical

1. **Storage scaling:** When should we migrate from SQLite to Postgres/ClickHouse?
   - Proposed threshold: > 10M traces or > 100 traces/second

2. **LLM judge consistency:** How do we ensure LLM judges are consistent across runs?
   - Options: temperature=0, multiple samples, fine-tuned models

3. **Pattern drift:** How do we detect when patterns become stale?
   - Proposed: Track pattern match rate, alert on significant drops

### 11.2 Product

1. **Privacy controls:** What PII redaction is required for pattern mining?
   - Need: Legal/compliance review

2. **Access control:** Who can view traces from production?
   - Need: Define roles and permissions

3. **Cost allocation:** How do we allocate eval costs to teams/projects?
   - Need: Define cost model

### 11.3 Process

1. **Baseline management:** How do we maintain and update baselines for comparison?
   - Proposed: Automatic baseline from main branch, manual override

2. **Alert ownership:** Who is responsible for responding to quality alerts?
   - Need: Define on-call rotation or ownership model

---

## Appendix A: CLI Reference

```bash
# Evaluation commands
ai-flow eval run [suite]              # Run evaluation suite
ai-flow eval watch                    # Live dashboard
ai-flow eval tail [--stage] [--score] # Tail traces
ai-flow eval compare <a> <b>          # Compare runs
ai-flow eval report [--format] [--output]

# Trace commands
ai-flow trace get <id>                # Get trace details
ai-flow trace search <query>          # Search traces
ai-flow trace replay <id>             # Replay trace
ai-flow trace export [--query] [--output]

# Generation commands
ai-flow gen run <job-file>            # Run generation job
ai-flow gen preview <job-file>        # Preview variations
ai-flow gen status <job-id>           # Check job status

# Pattern commands
ai-flow pattern mine [--query]        # Mine patterns
ai-flow pattern list                  # List patterns
ai-flow pattern show <id>             # Show pattern details

# Dataset commands
ai-flow dataset create <name>         # Create dataset
ai-flow dataset add <dataset> <traces># Add traces to dataset
ai-flow dataset export <dataset>      # Export dataset
```

---

## Appendix B: Configuration Schema

```typescript
interface EvalPlatformConfig {
  // Storage
  storage: {
    type: 'sqlite' | 'postgres';
    connectionString?: string;
    path?: string;  // For SQLite
  };

  // Defaults
  defaults: {
    evalMode: EvalMode;
    sampleRate: number;
    thresholds: { block: number; warn: number };
  };

  // Pattern mining
  mining: {
    minTracesPerPattern: number;
    similarityThreshold: number;
    slotDetectionModel: string;
  };

  // Generation
  generation: {
    maxConcurrency: number;
    defaultBranchFactor: number;
    maxCostPerJob: number;
  };

  // Observability
  observability: {
    metricsRetentionDays: number;
    traceRetentionDays: number;
    alertWebhook?: string;
  };

  // UI
  ui: {
    port: number;
    basePath: string;
  };
}
```

---

*End of Specification*
