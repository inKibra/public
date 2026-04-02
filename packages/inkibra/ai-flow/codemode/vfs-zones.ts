/**
 * VFS Zone System
 *
 * Zones define ownership, visibility, and permissions for VFS paths.
 * A zone map is a list of zones ordered by path specificity (longest prefix match).
 *
 * Enforcement is a wrapper around OverlayFs — the underlying storage doesn't change.
 *
 * See vfs-layout-v2.md spec.
 */

import type { FsEntry, IOverlayFs, OverlayFs } from './overlay-fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VfsZoneOwner = 'agent' | 'developer' | 'system';
export type VfsZoneVisibility = 'public' | 'hidden';
export type VfsZonePermissions = 'read-write' | 'read-only' | 'append-only';

export type VfsZone = {
  /** Path prefix (e.g., '/agent/home/'). Must end with '/'. */
  path: string;
  /** Who owns this zone. */
  owner: VfsZoneOwner;
  /** Whether the agent can see this zone in the file tree. */
  visibility: VfsZoneVisibility;
  /** What operations are allowed. */
  permissions: VfsZonePermissions;
};

export type VfsZoneCaller = 'agent' | 'system';

// ---------------------------------------------------------------------------
// Default zones
// ---------------------------------------------------------------------------

export const DEFAULT_VFS_ZONES: VfsZone[] = [
  // Agent workspace
  {
    path: '/agent/home/',
    owner: 'agent',
    visibility: 'public',
    permissions: 'read-write',
  },
  {
    path: '/agent/scripts/',
    owner: 'agent',
    visibility: 'public',
    permissions: 'read-write',
  },
  {
    path: '/agent/packages/',
    owner: 'agent',
    visibility: 'public',
    permissions: 'read-write',
  },
  {
    path: '/agent/commands/',
    owner: 'agent',
    visibility: 'public',
    permissions: 'read-write',
  },
  {
    path: '/agent/intents/',
    owner: 'agent',
    visibility: 'public',
    permissions: 'read-write',
  },

  // Developer-provided
  {
    path: '/developer/',
    owner: 'developer',
    visibility: 'public',
    permissions: 'read-only',
  },

  // System reference
  {
    path: '/system/',
    owner: 'system',
    visibility: 'public',
    permissions: 'read-only',
  },

  // Logs
  {
    path: '/logs/',
    owner: 'system',
    visibility: 'public',
    permissions: 'read-only',
  },

  // Runtime — all hidden, agent uses commands
  {
    path: '/runtime/',
    owner: 'system',
    visibility: 'hidden',
    permissions: 'read-only',
  },

  // Ephemeral
  {
    path: '/tmp/',
    owner: 'agent',
    visibility: 'public',
    permissions: 'read-write',
  },
];

// ---------------------------------------------------------------------------
// Zone resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the zone for a given path using longest prefix match.
 * Returns undefined if no zone matches.
 */
export function resolveZone(
  path: string,
  zones: VfsZone[],
): VfsZone | undefined {
  const normalized = path.endsWith('/') ? path : path;
  let bestMatch: VfsZone | undefined;
  let bestLength = 0;

  for (const zone of zones) {
    if (
      (normalized.startsWith(zone.path) ||
        normalized === zone.path.slice(0, -1)) &&
      zone.path.length > bestLength
    ) {
      bestMatch = zone;
      bestLength = zone.path.length;
    }
  }

  return bestMatch;
}

/**
 * Check if a path is writable for a given caller.
 */
export function isWritable(
  path: string,
  zones: VfsZone[],
  caller: VfsZoneCaller,
): boolean {
  if (caller === 'system') return true;
  const zone = resolveZone(path, zones);
  if (!zone) return false;
  return zone.permissions === 'read-write';
}

/**
 * Check if a path is visible to the agent.
 */
export function isVisible(path: string, zones: VfsZone[]): boolean {
  const zone = resolveZone(path, zones);
  if (!zone) return false;
  return zone.visibility === 'public';
}

/**
 * Filter VFS entries to only public (visible) ones.
 */
export function filterVisibleEntries(
  entries: FsEntry[],
  zones: VfsZone[],
): FsEntry[] {
  return entries.filter((entry) => isVisible(entry.path, zones));
}

// ---------------------------------------------------------------------------
// Zoned OverlayFs wrapper
// ---------------------------------------------------------------------------

export type ZonedOverlayFs = IOverlayFs & {
  /** The underlying unwrapped OverlayFs. */
  readonly unwrap: OverlayFs;
  /** The zone map. */
  readonly zones: VfsZone[];
};

/**
 * Create a zone-enforced wrapper around an OverlayFs.
 *
 * When `caller` is `'agent'`:
 *   - Writes to read-only zones throw EACCES
 *   - Reads from hidden zones throw EACCES
 *   - List results are filtered to public entries only
 *
 * When `caller` is `'system'`:
 *   - All operations are allowed (system bypasses zone checks)
 */
export function createZonedFs(
  fs: OverlayFs,
  zones: VfsZone[],
  caller: VfsZoneCaller,
): ZonedOverlayFs {
  if (caller === 'system') {
    // System bypasses all checks — return the fs as-is with zone metadata
    return Object.assign(fs, {
      unwrap: fs,
      zones,
    }) as ZonedOverlayFs;
  }

  // Agent caller — enforce zones
  const zoned: ZonedOverlayFs = {
    unwrap: fs,
    zones,
    get cwd() {
      return fs.cwd;
    },

    async read(path: string): Promise<string> {
      const zone = resolveZone(path, zones);
      if (zone?.visibility === 'hidden') {
        throw new Error(
          `EACCES: permission denied, read '${path}' — use commands to inspect runtime state`,
        );
      }
      return fs.read(path);
    },

    async write(path: string, content: string): Promise<void> {
      if (!isWritable(path, zones, 'agent')) {
        const zone = resolveZone(path, zones);
        throw new Error(
          `EACCES: permission denied, write '${path}' (${zone?.permissions ?? 'unknown'} zone)`,
        );
      }
      return fs.write(path, content);
    },

    async delete(path: string): Promise<void> {
      if (!isWritable(path, zones, 'agent')) {
        throw new Error(
          `EACCES: permission denied, delete '${path}' (read-only zone)`,
        );
      }
      return fs.delete(path);
    },

    async exists(path: string): Promise<boolean> {
      const zone = resolveZone(path, zones);
      if (zone?.visibility === 'hidden') {
        return false;
      }
      return fs.exists(path);
    },

    async list(path: string): Promise<FsEntry[]> {
      const entries = await fs.list(path);
      return filterVisibleEntries(entries, zones);
    },

    fork() {
      const forkedFs = fs.fork();
      return createZonedFs(forkedFs, zones, caller);
    },

    getDirtyPaths() {
      return fs.getDirtyPaths();
    },

    async flush(): Promise<void> {
      return fs.flush();
    },

    async flushCurrent(): Promise<void> {
      return fs.flushCurrent();
    },
  };

  return zoned;
}
