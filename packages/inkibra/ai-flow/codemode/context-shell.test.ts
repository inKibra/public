import { beforeEach, describe, expect, test } from 'bun:test';
import { serializeContextFile } from '../context/frontmatter';
import {
  type ContextShell,
  createContextShell,
  createContextTool,
  createOverlayFs,
  type OverlayFs,
} from './index';

describe('OverlayFs', () => {
  let fs: OverlayFs;

  beforeEach(() => {
    fs = createOverlayFs({
      mount: {
        '/context/user/profile.md': `---
type: user-profile
tags: [fitness]
---

# User Profile

Name: John
Goal: Strength training
`,
        '/context/exercises/squats.md': `---
type: exercise
tags: [legs, compound]
---

# Squats

A compound leg exercise.
`,
        '/context/exercises/rows.md': `---
type: exercise
tags: [back, pull]
---

# Rows

A pulling movement for back.
`,
        '/context/reminders/pay-rent.md': `---
status: pending
due_at: 2026-03-01T09:00:00Z
---

Pay rent.
`,
        '/context/reminders/daily-walk.md': `---
status: pending
cron: "0 18 * * *"
next_fire_at: 2026-03-02T18:00:00Z
---

Go for a walk.
`,
        '/context/reminders/archive/old.md': `---
status: done
due_at: 2025-01-01T09:00:00Z
---

Old reminder.
`,
      },
    });
  });

  describe('read', () => {
    test('reads mounted files', async () => {
      const content = await fs.read('/context/user/profile.md');
      expect(content).toContain('# User Profile');
      expect(content).toContain('Name: John');
    });

    test('throws for non-existent files', async () => {
      await expect(fs.read('/context/missing.md')).rejects.toThrow('ENOENT');
    });
  });

  describe('write', () => {
    test('writes new files', async () => {
      await fs.write('/context/notes/new.md', '# New Note\n\nContent here.');
      const content = await fs.read('/context/notes/new.md');
      expect(content).toBe('# New Note\n\nContent here.');
    });

    test('overwrites existing files', async () => {
      await fs.write('/context/user/profile.md', '# Updated Profile');
      const content = await fs.read('/context/user/profile.md');
      expect(content).toBe('# Updated Profile');
    });
  });

  describe('exists', () => {
    test('returns true for existing files', async () => {
      expect(await fs.exists('/context/user/profile.md')).toBe(true);
    });

    test('returns false for non-existent files', async () => {
      expect(await fs.exists('/context/missing.md')).toBe(false);
    });
  });

  describe('delete', () => {
    test('removes files', async () => {
      await fs.delete('/context/user/profile.md');
      expect(await fs.exists('/context/user/profile.md')).toBe(false);
    });
  });

  describe('list', () => {
    test('lists directory contents', async () => {
      const entries = await fs.list('/context/exercises');
      const names = entries.map((e) => e.name);
      expect(names).toContain('squats.md');
      expect(names).toContain('rows.md');
    });

    test('identifies directories vs files', async () => {
      const entries = await fs.list('/context');
      const user = entries.find((e) => e.name === 'user');
      const exercises = entries.find((e) => e.name === 'exercises');
      expect(user?.type).toBe('directory');
      expect(exercises?.type).toBe('directory');
    });
  });

  describe('cwd and cd', () => {
    test('starts at root', () => {
      expect(fs.cwd).toBe('/');
    });

    test('changes directory', () => {
      fs.cd('/context/user');
      expect(fs.cwd).toBe('/context/user');
    });

    test('resolves relative paths', () => {
      fs.cd('/context');
      expect(fs.normalizePath('user/profile.md')).toBe(
        '/context/user/profile.md',
      );
    });
  });
});

describe('ContextShell', () => {
  let fs: OverlayFs;
  let shell: ContextShell;

  beforeEach(() => {
    fs = createOverlayFs({
      mount: {
        '/context/user/profile.md': `---
type: user-profile
tags: [fitness, beginner]
---

# User Profile

Name: John
Goal: Strength training
Equipment: Dumbbells
`,
        '/context/exercises/squats.md': `---
type: exercise
tags: [legs, compound]
---

# Squats

A compound leg exercise.
Great for building strength.
`,
        '/context/exercises/rows.md': `---
type: exercise
tags: [back, pull, user-favorite]
---

# Rows

A pulling movement for back.
User loves this exercise.
`,
        '/context/exercises/programs/day1.md': `---
type: program
tags: [day1]
---

# Day 1

Squat focus.
`,
        '/context/sessions/2025-01-15.md': `---
type: session
---

# Session Jan 15

Did squats and rows.
`,
        '/context/reminders/pay-rent.md': `---
status: pending
due_at: 2026-03-01T09:00:00Z
---

Pay rent.
`,
        '/context/reminders/daily-walk.md': `---
status: pending
cron: "0 18 * * *"
next_fire_at: 2026-03-02T18:00:00Z
---

Go for a walk.
`,
        '/context/reminders/archive/old.md': `---
status: done
due_at: 2025-01-01T09:00:00Z
---

Old reminder.
`,
      },
    });
    shell = createContextShell(fs);
  });

  describe('ls', () => {
    test('lists root directory', async () => {
      const result = await shell.exec('ls /');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('context');
    });

    test('lists subdirectory', async () => {
      const result = await shell.exec('ls /context/exercises');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('squats.md');
      expect(result.stdout).toContain('rows.md');
    });

    test('uses current directory if no path given', async () => {
      fs.cd('/context/exercises');
      const result = await shell.exec('ls');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('squats.md');
    });
  });

  describe('cat', () => {
    test('reads file contents', async () => {
      const result = await shell.exec('cat /context/user/profile.md');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('# User Profile');
      expect(result.stdout).toContain('Name: John');
    });

    test('returns error for missing file', async () => {
      const result = await shell.exec('cat /context/missing.md');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('ENOENT');
    });
  });

  describe('head', () => {
    test('reads first N lines', async () => {
      const result = await shell.exec('head -n 5 /context/user/profile.md');
      expect(result.exitCode).toBe(0);
      const lines = result.stdout.split('\n');
      expect(lines.length).toBeLessThanOrEqual(5);
      expect(result.stdout).toContain('---');
    });

    test('defaults to 10 lines', async () => {
      const result = await shell.exec('head /context/user/profile.md');
      expect(result.exitCode).toBe(0);
      const lines = result.stdout.split('\n');
      expect(lines.length).toBeLessThanOrEqual(10);
    });
  });

  describe('tail', () => {
    test('reads last N lines', async () => {
      const result = await shell.exec('tail -n 3 /context/user/profile.md');
      expect(result.exitCode).toBe(0);
      const lines = result.stdout.split('\n').filter(Boolean);
      expect(lines.length).toBeLessThanOrEqual(3);
    });
  });

  describe('grep', () => {
    test('finds pattern in file', async () => {
      const result = await shell.exec(
        'grep "Squats" /context/exercises/squats.md',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Squats');
    });

    test('searches recursively with -r', async () => {
      const result = await shell.exec('grep -r "tags:" /context/');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('profile.md');
      expect(result.stdout).toContain('squats.md');
    });

    test('case insensitive with -i', async () => {
      const result = await shell.exec(
        'grep -i "SQUATS" /context/exercises/squats.md',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Squats');
    });

    test('shows line numbers with -n', async () => {
      const result = await shell.exec(
        'grep -n "Squats" /context/exercises/squats.md',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/\d+:/);
    });

    test('returns exit code 1 when no matches', async () => {
      const result = await shell.exec(
        'grep "nonexistent" /context/exercises/squats.md',
      );
      expect(result.exitCode).toBe(1);
    });

    test('finds files by tag pattern', async () => {
      const result = await shell.exec(
        'grep -r "tags:.*user-favorite" /context/',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('rows.md');
    });
  });

  describe('echo with redirect', () => {
    test('writes to file with >', async () => {
      const result = await shell.exec(
        'echo "# New Note" > /context/notes/test.md',
      );
      expect(result.exitCode).toBe(0);

      const content = await fs.read('/context/notes/test.md');
      expect(content).toBe('# New Note');
    });

    test('appends to file with >>', async () => {
      await shell.exec('echo "Line 1" > /context/notes/append.md');
      await shell.exec('echo "Line 2" >> /context/notes/append.md');

      const content = await fs.read('/context/notes/append.md');
      expect(content).toContain('Line 1');
      expect(content).toContain('Line 2');
    });

    test('handles quoted strings', async () => {
      await shell.exec('echo "Hello World" > /context/notes/quoted.md');
      const content = await fs.read('/context/notes/quoted.md');
      expect(content).toBe('Hello World');
    });
  });

  describe('rm', () => {
    test('deletes file', async () => {
      await shell.exec('rm /context/sessions/2025-01-15.md');
      expect(await fs.exists('/context/sessions/2025-01-15.md')).toBe(false);
    });

    test('force flag ignores missing files', async () => {
      const result = await shell.exec('rm -f /context/missing.md');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('pwd and cd', () => {
    test('pwd shows current directory', async () => {
      const result = await shell.exec('pwd');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('/');
    });

    test('cd changes directory', async () => {
      await shell.exec('cd /context/exercises');
      const result = await shell.exec('pwd');
      expect(result.stdout).toBe('/context/exercises');
    });

    test('ls works after cd', async () => {
      await shell.exec('cd /context/exercises');
      const result = await shell.exec('ls');
      expect(result.stdout).toContain('squats.md');
    });
  });

  describe('find', () => {
    test('finds files by name pattern', async () => {
      const result = await shell.exec('find /context -name "*.md"');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('profile.md');
      expect(result.stdout).toContain('squats.md');
    });
  });

  describe('wc', () => {
    test('counts lines', async () => {
      const result = await shell.exec('wc -l /context/user/profile.md');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/\d+/);
    });
  });

  describe('open wildcard semantics', () => {
    test('open /dir/* opens direct files + direct subdirectories only', async () => {
      const result = await shell.exec('open /context/exercises/*');
      expect(result.exitCode).toBe(0);

      const opened = await shell.exec('opened');
      expect(opened.exitCode).toBe(0);
      expect(opened.stdout).toContain('/context/exercises/squats.md');
      expect(opened.stdout).toContain('/context/exercises/rows.md');
      expect(opened.stdout).toContain('/context/exercises/programs/');
      expect(opened.stdout).not.toContain(
        '/context/exercises/programs/day1.md',
      );
    });

    test('open /dir/** opens files recursively', async () => {
      const result = await shell.exec('open /context/exercises/**');
      expect(result.exitCode).toBe(0);

      const opened = await shell.exec('opened');
      expect(opened.exitCode).toBe(0);
      expect(opened.stdout).toContain('/context/exercises/squats.md');
      expect(opened.stdout).toContain('/context/exercises/rows.md');
      expect(opened.stdout).toContain('/context/exercises/programs/day1.md');
    });

    test('open /context/reminders/ shows direct child frontmatter only', async () => {
      const result = await shell.exec('open /context/reminders/');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('[FILE] pay-rent.md');
      expect(result.stdout).toContain('due_at: "2026-03-01T09:00:00.000Z"');
      expect(result.stdout).toContain('[FILE] daily-walk.md');
      expect(result.stdout).toContain('cron: 0 18 * * *');
      expect(result.stdout).toContain('[DIR] archive/');
      expect(result.stdout).not.toContain('[FILE] old.md');
    });
  });

  describe('cron reminders', () => {
    test('cron list prints existing reminders', async () => {
      const result = await shell.exec('cron list');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('pay-rent');
      expect(result.stdout).toContain('daily-walk');
    });

    test('cron set --at creates a one-time reminder file', async () => {
      const result = await shell.exec(
        'cron set submit-report --at "2026-02-20T10:00:00Z" --text "Submit weekly report"',
      );
      expect(result.exitCode).toBe(0);

      const reminder = await fs.read('/context/reminders/submit-report.md');
      expect(reminder).toContain('status: pending');
      expect(reminder).toContain("due_at: '2026-02-20T10:00:00.000Z'");
      expect(reminder).toContain('Submit weekly report');
    });

    test('cron set --every creates recurring reminder with next_fire_at', async () => {
      const result = await shell.exec(
        'cron set stretch --every "0 7 * * *" --text "Stretch for 10 minutes"',
      );
      expect(result.exitCode).toBe(0);

      const reminder = await fs.read('/context/reminders/stretch.md');
      expect(reminder).toContain('status: pending');
      expect(reminder).toContain('cron: 0 7 * * *');
      expect(reminder).toContain('next_fire_at: ');
      expect(reminder).toContain('Stretch for 10 minutes');
    });

    test('cron snooze pushes reminder into the future', async () => {
      const result = await shell.exec('cron snooze pay-rent --for 2h');
      expect(result.exitCode).toBe(0);

      const reminder = await fs.read('/context/reminders/pay-rent.md');
      expect(reminder).toContain('status: pending');
      expect(reminder).toContain('next_fire_at: ');
      expect(reminder).toContain('due_at: ');
    });

    test('cron done marks a reminder complete', async () => {
      const result = await shell.exec('cron done pay-rent');
      expect(result.exitCode).toBe(0);

      const reminder = await fs.read('/context/reminders/pay-rent.md');
      expect(reminder).toContain('status: done');
    });

    test('cron rm deletes reminder file', async () => {
      const result = await shell.exec('cron rm pay-rent');
      expect(result.exitCode).toBe(0);
      expect(await fs.exists('/context/reminders/pay-rent.md')).toBe(false);
    });
  });

  describe('context pin management', () => {
    test('pins file with phase/reason and shows in status', async () => {
      const pinResult = await shell.exec(
        'context pin /context/user/profile.md --phase both --reason "keep-user-profile" --mode frontmatter',
      );
      expect(pinResult.exitCode).toBe(0);

      const status = await shell.exec('context status');
      expect(status.exitCode).toBe(0);
      expect(status.stdout).toContain('/context/user/profile.md');
      expect(status.stdout).toContain('[pin:both][ai]');
      expect(status.stdout).toContain('keep-user-profile');

      const close = await shell.exec('close /context/user/profile.md');
      expect(close.exitCode).toBe(1);
      expect(close.stderr).toContain('pinned by AI');
    });

    test('unpin removes AI pin and allows close', async () => {
      await shell.exec(
        'context pin /context/user/profile.md --phase awake --reason "temporary-focus"',
      );

      const unpin = await shell.exec('context unpin /context/user/profile.md');
      expect(unpin.exitCode).toBe(0);

      const close = await shell.exec('close /context/user/profile.md');
      expect(close.exitCode).toBe(0);
      expect(close.stdout).toContain('closed: /context/user/profile.md');
    });

    test('cannot override or close system-pinned entries', async () => {
      const now = new Date().toISOString();
      const openedState = serializeContextFile(
        {
          id: 'opened-files',
          tags: [],
          created: now,
          updated: now,
          updated_at: now,
          context_bytes: 100,
          context_tokens: 25,
          files: [
            {
              path: '/context/user/profile.md',
              type: 'file',
              mode: 'full',
              pin: 'both',
              pin_source: 'system',
              pin_path: '/context/user/profile.md',
              opened_at: now,
              last_accessed_at: now,
              opened_by: 'system',
              size_bytes: 100,
              size_tokens: 25,
            },
          ],
          ai_pins: [],
          recently_closed: [],
        },
        '',
      );
      await fs.write('/handles/opened.md', openedState);

      const pinResult = await shell.exec(
        'context pin /context/user/profile.md --phase both --reason "override"',
      );
      expect(pinResult.exitCode).toBe(1);
      expect(pinResult.stderr).toContain('system-pinned');

      const closeResult = await shell.exec('close /context/user/profile.md');
      expect(closeResult.exitCode).toBe(1);
      expect(closeResult.stderr).toContain('system-pinned');

      const downgradeResult = await shell.exec(
        'open --frontmatter /context/user/profile.md',
      );
      expect(downgradeResult.exitCode).toBe(1);
      expect(downgradeResult.stderr).toContain('cannot change mode');

      const frontmatterPinnedState = serializeContextFile(
        {
          id: 'opened-files',
          tags: [],
          created: now,
          updated: now,
          updated_at: now,
          context_bytes: 20,
          context_tokens: 5,
          files: [
            {
              path: '/context/user/profile.md',
              type: 'file',
              mode: 'frontmatter',
              pin: 'both',
              pin_source: 'system',
              pin_path: '/context/user/profile.md',
              opened_at: now,
              last_accessed_at: now,
              opened_by: 'system',
              size_bytes: 20,
              size_tokens: 5,
            },
          ],
          ai_pins: [],
          recently_closed: [],
        },
        '',
      );
      await fs.write('/handles/opened.md', frontmatterPinnedState);

      const promoteResult = await shell.exec('open /context/user/profile.md');
      expect(promoteResult.exitCode).toBe(1);
      expect(promoteResult.stderr).toContain('cannot change mode');
    });

    test('context pin /dir/* is shallow and /dir/** is recursive', async () => {
      const shallow = await shell.exec(
        'context pin /context/exercises/* --phase both --reason "shallow-pin"',
      );
      expect(shallow.exitCode).toBe(0);

      let status = await shell.exec('context status');
      expect(status.stdout).toContain('/context/exercises/squats.md');
      expect(status.stdout).toContain('/context/exercises/programs/');
      expect(status.stdout).not.toContain(
        '/context/exercises/programs/day1.md',
      );

      const recursive = await shell.exec(
        'context pin /context/exercises/** --phase both --reason "recursive-pin"',
      );
      expect(recursive.exitCode).toBe(0);

      status = await shell.exec('context status');
      expect(status.stdout).toContain('/context/exercises/programs/day1.md');
    });

    test('rejects pinning runtime-managed logs/handles/queue paths', async () => {
      const pinLogs = await shell.exec(
        'context pin /context/logs/* --phase both --reason "nope"',
      );
      expect(pinLogs.exitCode).toBe(1);
      expect(pinLogs.stderr).toContain('runtime-managed');

      const pinHandles = await shell.exec(
        'context pin /handles/* --phase both --reason "nope"',
      );
      expect(pinHandles.exitCode).toBe(1);
      expect(pinHandles.stderr).toContain('runtime-managed');

      const pinQueue = await shell.exec(
        'context pin /queue/* --phase both --reason "nope"',
      );
      expect(pinQueue.exitCode).toBe(1);
      expect(pinQueue.stderr).toContain('runtime-managed');
    });
  });

  describe('unknown commands', () => {
    test('returns error for unknown command', async () => {
      const result = await shell.exec('unknown-cmd arg1 arg2');
      expect(result.exitCode).toBe(127);
      expect(result.stderr).toContain('command not found');
    });
  });

  describe('read-only policy', () => {
    test('blocks patch writes to read-only files', async () => {
      const readOnlyShell = createContextShell(fs, {
        readOnlyPaths: ['/context/user/profile.md'],
      });

      const result = await readOnlyShell.exec(
        'patch /context/user/profile.md "Goal: Strength training" "Goal: 5k running"',
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('read-only');
    });

    test('blocks redirected writes to read-only files', async () => {
      const readOnlyShell = createContextShell(fs, {
        readOnlyPaths: ['/context/user/profile.md'],
      });

      const result = await readOnlyShell.exec(
        'cat /context/exercises/squats.md > /context/user/profile.md',
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('read-only');
    });
  });
});

describe('createContextTool', () => {
  test('creates a tool with correct structure', () => {
    const fs = createOverlayFs();
    const shell = createContextShell(fs);
    const tool = createContextTool({ shell });

    expect(tool.name).toBe('context');
    expect(tool.description).toContain('ls');
    expect(tool.description).toContain('grep');
    expect(tool.parameters.properties.command.type).toBe('string');
  });

  test('executes commands through tool', async () => {
    const fs = createOverlayFs({
      mount: {
        '/test.md': '# Test',
      },
    });
    const shell = createContextShell(fs);
    const tool = createContextTool({ shell });

    const result = await tool.execute({ command: 'cat /test.md' });
    expect(result.stdout).toContain('# Test');
    expect(result.exitCode).toBe(0);
  });
});
