/**
 * Craft Response — Personality/tone layer (spec §20.6 step 7)
 *
 * Takes plan_response() proposals from a committed preview and crafts
 * the final user-facing message with proper personality, tone, and style.
 *
 * The impulse stage (Grok) decides WHAT to do and plans the response.
 * This stage (Kimi) decides HOW to say it — voice, personality, phrasing.
 *
 * Input:  plan_response proposals (from committed preview)
 * Context: identity files (SOUL.md, IDENTITY.md, USER.md) + recent transcript
 * Output: polished user-facing text
 */

import type { AIDeps, OverlayFs } from '@inkibra/ai-flow';
import type { ResponsePlan } from '@inkibra/ai-sandbox-computer';
import { loadLanesConfig, resolveStageContext } from '../vfs/context-system';
import { canRespondToLane } from './lane-response-policy';

export type CraftResponseOptions = {
  impulseId: string;
  responsePlans: ResponsePlan[];
  model?: string;
  /** Target lane for this response — used for lane-scoped context resolution */
  targetLane?: string;
};

/**
 * Craft a polished response from plan_response proposals.
 *
 * Uses the 'response' stage context (identity files + transcript)
 * to inform personality and tone.
 */
export async function craftResponse(
  vfs: OverlayFs,
  deps: AIDeps,
  options: CraftResponseOptions,
): Promise<string> {
  const { responsePlans } = options;
  if (responsePlans.length === 0) return '';

  // Resolve context for the response stage (lane-scoped if targeting a lane)
  const now = new Date();
  const stageContext = await resolveStageContext(vfs, {
    stage: 'response',
    now,
    lane: options.targetLane,
  });

  // Build the plans section
  const planLines = responsePlans.map((plan, i) => {
    const importance = plan.importance ?? 'normal';
    return responsePlans.length > 1
      ? `${i + 1}. [${importance}] ${plan.text}`
      : plan.text;
  });

  const systemPrompt = `You are crafting a user-facing response for an AI construct.

You receive:
1. The construct's identity and context (who it is, who it's talking to, recent conversation)
2. Response plans from the impulse stage — these describe WHAT to communicate

Your job: take the plans and craft the actual message the user will see. Apply the construct's personality, tone, and communication style from its identity files.

Rules:
- Write as the construct (first person)
- Match the personality in SOUL.md and IDENTITY.md
- Keep it natural and conversational
- If multiple plans are given, weave them into one cohesive message
- Don't add information not in the plans — they are the source of truth for content
- Don't mention that you're "crafting" or "polishing" — just write the response naturally
- Keep the length proportional to the content — short plans get short responses
- To send multiple separate chat bubbles, use three blank lines between them. One blank line is normal paragraph spacing within a single message`;

  const userPrompt = `## Context

${stageContext}

## Response Plans

${planLines.join('\n')}

Write the response now. Output ONLY the response text, nothing else.`;

  const model = options.model ?? 'moonshotai/kimi-k2.5';

  try {
    deps.logger.info('Crafting response', {
      model,
      plansCount: responsePlans.length,
      contextChars: stageContext.length,
    });
    const response = await deps.openAI.responses.create({
      model,
      input: [
        { role: 'developer', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    // Extract text from response
    const text =
      response.output
        ?.filter((item) => item.type === 'message')
        .flatMap((item) =>
          'content' in item &&
          Array.isArray((item as { content?: unknown[] }).content)
            ? (
                item as { content: Array<{ type: string; text?: string }> }
              ).content
                .filter((c) => c.type === 'output_text')
                .map((c) => c.text ?? '')
            : [],
        )
        .join('') ?? '';

    deps.logger.info('Crafted response', { chars: text.length });
    return text.trim() || planLines.join('\n');
  } catch (err) {
    // Fallback: deliver plans directly if response stage fails
    deps.logger.warn('Craft response failed, delivering plans directly', {
      error: err instanceof Error ? err.message : String(err),
    });
    return planLines.join('\n');
  }
}

/**
 * Check if a source lane is allowed to respond to a target lane.
 * Same-lane delivery is always allowed. Cross-lane delivery is self-only by default.
 */
export async function checkLanePermission(
  vfs: OverlayFs,
  sourceLane: string,
  targetLane: string,
): Promise<boolean> {
  const lanesConfig = await loadLanesConfig(vfs);
  return canRespondToLane(lanesConfig, sourceLane, targetLane);
}

/**
 * Group response plans by target lane and craft responses in parallel.
 * Permission checks gate each lane — unauthorized responses are dropped with a warning.
 */
export async function craftLaneResponses(
  vfs: OverlayFs,
  deps: AIDeps,
  options: {
    impulseId: string;
    sourceLane: string;
    responsePlans: ResponsePlan[];
    model?: string;
  },
): Promise<Array<{ lane: string; text: string }>> {
  const { responsePlans, sourceLane } = options;

  // Group plans by target lane
  const plansByLane = new Map<string, ResponsePlan[]>();
  for (const plan of responsePlans) {
    const lane = plan.lane ?? sourceLane;
    const existing = plansByLane.get(lane);
    if (existing) {
      existing.push(plan);
    } else {
      plansByLane.set(lane, [plan]);
    }
  }

  // Process each target lane in parallel
  const results = await Promise.all(
    Array.from(plansByLane.entries()).map(async ([targetLane, plans]) => {
      // Permission check
      const allowed = await checkLanePermission(vfs, sourceLane, targetLane);
      if (!allowed) {
        deps.logger.warn('Permission denied for lane response', {
          sourceLane,
          targetLane,
          plans: plans.length,
        });
        return null;
      }

      // Craft response for this lane
      const text = await craftResponse(vfs, deps, {
        impulseId: options.impulseId,
        responsePlans: plans,
        model: options.model,
        targetLane,
      });

      return { lane: targetLane, text };
    }),
  );

  return results.filter((r): r is { lane: string; text: string } => r !== null);
}
