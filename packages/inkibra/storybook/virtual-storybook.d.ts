/**
 * Type declarations for the virtual:storybook module.
 *
 * This module is generated at runtime by the storybook plugin.
 */

declare module 'virtual:storybook' {
  import type { StoryManifest } from './types';

  export const manifest: StoryManifest;
  export const importModuleByFileId: Record<string, () => Promise<unknown>>;
}
