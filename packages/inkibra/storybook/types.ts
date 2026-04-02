/**
 * @inkibra/storybook - Public Types
 *
 * These types define the contract for story authoring and discovery.
 */

import type { ReactNode } from 'react';

// ============================================================================
// Story Props (passed to Story components)
// ============================================================================

/**
 * Generic runtime mode for story rendering.
 */
export type StoryRuntimeMode = 'dev' | 'test' | 'vrt';

/**
 * Runtime context passed to stories.
 */
export type StoryRuntime = {
  mode: StoryRuntimeMode;
};

/**
 * Props passed to all Story components.
 */
export type StoryProps = {
  /** Callback to report story output/actions for debugging */
  onOutput?: (data: unknown) => void;
  /** Callback to register an input panel for story controls */
  onRegisterInput?: (panel: ReactNode) => void;
  /** Generic runtime context (dev/test/vrt) */
  runtime?: StoryRuntime;
};

// ============================================================================
// Shot Schema (step runner contract for review/vrt)
// ============================================================================

/**
 * Element locator for step actions.
 */
export type Locator =
  | {
      by: 'role';
      role: 'button' | 'heading' | 'textbox' | 'link' | 'checkbox';
      name: string;
    }
  | { by: 'text'; value: string }
  | { by: 'testId'; value: string }
  | { by: 'css'; value: string };

/**
 * A single step in a shot sequence.
 */
export type Step =
  | { type: 'click'; target: Locator }
  | { type: 'type'; target: Locator; text: string; clear?: boolean }
  | { type: 'hold'; target: Locator; ms: number }
  | { type: 'waitFor'; target: Locator; state: 'visible' | 'hidden' }
  | { type: 'sleep'; ms: number }
  | {
      type: 'scroll';
      target: Locator;
      direction: 'up' | 'down';
      amount?: number;
    };

/**
 * A single screenshot capture point with optional setup steps.
 */
export type Shot = {
  /** Unique identifier for this shot within the sequence */
  id: string;
  /** Steps to execute before capturing this shot */
  steps?: Step[];
};

/**
 * A sequence of shots that share setup state.
 * Shots within a sequence continue from the previous shot's state.
 * To start fresh, define a new sequence.
 */
export type ShotSequence = {
  /** Unique identifier for this sequence */
  id: string;
  /** Shots to capture in order */
  shots: Shot[];
};

/**
 * Complete shot plan for a story variant.
 */
export type StoryShotPlan = {
  /** Shot sequences to execute */
  sequences: ShotSequence[];
};

/**
 * Default shot plan: single sequence with one initial shot.
 */
export const DEFAULT_SHOT_PLAN: StoryShotPlan = {
  sequences: [{ id: 'main', shots: [{ id: 'initial' }] }],
};

// ============================================================================
// Review/VRT Config Types
// ============================================================================

/**
 * Configuration for a capture lane (review or vrt).
 */
export type CaptureLaneConfig = {
  /** Whether this lane is enabled for this variant */
  enabled: boolean;
  /** Shot plan for capturing screenshots */
  shots: StoryShotPlan;
};

/**
 * Partial capture config as authored in story files.
 * Missing fields are filled with defaults.
 */
export type PartialCaptureLaneConfig = {
  enabled?: boolean;
  shots?: StoryShotPlan;
};

// ============================================================================
// Story Metadata
// ============================================================================

/**
 * Metadata for a story variant.
 * Must be AST-extractable (object literals only, no function calls).
 */
export type StoryMeta = {
  /** Override the auto-generated ID (optional) */
  id?: string;
  /** Human-readable label for display */
  label: string;
  /** Category for grouping (e.g., 'home', 'session', 'settings') */
  category?: string;
  /** Tags for filtering and organization */
  tags?: string[];
  /** Component names used in this story (for documentation) */
  components?: string[];
};

// ============================================================================
// Story Variant (the authoring contract)
// ============================================================================

/**
 * A story variant as exported from a story file.
 *
 * @example
 * ```ts
 * export const Default = {
 *   meta: { label: 'Training Home', category: 'home' },
 *   review: { enabled: true },
 *   vrt: { enabled: false },
 *   Story: (props: StoryProps) => <TrainingHomePage {...props} />,
 * } satisfies StoryVariant;
 * ```
 */
export type StoryVariant<Props extends StoryProps = StoryProps> = {
  /** Story metadata (must be object literal for AST extraction) */
  meta: StoryMeta;
  /** Review lane config (must be object literal for AST extraction) */
  review?: PartialCaptureLaneConfig;
  /** VRT lane config (must be object literal for AST extraction) */
  vrt?: PartialCaptureLaneConfig;
  /** The story component */
  Story: (props: Props) => ReactNode;
};

// ============================================================================
// Story Manifest (discovery output)
// ============================================================================

/**
 * Classification of a story.
 */
export type StoryKind = 'page' | 'component' | 'scenario';

/**
 * A single story record in the manifest.
 * Represents one exported variant from a story file.
 */
export type StoryRecord = {
  /** Unique identifier for this story variant */
  id: string;
  /** Identifier derived from the file (without variant suffix) */
  fileId: string;
  /** Name of the export (e.g., 'Default', 'WithError') */
  exportName: string;
  /** Classification based on glob rule */
  kind: StoryKind;
  /** Path to the story file (relative to package root) */
  filePath: string;
  /** Extracted metadata */
  meta: StoryMeta;
  /** Normalized review config */
  review: CaptureLaneConfig;
  /** Normalized VRT config */
  vrt: CaptureLaneConfig;
};

/**
 * The complete story manifest for a package.
 */
export type StoryManifest = readonly StoryRecord[];

// ============================================================================
// Virtual Module Exports
// ============================================================================

/**
 * Shape of the virtual:storybook module exports.
 */
export type VirtualStorybookModule = {
  /** All discovered story records */
  manifest: StoryManifest;
  /** Dynamic import map keyed by fileId (returns unknown - consumers must validate) */
  importModuleByFileId: Record<string, () => Promise<unknown>>;
};
