#!/usr/bin/env bun
/** @jsxImportSource @opentui/react */
/**
 * AI Construct Demo (OpenTUI)
 *
 * A React TUI for interacting with an ai-construct construct.
 */

import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createContextShell,
  estimateTokensFromBytes,
  extractFilesFromToolUsage,
  formatToolUsageLines,
} from '@inkibra/ai-flow';
import { Logger } from '@inkibra/logger';
import {
  createCliRenderer,
  type KeyEvent,
  type ScrollBoxRenderable,
} from '@opentui/core';
import { createRoot, useKeyboard, useTerminalDimensions } from '@opentui/react';
import OpenAI from 'openai';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Construct } from '../construct/construct';
import { createFileStorage } from '../construct/storage';
import type { StageConfig } from '../construct/types';
import { DEFAULT_CONSTRUCT_LANES } from '../construct/types';
import { DEFAULT_IMPULSE_PROFILES } from '../impulse/keys';
import type { ImpulsePool } from '../impulse/pool';
import type { ImpulseProfileMap } from '../impulse/types';
import {
  appendConstructLiveImpulseDelta,
  formatConstructPerceptionSummary,
} from '../live/runtime-state';
import { sortConstructViewsByStartedAtDesc } from '../live/selectors';
import { createLocalConstructRuntime } from '../runtime/runtime';
import {
  type HeartbeatShape,
  startPerceptionScheduler,
} from '../scheduler/perception-scheduler';
import type { ResponseScheduler } from '../scheduler/scheduler';
import type { ScheduledResponse } from '../scheduler/types';
import {
  DEFAULT_CONTEXT_PRESSURE_CONFIG,
  evaluateContextPressure,
} from '../vfs/context-pressure';
import { getLatestLogPathForDir } from '../vfs/logs';
import { loadOpenedState, type OpenedFilesState } from '../vfs/opened';
import {
  parseTranscriptLog,
  type TranscriptEntry as StoredTranscriptEntry,
} from '../vfs/transcript';
import {
  type CliConstructHandle,
  type CommandSuggestion,
  getCommandSuggestions,
  handleCommand,
  parseCommand,
} from './commands';

const VERSION = '0.1.0';
const DEFAULT_CONSTRUCT_MODEL = 'moonshotai/kimi-k2.5';

/**
 * Options for launching the demo TUI programmatically.
 *
 * Callers provide pre-parsed construct configuration instead of CLI args.
 * The TUI handles OpenAI client creation, scheduler startup, and rendering.
 */
export type DemoTuiOptions = {
  /** Construct identifier (default: 'demo') */
  constructId?: string;
  /** Storage directory path (default: ~/.ai-construct/<constructId>) */
  storage?: string;
  /** Directory to dump stage context for debugging */
  debugDumpDir?: string;
  /** Path to heartbeat cadence shape JSON file */
  heartbeatShapePath?: string;
  /** Paths to open into context at startup */
  startupOpenSpecs?: PathModeSpec[];
  /** Per-profile impulse configuration (code execution, tools, prompts) */
  impulseProfiles?: ImpulseProfileMap;
  /** Pre-configured OpenAI client. If not provided, created from API key/base URL options. */
  openAI?: OpenAI;
  /** Base URL for gateway-backed OpenAI-compatible APIs such as Bifrost. */
  baseURL?: string;
  /** Default model for construct stages. */
  model?: string;
  /** Per-stage AI settings for the construct */
  stageConfig?: StageConfig;
};

/**
 * Launch the interactive TUI for an ai-construct instance.
 *
 * This is the programmatic entry point used by product-layer runners
 * (e.g., ToneTempo) to start the demo TUI with custom construct configuration.
 *
 * The function creates the OpenAI client, construct, scheduler, and renders
 * the React TUI. It does not return until the process exits.
 */
export async function launchDemoTui(
  options: DemoTuiOptions = {},
): Promise<void> {
  const constructId = options.constructId ?? 'demo';
  const storagePath = options.storage ?? `~/.ai-construct/${constructId}`;
  const baseURL = options.baseURL ?? process.env.OPENAI_BASE_URL;
  const model =
    options.model ?? process.env.AI_CONSTRUCT_MODEL ?? DEFAULT_CONSTRUCT_MODEL;

  const openAI =
    options.openAI ??
    (() => {
      const apiKey =
        process.env.OPENAI_API_KEY ??
        process.env.OPENROUTER_API_KEY ??
        undefined;
      if (!apiKey) {
        console.error(
          'Error: OPENAI_API_KEY or OPENROUTER_API_KEY environment variable is not set.\n' +
            'Create a .env file with your API key or set it in your shell.',
        );
        process.exit(1);
      }
      return new OpenAI({ apiKey, baseURL });
    })();
  const logger = Logger.createLogger('ai-construct', {}, 'info');
  const deps = {
    openAI,
    logger,
    debug: options.debugDumpDir
      ? {
          dumpDir: options.debugDumpDir,
          dumpFormat: 'md' as const,
          dumpStages: 'all' as const,
        }
      : undefined,
  };

  let heartbeatShape: HeartbeatShape | undefined;
  if (options.heartbeatShapePath) {
    try {
      const raw = await readFile(options.heartbeatShapePath, 'utf8');
      heartbeatShape = JSON.parse(raw) as HeartbeatShape;
    } catch (error) {
      console.error(
        `Error: failed to read heartbeat shape from ${options.heartbeatShapePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      process.exit(1);
    }
  }

  const runtime = createLocalConstructRuntime({
    logger,
    createConfig: async (id) => ({
      id,
      storage: createFileStorage(storagePath),
      deps,
      debug: true,
      impulseProfiles: options.impulseProfiles ?? DEFAULT_IMPULSE_PROFILES,
      model,
      stageConfig: options.stageConfig,
      computerConfig: {},
      lanes: DEFAULT_CONSTRUCT_LANES,
    }),
  });

  const construct = await runtime.runtimeManager.getOrCreate(constructId);

  if (options.startupOpenSpecs && options.startupOpenSpecs.length > 0) {
    await applyStartupOpenSpecs(construct, options.startupOpenSpecs);
  }

  startPerceptionScheduler(construct, construct.getVfs(), { heartbeatShape });

  const cliHandle: CliConstructHandle = {
    constructId,
    construct,
    submit: (op) => runtime.submit(constructId, op),
    flush: async () => {
      await runtime.waitForSettled?.(constructId);
      await construct.flush();
    },
  };

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
  });

  // Centralized shutdown: destroy the renderer (restores terminal from raw /
  // mouse-tracking mode) then exit. Every exit path should call this instead
  // of process.exit() directly.
  let shutdownCalled = false;
  const shutdown = (code = 0) => {
    if (shutdownCalled) return;
    shutdownCalled = true;
    try {
      renderer.destroy();
    } catch {
      // best-effort
    }
    process.exit(code);
  };

  // Ctrl+C
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  // Crash handlers
  process.on('uncaughtException', (err) => {
    try {
      renderer.destroy();
    } catch {
      /* best-effort */
    }
    console.error('\n[ai-construct] Fatal: uncaughtException');
    console.error(err.stack ?? err.message);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    try {
      renderer.destroy();
    } catch {
      /* best-effort */
    }
    console.error('\n[ai-construct] Fatal: unhandledRejection');
    console.error(
      reason instanceof Error
        ? (reason.stack ?? reason.message)
        : String(reason),
    );
    process.exit(1);
  });

  createRoot(renderer).render(
    <App construct={construct} cliHandle={cliHandle} onExit={shutdown} />,
  );
}

type TranscriptEntry = {
  id: string;
  role: 'user' | 'construct' | 'system';
  text: string;
  timestamp: Date;
};

type ToolHistoryEntry = {
  impulseId: string;
  tool: string;
  command: string;
  output: string;
  timestamp: Date;
};

type NapToolEntry = {
  command: string;
  output: string;
  timestamp: Date;
};

type NapView = {
  status: 'idle' | 'running' | 'completed' | 'error';
  startedAt?: Date;
  completedAt?: Date;
  analysis?: string;
  tools: NapToolEntry[];
  error?: string;
  /** Hypno: which review stage is awaiting human input */
  hypnoStage?:
    | 'analyze'
    | 'propose'
    | 'commit'
    | 'completed'
    | 'cancelled'
    | null;
  /** Hypno: current draft being reviewed */
  hypnoDraft?: string;
};

type ImpulseView = {
  id: string;
  type: string;
  status: 'active' | 'completed' | 'error';
  thinking: string;
  tools: ToolHistoryEntry[];
  startedAt: Date;
  error?: string;
};

type OpenStateView = {
  files: OpenedFilesState['files'];
  bytes: number;
  tokens: number;
  recently_closed?: OpenedFilesState['recently_closed'];
};

type ImpulseState = ReturnType<ImpulsePool['getState']>;
type SchedulerState = Awaited<ReturnType<ResponseScheduler['getState']>>;

export type PathModeSpec = {
  path: string;
  mode?: 'full' | 'frontmatter';
};

export function parsePathModeSpec(
  value: string,
  flagName: string,
): PathModeSpec {
  const raw = value.trim();
  if (!raw) {
    throw new Error(`${flagName}: value cannot be empty`);
  }

  const modeMatch = raw.match(/^(.*):(full|frontmatter)$/);
  const path = (modeMatch ? modeMatch[1] : raw)?.trim();
  const mode = modeMatch?.[2] as PathModeSpec['mode'] | undefined;

  if (!path) {
    throw new Error(`${flagName}: path cannot be empty`);
  }

  if (!path.startsWith('/')) {
    throw new Error(`${flagName}: path must be absolute (received: ${path})`);
  }

  return mode ? { path, mode } : { path };
}

function quotePathForShell(path: string): string {
  if (!path.includes(' ')) return path;
  return `"${path.replace(/"/g, '\\"')}"`;
}

async function applyStartupOpenSpecs(
  construct: Construct,
  openSpecs: PathModeSpec[],
): Promise<void> {
  if (openSpecs.length === 0) return;

  const shell = createContextShell(construct.getVfs());
  for (const spec of openSpecs) {
    const path = quotePathForShell(spec.path);
    const command =
      spec.mode === 'frontmatter'
        ? `open --frontmatter ${path}`
        : `open ${path}`;
    const result = await shell.exec(command);
    if (result.exitCode !== 0) {
      throw new Error(
        `Failed startup --open for ${spec.path}: ${result.stderr || result.stdout || 'unknown error'}`,
      );
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  let constructId = 'demo';
  let storage = `~/.ai-construct/${constructId}`;
  let debugDumpDir: string | undefined;
  let heartbeatShapePath: string | undefined;
  let baseURL = process.env.OPENAI_BASE_URL;
  let apiKey = process.env.OPENAI_API_KEY;
  let model = process.env.AI_CONSTRUCT_MODEL ?? DEFAULT_CONSTRUCT_MODEL;
  const startupOpenSpecsRaw: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--id' && args[i + 1]) {
      constructId = args[++i]!;
      storage = `~/.ai-construct/${constructId}`;
    } else if (arg === '--storage' && args[i + 1]) {
      storage = args[++i]!;
    } else if (arg === '--debug-dump-dir' && args[i + 1]) {
      debugDumpDir = args[++i]!;
    } else if (arg === '--heartbeat-shape' && args[i + 1]) {
      heartbeatShapePath = args[++i]!;
    } else if (arg === '--base-url' && args[i + 1]) {
      baseURL = args[++i]!;
    } else if (arg === '--api-key' && args[i + 1]) {
      apiKey = args[++i]!;
    } else if (arg === '--model' && args[i + 1]) {
      model = args[++i]!;
    } else if (arg === '--open' && args[i + 1]) {
      startupOpenSpecsRaw.push(args[++i]!);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      return;
    } else if (arg === '--version' || arg === '-v') {
      console.log(`ai-construct v${VERSION}`);
      return;
    }
  }

  const startupOpenSpecs = startupOpenSpecsRaw.map((value) =>
    parsePathModeSpec(value, '--open'),
  );

  const resolvedApiKey =
    apiKey ?? process.env.OPENAI_API_KEY ?? process.env.OPENROUTER_API_KEY;

  if (!resolvedApiKey) {
    console.error(
      'Error: provide OPENAI_API_KEY/--api-key for direct mode or OPENAI_BASE_URL/--base-url for gateway mode.',
    );
    process.exit(1);
  }

  const openAI = new OpenAI({
    apiKey: resolvedApiKey,
    ...(baseURL ? { baseURL } : {}),
  });

  await launchDemoTui({
    constructId,
    storage,
    debugDumpDir,
    heartbeatShapePath,
    startupOpenSpecs,
    openAI,
    baseURL,
    model,
  });
}

function App({
  construct,
  cliHandle,
  onExit,
}: {
  construct: Construct;
  cliHandle: CliConstructHandle;
  onExit: (code?: number) => void;
}) {
  const [inputValue, setInputValue] = useState('');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [responseDraft, setResponseDraft] = useState('');
  const [focusTarget, setFocusTarget] = useState<
    'input' | 'transcript' | 'context' | 'impulses' | 'thinking'
  >('input');
  const [followTail, setFollowTail] = useState(true);
  const [followThinkingTail, setFollowThinkingTail] = useState(true);
  const [openContextTab, setOpenContextTab] = useState<
    'open' | 'closed' | 'tree' | 'history'
  >('open');
  const [toolHistory, setToolHistory] = useState<ToolHistoryEntry[]>([]);
  const [impulseViews, setImpulseViews] = useState<Record<string, ImpulseView>>(
    {},
  );
  const [napView, setNapView] = useState<NapView>({
    status: 'idle',
    tools: [],
  });
  const [napOverlayVisible, setNapOverlayVisible] = useState(false);
  const [napNotice, setNapNotice] = useState<string | null>(null);
  const [cmdSuggestionIdx, setCmdSuggestionIdx] = useState(0);
  const [cmdDismissed, setCmdDismissed] = useState(false);
  const [impulseSelection, setImpulseSelection] = useState(0);
  const [impulseExpanded, setImpulseExpanded] = useState(false);
  const [impulseNotice, setImpulseNotice] = useState<string | null>(null);
  const [thinkingNotice, setThinkingNotice] = useState<string | null>(null);
  const [openContextPreview, setOpenContextPreview] = useState<{
    path: string;
    content: string;
  } | null>(null);
  const [treePath, setTreePath] = useState('/');
  const [treeEntries, setTreeEntries] = useState<
    Array<{ name: string; path: string; type: 'file' | 'directory' }>
  >([]);
  const [treeSelection, setTreeSelection] = useState(0);
  const [openSelection, setOpenSelection] = useState(0);
  const [closedSelection, setClosedSelection] = useState(0);
  const [historySelection, setHistorySelection] = useState(0);
  const lastSelectedImpulseId = useRef<string | null>(null);
  const [openState, setOpenState] = useState<OpenStateView>({
    files: [],
    bytes: 0,
    tokens: 0,
  });
  const [impulseState, setImpulseState] = useState<ImpulseState>(
    construct.getImpulsePool().getState(),
  );
  const [schedulerState, setSchedulerState] = useState<SchedulerState>({
    scheduled: [],
    inProgressImpulses: [],
    activeImpulses: [],
    activeResponses: [],
    schedulerBusy: false,
    isRunning: false,
  });

  // Ephemeral hypno evaluation chat (not persisted to VFS)
  type HypnoEvalEntry = {
    role: 'human' | 'system' | 'assistant';
    text: string;
    timestamp: Date;
  };
  const [hypnoEvalChat, setHypnoEvalChat] = useState<HypnoEvalEntry[]>([]);
  const [hypnoCurrentPlan, setHypnoCurrentPlan] = useState('');
  const [hypnoReviewStreaming, setHypnoReviewStreaming] = useState('');

  const { width, height } = useTerminalDimensions();
  const pageScrollStep = 0.7;

  const responseRef = useRef('');
  const transcriptScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const thinkingScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const napScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const cmdScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const impulseNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thinkingNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const napNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    construct.onResponseStream((chunk) => {
      responseRef.current = `${responseRef.current}${chunk}`;
      setResponseDraft(responseRef.current);
    });

    construct.onResponse(({ content }) => {
      const finalContent = content || responseRef.current;
      if (finalContent.trim()) {
        setTranscript((prev: TranscriptEntry[]) => [
          ...prev,
          {
            id: `construct-${Date.now()}`,
            role: 'construct',
            text: finalContent,
            timestamp: new Date(),
          },
        ]);
      }
      responseRef.current = '';
      setResponseDraft('');
    });

    construct.onEvent((event) => {
      if (event.type === 'impulse:started') {
        setImpulseState(construct.getImpulsePool().getState());
        setImpulseViews((prev) => ({
          ...prev,
          [event.impulseId]: {
            id: event.impulseId,
            type: formatConstructPerceptionSummary(event.perception),
            status: 'active',
            thinking: '',
            tools: [],
            startedAt: new Date(),
          },
        }));
      } else if (event.type === 'impulse:thinking') {
        setImpulseViews((prev) => {
          const existing = prev[event.impulseId];
          if (!existing) return prev;
          const nextThinking =
            appendConstructLiveImpulseDelta(
              { [event.impulseId]: existing.thinking },
              event.impulseId,
              event.delta,
            )[event.impulseId] ?? '';
          return {
            ...prev,
            [event.impulseId]: {
              ...existing,
              thinking: nextThinking,
            },
          };
        });
      } else if (event.type === 'impulse:tool') {
        const entry: ToolHistoryEntry = {
          impulseId: event.impulseId,
          tool: event.tool,
          command: event.command,
          output: event.output,
          timestamp: new Date(),
        };
        setToolHistory((prev) => [entry, ...prev].slice(0, 100));
        setImpulseViews((prev) => {
          const existing = prev[event.impulseId];
          if (!existing) return prev;
          return {
            ...prev,
            [event.impulseId]: {
              ...existing,
              tools: [entry, ...existing.tools].slice(0, 20),
            },
          };
        });
      } else if (event.type === 'impulse:completed') {
        setImpulseState(construct.getImpulsePool().getState());
        setImpulseViews((prev) => {
          const existing = prev[event.impulseId];
          if (!existing) return prev;
          return {
            ...prev,
            [event.impulseId]: { ...existing, status: 'completed' },
          };
        });
      } else if (event.type === 'impulse:error') {
        const errorText = event.error.stack ?? event.error.message;
        setImpulseViews((prev) => {
          const existing = prev[event.impulseId];
          if (!existing) return prev;
          return {
            ...prev,
            [event.impulseId]: {
              ...existing,
              status: 'error',
              error: errorText,
            },
          };
        });
      } else if (event.type === 'response:scheduled') {
        void construct.getScheduler().getState().then(setSchedulerState);
      } else if (event.type === 'response:executing') {
        void construct.getScheduler().getState().then(setSchedulerState);
      } else if (event.type === 'response:dropped') {
        void construct.getScheduler().getState().then(setSchedulerState);
        if (event.reason === 'execution_error') {
          responseRef.current = '';
          setResponseDraft('');
          setTranscript((prev: TranscriptEntry[]) => [
            ...prev,
            {
              id: `response-drop-${event.responseId}-${Date.now()}`,
              role: 'system',
              text: event.error
                ? `Response execution error: ${event.error}`
                : 'Response execution error.',
              timestamp: new Date(),
            },
          ]);
        }
      } else if (event.type === 'nap:started') {
        setNapView({
          status: 'running',
          startedAt: new Date(),
          tools: [],
          analysis: '',
        });
        setNapOverlayVisible(true);
      } else if (event.type === 'nap:analysis') {
        setNapView((prev) => ({
          ...prev,
          analysis: event.content,
        }));
      } else if (event.type === 'nap:tool') {
        const entry: NapToolEntry = {
          command: event.command,
          output: event.output,
          timestamp: new Date(),
        };
        setNapView((prev) => ({
          ...prev,
          tools: [entry, ...prev.tools].slice(0, 40),
        }));
      } else if (event.type === 'nap:completed') {
        setNapView((prev) => ({
          ...prev,
          status: 'completed',
          completedAt: new Date(),
        }));
      } else if (event.type === 'nap:error') {
        const errorText = event.error.stack ?? event.error.message;
        setNapView((prev) => ({
          ...prev,
          status: 'error',
          error: errorText,
        }));
        setNapOverlayVisible(true);
      } else if (event.type === 'hypno:started') {
        setNapView({
          status: 'running',
          startedAt: new Date(),
          tools: [],
          analysis: '',
          hypnoStage: 'analyze',
          hypnoDraft: '',
        });
        setHypnoEvalChat([
          {
            role: 'system',
            text: 'Hypno session started. Analyze stage running...',
            timestamp: new Date(),
          },
        ]);
        setHypnoCurrentPlan('');
        setHypnoReviewStreaming('');
        setNapOverlayVisible(true);
      } else if (event.type === 'hypno:draft-chunk') {
        setNapView((prev) => ({
          ...prev,
          hypnoDraft: event.text,
        }));
      } else if (event.type === 'hypno:draft-ready') {
        setNapView((prev) => ({
          ...prev,
          hypnoDraft: event.draft,
          hypnoStage: event.stage as 'analyze' | 'propose',
        }));
        setHypnoEvalChat((prev) => [
          ...prev,
          {
            role: 'system' as const,
            text: `${event.stage} draft ready. Chat to discuss, :update to apply plan, :accept to advance.`,
            timestamp: new Date(),
          },
        ]);
        setHypnoCurrentPlan('');
        setHypnoReviewStreaming('');
        // During review, hide overlay so input is accessible; draft shows in document pane
        setNapOverlayVisible(false);
      } else if (event.type === 'hypno:review-chunk') {
        setHypnoReviewStreaming(event.text);
      } else if (event.type === 'hypno:review-reply') {
        setHypnoReviewStreaming('');
        setHypnoEvalChat((prev) => [
          ...prev,
          {
            role: 'assistant' as const,
            text: event.reply,
            timestamp: new Date(),
          },
        ]);
      } else if (event.type === 'hypno:plan-updated') {
        setHypnoCurrentPlan(event.plan);
      } else if (event.type === 'hypno:accept-warning') {
        setHypnoEvalChat((prev) => [
          ...prev,
          {
            role: 'system' as const,
            text: event.message,
            timestamp: new Date(),
          },
        ]);
      } else if (event.type === 'hypno:stage-change') {
        setNapView((prev) => ({
          ...prev,
          hypnoStage: event.stage as NapView['hypnoStage'],
          hypnoDraft: event.stage === 'commit' ? '' : prev.hypnoDraft,
        }));
        setHypnoCurrentPlan('');
        setHypnoReviewStreaming('');
        setHypnoEvalChat((prev) => [
          ...prev,
          {
            role: 'system' as const,
            text:
              event.stage === 'commit'
                ? 'Proposal accepted. Commit stage running (tools enabled)...'
                : `Advancing to ${event.stage} stage...`,
            timestamp: new Date(),
          },
        ]);
        // Show overlay during commit (no human input needed)
        if (event.stage === 'commit') {
          setNapOverlayVisible(true);
        }
      } else if (event.type === 'hypno:completed') {
        setNapView((prev) => ({
          ...prev,
          status: 'completed',
          completedAt: new Date(),
          hypnoStage: 'completed',
        }));
        setHypnoEvalChat((prev) => [
          ...prev,
          {
            role: 'system' as const,
            text: 'Hypno session completed successfully.',
            timestamp: new Date(),
          },
        ]);
      } else if (event.type === 'hypno:cancelled') {
        setNapView((prev) => ({
          ...prev,
          status: 'completed',
          hypnoStage: 'cancelled',
        }));
        setHypnoEvalChat((prev) => [
          ...prev,
          {
            role: 'system' as const,
            text: 'Hypno session cancelled.',
            timestamp: new Date(),
          },
        ]);
      } else if (event.type === 'hypno:error') {
        const errorText = event.error.stack ?? event.error.message;
        setNapView((prev) => ({
          ...prev,
          status: 'error',
          error: errorText,
          hypnoStage: null,
        }));
      }
    });
  }, [construct]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const latest = await getLatestLogPathForDir(
          construct.getVfs(),
          '/context/logs/transcript',
        );
        if (!latest) return;

        const content = await construct.getVfs().read(latest);
        const parsed = parseTranscriptLog(content);
        if (cancelled) return;

        setTranscript(
          parsed.map((entry: StoredTranscriptEntry) => ({
            id: `transcript-${entry.timestamp.getTime()}-${entry.role}`,
            role: entry.role,
            text: entry.content,
            timestamp: entry.timestamp,
          })),
        );
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [construct]);

  const pushImpulseNotice = (message: string) => {
    setImpulseNotice(message);
    if (impulseNoticeTimer.current) {
      clearTimeout(impulseNoticeTimer.current);
    }
    impulseNoticeTimer.current = setTimeout(() => {
      setImpulseNotice(null);
    }, 2500);
  };

  const pushThinkingNotice = (message: string) => {
    setThinkingNotice(message);
    if (thinkingNoticeTimer.current) {
      clearTimeout(thinkingNoticeTimer.current);
    }
    thinkingNoticeTimer.current = setTimeout(() => {
      setThinkingNotice(null);
    }, 2500);
  };

  const pushNapNotice = (message: string) => {
    setNapNotice(message);
    if (napNoticeTimer.current) {
      clearTimeout(napNoticeTimer.current);
    }
    napNoticeTimer.current = setTimeout(() => {
      setNapNotice(null);
    }, 2500);
  };

  useEffect(() => {
    if (openContextTab !== 'tree') return;
    let cancelled = false;

    void construct
      .getVfs()
      .list(treePath)
      .then((entries) => {
        if (cancelled) return;
        const sorted = entries
          .map((entry) => ({
            name: entry.name,
            path: entry.path,
            type: entry.type,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setTreeEntries(sorted);
        setTreeSelection((prev) =>
          Math.min(prev, Math.max(sorted.length - 1, 0)),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setTreeEntries([]);
          setTreeSelection(0);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [construct, treePath, openContextTab]);

  useEffect(() => {
    let cancelled = false;
    const interval = setInterval(async () => {
      if (cancelled) return;
      try {
        const opened = await loadOpenedState(construct.getVfs());
        if (!cancelled) {
          setOpenState({
            files: opened.files,
            bytes: opened.context_bytes,
            tokens: opened.context_tokens,
            recently_closed: opened.recently_closed ?? [],
          });
        }
      } catch {
        // ignore
      }

      if (!cancelled) {
        setImpulseState(construct.getImpulsePool().getState());
        const scheduler = await construct.getScheduler().getState();
        if (!cancelled) {
          setSchedulerState(scheduler);
        }
      }
    }, 750);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [construct]);

  useKeyboard((key: KeyEvent) => {
    // ---- Command suggestion palette keybinds ----
    if (showCmdSuggestions && focusTarget === 'input') {
      if (key.name === 'escape') {
        // Dismiss suggestions but keep typed text
        key.preventDefault();
        setCmdDismissed(true);
        return;
      }

      if (key.name === 'up') {
        key.preventDefault();
        setCmdSuggestionIdx((prev) =>
          prev > 0 ? prev - 1 : cmdSuggestions.length - 1,
        );
        return;
      }

      if (key.name === 'down') {
        key.preventDefault();
        setCmdSuggestionIdx((prev) =>
          prev < cmdSuggestions.length - 1 ? prev + 1 : 0,
        );
        return;
      }

      if (key.name === 'tab') {
        // Autocomplete: fill the command name + a trailing space
        key.preventDefault();
        const selected = cmdSuggestions[cmdSuggestionIdx];
        if (selected) {
          const prefix = inputValue.trimStart().charAt(0); // : or /
          const usage = selected.usage ? '' : '';
          setInputValue(`${prefix}${selected.name} ${usage}`);
        }
        return;
      }
    }

    if (key.name === 'escape') {
      if (napOverlayVisible) {
        key.preventDefault();
        // If hypno is actively in review, cancel it
        if (construct.isHypnoActive()) {
          void cliHandle.submit({
            opId: `cancel-hypno:${cliHandle.constructId}:${crypto.randomUUID()}`,
            kind: 'cancel_hypno',
            payload: {},
            createdAt: new Date().toISOString(),
          });
        }
        setNapOverlayVisible(false);
        return;
      }
      onExit(0);
    }

    if (napOverlayVisible) {
      if (key.name === 'c') {
        key.preventDefault();
        if (!napOverlayText.trim()) {
          pushNapNotice('Nothing to copy.');
          return;
        }
        const result = copyTextToClipboard(napOverlayText);
        pushNapNotice(result.message);
        return;
      }

      const scrollbox = napScrollRef.current;
      if (!scrollbox) return;

      if (key.name === 'pageup' || key.name === 'prior' || key.name === 'up') {
        key.preventDefault();
        scrollbox.scrollBy({ x: 0, y: -pageScrollStep }, 'viewport');
        return;
      }

      if (
        key.name === 'pagedown' ||
        key.name === 'next' ||
        key.name === 'down'
      ) {
        key.preventDefault();
        scrollbox.scrollBy({ x: 0, y: pageScrollStep }, 'viewport');
        return;
      }

      if (key.name === 'home') {
        key.preventDefault();
        scrollbox.scrollTo({ y: 0, x: 0 });
        return;
      }

      if (key.name === 'end') {
        key.preventDefault();
        scrollbox.scrollTo({ y: scrollbox.scrollHeight, x: 0 });
      }

      return;
    }

    if (key.name === 'tab') {
      key.preventDefault();
      const order: Array<typeof focusTarget> = [
        'input',
        'transcript',
        'context',
        'impulses',
        'thinking',
      ];
      const idx = order.indexOf(focusTarget);
      const next = order[(idx + 1) % order.length] ?? 'input';
      setFocusTarget(next);
      return;
    }

    if (focusTarget === 'transcript') {
      const scrollbox = transcriptScrollRef.current;
      if (!scrollbox) return;

      if (key.name === 'pageup' || key.name === 'prior') {
        key.preventDefault();
        setFollowTail(false);
        scrollbox.scrollBy({ x: 0, y: -pageScrollStep }, 'viewport');
        return;
      }

      if (key.name === 'pagedown' || key.name === 'next') {
        key.preventDefault();
        setFollowTail(false);
        scrollbox.scrollBy({ x: 0, y: pageScrollStep }, 'viewport');
        return;
      }

      if (key.name === 'home') {
        key.preventDefault();
        setFollowTail(false);
        scrollbox.scrollTo({ y: 0, x: 0 });
        return;
      }

      if (key.name === 'end') {
        key.preventDefault();
        setFollowTail(true);
        scrollbox.scrollTo({ y: scrollbox.scrollHeight, x: 0 });
      }
    }

    if (focusTarget === 'thinking') {
      if (key.name === 'c') {
        key.preventDefault();
        if (!responseDraft.trim()) {
          pushThinkingNotice('No thinking to copy.');
          return;
        }
        const result = copyTextToClipboard(responseDraft);
        pushThinkingNotice(result.message);
        return;
      }

      const scrollbox = thinkingScrollRef.current;
      if (!scrollbox) return;

      if (key.name === 'pageup' || key.name === 'prior') {
        key.preventDefault();
        setFollowThinkingTail(false);
        scrollbox.scrollBy({ x: 0, y: -pageScrollStep }, 'viewport');
        return;
      }

      if (key.name === 'pagedown' || key.name === 'next') {
        key.preventDefault();
        setFollowThinkingTail(false);
        scrollbox.scrollBy({ x: 0, y: pageScrollStep }, 'viewport');
        return;
      }

      if (key.name === 'home') {
        key.preventDefault();
        setFollowThinkingTail(false);
        scrollbox.scrollTo({ y: 0, x: 0 });
        return;
      }

      if (key.name === 'end') {
        key.preventDefault();
        setFollowThinkingTail(true);
        scrollbox.scrollTo({ y: scrollbox.scrollHeight, x: 0 });
      }
    }

    if (focusTarget === 'context') {
      if (key.name === '1') setOpenContextTab('open');
      if (key.name === '2') setOpenContextTab('closed');
      if (key.name === '3') setOpenContextTab('tree');
      if (key.name === '4') setOpenContextTab('history');

      if (
        openContextPreview &&
        (key.name === 'backspace' || key.name === 'escape')
      ) {
        key.preventDefault();
        setOpenContextPreview(null);
        return;
      }

      if (openContextTab === 'open') {
        const items = openState.files;
        if (key.name === 'up') {
          key.preventDefault();
          setOpenSelection((prev) => Math.max(0, prev - 1));
        } else if (key.name === 'down') {
          key.preventDefault();
          setOpenSelection((prev) => Math.min(items.length - 1, prev + 1));
        } else if (key.name === 'return' && items[openSelection]) {
          key.preventDefault();
          const item = items[
            openSelection
          ] as OpenedFilesState['files'][number];
          if (item.type === 'file') {
            void construct
              .getVfs()
              .read(item.path)
              .then((content) => {
                setOpenContextPreview({ path: item.path, content });
              });
          }
        }
      }

      if (openContextTab === 'closed') {
        const items = openState.recently_closed ?? [];
        if (key.name === 'up') {
          key.preventDefault();
          setClosedSelection((prev) => Math.max(0, prev - 1));
        } else if (key.name === 'down') {
          key.preventDefault();
          setClosedSelection((prev) => Math.min(items.length - 1, prev + 1));
        } else if (key.name === 'return' && items[closedSelection]) {
          key.preventDefault();
          const item = items[closedSelection]!;
          void construct
            .getVfs()
            .read(item.path)
            .then((content) => {
              setOpenContextPreview({ path: item.path, content });
            });
        }
      }

      if (openContextTab === 'history') {
        if (key.name === 'up') {
          key.preventDefault();
          setHistorySelection((prev) => Math.max(0, prev - 1));
        } else if (key.name === 'down') {
          key.preventDefault();
          setHistorySelection((prev) =>
            Math.min(toolHistory.length - 1, prev + 1),
          );
        } else if (key.name === 'return' && toolHistory[historySelection]) {
          key.preventDefault();
          const item = toolHistory[historySelection]!;
          setOpenContextPreview({
            path: `${item.impulseId} ${item.command}`,
            content: item.output,
          });
        }
      }

      if (openContextTab === 'tree') {
        if (key.name === 'up') {
          key.preventDefault();
          setTreeSelection((prev) => Math.max(0, prev - 1));
        } else if (key.name === 'down') {
          key.preventDefault();
          setTreeSelection((prev) =>
            Math.min(treeEntries.length - 1, prev + 1),
          );
        } else if (key.name === 'backspace') {
          key.preventDefault();
          const parent = treePath.split('/').slice(0, -1).join('/') || '/';
          setTreePath(parent);
          setTreeSelection(0);
        } else if (key.name === 'return' && treeEntries[treeSelection]) {
          key.preventDefault();
          const item = treeEntries[treeSelection]!;
          if (item.type === 'directory') {
            setTreePath(item.path);
            setTreeSelection(0);
          } else {
            void construct
              .getVfs()
              .read(item.path)
              .then((content) => {
                setOpenContextPreview({ path: item.path, content });
              });
          }
        }
      }
    }

    if (focusTarget === 'impulses') {
      if (key.name === 'up') {
        key.preventDefault();
        setImpulseSelection((prev) => Math.max(0, prev - 1));
        return;
      }

      if (key.name === 'down') {
        key.preventDefault();
        setImpulseSelection((prev) =>
          Math.min(Math.max(impulseItems.length - 1, 0), prev + 1),
        );
        return;
      }

      if (key.name === 'return') {
        key.preventDefault();
        if (impulseItems.length === 0) return;
        setImpulseExpanded((prev) => !prev);
        return;
      }

      if (
        (key.name === 'escape' || key.name === 'backspace') &&
        impulseExpanded
      ) {
        key.preventDefault();
        setImpulseExpanded(false);
        return;
      }

      if (key.name === 'c') {
        key.preventDefault();
        const selected = impulseItems[impulseSelection];
        if (!selected) return;
        const details = formatImpulseDetail(selected);
        const result = copyTextToClipboard(details);
        pushImpulseNotice(result.message);
      }
    }
  });

  const transcriptLines = useMemo(() => {
    const lines: string[] = [];
    for (const entry of transcript) {
      const prefix =
        entry.role === 'user'
          ? 'you'
          : entry.role === 'construct'
            ? 'construct'
            : 'system';
      lines.push(`[${prefix}] ${entry.text}`);
    }
    return lines.join('\n\n');
  }, [transcript]);

  useEffect(() => {
    if (!followTail) return;
    const scrollbox = transcriptScrollRef.current;
    if (!scrollbox) return;

    const id = setTimeout(() => {
      scrollbox.scrollTo({ y: scrollbox.scrollHeight, x: 0 });
    }, 0);

    return () => clearTimeout(id);
  }, [followTail, transcriptLines]);

  useEffect(() => {
    if (!followThinkingTail) return;
    const scrollbox = thinkingScrollRef.current;
    if (!scrollbox) return;

    const id = setTimeout(() => {
      scrollbox.scrollTo({ y: scrollbox.scrollHeight, x: 0 });
    }, 0);

    return () => clearTimeout(id);
  }, [followThinkingTail, responseDraft]);

  // During hypno, thinking pane becomes the evaluation chat
  const isHypnoActive =
    napView.hypnoStage != null &&
    napView.hypnoStage !== 'completed' &&
    napView.hypnoStage !== 'cancelled';

  // Hypno evaluation chat text (ephemeral)
  const hypnoEvalText = useMemo(() => {
    const sections: string[] = [];

    // Current plan at top if present
    if (hypnoCurrentPlan && hypnoCurrentPlan !== '(no changes yet)') {
      sections.push(`--- Update Plan ---\n${hypnoCurrentPlan}\n---`);
    }

    // Chat transcript
    if (hypnoEvalChat.length > 0) {
      const chatLines = hypnoEvalChat
        .map((entry) => {
          const prefix =
            entry.role === 'human'
              ? '[you]'
              : entry.role === 'assistant'
                ? '[evaluator]'
                : '[hypno]';
          return `${prefix} ${entry.text}`;
        })
        .join('\n\n');
      sections.push(chatLines);
    }

    // Streaming review response
    if (hypnoReviewStreaming) {
      sections.push(`[evaluator] ${hypnoReviewStreaming}...`);
    }

    return sections.length > 0
      ? sections.join('\n\n')
      : '(no evaluation messages)';
  }, [hypnoEvalChat, hypnoCurrentPlan, hypnoReviewStreaming]);

  // Hypno document text (current draft for impulses pane)
  const hypnoDocText = useMemo(() => {
    if (!isHypnoActive) return '';
    const stage = napView.hypnoStage ?? 'unknown';
    const draft = napView.hypnoDraft ?? '';
    if (!draft) return `[${stage} stage running...]`;
    return `# Hypno Document (${stage})\n\n${draft}`;
  }, [isHypnoActive, napView.hypnoStage, napView.hypnoDraft]);

  const thinkingText = isHypnoActive
    ? hypnoEvalText
    : responseDraft.trim()
      ? responseDraft
      : '(idle)';

  const openContextContent = useMemo(() => {
    if (openContextPreview) {
      return `# ${openContextPreview.path}\n\n${openContextPreview.content}`;
    }

    if (openContextTab === 'open') {
      if (openState.files.length === 0) return '(none)';
      const lines: string[] = [];
      for (const [idx, entry] of openState.files.entries()) {
        const typeLabel = entry.type === 'directory' ? 'DIR' : 'FILE';
        const tokenCount =
          typeof entry.size_tokens === 'number'
            ? entry.size_tokens
            : estimateTokensFromBytes(entry.size_bytes);
        const sizeLabel = `${entry.size_bytes}b/${tokenCount}t`;
        const modeLabel =
          entry.type === 'file'
            ? entry.mode === 'frontmatter'
              ? 'OPEN:META'
              : 'OPEN:FULL'
            : 'OPEN:DIR';
        const prefix = idx === openSelection ? '>' : ' ';
        lines.push(
          `${prefix} [${typeLabel}:${modeLabel}] ${entry.path} (${sizeLabel})`,
        );

        if (entry.type === 'directory') {
          const children = openState.files
            .filter(
              (child) =>
                child.path !== entry.path &&
                child.path.startsWith(`${entry.path}/`),
            )
            .sort((a, b) => a.path.localeCompare(b.path));
          if (children.length === 0) {
            lines.push('  - (no open children)');
          } else {
            for (const child of children) {
              const childType = child.type === 'directory' ? 'DIR' : 'FILE';
              const childMode =
                child.type === 'directory'
                  ? 'OPEN:DIR'
                  : child.mode === 'frontmatter'
                    ? 'OPEN:META'
                    : 'OPEN:FULL';
              lines.push(`  - [${childType}:${childMode}] ${child.path}`);
            }
          }
          lines.push('  note: OPEN:FULL overrides directory frontmatter');
        }
      }
      return lines.join('\n');
    }

    if (openContextTab === 'closed') {
      const closed = openState.recently_closed ?? [];
      if (closed.length === 0) return '(none)';
      return closed
        .map((entry, idx) => {
          const typeLabel = entry.type === 'directory' ? 'DIR' : 'FILE';
          const tokenCount =
            typeof entry.size_tokens === 'number'
              ? entry.size_tokens
              : estimateTokensFromBytes(entry.size_bytes);
          const sizeLabel = `${entry.size_bytes}b/${tokenCount}t`;
          const prefix = idx === closedSelection ? '>' : ' ';
          return `${prefix} [${typeLabel}] ${entry.path} (${sizeLabel})`;
        })
        .join('\n');
    }

    if (openContextTab === 'history') {
      if (toolHistory.length === 0) return '(none)';
      return toolHistory
        .map((entry, idx) => {
          const prefix = idx === historySelection ? '>' : ' ';
          const output = entry.output.replace(/\s+/g, ' ').slice(0, 80);
          return `${prefix} ${entry.impulseId}: ${entry.tool} ${entry.command} => ${output}`;
        })
        .join('\n');
    }

    if (openContextTab === 'tree') {
      if (treeEntries.length === 0) return '(empty)';
      return [
        `Path: ${treePath}`,
        ...treeEntries.map((entry, idx) => {
          const prefix = idx === treeSelection ? '>' : ' ';
          const suffix = entry.type === 'directory' ? '/' : '';
          return `${prefix} ${entry.name}${suffix}`;
        }),
      ].join('\n');
    }

    return '(none)';
  }, [
    openContextPreview,
    openContextTab,
    openState,
    openSelection,
    closedSelection,
    historySelection,
    toolHistory,
    treeEntries,
    treeSelection,
    treePath,
  ]);

  const openPressure = useMemo(() => {
    return evaluateContextPressure(
      {
        updated: new Date().toISOString(),
        context_bytes: openState.bytes,
        context_tokens: openState.tokens,
        files: openState.files,
        recently_closed: openState.recently_closed,
      },
      DEFAULT_CONTEXT_PRESSURE_CONFIG,
    );
  }, [openState]);

  const impulseItems = useMemo(() => {
    return sortConstructViewsByStartedAtDesc(
      Object.values(impulseViews).map((impulse) => ({
        ...impulse,
        startedAt: impulse.startedAt.toISOString(),
      })),
    ).map((impulse) => ({
      ...impulse,
      startedAt: new Date(impulse.startedAt),
    }));
  }, [impulseViews]);

  useEffect(() => {
    if (impulseItems.length === 0) {
      setImpulseSelection(0);
      setImpulseExpanded(false);
      return;
    }
    if (impulseSelection > impulseItems.length - 1) {
      setImpulseSelection(Math.max(0, impulseItems.length - 1));
    }
  }, [impulseItems.length, impulseSelection]);

  useEffect(() => {
    const selectedId = impulseItems[impulseSelection]?.id ?? null;
    if (
      impulseExpanded &&
      lastSelectedImpulseId.current &&
      selectedId &&
      lastSelectedImpulseId.current !== selectedId
    ) {
      setImpulseExpanded(false);
    }
    lastSelectedImpulseId.current = selectedId;
  }, [impulseExpanded, impulseItems, impulseSelection]);

  const impulsesText = useMemo(() => {
    if (impulseItems.length === 0) return '(none)';

    const selected = impulseItems[impulseSelection];
    if (impulseExpanded && selected) {
      return formatImpulseDetail(selected);
    }

    return impulseItems
      .map((impulse, idx) => {
        const prefix = idx === impulseSelection ? '>' : ' ';
        const header = `${prefix} ${impulse.id} [${impulse.type}] (${impulse.status})`;
        const thinking = impulse.thinking
          ? `thinking: ${impulse.thinking.replace(/\s+/g, ' ').slice(0, 120)}`
          : 'thinking: (none)';
        const error = impulse.error
          ? `error: ${impulse.error.replace(/\s+/g, ' ').slice(0, 120)}`
          : null;
        const toolCounts = impulse.tools.reduce<Record<string, number>>(
          (acc, tool) => {
            acc[tool.tool] = (acc[tool.tool] ?? 0) + 1;
            return acc;
          },
          {},
        );
        const tools = Object.keys(toolCounts).length
          ? `tools: ${Object.entries(toolCounts)
              .map(([tool, count]) => `${tool}:${count}`)
              .join(' ')}`
          : 'tools: none';
        return [header, thinking, error, tools].filter(Boolean).join('\n');
      })
      .join('\n\n');
  }, [impulseExpanded, impulseItems, impulseSelection, impulseViews]);

  const scheduledText = useMemo(() => {
    if (schedulerState.scheduled.length === 0) return '(none)';
    return schedulerState.scheduled
      .map((resp: ScheduledResponse) => `${resp.id} (${resp.urgency})`)
      .join('\n');
  }, [schedulerState]);

  // Command suggestions: show when input starts with : or / and user hasn't
  // moved past the command name (no space yet, or still typing the first word)
  const cmdSuggestions: CommandSuggestion[] = useMemo(() => {
    const trimmed = inputValue.trimStart();
    if (!trimmed.startsWith(':') && !trimmed.startsWith('/')) return [];
    // Only suggest while typing the command name (before first space)
    if (trimmed.includes(' ')) return [];
    const fragment = trimmed.slice(1); // strip : or /
    return getCommandSuggestions(fragment);
  }, [inputValue]);

  // Reset selection when suggestion list changes
  useEffect(() => {
    if (cmdSuggestionIdx >= cmdSuggestions.length) {
      setCmdSuggestionIdx(0);
    }
  }, [cmdSuggestions.length]);

  // Re-show suggestions when input changes after dismissal
  useEffect(() => {
    if (cmdDismissed) {
      setCmdDismissed(false);
    }
  }, [inputValue]);

  const showCmdSuggestions =
    cmdSuggestions.length > 0 && focusTarget === 'input' && !cmdDismissed;

  // Scroll the suggestion scrollbox to keep the selected item visible
  useEffect(() => {
    if (showCmdSuggestions && cmdScrollRef.current) {
      cmdScrollRef.current.scrollTo(cmdSuggestionIdx);
    }
  }, [cmdSuggestionIdx, showCmdSuggestions]);

  // Suggestion overlay height: min 10, max 18, capped by half the terminal
  const cmdOverlayHeight = Math.min(
    Math.max(cmdSuggestions.length + 4, 10),
    18,
    Math.floor(height * 0.5),
  );

  const napDebugText = useMemo(() => formatNapDebug(napView), [napView]);
  const napOverlayText = useMemo(
    () => formatNapOverlay(napView, napNotice ?? undefined),
    [napView, napNotice],
  );

  const impulseHint =
    focusTarget === 'impulses'
      ? impulseExpanded
        ? 'Esc collapse • C copy'
        : 'Up/Down select • Enter expand • C copy'
      : 'Tab to focus impulses';

  const submitInput = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    const parsedCommand = parseCommand(trimmed);
    if (parsedCommand) {
      setInputValue('');
      const { output, exit } = await handleCommand(
        cliHandle,
        parsedCommand.command,
        parsedCommand.args,
      );

      if (output.trim()) {
        setTranscript((prev: TranscriptEntry[]) => [
          ...prev,
          {
            id: `system-${Date.now()}`,
            role: 'system',
            text: output,
            timestamp: new Date(),
          },
        ]);
      }

      if (exit) {
        setTimeout(() => onExit(0), 0);
      }
      return;
    }

    // If hypno is in review mode, route plain text to review evaluator chat
    if (
      construct.isHypnoActive() &&
      (construct.getHypnoStage() === 'analyze' ||
        construct.getHypnoStage() === 'propose')
    ) {
      // Push human message to eval chat
      setHypnoEvalChat((prev) => [
        ...prev,
        {
          role: 'human' as const,
          text: trimmed,
          timestamp: new Date(),
        },
      ]);
      setInputValue('');
      // Chat with review evaluator (non-blocking — events handle response display)
      void cliHandle
        .submit({
          opId: `chat-hypno-review:${cliHandle.constructId}:${crypto.randomUUID()}`,
          kind: 'chat_hypno_review',
          payload: { text: trimmed },
          createdAt: new Date().toISOString(),
        })
        .catch((err) => {
          setHypnoReviewStreaming('');
          setHypnoEvalChat((prev) => [
            ...prev,
            {
              role: 'system' as const,
              text: `Review error: ${err instanceof Error ? err.message : String(err)}`,
              timestamp: new Date(),
            },
          ]);
        });
      return;
    }

    setTranscript((prev: TranscriptEntry[]) => [
      ...prev,
      {
        id: `user-${Date.now()}`,
        role: 'user',
        text: trimmed,
        timestamp: new Date(),
      },
    ]);

    setInputValue('');

    void cliHandle
      .submit({
        opId: `user-message:${cliHandle.constructId}:${crypto.randomUUID()}`,
        kind: 'user_message',
        payload: {
          content: trimmed,
          timestamp: new Date().toISOString(),
        },
        createdAt: new Date().toISOString(),
      })
      .catch((err) => {
        setTranscript((prev: TranscriptEntry[]) => [
          ...prev,
          {
            id: `system-${Date.now()}`,
            role: 'system',
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            timestamp: new Date(),
          },
        ]);
      });
  };

  const contextWidth = Math.max(26, Math.floor(width * 0.2));
  const impulseWidth = Math.max(34, Math.floor(width * 0.35));
  const inputHeight = 3;
  const thinkingHeight = Math.max(4, Math.floor(height * 0.2));
  const mainHeight = Math.max(8, height - inputHeight - thinkingHeight - 4);

  return (
    <box flexDirection="column" style={{ width: '100%', height: '100%' }}>
      <box flexDirection="row" style={{ height: mainHeight }}>
        <box
          title={`Open Context (${openState.files.length}) [${openContextTab}]${
            focusTarget === 'context' ? ' *' : ''
          }`}
          border
          style={{
            width: contextWidth,
            padding: 1,
            borderColor: focusTarget === 'context' ? '#60A5FA' : undefined,
          }}
        >
          <text fg="#9CA3AF">
            {`tokens: ${openState.tokens} | bytes: ${openState.bytes}`}
          </text>
          <text fg="#6B7280">Tab: 1 Open 2 Closed 3 Tree 4 History</text>
          <scrollbox
            focused={focusTarget === 'context'}
            style={{ flexGrow: 1, marginTop: 1 }}
          >
            <text>{openContextContent}</text>
          </scrollbox>
          <text fg="#9CA3AF">
            {`Pressure: ${openPressure.status} (${Math.round(openPressure.ratio * 100)}%) ${openPressure.contextTokens}/${openPressure.maxTokens} tokens`}
          </text>
          <text fg="#6B7280">open-handle tokens (heuristic)</text>
        </box>

        <box
          title={`Transcript${focusTarget === 'transcript' ? ' (focused)' : ''}`}
          border
          style={{
            flexGrow: 1,
            marginLeft: 1,
            marginRight: 1,
            padding: 1,
            borderColor: focusTarget === 'transcript' ? '#60A5FA' : undefined,
          }}
        >
          <scrollbox
            ref={transcriptScrollRef}
            focused={focusTarget === 'transcript'}
            stickyScroll={followTail}
            stickyStart="bottom"
            style={{ height: '100%' }}
          >
            <text>{transcriptLines || '(no messages yet)'}</text>
          </scrollbox>
        </box>

        <box
          title={
            isHypnoActive
              ? `Hypno Document (${napView.hypnoStage})${focusTarget === 'impulses' ? ' *' : ''}`
              : `Impulses (${impulseState.active.length})${
                  focusTarget === 'impulses' ? ' *' : ''
                }`
          }
          border
          style={{
            width: impulseWidth,
            padding: 1,
            borderColor:
              focusTarget === 'impulses'
                ? isHypnoActive
                  ? '#F59E0B'
                  : '#60A5FA'
                : undefined,
          }}
        >
          {isHypnoActive ? (
            <scrollbox
              focused={focusTarget === 'impulses'}
              style={{ height: '100%' }}
            >
              <text>{hypnoDocText}</text>
            </scrollbox>
          ) : (
            <>
              <text fg="#9CA3AF">{`queued: ${impulseState.queuedCount}`}</text>
              <scrollbox
                focused={focusTarget === 'impulses'}
                style={{ height: '100%', marginTop: 1 }}
              >
                <text>{impulsesText}</text>
              </scrollbox>
              <text fg="#6B7280" style={{ marginTop: 1 }}>
                {impulseHint}
              </text>
              {impulseNotice ? <text fg="#9CA3AF">{impulseNotice}</text> : null}
              <text fg="#9CA3AF" style={{ marginTop: 1 }}>
                Scheduled
              </text>
              <scrollbox style={{ height: 6, marginTop: 1 }}>
                <text>{scheduledText}</text>
              </scrollbox>
              <text fg="#9CA3AF" style={{ marginTop: 1 }}>
                Nap
              </text>
              <scrollbox style={{ height: 8, marginTop: 1 }}>
                <text>{napDebugText}</text>
              </scrollbox>
            </>
          )}
        </box>
      </box>

      <box
        title={
          isHypnoActive
            ? `Hypno Evaluation${focusTarget === 'thinking' ? ' (focused)' : ''}`
            : `Thinking${focusTarget === 'thinking' ? ' (focused)' : ''}`
        }
        border
        flexDirection="column"
        style={{
          height: thinkingHeight,
          paddingLeft: 1,
          paddingRight: 1,
          marginTop: 1,
          borderColor:
            focusTarget === 'thinking'
              ? isHypnoActive
                ? '#F59E0B'
                : '#60A5FA'
              : undefined,
        }}
      >
        <scrollbox
          ref={thinkingScrollRef}
          focused={focusTarget === 'thinking'}
          stickyScroll={followThinkingTail}
          stickyStart="bottom"
          style={{ flexGrow: 1 }}
        >
          <text fg="#9CA3AF">{thinkingText}</text>
        </scrollbox>
        <text fg="#6B7280">
          {focusTarget === 'thinking'
            ? 'PgUp/PgDn scroll | C copy'
            : 'Tab to focus thinking'}
        </text>
        {thinkingNotice ? <text fg="#9CA3AF">{thinkingNotice}</text> : null}
      </box>

      <box
        title={
          isHypnoActive
            ? `Hypno Feedback${focusTarget === 'input' ? ' (focused)' : ''}`
            : `Input${focusTarget === 'input' ? ' (focused)' : ''}`
        }
        border
        style={{ height: inputHeight, marginTop: 1 }}
      >
        <input
          placeholder={
            isHypnoActive
              ? `Hypno review (${napView.hypnoStage}) — chat to discuss, :update to apply plan, :accept to advance`
              : 'Type a message or : for commands'
          }
          value={inputValue}
          focused={focusTarget === 'input'}
          onInput={setInputValue}
          onSubmit={() => submitInput(inputValue)}
        />
      </box>
      {showCmdSuggestions ? (
        <box
          title="Commands"
          border
          style={{
            position: 'absolute',
            bottom: inputHeight + 1,
            left: 0,
            width: '100%',
            padding: 1,
            borderColor: '#60A5FA',
            backgroundColor: '#0B1220',
            height: cmdOverlayHeight,
          }}
        >
          <scrollbox ref={cmdScrollRef} style={{ flexGrow: 1 }}>
            {cmdSuggestions.map((s, i) => {
              const pointer = i === cmdSuggestionIdx ? '>' : ' ';
              const alias = s.aliasHint ? ` ${s.aliasHint}` : '';
              const usage = s.usage ? ` ${s.usage}` : '';
              return (
                <text
                  key={s.name}
                  fg={i === cmdSuggestionIdx ? '#60A5FA' : '#9CA3AF'}
                >
                  {`${pointer} :${s.name}${usage}${alias}  ${s.description}`}
                </text>
              );
            })}
          </scrollbox>
        </box>
      ) : null}
      {napOverlayVisible ? (
        <box
          title={`Nap Mode${napView.status === 'running' ? ' (running)' : ''}`}
          border
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            padding: 1,
            borderColor: '#F59E0B',
            backgroundColor: '#0B1220',
          }}
        >
          <scrollbox ref={napScrollRef} focused style={{ height: '100%' }}>
            <text>{napOverlayText}</text>
          </scrollbox>
        </box>
      ) : null}
    </box>
  );
}

function formatImpulseDetail(impulse: ImpulseView): string {
  const lines: string[] = [];
  lines.push(`${impulse.id} [${impulse.type}] (${impulse.status})`);
  lines.push(`started: ${impulse.startedAt.toISOString()}`);

  if (impulse.thinking) {
    lines.push('');
    lines.push('thinking:');
    lines.push(impulse.thinking.trim() || '(none)');
  } else {
    lines.push('');
    lines.push('thinking: (none)');
  }

  if (impulse.error) {
    lines.push('');
    lines.push('error:');
    lines.push(impulse.error);
  }

  lines.push('');
  if (impulse.tools.length > 0) {
    const toolLines = formatToolUsageLines(
      impulse.tools.map((tool) => ({
        command: `${tool.tool}: ${tool.command}`,
        output: tool.output,
      })),
      { maxEntries: 12, maxOutputLength: 120 },
    );
    if (toolLines.length > 0) {
      lines.push('tools (trimmed):');
      for (const line of toolLines) {
        lines.push(`- ${line}`);
      }
    } else {
      lines.push('tools: (none)');
    }
  } else {
    lines.push('tools: (none)');
  }

  return lines.join('\n');
}

function formatNapDebug(nap: NapView): string {
  const lines: string[] = [];
  if (nap.hypnoStage != null) {
    lines.push(`hypno: ${nap.hypnoStage}`);
  }
  lines.push(`status: ${nap.status}`);

  if (nap.startedAt) {
    lines.push(`started: ${nap.startedAt.toISOString()}`);
  }
  if (nap.completedAt) {
    lines.push(`completed: ${nap.completedAt.toISOString()}`);
  }

  if (nap.error) {
    lines.push('error:');
    lines.push(nap.error.split('\n').slice(0, 3).join('\n'));
  }

  if (nap.analysis) {
    lines.push('analysis:');
    lines.push(nap.analysis.split('\n').slice(0, 8).join('\n'));
  }

  if (nap.tools.length > 0) {
    const toolLines = formatToolUsageLines(nap.tools, {
      maxEntries: 5,
      maxOutputLength: 80,
    });
    if (toolLines.length > 0) {
      lines.push('tools:');
      for (const line of toolLines) {
        lines.push(`- ${line}`);
      }
    } else {
      lines.push('tools: (none)');
    }
  } else {
    lines.push('tools: (none)');
  }

  return lines.join('\n');
}

function formatNapOverlay(nap: NapView, notice?: string): string {
  const lines: string[] = [];
  const isManual = nap.hypnoStage != null;

  if (isManual) {
    lines.push(`mode: hypno | stage: ${nap.hypnoStage}`);
  } else {
    lines.push(`status: ${nap.status}`);
  }

  if (nap.startedAt) {
    lines.push(`started: ${nap.startedAt.toISOString()}`);
  }
  if (nap.completedAt) {
    lines.push(`completed: ${nap.completedAt.toISOString()}`);
  }

  if (nap.error) {
    lines.push('');
    lines.push('error:');
    lines.push(nap.error);
  }

  // Hypno: show the current draft being reviewed
  if (isManual && nap.hypnoDraft) {
    const stageLabel =
      nap.hypnoStage === 'analyze'
        ? 'Analysis'
        : nap.hypnoStage === 'propose'
          ? 'Proposal'
          : 'Draft';
    lines.push('');
    lines.push(`--- ${stageLabel} Draft ---`);
    lines.push(nap.hypnoDraft.trim());
  } else if (nap.analysis) {
    lines.push('');
    lines.push('analysis:');
    lines.push(nap.analysis.trim());
  }

  const files = extractFilesFromToolUsage(nap.tools);
  if (files.length > 0) {
    lines.push('');
    lines.push(`files touched (${files.length}):`);
    for (const file of files) {
      lines.push(`- ${file}`);
    }
  }

  const toolLines = formatToolUsageLines(nap.tools, {
    maxEntries: 30,
    maxOutputLength: 120,
  });
  lines.push('');
  if (toolLines.length > 0) {
    lines.push('tool log:');
    for (const line of toolLines) {
      lines.push(`- ${line}`);
    }
  } else {
    lines.push('tool log: (none)');
  }

  if (notice) {
    lines.push('');
    lines.push(notice);
  }

  lines.push('');
  if (
    isManual &&
    (nap.hypnoStage === 'analyze' || nap.hypnoStage === 'propose')
  ) {
    lines.push(
      'Chat to discuss | :update to apply plan | :accept to advance | Esc cancel',
    );
  } else if (isManual && nap.hypnoStage === 'commit') {
    lines.push('Commit stage running... | Esc cancel');
  } else {
    lines.push('PgUp/PgDn scroll | C copy | Esc close');
  }
  return lines.join('\n');
}

function copyTextToClipboard(text: string): { message: string } {
  const normalized = text.replace(/\r\n/g, '\n');
  const attempts: Array<{ cmd: string; args: string[] }> = [];

  if (process.platform === 'darwin') {
    attempts.push({ cmd: 'pbcopy', args: [] });
  } else if (process.platform === 'win32') {
    attempts.push({ cmd: 'clip', args: [] });
  } else {
    attempts.push({ cmd: 'xclip', args: ['-selection', 'clipboard'] });
    attempts.push({ cmd: 'xsel', args: ['--clipboard', '--input'] });
  }

  for (const attempt of attempts) {
    const result = spawnSync(attempt.cmd, attempt.args, {
      input: normalized,
      encoding: 'utf8',
    });
    if (!result.error && result.status === 0) {
      return { message: 'Copied to clipboard.' };
    }
  }

  const filePath = join(tmpdir(), `ai-construct-copy-${Date.now()}.txt`);
  writeFileSync(filePath, normalized, 'utf8');
  return { message: `Clipboard unavailable; wrote ${filePath}` };
}

function printHelp(): void {
  console.log(`
ai-construct - A cognitive architecture for AI agents (OpenTUI)

Usage: bun run demo [options]

Options:
  --id <name>       Construct identifier (default: demo)
  --storage <path>  Storage directory (default: ~/.ai-construct/<id>)
  --debug-dump-dir <path>  Dump stage context to directory
  --heartbeat-shape <path>  JSON file for heartbeat cadence shape
  --base-url <url>   OpenAI-compatible base URL (e.g. http://localhost:8082/openai)
  --api-key <key>    API key for the OpenAI-compatible endpoint
  --model <name>     Default construct model (default: ${DEFAULT_CONSTRUCT_MODEL})
  --open <path[:mode]>  Open file/dir into context at startup (repeatable)
                        mode: full | frontmatter (default: full)
                        /dir/ => directory summary | /dir/* => shallow | /dir/** => recursive
                        pinning /context/logs, /handles, or /queue is disallowed
  --help, -h        Show this help
  --version, -v     Show version
`);
}

// Only run main() when this file is executed directly (not when imported as a module)
if (import.meta.main) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
