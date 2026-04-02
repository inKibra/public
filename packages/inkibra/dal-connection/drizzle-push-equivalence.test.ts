import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import * as Logger from '@inkibra/logger';
import { drizzle } from 'drizzle-orm/pglite';
import { DrizzleDriver } from './drivers/drizzle-driver';
import { ecommerce, social } from './examples/drizzle-schema';

function ensureDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function rmDir(dirPath: string) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function resolveDrizzleKitBin(): string {
  const drizzleKitPkgJson = import.meta.resolve('drizzle-kit/package.json');
  const pkgJsonPath = fileURLToPath(drizzleKitPkgJson);
  const pkgDir = path.dirname(pkgJsonPath);

  const raw = fs.readFileSync(pkgJsonPath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) {
    throw new Error('Unexpected drizzle-kit package.json shape');
  }

  const bin = parsed['bin'];
  if (typeof bin === 'string') {
    return path.resolve(pkgDir, bin);
  }
  if (isRecord(bin)) {
    const drizzleKitBin = bin['drizzle-kit'];
    if (typeof drizzleKitBin === 'string') {
      return path.resolve(pkgDir, drizzleKitBin);
    }
  }
  throw new Error('Unable to resolve drizzle-kit bin from package.json');
}

async function runDrizzleKitPush(params: {
  cwd: string;
  env: Record<string, string>;
}) {
  const drizzleKitPath = resolveDrizzleKitBin();
  const proc = Bun.spawn(
    [
      'bun',
      drizzleKitPath,
      'push',
      '--config',
      './drizzle.config.ts',
      '--force',
    ],
    {
      cwd: params.cwd,
      env: { ...process.env, ...params.env },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `drizzle-kit push failed (exit ${exitCode})\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
    );
  }
}

describe('drizzle-kit push equivalence (example schema)', () => {
  const logger = Logger.init('drizzle-push-equivalence-test');
  const baseDir = path.join(
    import.meta.dir,
    'test-pglite',
    'drizzle-push-equivalence',
  );
  const packageCwd = import.meta.dir;

  let dbPath: string;
  let pglite: PGlite;
  let driver: DrizzleDriver;

  beforeAll(async () => {
    ensureDir(baseDir);
    dbPath = path.join(baseDir, `db-${Date.now()}`);
    rmDir(dbPath);

    await runDrizzleKitPush({
      cwd: packageCwd,
      env: {
        PG_REMOTE: 'false',
        PGLITE_PATH: dbPath,
      },
    });

    pglite = new PGlite(dbPath);
    const db = drizzle(pglite);
    driver = DrizzleDriver.fromDb({ db });
  });

  afterAll(async () => {
    await pglite?.close();
    rmDir(dbPath);
  });

  test('db:push schema passes strict ensureCollection validation', async () => {
    const collections = [social, ecommerce];
    for (const collection of collections) {
      await collection.initialize(logger, driver, { strict: true });
    }
    expect(true).toBe(true);
  });
});
