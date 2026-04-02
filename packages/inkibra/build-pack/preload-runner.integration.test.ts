import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPreload } from './preload-runner';

const tempFiles: string[] = [];

afterEach(() => {
  for (const filePath of tempFiles.splice(0)) {
    fs.rmSync(filePath, { force: true });
  }
});

describe('createPreload integration', () => {
  test('registers codeMode plugin and transforms .tool.ts imports', async () => {
    const packageDir = path.resolve(import.meta.dir, '../example-web-app');

    const codemodeIndexPath = path
      .resolve(import.meta.dir, '../ai-flow/codemode/index.ts')
      .replaceAll('\\', '/');

    const toolPath = path.join(packageDir, '.tmp-preload-code-mode.tool.ts');
    tempFiles.push(toolPath);

    fs.writeFileSync(
      toolPath,
      `
import { defineCodeBinding } from '${codemodeIndexPath}';

export const sum = defineCodeBinding(async function sum(
  { a, b }: { a: number; b: number }
): Promise<number> {
  return a + b;
});
`,
    );

    const pluginModulePath = path.resolve(
      import.meta.dir,
      '../ai-flow/codemode/plugin.ts',
    );
    const pluginModule = await import(pathToFileURL(pluginModulePath).href);

    const originalArgv1 = process.argv[1] ?? '';
    process.argv[1] = path.join(packageDir, 'run-preload-code-mode.ts');

    try {
      createPreload({
        packageDir,
        matchScripts: ['run-preload-code-mode.ts'],
        plugins: {
          loadSchemas: false,
          assetsPath: false,
          clientStub: false,
          clientBuild: false,
          codeMode: pluginModule.codeBindingPlugin,
        },
      });
    } finally {
      process.argv[1] = originalArgv1;
    }

    const module = await import(
      `${pathToFileURL(toolPath).href}?t=${Date.now()}`
    );

    expect(module.sum).toBeDefined();
    expect(typeof module.sum.validate).toBe('function');
    expect(typeof module.sum.fn).toBe('function');

    const valid = module.sum.validate({ a: 2, b: 3 });
    expect(valid.success).toBe(true);

    const invalid = module.sum.validate({ a: '2', b: 3 });
    expect(invalid.success).toBe(false);
  });

  test('codeMode=true resolves default codemode plugin', async () => {
    const packageDir = path.resolve(import.meta.dir, '../example-web-app');

    const codemodeIndexPath = path
      .resolve(import.meta.dir, '../ai-flow/codemode/index.ts')
      .replaceAll('\\', '/');

    const toolPath = path.join(
      packageDir,
      '.tmp-preload-code-mode-boolean.tool.ts',
    );
    tempFiles.push(toolPath);

    fs.writeFileSync(
      toolPath,
      `
import { defineCodeBinding } from '${codemodeIndexPath}';

export const multiply = defineCodeBinding(async function multiply(
  { a, b }: { a: number; b: number }
): Promise<number> {
  return a * b;
});
`,
    );

    const originalArgv1 = process.argv[1] ?? '';
    process.argv[1] = path.join(packageDir, 'run-preload-code-mode-boolean.ts');

    try {
      createPreload({
        packageDir,
        matchScripts: ['run-preload-code-mode-boolean.ts'],
        plugins: {
          loadSchemas: false,
          assetsPath: false,
          clientStub: false,
          clientBuild: false,
          codeMode: true,
        },
      });
    } finally {
      process.argv[1] = originalArgv1;
    }

    const module = await import(
      `${pathToFileURL(toolPath).href}?t=${Date.now()}`
    );

    const valid = module.multiply.validate({ a: 3, b: 4 });
    const invalid = module.multiply.validate({ a: 3, b: '4' });

    expect(valid.success).toBe(true);
    expect(invalid.success).toBe(false);
  });
});
