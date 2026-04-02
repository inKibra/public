/**
 * Built-in cron/reminder commands.
 * See spec §8.2 — Scheduler table.
 *
 * Cron jobs are stored in /runtime/cron/ within the VFS.
 * Each job is a JSON file with a schedule and a command string to run.
 */

import type { OverlayFs } from '@inkibra/ai-flow';
import { defineCommand } from '../define-command';

const CRON_DIR = '/runtime/cron';

type CronEntry = {
  name: string;
  schedule?: string; // cron expression (--every)
  at?: string; // one-time date (--at)
  text: string;
  timezone?: string;
  status: 'active' | 'snoozed' | 'done';
  snoozeUntil?: string;
  createdAt: string;
  updatedAt: string;
};

async function loadCronEntries(fs: OverlayFs): Promise<CronEntry[]> {
  try {
    const entries = await fs.list(CRON_DIR);
    const results: CronEntry[] = [];
    for (const entry of entries) {
      if (entry.type !== 'file' || !entry.name.endsWith('.json')) continue;
      try {
        const content = await fs.read(entry.path);
        results.push(JSON.parse(content) as CronEntry);
      } catch {
        // skip invalid
      }
    }
    return results;
  } catch {
    return [];
  }
}

function cronPath(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '-');
  return `${CRON_DIR}/${safe}.json`;
}

// ---------------------------------------------------------------------------
// cron — sub-command dispatcher
// ---------------------------------------------------------------------------

export const cronCommand = defineCommand({
  name: 'cron',
  description: 'Manage scheduled reminders (list, show, set, snooze, done, rm)',
  args: {
    subcommand: {
      type: 'string',
      position: 0,
      required: true,
      description: 'Sub-command: list, show, set, snooze, done, rm',
    },
    name: { type: 'string', position: 1, description: 'Reminder name' },
    every: {
      type: 'string',
      flag: '--every',
      description: 'Cron expression for recurring',
    },
    at: { type: 'string', flag: '--at', description: 'One-time date/time' },
    text: {
      type: 'string',
      flag: '--text',
      description: 'Reminder message text',
    },
    timezone: {
      type: 'string',
      flag: '--timezone',
      description: 'Timezone for scheduling',
    },
    duration: {
      type: 'string',
      flag: '--for',
      description: 'Snooze duration (e.g., 30m, 2h)',
    },
  },
  async fn(parsed, ctx) {
    const sub = parsed.subcommand as string;
    const name = parsed.name as string | undefined;
    const now = new Date().toISOString();

    switch (sub) {
      case 'list': {
        const entries = await loadCronEntries(ctx.fs);
        return { subcommand: 'list', entries } as const;
      }

      case 'show': {
        if (!name) throw new Error('cron show requires a name');
        try {
          const content = await ctx.fs.read(cronPath(name));
          return {
            subcommand: 'show',
            entry: JSON.parse(content) as CronEntry,
          } as const;
        } catch {
          throw new Error(`Reminder not found: ${name}`);
        }
      }

      case 'set': {
        if (!name) throw new Error('cron set requires a name');
        if (!parsed.text) throw new Error('cron set requires --text');
        if (!parsed.every && !parsed.at)
          throw new Error('cron set requires --every or --at');

        const entry: CronEntry = {
          name,
          schedule: parsed.every as string | undefined,
          at: parsed.at as string | undefined,
          text: parsed.text as string,
          timezone: parsed.timezone as string | undefined,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        };
        await ctx.fs.write(cronPath(name), JSON.stringify(entry, null, 2));
        return { subcommand: 'set', entry } as const;
      }

      case 'snooze': {
        if (!name) throw new Error('cron snooze requires a name');
        if (!parsed.duration) throw new Error('cron snooze requires --for');
        try {
          const content = await ctx.fs.read(cronPath(name));
          const entry = JSON.parse(content) as CronEntry;
          entry.status = 'snoozed';
          entry.snoozeUntil = parsed.duration as string; // simplified
          entry.updatedAt = now;
          await ctx.fs.write(cronPath(name), JSON.stringify(entry, null, 2));
          return { subcommand: 'snooze', entry } as const;
        } catch {
          throw new Error(`Reminder not found: ${name}`);
        }
      }

      case 'done': {
        if (!name) throw new Error('cron done requires a name');
        try {
          const content = await ctx.fs.read(cronPath(name));
          const entry = JSON.parse(content) as CronEntry;
          entry.status = 'done';
          entry.updatedAt = now;
          await ctx.fs.write(cronPath(name), JSON.stringify(entry, null, 2));
          return { subcommand: 'done', entry } as const;
        } catch {
          throw new Error(`Reminder not found: ${name}`);
        }
      }

      case 'rm': {
        if (!name) throw new Error('cron rm requires a name');
        try {
          await ctx.fs.delete(cronPath(name));
          return { subcommand: 'rm', removed: name } as const;
        } catch {
          throw new Error(`Reminder not found: ${name}`);
        }
      }

      default:
        throw new Error(
          `Unknown cron sub-command: ${sub}. Use: list, show, set, snooze, done, rm`,
        );
    }
  },
  render(result) {
    switch (result.subcommand) {
      case 'list': {
        if (result.entries.length === 0) return 'No reminders';
        return result.entries
          .map((e: CronEntry) => {
            const schedule = e.schedule ? `every ${e.schedule}` : `at ${e.at}`;
            return `  ${e.name} [${e.status}] ${schedule} — ${e.text}`;
          })
          .join('\n');
      }
      case 'show': {
        const e = result.entry;
        const schedule = e.schedule ? `every ${e.schedule}` : `at ${e.at}`;
        return `${e.name} [${e.status}]\n  Schedule: ${schedule}\n  Text: ${e.text}${e.timezone ? `\n  Timezone: ${e.timezone}` : ''}`;
      }
      case 'set':
        return `Set reminder: ${result.entry.name}`;
      case 'snooze':
        return `Snoozed: ${result.entry.name}`;
      case 'done':
        return `Done: ${result.entry.name}`;
      case 'rm':
        return `Removed: ${result.removed}`;
      default:
        return '';
    }
  },
});
