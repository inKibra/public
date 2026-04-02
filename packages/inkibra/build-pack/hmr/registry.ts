/**
 * HMR Frontend Registry
 *
 * A shared registry where frontends auto-register themselves for HMR.
 * The clientBuildPlugin template auto-registers each frontend on import,
 * so the HMR server can find and rebuild them when files change.
 */

import type { ClientBundleInfo } from '../client-stub';

/**
 * Registered frontend info for HMR.
 */
export interface RegisteredFrontend {
  /** The client entry point path (e.g., './frontend/example.client.tsx') */
  entryPoint: string;

  /** Friendly name derived from entry point */
  name: string;

  /** Directories to watch for changes */
  watchDirs: string[];

  /** Function to rebuild and get new bundle info */
  rebuild: () => Promise<ClientBundleInfo>;
}

/**
 * Registry entry with additional metadata.
 */
interface RegistryEntry extends RegisteredFrontend {
  /** Timestamp of last rebuild */
  lastRebuild?: number;

  /** Cached bundle info from last rebuild */
  cachedBundleInfo?: ClientBundleInfo;
}

/**
 * Global registry of frontends for HMR.
 */
class HmrFrontendRegistry {
  private frontends = new Map<string, RegistryEntry>();

  /**
   * Register a frontend for HMR.
   * Called automatically by clientBuildPlugin template.
   */
  register(frontend: RegisteredFrontend): void {
    console.log(`[HMR Registry] Registered frontend: ${frontend.name}`);
    this.frontends.set(frontend.entryPoint, {
      ...frontend,
    });
  }

  /**
   * Unregister a frontend.
   */
  unregister(entryPoint: string): void {
    this.frontends.delete(entryPoint);
  }

  /**
   * Get a frontend by entry point.
   */
  get(entryPoint: string): RegistryEntry | undefined {
    return this.frontends.get(entryPoint);
  }

  /**
   * Get a frontend by name.
   */
  getByName(name: string): RegistryEntry | undefined {
    for (const frontend of this.frontends.values()) {
      if (frontend.name === name) {
        return frontend;
      }
    }
    return undefined;
  }

  /**
   * Get all registered frontends.
   */
  getAll(): RegistryEntry[] {
    return Array.from(this.frontends.values());
  }

  /**
   * Find frontends affected by a file change.
   * Matches the changed path against each frontend's watchDirs.
   */
  findAffectedFrontends(changedPath: string): RegistryEntry[] {
    const affected: RegistryEntry[] = [];

    for (const frontend of this.frontends.values()) {
      for (const watchDir of frontend.watchDirs) {
        // Normalize paths for comparison
        const normalizedWatch = watchDir.replace(/\\/g, '/');
        const normalizedChanged = changedPath.replace(/\\/g, '/');

        if (
          normalizedChanged.includes(normalizedWatch) ||
          normalizedChanged.startsWith(normalizedWatch)
        ) {
          affected.push(frontend);
          break;
        }
      }
    }

    return affected;
  }

  /**
   * Rebuild a frontend and cache the result.
   */
  async rebuildFrontend(entryPoint: string): Promise<ClientBundleInfo | null> {
    const frontend = this.frontends.get(entryPoint);
    if (!frontend) {
      console.warn(`[HMR Registry] Frontend not found: ${entryPoint}`);
      return null;
    }

    console.log(`[HMR Registry] Rebuilding: ${frontend.name}`);
    const startTime = Date.now();

    try {
      const bundleInfo = await frontend.rebuild();
      frontend.lastRebuild = Date.now();
      frontend.cachedBundleInfo = bundleInfo;

      console.log(
        `[HMR Registry] Rebuilt ${frontend.name} in ${Date.now() - startTime}ms`,
      );

      return bundleInfo;
    } catch (err) {
      console.error(`[HMR Registry] Rebuild failed for ${frontend.name}:`, err);
      throw err;
    }
  }

  /**
   * Get cached bundle info for a frontend (if available).
   */
  getCachedBundleInfo(entryPoint: string): ClientBundleInfo | undefined {
    return this.frontends.get(entryPoint)?.cachedBundleInfo;
  }

  /**
   * Clear all registrations.
   */
  clear(): void {
    this.frontends.clear();
  }
}

/**
 * Singleton registry instance.
 * Shared across all frontends in the process.
 */
export const hmrRegistry = new HmrFrontendRegistry();
