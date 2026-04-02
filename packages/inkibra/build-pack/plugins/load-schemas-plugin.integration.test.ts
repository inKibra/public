import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadSchemasPlugin } from './load-schemas-plugin';

const WORKSPACE_ROOT = path.resolve(import.meta.dir, '../../../..');

describe('loadSchemasPlugin integration', () => {
  test('transforms .schemas.ts directly without requiring sibling .js', async () => {
    const schemaPath = path.join(
      WORKSPACE_ROOT,
      'packages/inkibra/example-web-app/.tmp-load-schemas.integration.schemas.ts',
    );
    const outdir = path.join(
      WORKSPACE_ROOT,
      'packages/inkibra/example-web-app/.tmp-load-schemas.integration.out',
    );

    fs.writeFileSync(
      schemaPath,
      `
// biome-ignore lint/style/noRestrictedImports: typia is allowed in schema files
import typia from 'typia';

export const validatePayload = typia.createValidate<{ value: string }>();
`,
    );

    try {
      const buildResult = await Bun.build({
        entrypoints: [schemaPath],
        target: 'browser',
        format: 'esm',
        outdir,
        plugins: [loadSchemasPlugin],
      });

      expect(buildResult.success).toBe(true);
      expect(buildResult.outputs.length).toBeGreaterThan(0);

      const output = await buildResult.outputs[0]?.text();
      expect(output).toBeDefined();
      expect(output).not.toContain('typia.createValidate');
    } finally {
      fs.rmSync(schemaPath, { force: true });
      fs.rmSync(outdir, { recursive: true, force: true });
    }
  });

  test('expands router defineRouteSchema marker and executes validators', async () => {
    const schemaPath = path.join(
      WORKSPACE_ROOT,
      'packages/inkibra/example-web-app/.tmp-load-schemas.route-markers.integration.schemas.ts',
    );
    const outdir = path.join(
      WORKSPACE_ROOT,
      'packages/inkibra/example-web-app/.tmp-load-schemas.route-markers.integration.out',
    );

    fs.writeFileSync(
      schemaPath,
      `
import { defineRouteSchema } from '@inkibra/router';

type DemoRouteContract = {
  pathParams: Record<string, never>;
  pathQuery: Record<string, never>;
  body: { id: string };
  response: { ok: true };
};

export const routeSchema = defineRouteSchema<DemoRouteContract>();
`,
    );

    try {
      const buildResult = await Bun.build({
        entrypoints: [schemaPath],
        target: 'bun',
        format: 'esm',
        outdir,
        plugins: [loadSchemasPlugin],
      });

      expect(buildResult.success).toBe(true);

      const outputPath = path.join(
        outdir,
        path.basename(schemaPath).replace(/\.ts$/, '.js'),
      );
      const outputCode = fs.readFileSync(outputPath, 'utf8');
      expect(outputCode).not.toContain(
        'defineRouteSchema<DemoRouteContract>()',
      );

      const module = await import(
        `${pathToFileURL(outputPath).href}?t=${Date.now()}`
      );

      const routeOk = module.routeSchema.body({ id: 'abc' });
      const routeBad = module.routeSchema.body({ id: 123 });
      expect(routeOk.success).toBe(true);
      expect(routeBad.success).toBe(false);
    } finally {
      fs.rmSync(schemaPath, { force: true });
      fs.rmSync(outdir, { recursive: true, force: true });
    }
  });

  test('expands ai-flow defineAi* markers and executes validators', async () => {
    const schemaPath = path.join(
      WORKSPACE_ROOT,
      'packages/inkibra/ai-construct/.tmp-load-schemas.ai-markers.integration.schemas.ts',
    );
    const outdir = path.join(
      WORKSPACE_ROOT,
      'packages/inkibra/ai-construct/.tmp-load-schemas.ai-markers.integration.out',
    );

    fs.writeFileSync(
      schemaPath,
      `
import {
  defineAiOutputSchema,
  defineAiToolParams,
} from '@inkibra/ai-flow';

type DemoToolParams = { query: string };
type DemoOutput = { title: string };

export const toolParams = defineAiToolParams<DemoToolParams>();
export const outputSchema = defineAiOutputSchema<DemoOutput>();
`,
    );

    try {
      const buildResult = await Bun.build({
        entrypoints: [schemaPath],
        target: 'bun',
        format: 'esm',
        outdir,
        plugins: [loadSchemasPlugin],
      });

      expect(buildResult.success).toBe(true);

      const outputPath = path.join(
        outdir,
        path.basename(schemaPath).replace(/\.ts$/, '.js'),
      );
      const outputCode = fs.readFileSync(outputPath, 'utf8');
      expect(outputCode).not.toContain('defineAiToolParams<DemoToolParams>()');
      expect(outputCode).not.toContain('defineAiOutputSchema<DemoOutput>()');

      const module = await import(
        `${pathToFileURL(outputPath).href}?t=${Date.now()}`
      );

      const toolOk = module.toolParams.parseParameters('{"query":"hello"}');
      const toolBad = module.toolParams.parseParameters('{"query":123}');
      expect(toolOk.success).toBe(true);
      expect(toolBad.success).toBe(false);

      const outputOk = module.outputSchema.validate('{"title":"hi"}');
      const outputBad = module.outputSchema.validate('{"title":123}');
      expect(outputOk.success).toBe(true);
      expect(outputBad.success).toBe(false);
    } finally {
      fs.rmSync(schemaPath, { force: true });
      fs.rmSync(outdir, { recursive: true, force: true });
    }
  });
});
