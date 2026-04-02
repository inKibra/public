/**
 * createPreviewExecTool — The AI's single tool during impulse.
 *
 * Wraps the preview engine as a custom ai-flow tool with raw text input.
 * The AI sends TypeScript code directly as the tool input — no JSON wrapper needed.
 *
 * See spec §5.5.
 */

import { createAiCustomTool } from '@inkibra/ai-flow';
import type { ResponsePlanPolicy } from './globals';
import type { PreviewEngine, PreviewExecRecord } from './preview-engine';
import type { CommandRegistry } from './types';

// ---------------------------------------------------------------------------
// Flow context shape
// ---------------------------------------------------------------------------

export type ImpulseFlowContext = Record<string, unknown> & {
  previewExecRuns?: Record<string, PreviewExecRecord>;
  previewExecOrder?: string[];
  responsePlanPolicy?: ResponsePlanPolicy;
};

// ---------------------------------------------------------------------------
// Tool description generation
// ---------------------------------------------------------------------------

function generatePreviewExecDescription(
  _registry: CommandRegistry,
  _engine: PreviewEngine,
): string {
  return `Run TypeScript code on a sandboxed preview of your construct's computer. The code runs on a forked copy of your filesystem. Preview results have NO EFFECT unless you later commit the returned exec_id in your structured output.

## Globals available in your code

command(name, ...args) → Promise<unknown>
  Dispatches a registered command. Command output is already captured in stdout. Detailed command docs are loaded in context — use those docs instead of guessing arguments.

plan_response({ text: string, importance?: 'low'|'normal'|'high'|'urgent', lane?: string }) → void
  Plans a user-facing message. Describe WHAT to communicate — key points, information, tone direction. Omit lane for same-lane delivery. When the host provides lane policy, invalid cross-lane targets fail during preview and commit.

show(value) → value
  Pretty-prints a value to stdout and returns it. Useful for inspecting non-command values.

console.log/warn/error(...)
  Captured as stdout. Use for debug output.

## Imports

import { command } from 'sys'
import { ai } from 'sys/ai'
import fs from 'sys/fs'
import { join, basename } from 'node:path'
import { Buffer } from 'node:buffer'
import { URL } from 'node:url'
import { randomUUID } from 'node:crypto'

System, developer, and agent package docs are loaded in context. Use those docs for the detailed public API surface and semantics.

## How previews work

Each preview_exec call forks your VFS, runs your code, and returns stdout, captured response plans, and a unique exec_id.

You can call preview_exec multiple times to explore and iterate. In your structured output, set execId to the exec_id you want to commit. execId is required — you must always commit a preview. Until you commit a real exec_id, every write, delete, rename, and response plan shown by preview_exec is speculative and has no effect.`;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export type PreviewExecToolOptions = {
  engine: PreviewEngine;
  registry: CommandRegistry;
};

export function createPreviewExecTool<TDeps = unknown>(
  options: PreviewExecToolOptions,
) {
  return createAiCustomTool<
    ImpulseFlowContext,
    string,
    PreviewExecRecord,
    TDeps
  >('preview_exec', {
    description: generatePreviewExecDescription(
      options.registry,
      options.engine,
    ),
    parseInput: (raw: string) => {
      // The custom tool receives raw text — try to unwrap JSON if the provider wrapped it
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.input === 'string') {
          return { success: true, data: parsed.input };
        }
        if (typeof parsed?.code === 'string') {
          return { success: true, data: parsed.code };
        }
      } catch {
        // Not JSON — raw code string, use as-is
      }
      return { success: true, data: raw };
    },
    execute: async (code, ctx) => {
      const record = await options.engine.preview(code, {
        ctx,
        responsePlanPolicy: ctx.responsePlanPolicy,
      });

      // Store in hidden flow context
      if (!ctx.previewExecRuns) ctx.previewExecRuns = {};
      if (!ctx.previewExecOrder) ctx.previewExecOrder = [];
      ctx.previewExecRuns[record.execId] = record;
      ctx.previewExecOrder.push(record.execId);

      if (record.error) {
        return { success: false, message: record.error };
      }
      return { success: true, data: record };
    },
    render: (record) => {
      const parts: string[] = [
        'Preview only — no effect unless this exec_id is later committed.',
        'All file writes, deletions, and response plans shown below are speculative.',
      ];
      if (record.stdout) parts.push(record.stdout);
      if (record.responsePlans.length > 0) {
        parts.push('Response plans:');
        for (const r of record.responsePlans) {
          const lane = r.lane ? ` → ${r.lane}` : '';
          parts.push(
            `  [${r.importance ?? 'normal'}]${lane} ${r.text}`.trimEnd(),
          );
        }
      }
      parts.push(`\n[exec_id: ${record.execId}]`);
      const renderedOutput = parts.join('\n');
      if (record.ephemeralOutput) {
        return {
          renderedOutput,
          ephemeralOutput: record.ephemeralOutput,
        };
      }
      return renderedOutput;
    },
  });
}
