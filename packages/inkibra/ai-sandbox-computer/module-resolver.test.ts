import { describe, expect, test } from 'bun:test';
import { createOverlayFs } from '@inkibra/ai-flow';
import { codeFunction } from '@inkibra/ai-flow/codemode';
import { createComputer } from './create-computer';
import { defineAiComputerModule } from './define-module';
import { rewriteImports } from './module-resolver';
import type { ImpulseFlowContext } from './preview-exec-tool';

describe('rewriteImports', () => {
  test('rewrites named imports', () => {
    const result = rewriteImports("import { a, b } from 'mod';");
    expect(result).toBe("const { a, b } = __require('mod');");
  });

  test('rewrites default imports', () => {
    const result = rewriteImports("import x from 'mod';");
    expect(result).toContain("__require('mod')");
  });

  test('rewrites namespace imports', () => {
    const result = rewriteImports("import * as x from 'mod';");
    expect(result).toBe("const x = __require('mod');");
  });

  test('rewrites multiple imports', () => {
    const code = [
      "import { command } from 'sys';",
      "import { ai } from 'sys/ai';",
      "import { getWorkouts } from 'workout-api';",
    ].join('\n');
    const result = rewriteImports(code);
    expect(result).toContain("__require('sys')");
    expect(result).toContain("__require('sys/ai')");
    expect(result).toContain("__require('workout-api')");
  });

  test('preserves non-import code', () => {
    const code = 'const x = 1;\nconsole.log(x);';
    expect(rewriteImports(code)).toBe(code);
  });
});

describe('module resolution in preview', () => {
  test('import { command } from sys works', async () => {
    const fs = createOverlayFs();
    const computer = createComputer(fs);
    const ctx: ImpulseFlowContext = {};

    const result = await computer.tool.execute(
      `
      import { command } from 'sys';
      await command('write', '/test.md', 'via import');
      `,
      ctx,
      undefined,
    );
    expect(result.success).toBe(true);
  });

  test('product bindings are accessible via import', async () => {
    const fs = createOverlayFs();
    const mockWorkoutApi = {
      getWorkouts: codeFunction({
        description: 'Get all workouts',
        validate: (input: unknown) => ({ success: true as const, data: input }),
        fn: async () => [{ id: '1', exercise: 'squat' }],
      }),
      logWorkout: codeFunction({
        description: 'Log a workout',
        validate: (input: unknown) => ({
          success: true as const,
          data: input as Record<string, unknown>,
        }),
        fn: async (params: Record<string, unknown>) => ({
          id: 'w1',
          logged: true,
          ...params,
        }),
      }),
    };

    const computer = createComputer(fs, {
      modules: [
        defineAiComputerModule({
          name: 'workout-api',
          bindings: mockWorkoutApi,
        }),
      ],
    });
    const ctx: ImpulseFlowContext = {};

    const result = await computer.tool.execute(
      `
      import { getWorkouts } from 'workout-api';
      const workouts = await getWorkouts();
      console.log('workouts:', JSON.stringify(workouts));
      `,
      ctx,
      undefined,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stdout).toContain('squat');
    }
  });

  test('node:path is available', async () => {
    const fs = createOverlayFs();
    const computer = createComputer(fs);
    const ctx: ImpulseFlowContext = {};

    const result = await computer.tool.execute(
      `
      import { join, basename } from 'node:path';
      const p = join('/agent', 'home', 'notes.md');
      console.log('path:', p);
      console.log('base:', basename(p));
      `,
      ctx,
      undefined,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stdout).toContain('/agent/home/notes.md');
      expect(result.data.stdout).toContain('base: notes.md');
    }
  });

  test('unknown module throws clear error', async () => {
    const fs = createOverlayFs();
    const computer = createComputer(fs);
    const ctx: ImpulseFlowContext = {};

    const result = await computer.tool.execute(
      "import { x } from 'nonexistent';",
      ctx,
      undefined,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).toContain('Module not found');
      expect(result.message).toContain('nonexistent');
    }
  });
});

describe('VFS package imports in preview', () => {
  test('imports a package from /agent/packages by name', async () => {
    const fs = createOverlayFs({
      mount: {
        '/agent/packages/demo/index.ts': [
          'export const value = 1;',
          'export default { value };',
        ].join('\n'),
      },
    });
    const computer = createComputer(fs);
    const ctx: ImpulseFlowContext = {};

    const result = await computer.tool.execute(
      `
      import demo from 'demo';
      console.log('value:', demo.value);
      `,
      ctx,
      undefined,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stdout).toContain('value: 1');
    }
  });

  test('prefers package.json main when present', async () => {
    const fs = createOverlayFs({
      mount: {
        '/agent/packages/main-choice/package.json': JSON.stringify({
          name: 'main-choice',
          main: 'entry.js',
        }),
        '/agent/packages/main-choice/entry.js': [
          'export const source = "entry";',
          'export default { source };',
        ].join('\n'),
        '/agent/packages/main-choice/index.ts': [
          'export const source = "index";',
          'export default { source };',
        ].join('\n'),
      },
    });
    const computer = createComputer(fs);
    const ctx: ImpulseFlowContext = {};

    const result = await computer.tool.execute(
      `
      import selected from 'main-choice';
      console.log('source:', selected.source);
      `,
      ctx,
      undefined,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stdout).toContain('source: entry');
    }
  });

  test('imports a plain package from /developer/packages by default export', async () => {
    const fs = createOverlayFs({
      mount: {
        '/developer/packages/utils/index.ts': [
          'const utils = { add: (a: number, b: number) => a + b };',
          'export default utils;',
        ].join('\n'),
      },
    });
    const computer = createComputer(fs);
    const ctx: ImpulseFlowContext = {};

    const result = await computer.tool.execute(
      `
      import utils from 'utils';
      console.log('sum:', utils.add(2, 3));
      `,
      ctx,
      undefined,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stdout).toContain('sum: 5');
    }
  });

  test('imports a scoped package path from /developer/packages', async () => {
    const fs = createOverlayFs({
      mount: {
        '/developer/packages/@commands/greet/index.ts': [
          'export default { greeting: "hello" };',
        ].join('\n'),
      },
    });
    const computer = createComputer(fs);
    const ctx: ImpulseFlowContext = {};

    const result = await computer.tool.execute(
      `
      import greet from '@commands/greet';
      console.log(greet.greeting);
      `,
      ctx,
      undefined,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stdout).toContain('hello');
    }
  });
});

describe('agent command runtime loading', () => {
  test('auto-registers commands from /agent/commands for command()', async () => {
    const fs = createOverlayFs({
      mount: {
        '/agent/commands/greet/index.ts': [
          'export default {',
          '  name: "greet",',
          '  description: "Greet someone",',
          '  args: { who: { type: "string", position: 0, required: false } },',
          '  async fn(parsed) {',
          '    const who = typeof parsed.who === "string" ? parsed.who : "world";',
          '    return { message: `hello ${who}` };',
          '  },',
          '  render(result) {',
          '    return result.message;',
          '  },',
          '};',
        ].join('\n'),
      },
    });
    const computer = createComputer(fs);
    const ctx: ImpulseFlowContext = {};

    const result = await computer.tool.execute(
      `
      await command('greet', 'team');
      `,
      ctx,
      undefined,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stdout).toContain('hello team');
    }
  });

  test('imports named exports from a scoped package path in /agent/packages', async () => {
    const fs = createOverlayFs({
      mount: {
        '/agent/packages/@commands/greet/index.ts': [
          'export const greet = (name: string) => `Hello, ${name}`;',
        ].join('\n'),
      },
    });
    const computer = createComputer(fs);
    const ctx: ImpulseFlowContext = {};

    const result = await computer.tool.execute(
      `
      import { greet } from '@commands/greet';
      console.log(greet('world'));
      `,
      ctx,
      undefined,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stdout).toContain('Hello, world');
    }
  });

  test('imports agent commands via @commands/<name>', async () => {
    const fs = createOverlayFs({
      mount: {
        '/agent/commands/greet/index.ts': [
          'export default {',
          '  name: "greet",',
          '  description: "Greet someone",',
          '  args: {},',
          '  async fn() {',
          '    return { message: "hello" };',
          '  },',
          '  render(result) {',
          '    return result.message;',
          '  },',
          '};',
        ].join('\n'),
      },
    });
    const computer = createComputer(fs);
    const ctx: ImpulseFlowContext = {};

    const result = await computer.tool.execute(
      `
      import greet from '@commands/greet';
      console.log(greet.name);
      `,
      ctx,
      undefined,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stdout).toContain('greet');
    }
  });
});
