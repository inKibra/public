/**
 * Context Management
 *
 * A context management system where agents can discover, read, and write context
 * as markdown files with YAML frontmatter. Supports persistence to various backends
 * and change tracking for commit/discard operations.
 *
 * @example
 * ```typescript
 * import { createContextManager, createFilePersistence } from '@inkibra/ai-flow/context';
 *
 * const persistence = createFilePersistence({ baseDir: './context' });
 * const contextManager = createContextManager({ persistence });
 *
 * // Load a context
 * const prefs = await contextManager.load<UserPrefs>('user-preferences-123');
 *
 * // Stage changes
 * await contextManager.stage({
 *   id: 'user-preferences-123',
 *   tags: ['fitness'],
 *   content: '# User Preferences\n\n...',
 * });
 *
 * // Commit to persistence
 * await contextManager.commit();
 * ```
 */

// Frontmatter utilities
export {
  completeContextMeta,
  contextToFilename,
  filenameToContext,
  generateContextId,
  parseContextFile,
  serializeContextFile,
} from './frontmatter';

// Context manager
export { ContextManager, createContextManager } from './manager';

// Persistence adapters
export {
  createFilePersistence,
  type FilePersistenceConfig,
} from './persistence';
// Types
export type {
  ContextChange,
  ContextFilter,
  ContextManagerConfig,
  ContextMeta,
  ContextPersistence,
  ContextSearchResult,
  ContextStageOptions,
  ContextState,
  LoadedContext,
} from './types';
