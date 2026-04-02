/**
 * VFS Hooks — Proxy wrapper for intercepting VFS operations.
 *
 * ai-construct wraps the OverlayFs with this proxy to detect
 * CONTEXT.yaml writes and auto-register directories in the manifest.
 * No changes to ai-flow needed — pure JS Proxy.
 */

import type { OverlayFs } from '@inkibra/ai-flow';

export type VfsHooks = {
  /** Called after every write operation */
  onWrite?: (path: string, content: string) => void;
};

/**
 * Wrap an OverlayFs with hooks that fire on VFS operations.
 * Returns a Proxy that delegates all operations to the real VFS.
 */
export function createHookedVfs(vfs: OverlayFs, hooks: VfsHooks): OverlayFs {
  return new Proxy(vfs, {
    get(target, prop, _receiver) {
      const value = Reflect.get(target, prop, target);

      // Wrap write() to fire hook after each write
      if (prop === 'write' && hooks.onWrite) {
        const originalWrite =
          typeof value === 'function' ? value.bind(target) : value;
        return async (path: string, content: string) => {
          await originalWrite(path, content);
          hooks.onWrite!(path, content);
        };
      }

      // Bind all methods to the real target so `this` works correctly
      if (typeof value === 'function') {
        return value.bind(target);
      }

      return value;
    },
  });
}

/**
 * Create a CONTEXT.yaml auto-registration hook.
 * When a CONTEXT.yaml is written anywhere in the VFS, the directory
 * is added to the context manifest.
 */
export function createContextManifestHook(vfs: OverlayFs): VfsHooks {
  const MANIFEST_PATH = '/runtime/handles/context-dirs.yaml';

  return {
    onWrite: async (path: string) => {
      if (!path.endsWith('/CONTEXT.yaml')) return;

      const dir = path.slice(0, -'/CONTEXT.yaml'.length) || '/';

      // Read current manifest
      let manifest: { directories: string[] };
      try {
        const raw = await vfs.read(MANIFEST_PATH);
        const parsed = Bun.YAML.parse(raw) as Record<string, unknown>;
        manifest = {
          directories: Array.isArray(parsed.directories)
            ? (parsed.directories as string[])
            : [],
        };
      } catch {
        manifest = { directories: [] };
      }

      // Add directory if not already present
      if (!manifest.directories.includes(dir)) {
        manifest.directories.push(dir);
        const yaml = `directories:\n${manifest.directories.map((d) => `  - ${d}`).join('\n')}\n`;
        await vfs.write(MANIFEST_PATH, yaml);
      }
    },
  };
}
