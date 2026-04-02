/**
 * VFS Layout v2 — Standard filesystem structure for the command computer.
 *
 * See vfs-layout-v2.md spec.
 *
 * Five top-level paths, three authors (agent, developer, system).
 * Zone map controls visibility and permissions.
 */

import type { OverlayFs } from '@inkibra/ai-flow';

// ---------------------------------------------------------------------------
// Standard paths
// ---------------------------------------------------------------------------

export const VFS_PATHS = {
  // Agent workspace
  agent: {
    home: '/agent/home',
    scripts: '/agent/scripts',
    packages: '/agent/packages',
    commands: '/agent/commands',
    intents: '/agent/intents',
    intentRegistry: '/agent/intents/registry.toml',
  },

  // Developer-provided
  developer: {
    root: '/developer',
    config: '/developer/config',
    instructions: '/developer/config/instructions.md',
    packages: '/developer/packages',
    commands: '/developer/commands',
    intents: '/developer/intents',
    intentRegistry: '/developer/intents/registry.toml',
  },

  // System reference (virtual)
  system: {
    root: '/system',
    packages: '/system/packages',
    commands: '/system/commands',
  },

  // Logs (flat structure — type is file suffix, e.g. 2026-03-24-0.conversation.log)
  logs: {
    root: '/logs',
  },

  // Runtime — computer-owned state only (ai-construct manages its own runtime files)
  runtime: {
    root: '/runtime',
    cron: '/runtime/cron',
    state: {
      root: '/runtime/state',
      session: '/runtime/state/session.md',
      selfCtx: '/runtime/state/self-ctx.json',
      meminfo: '/runtime/state/meminfo',
      contextinfo: '/runtime/state/contextinfo',
      loadavg: '/runtime/state/loadavg',
    },
    packages: {
      registry: '/runtime/packages/registry',
    },
  },

  // Ephemeral
  tmp: '/tmp',
} as const;

// Backward compat — re-export as VFS_COMPUTER_PATHS for existing consumers
export const VFS_COMPUTER_PATHS = VFS_PATHS;

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/**
 * Initialize the VFS with the v2 directory structure.
 * Creates placeholder files to ensure directories appear in listings.
 */
export async function bootstrapComputerVfs(
  fs: OverlayFs,
  config?: {
    constructName?: string;
    constructInstructions?: string;
  },
): Promise<void> {
  const dirs = [
    VFS_PATHS.agent.home,
    VFS_PATHS.agent.scripts,
    VFS_PATHS.agent.packages,
    VFS_PATHS.agent.commands,
    VFS_PATHS.agent.intents,
    VFS_PATHS.developer.packages,
    VFS_PATHS.developer.commands,
    VFS_PATHS.developer.intents,
    VFS_PATHS.developer.config,
    VFS_PATHS.system.packages,
    VFS_PATHS.system.commands,
    VFS_PATHS.logs.root,
    VFS_PATHS.runtime.cron,
    VFS_PATHS.runtime.state.root,
    VFS_PATHS.runtime.packages.registry,
    VFS_PATHS.tmp,
  ];

  for (const dir of dirs) {
    try {
      await fs.read(`${dir}/.keep`);
    } catch {
      await fs.write(`${dir}/.keep`, '');
    }
  }

  // Write developer config if provided
  if (config?.constructName || config?.constructInstructions) {
    const content = [
      `# ${config.constructName ?? 'Construct'}`,
      '',
      config.constructInstructions ?? '',
    ].join('\n');
    await fs.write(VFS_PATHS.developer.instructions, content);
  }

  // Write empty intent registries
  for (const registryPath of [
    VFS_PATHS.agent.intentRegistry,
    VFS_PATHS.developer.intentRegistry,
  ]) {
    try {
      await fs.read(registryPath);
    } catch {
      await fs.write(
        registryPath,
        '# Intent Hint Registry\n# See: vfs-layout-v2.md\n',
      );
    }
  }

  // Write virtual runtime state files
  await fs.write(VFS_PATHS.runtime.state.meminfo, '{}');
  await fs.write(VFS_PATHS.runtime.state.contextinfo, '{}');
  await fs.write(VFS_PATHS.runtime.state.loadavg, '0');
}
