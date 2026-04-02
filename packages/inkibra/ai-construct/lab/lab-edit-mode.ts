/**
 * Construct lab edit mode types and helpers.
 *
 * Edit mode allows direct VFS CRUD for context files while the construct
 * runtime is paused. The actor runtime will not process mailbox messages
 * or flush VFS while a construct is in edit mode.
 *
 * Lifecycle:
 *   running → enterEditMode() → editing → exitEditMode() → running
 *
 * During edit mode:
 * - SSE stream is disconnected
 * - No perceptions are processed
 * - No scheduler cycles run
 * - VFS is accessible for raw read/write/delete/list
 * - On exit, VFS is flushed and the construct resumes naturally
 */

import type { Construct } from '../construct/construct';
import {
  listStudioContextFiles,
  readStudioState,
  writeStudioState,
} from '../vfs/studio-context';
import { normalizeContextPath } from './lab-action-ops';
import type {
  ConstructStudioAction,
  ConstructStudioContextFile,
} from './types';

// ---------------------------------------------------------------------------
// Edit mode state
// ---------------------------------------------------------------------------

/**
 * The lifecycle states for edit mode.
 */
export type ConstructEditModeState =
  | 'running'
  | 'entering_edit'
  | 'editing'
  | 'exiting_edit';

/**
 * The view returned when entering edit mode.
 */
export type ConstructEditModeSnapshot = {
  contextFiles: ConstructStudioContextFile[];
  activeContextFilePath?: string;
  lastSavedAt?: string;
};

// ---------------------------------------------------------------------------
// File CRUD result types
// ---------------------------------------------------------------------------

/**
 * Result of a context file read.
 */
export type ConstructFileReadResult = {
  path: string;
  content: string;
  sizeBytes: number;
};

/**
 * Result of listing context files.
 */
export type ConstructFileListResult = {
  contextFiles: ConstructStudioContextFile[];
  activeContextFilePath?: string;
};

// ---------------------------------------------------------------------------
// Apply studio action (direct VFS CRUD)
// ---------------------------------------------------------------------------

/**
 * Applies a generic studio action directly to the construct's VFS.
 *
 * This function performs the raw VFS write/delete operations and updates
 * studio state. It does NOT go through the runtime mailbox — it operates
 * directly on the construct's VFS, which is appropriate during edit mode.
 *
 * The caller is responsible for flushing VFS afterward if persistence
 * is needed.
 */
export async function applyConstructStudioAction(
  construct: Construct,
  action: ConstructStudioAction,
): Promise<void> {
  const vfs = construct.getVfs();

  if (action.action === 'upsertContextFile') {
    const now = new Date().toISOString();
    const path = normalizeContextPath(action.file.path);

    // Write raw content to VFS
    await vfs.write(path, action.file.content);

    // Update studio state
    await writeStudioState(construct, {
      activeContextFilePath: path,
      lastSavedAt: now,
    });
    return;
  }

  if (action.action === 'deleteContextFile') {
    const path = normalizeContextPath(action.path);
    try {
      await vfs.delete(path);
    } catch {
      // Ignore missing path.
    }

    const currentState = await readStudioState(construct);
    if (currentState.activeContextFilePath === path) {
      await writeStudioState(construct, {
        activeContextFilePath: undefined,
        lastSavedAt: new Date().toISOString(),
      });
    }
    return;
  }

  if (action.action === 'setActiveContextFile') {
    await writeStudioState(construct, {
      activeContextFilePath: normalizeContextPath(action.path),
      lastSavedAt: new Date().toISOString(),
    });
    return;
  }

  // Exhaustiveness check
  const _exhaustive: never = action;
  throw new Error(`Unknown studio action: ${JSON.stringify(_exhaustive)}`);
}

/**
 * Builds an edit mode snapshot from the construct's current VFS state.
 */
export async function buildEditModeSnapshot(
  construct: Construct,
): Promise<ConstructEditModeSnapshot> {
  const [contextFiles, studioState] = await Promise.all([
    listStudioContextFiles(construct),
    readStudioState(construct),
  ]);

  return {
    contextFiles,
    activeContextFilePath: studioState.activeContextFilePath,
    lastSavedAt: studioState.lastSavedAt,
  };
}
