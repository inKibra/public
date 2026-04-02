import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { clearTypeMacroCaches, expandTypeMacrosInSource } from './type-macros';
import {
  createTypiaTransformPlugin,
  transformTypiaSource,
} from './typia-transform';

const WORKSPACE_ROOT = path.resolve(import.meta.dir, '../../../..');

afterEach(() => {
  clearTypeMacroCaches();
});

describe('type macros', () => {
  test('expands router defineRouteSchema<T>() marker', () => {
    const filePath = path.join(
      WORKSPACE_ROOT,
      'packages/inkibra/example-web-app/test.route.schemas.ts',
    );

    const source = `
import { defineRouteSchema } from '@inkibra/router';

type LoginContract = {
  pathParams: Record<string, never>;
  pathQuery: { redirect?: string };
  body: { email: string };
  response: { ok: true };
};

export const loginSchema = defineRouteSchema<LoginContract>();
`;

    const result = expandTypeMacrosInSource(filePath, source, { cache: false });

    expect(result.expanded).toBe(true);
    expect(result.code).not.toContain('defineRouteSchema<LoginContract>()');
    expect(result.code).toMatch(/import\s+typia\s+from\s+['"]typia['"]/);
    expect(result.code).toMatch(/typia\.createValidate<T\["pathQuery"\]>\(\)/);
    expect(result.code).toMatch(/typia\.createValidate<T\["response"\]>\(\)/);
  });

  test('expands additional router define* schema markers', () => {
    const filePath = path.join(
      WORKSPACE_ROOT,
      'packages/inkibra/example-web-app/test.router-markers.schemas.ts',
    );

    const source = `
import {
  defineAppSchema,
  defineCapabilitySchema,
  defineContextSchema,
  defineEventStreamSchema,
  defineLoaderSchema,
  definePathParamsSchema,
} from '@inkibra/router';

type LoaderContract = { response: { ok: true }; error: { type: 'Nope' } };
type ContextContract = {
  data: { userId: string };
  warning: { type: 'SessionWarning' };
  error: { type: 'Unauthorized' };
};
type EventStreamContract = {
  pathParams: { threadId: string };
  pathQuery: { before?: string };
  eventTypes: { message: { id: string } };
  completionData: { done: true };
  completionError: { type: 'Oops' };
};
type CapabilityContract = {
  request: { message: string };
  response: { accepted: boolean };
};
type AppContract = { config: { apiBase: string } };

export const loader = defineLoaderSchema<LoaderContract>();
export const context = defineContextSchema<ContextContract>();
export const pathParam = definePathParamsSchema<string>();
export const eventStream = defineEventStreamSchema<EventStreamContract>();
export const capability = defineCapabilitySchema<CapabilityContract>();
export const app = defineAppSchema<AppContract>();
`;

    const result = expandTypeMacrosInSource(filePath, source, { cache: false });

    expect(result.expanded).toBe(true);
    expect(result.code).not.toContain('defineLoaderSchema<LoaderContract>()');
    expect(result.code).not.toContain('defineContextSchema<ContextContract>()');
    expect(result.code).not.toContain('definePathParamsSchema<string>()');
    expect(result.code).not.toContain(
      'defineEventStreamSchema<EventStreamContract>()',
    );
    expect(result.code).not.toContain(
      'defineCapabilitySchema<CapabilityContract>()',
    );
    expect(result.code).not.toContain('defineAppSchema<AppContract>()');
    expect(result.code).toMatch(/typia\.createValidate<T\["response"\]>\(\)/);
    expect(result.code).toMatch(/typia\.createValidate<T\["error"\]>\(\)/);
    expect(result.code).toMatch(/typia\.createValidate<T\["data"\]>\(\)/);
    expect(result.code).toMatch(/typia\.createValidate<TParam>\(\)/);
    expect(result.code).toMatch(
      /typia\.createValidate<Partial<T\["eventTypes"\]>>\(\)/,
    );
    expect(result.code).toMatch(/typia\.createValidate<T\["request"\]>\(\)/);
    expect(result.code).toMatch(/typia\.createValidate<T\["config"\]>\(\)/);
  });

  test('expands ai-flow tool/output marker contracts', () => {
    const filePath = path.join(
      WORKSPACE_ROOT,
      'packages/inkibra/example-web-app/test.ai-flow.schemas.ts',
    );

    const source = `
import { defineAiOutputSchema, defineAiToolParams } from '@inkibra/ai-flow';

type SearchParams = { query: string };
type RecapOutput = { name: string };

export const toolParams = defineAiToolParams<SearchParams>();
export const outputDef = defineAiOutputSchema<RecapOutput>();
`;

    const result = expandTypeMacrosInSource(filePath, source, { cache: false });

    expect(result.expanded).toBe(true);
    expect(result.code).not.toContain('defineAiToolParams<SearchParams>()');
    expect(result.code).not.toContain('defineAiOutputSchema<RecapOutput>()');
    expect(result.code).toMatch(/typia\.llm\.parameters<T,\s*"chatgpt">\(\)/);
    expect(result.code).toMatch(/typia\.json\.createValidateParse<T>\(\)/);
    expect(result.code).toMatch(
      /validate:\s*typia\.json\.createValidateParse<T>\(\)/,
    );
  });

  test('rejects macros with free globals', () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'inkibra-type-macro-test-'),
    );
    const packageDir = path.join(tempDir, 'node_modules', 'fake-macro-pkg');

    fs.mkdirSync(path.join(packageDir, 'type-macros'), { recursive: true });
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify(
        {
          name: 'fake-macro-pkg',
          version: '0.0.0',
          inkibra: {
            'build-pack': {
              'type-macros': ['./type-macros/index.type-macros.ts'],
            },
          },
        },
        null,
        2,
      ),
    );

    fs.writeFileSync(
      path.join(packageDir, 'type-macros', 'index.type-macros.ts'),
      `
import typia from 'typia';

export function badMacro<T>() {
  return {
    value: typia.createValidate<T>(),
    leak: console.log('nope'),
  };
}
`,
    );

    const filePath = path.join(tempDir, 'consumer.schemas.ts');
    const source = `
import { badMacro } from 'fake-macro-pkg';

type Data = { id: string };
const x = badMacro<Data>();
`;

    try {
      expect(() =>
        expandTypeMacrosInSource(filePath, source, { cache: false }),
      ).toThrow(/free identifiers: console/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('transformTypiaSource expands marker-only source before typia skip gate', () => {
    const filePath = path.join(
      WORKSPACE_ROOT,
      'packages/inkibra/example-web-app/test.transform.schemas.ts',
    );

    const source = `
import { defineRouteSchema } from '@inkibra/router';

type HealthContract = {
  pathParams: Record<string, never>;
  pathQuery: Record<string, never>;
  body: Record<string, never>;
  response: { ok: true };
};

export const healthSchema = defineRouteSchema<HealthContract>();
`;

    const result = transformTypiaSource(filePath, source, {
      cache: false,
      skipIfNoTypia: true,
    });

    expect(result.code).not.toContain('defineRouteSchema<HealthContract>()');
    expect(result.code).not.toContain('defineRouteSchema(');
    expect(result.code.length).toBeGreaterThan(0);
  });

  test('createTypiaTransformPlugin expands markers during Bun.build', async () => {
    const tempFile = path.join(
      WORKSPACE_ROOT,
      'packages/inkibra/example-web-app/.tmp-type-macro-build.schemas.ts',
    );
    const outdir = path.join(
      WORKSPACE_ROOT,
      'packages/inkibra/example-web-app/.tmp-type-macro-build-out',
    );

    const source = `
import { defineRouteSchema } from '@inkibra/router';

type RouteContract = {
  pathParams: Record<string, never>;
  pathQuery: Record<string, never>;
  body: Record<string, never>;
  response: { ok: true };
};

export const routeSchema = defineRouteSchema<RouteContract>();
`;

    fs.writeFileSync(tempFile, source);

    try {
      const plugin = createTypiaTransformPlugin({
        filter: /\.schemas\.ts$/,
        cache: false,
        skipIfNoTypia: true,
      });

      const buildResult = await Bun.build({
        entrypoints: [tempFile],
        target: 'browser',
        format: 'esm',
        plugins: [plugin],
        outdir,
      });

      expect(buildResult.success).toBe(true);
      expect(buildResult.outputs.length).toBeGreaterThan(0);

      const output = await buildResult.outputs[0]?.text();
      expect(output).toBeDefined();
      expect(output).not.toContain('defineRouteSchema<RouteContract>()');
      expect(output).not.toContain('defineRouteSchema(');
      expect(output).not.toContain('typia.createValidate');

      const outputPath = path.join(
        WORKSPACE_ROOT,
        'packages/inkibra/example-web-app/.tmp-type-macro-build.output.js',
      );
      fs.writeFileSync(outputPath, output ?? '');
      try {
        const module = await import(
          `${pathToFileURL(outputPath).href}?t=${Date.now()}`
        );
        const result = module.routeSchema.pathQuery({});
        expect(result.success).toBe(true);
      } finally {
        fs.rmSync(outputPath, { force: true });
      }
    } finally {
      fs.rmSync(tempFile, { force: true });
      fs.rmSync(outdir, { recursive: true, force: true });
    }
  });
});
