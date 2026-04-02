/**
 * @inkibra/storybook
 *
 * AST-based storybook discovery and testing utilities.
 */

// ============================================================================
// Types
// ============================================================================

export type {
  CaptureLaneConfig,
  // Shot schema
  Locator,
  PartialCaptureLaneConfig,
  Shot,
  ShotSequence,
  Step,
  // Manifest
  StoryKind,
  StoryManifest,
  StoryMeta,
  // Story authoring
  StoryProps,
  StoryRecord,
  StoryShotPlan,
  StoryVariant,
  VirtualStorybookModule,
} from './types';

export { DEFAULT_SHOT_PLAN } from './types';

// ============================================================================
// Config
// ============================================================================

export type {
  BuildConfig,
  BuildPreloadResult,
  GlobRule,
  StorybookConfig,
} from './config';

export {
  defaultIdFromFile,
  defaultIdFromVariant,
  defineStorybookConfig,
  toKebabCase,
} from './config';
