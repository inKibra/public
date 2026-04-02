/**
 * @inkibra/storybook - Testing Utilities
 *
 * Playwright helpers for running story tests.
 */

import type { Page } from '@playwright/test';
import { SB_EVENT_OUTPUT } from '../runtime/messages';
import type {
  Locator,
  Shot,
  ShotSequence,
  Step,
  StoryKind,
  StoryManifest,
  StoryRecord,
  StoryRuntimeMode,
  StoryShotPlan,
} from '../types';

// Re-export types for convenience
export type { StoryManifest, StoryRecord, StoryKind };

/**
 * Load story manifest from a running storybook server.
 */
export async function loadManifest(baseUrl: string): Promise<StoryManifest> {
  const url = new URL('/__sb/manifest.json', baseUrl);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load manifest (${response.status}): ${url}`);
  }
  return (await response.json()) as StoryManifest;
}

// ============================================================================
// Manifest Filtering
// ============================================================================

/**
 * Filter stories that have review enabled.
 */
export function filterForReview(manifest: StoryManifest): StoryRecord[] {
  return manifest.filter((story) => story.review.enabled);
}

/**
 * Filter stories that have VRT enabled.
 */
export function filterForVrt(manifest: StoryManifest): StoryRecord[] {
  return manifest.filter((story) => story.vrt.enabled);
}

/**
 * Filter stories by kind.
 */
export function filterByKind(
  manifest: StoryManifest,
  kind: StoryKind,
): StoryRecord[] {
  return manifest.filter((story) => story.kind === kind);
}

/**
 * Filter stories by category.
 */
export function filterByCategory(
  manifest: StoryManifest,
  category: string,
): StoryRecord[] {
  return manifest.filter((story) => story.meta.category === category);
}

/**
 * Get page stories (convenience filter).
 */
export function getPageStories(manifest: StoryManifest): StoryRecord[] {
  return filterByKind(manifest, 'page');
}

/**
 * Get component stories (convenience filter).
 */
export function getComponentStories(manifest: StoryManifest): StoryRecord[] {
  return filterByKind(manifest, 'component');
}

/**
 * Get scenario stories (convenience filter).
 */
export function getScenarioStories(manifest: StoryManifest): StoryRecord[] {
  return filterByKind(manifest, 'scenario');
}

// ============================================================================
// Step Runner
// ============================================================================

/**
 * Resolve a Locator to a Playwright locator.
 */
function resolveLocator(page: Page, locator: Locator) {
  switch (locator.by) {
    case 'role':
      return page.getByRole(locator.role, { name: locator.name });
    case 'text':
      return page.getByText(locator.value);
    case 'testId':
      return page.getByTestId(locator.value);
    case 'css':
      return page.locator(locator.value);
  }
}

/**
 * Execute a single step.
 */
async function runStep(page: Page, step: Step): Promise<void> {
  switch (step.type) {
    case 'click': {
      const loc = resolveLocator(page, step.target);
      await loc.click();
      break;
    }

    case 'type': {
      const loc = resolveLocator(page, step.target);
      if (step.clear) {
        await loc.fill('');
      }
      await loc.type(step.text);
      break;
    }

    case 'hold': {
      const loc = resolveLocator(page, step.target);
      await loc.hover();
      await page.mouse.down();
      await page.waitForTimeout(step.ms);
      await page.mouse.up();
      break;
    }

    case 'waitFor': {
      const loc = resolveLocator(page, step.target);
      await loc.waitFor({ state: step.state });
      break;
    }

    case 'sleep': {
      await page.waitForTimeout(step.ms);
      break;
    }

    case 'scroll': {
      const loc = resolveLocator(page, step.target);
      const amount = step.amount ?? 200;
      const delta = step.direction === 'up' ? -amount : amount;
      await loc.hover();
      await page.mouse.wheel(0, delta);
      break;
    }
  }
}

/**
 * Execute all steps for a shot.
 */
async function runShotSteps(page: Page, shot: Shot): Promise<void> {
  if (!shot.steps) return;

  for (const step of shot.steps) {
    await runStep(page, step);
  }
}

// ============================================================================
// Shot Plan Execution
// ============================================================================

/**
 * Callback for shot capture.
 */
export type ShotCaptureCallback = (opts: {
  sequenceId: string;
  shotId: string;
  page: Page;
}) => Promise<void>;

/**
 * Execute a shot sequence.
 */
async function runSequence(
  page: Page,
  sequence: ShotSequence,
  onCapture: ShotCaptureCallback,
): Promise<void> {
  for (const shot of sequence.shots) {
    // Run setup steps
    await runShotSteps(page, shot);

    // Capture
    await onCapture({
      sequenceId: sequence.id,
      shotId: shot.id,
      page,
    });
  }
}

/**
 * Execute a complete shot plan.
 *
 * @param page - Playwright page
 * @param plan - The shot plan to execute
 * @param onCapture - Callback called for each shot capture point
 * @param onNavigate - Optional callback to navigate before each sequence (for fresh state)
 *
 * @example
 * ```ts
 * await runShots(page, story.review.shots, async ({ sequenceId, shotId, page }) => {
 *   const screenshotPath = `${story.id}--${sequenceId}--${shotId}.png`;
 *   await page.screenshot({ path: screenshotPath, fullPage: true });
 * });
 * ```
 */
export async function runShots(
  page: Page,
  plan: StoryShotPlan,
  onCapture: ShotCaptureCallback,
  onNavigate?: () => Promise<void>,
): Promise<void> {
  for (const sequence of plan.sequences) {
    // Navigate for fresh state if callback provided
    if (onNavigate) {
      await onNavigate();
    }

    await runSequence(page, sequence, onCapture);
  }
}

// ============================================================================
// Default Shot Plan
// ============================================================================

/**
 * Get the default shot plan (main/initial).
 */
export function defaultShotPlan(): StoryShotPlan {
  return {
    sequences: [{ id: 'main', shots: [{ id: 'initial' }] }],
  };
}

// ============================================================================
// Story URL Helpers (package provides these, we just expose a builder)
// ============================================================================

/**
 * Build a story URL from parts.
 * The actual URL format is package-specific.
 */
export function buildStoryUrl(
  baseUrl: string,
  storyId: string,
  params?: Record<string, string>,
): string {
  const url = new URL(baseUrl);
  url.searchParams.set('story', storyId);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

/**
 * Build an iframe story URL.
 */
export function buildIframeStoryUrl(
  baseUrl: string,
  storyId: string,
  opts?: {
    mode?: StoryRuntimeMode;
    params?: Record<string, string>;
  },
): string {
  const url = new URL('/__sb/iframe.html', baseUrl);
  url.searchParams.set('story', storyId);

  if (opts?.mode && opts.mode !== 'dev') {
    url.searchParams.set('sb_mode', opts.mode);
  }

  if (opts?.params) {
    for (const [key, value] of Object.entries(opts.params)) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

/**
 * Wait until the story iframe runtime marks itself ready.
 */
export async function waitForStoryReady(
  page: Page,
  timeout = 10_000,
): Promise<void> {
  await page.waitForSelector(
    '[data-storybook-root][data-storybook-ready="true"]',
    {
      timeout,
    },
  );
}

/**
 * Install a simple in-page output buffer for tests.
 * Captures `sb:output` CustomEvents emitted by the iframe runtime.
 */
export async function installStoryOutputCapture(
  page: Page,
  globalKey = '__SB_OUTPUTS__',
): Promise<void> {
  await page.addInitScript(
    ({ key, eventName }) => {
      const win = window as unknown as {
        [k: string]: Array<unknown> | undefined;
      };
      win[key] = [];
      window.addEventListener(eventName, (event) => {
        const customEvent = event as CustomEvent;
        const next = win[key] ?? [];
        next.push(customEvent.detail);
        if (next.length > 500) {
          next.splice(0, next.length - 500);
        }
        win[key] = next;
      });
    },
    { key: globalKey, eventName: SB_EVENT_OUTPUT },
  );
}

/**
 * Read captured output events from a page.
 */
export async function getCapturedStoryOutputs(
  page: Page,
  globalKey = '__SB_OUTPUTS__',
): Promise<unknown[]> {
  return page.evaluate((key) => {
    const win = window as unknown as {
      [k: string]: Array<unknown> | undefined;
    };
    return win[key] ?? [];
  }, globalKey);
}
