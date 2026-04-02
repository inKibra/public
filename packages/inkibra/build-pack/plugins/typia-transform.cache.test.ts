import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { transformTypiaSource } from './typia-transform';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('typia transform disk cache', () => {
  test('writes transformed output to disk cache and reuses it', () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'inkibra-typia-cache-test-'),
    );
    tempDirs.push(tempDir);

    const filePath = path.join(tempDir, 'fixture.schemas.ts');
    const source = `
// biome-ignore lint/style/noRestrictedImports: typia is allowed in schema files
import typia from 'typia';

export const validatePayload = typia.createValidate<{ id: string }>();
`;

    const first = transformTypiaSource(filePath, source, {
      cache: true,
      cacheDir: tempDir,
      skipIfNoTypia: false,
      typeMacros: false,
    });

    expect(first.code).toContain('validatePayload');

    const cacheFiles = fs
      .readdirSync(tempDir)
      .filter((fileName) => fileName.endsWith('.js'));
    expect(cacheFiles.length).toBeGreaterThan(0);

    const cachePath = path.join(tempDir, cacheFiles[0] as string);
    const sentinel = 'export const fromCache = 1;';
    fs.writeFileSync(cachePath, sentinel, 'utf-8');

    const second = transformTypiaSource(filePath, source, {
      cache: true,
      cacheDir: tempDir,
      skipIfNoTypia: false,
      typeMacros: false,
    });

    expect(second.code).toBe(sentinel);
  });

  test('uses INKIBRA_TYPIA_CACHE_DIR when cacheDir is omitted', () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'inkibra-typia-cache-env-test-'),
    );
    tempDirs.push(tempDir);

    const previous = process.env.INKIBRA_TYPIA_CACHE_DIR;
    process.env.INKIBRA_TYPIA_CACHE_DIR = tempDir;

    try {
      const filePath = path.join(tempDir, 'fixture-env.schemas.ts');
      const source = `
// biome-ignore lint/style/noRestrictedImports: typia is allowed in schema files
import typia from 'typia';

export const validatePayload = typia.createValidate<{ value: string }>();
`;

      const transformed = transformTypiaSource(filePath, source, {
        cache: true,
        skipIfNoTypia: false,
        typeMacros: false,
      });

      expect(transformed.code).toContain('validatePayload');

      const cacheFiles = fs
        .readdirSync(tempDir)
        .filter((fileName) => fileName.endsWith('.js'));
      expect(cacheFiles.length).toBeGreaterThan(0);
    } finally {
      process.env.INKIBRA_TYPIA_CACHE_DIR = previous;
    }
  });
});
