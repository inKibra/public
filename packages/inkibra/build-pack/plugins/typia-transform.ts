import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import type { BunPlugin } from 'bun';
import ts from 'typescript';
import { transform as typiaTransform } from 'typia/lib/transform.js';
import type { ITransformOptions } from 'typia/lib/transformers/ITransformOptions.js';
import { expandTypeMacrosInSource } from './type-macros';

const require = createRequire(import.meta.url);

export type TypiaTransformOptions = {
  baseDir?: string;
  tsconfigPath?: string;
  cache?: boolean;
  typia?: ITransformOptions;
  skipIfNoTypia?: boolean;
  typeMacros?: boolean;
  cacheDir?: string;
};

export type TypiaTransformResult = {
  code: string;
  diagnostics: ts.Diagnostic[];
};

export type TypiaTransformPluginOptions = TypiaTransformOptions & {
  filter?: RegExp;
  onDiagnostics?: (diagnostics: ts.Diagnostic[], formatted: string) => void;
};

const defaultCompilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
};

const printer = ts.createPrinter();
const compilerOptionsCache = new Map<string, ts.CompilerOptions>();
const sourceCache = new Map<string, ts.SourceFile>();

const typiaVersion = (() => {
  try {
    const pkgPath = require.resolve('typia/package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
      version?: string;
    };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();

function getCacheDir(options: TypiaTransformOptions): string {
  if (options.cacheDir) {
    return path.resolve(options.cacheDir);
  }
  if (process.env.INKIBRA_TYPIA_CACHE_DIR) {
    return path.resolve(process.env.INKIBRA_TYPIA_CACHE_DIR);
  }

  const baseDir = options.baseDir ?? process.cwd();
  return path.resolve(baseDir, 'node_modules/.cache/inkibra-typia');
}

function getTsconfigFingerprint(options: TypiaTransformOptions): string {
  const baseDir = options.baseDir ?? process.cwd();
  const resolvedTsconfig = resolveTsconfigPath(baseDir, options.tsconfigPath);
  if (!resolvedTsconfig || !fs.existsSync(resolvedTsconfig)) {
    return 'no-tsconfig';
  }
  try {
    const content = fs.readFileSync(resolvedTsconfig, 'utf-8');
    return createHash('sha256').update(content).digest('hex');
  } catch {
    return 'tsconfig-unreadable';
  }
}

function createTransformCacheKey(
  filePath: string,
  source: string,
  options: TypiaTransformOptions,
  programSourcesHash?: string,
): string {
  const parts = [
    `file:${path.resolve(filePath)}`,
    `source:${createHash('sha256').update(source).digest('hex')}`,
    `typia:${typiaVersion}`,
    `typescript:${ts.version}`,
    `typeMacros:${options.typeMacros === false ? 'off' : 'on'}`,
    `skipIfNoTypia:${options.skipIfNoTypia === false ? 'off' : 'on'}`,
    `typiaOptions:${JSON.stringify(options.typia ?? {})}`,
    `tsconfig:${getTsconfigFingerprint(options)}`,
  ];
  if (programSourcesHash) {
    parts.push(`programSources:${programSourcesHash}`);
  }

  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

function getCachePath(cacheDir: string, cacheKey: string): string {
  return path.join(cacheDir, `${cacheKey}.js`);
}

function readDiskCache(cacheDir: string, cacheKey: string): string | undefined {
  const cachePath = getCachePath(cacheDir, cacheKey);
  if (!fs.existsSync(cachePath)) {
    return undefined;
  }

  try {
    return fs.readFileSync(cachePath, 'utf-8');
  } catch {
    return undefined;
  }
}

function writeDiskCache(
  cacheDir: string,
  cacheKey: string,
  code: string,
): void {
  const cachePath = getCachePath(cacheDir, cacheKey);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cachePath, code, 'utf-8');
}

function formatDiagnostics(
  diagnostics: ts.Diagnostic[],
  baseDir: string,
): string {
  const formatHost: ts.FormatDiagnosticsHost = {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => baseDir,
    getNewLine: () => '\n',
  };
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, formatHost);
}

function resolveTsconfigPath(
  baseDir: string,
  tsconfigPath?: string,
): string | undefined {
  if (tsconfigPath) {
    return path.isAbsolute(tsconfigPath)
      ? tsconfigPath
      : path.resolve(baseDir, tsconfigPath);
  }
  return ts.findConfigFile(baseDir, ts.sys.fileExists, 'tsconfig.json');
}

function loadCompilerOptions(
  options: TypiaTransformOptions,
): ts.CompilerOptions {
  const baseDir = options.baseDir ?? process.cwd();
  const resolvedTsconfig = resolveTsconfigPath(baseDir, options.tsconfigPath);
  if (!resolvedTsconfig) {
    return { ...defaultCompilerOptions };
  }

  if (options.cache !== false) {
    const cached = compilerOptionsCache.get(resolvedTsconfig);
    if (cached) {
      return cached;
    }
  }

  const configFile = ts.readConfigFile(resolvedTsconfig, ts.sys.readFile);
  if (configFile.error) {
    const formatted = formatDiagnostics([configFile.error], baseDir);
    throw new Error(formatted);
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(resolvedTsconfig),
  );
  const compilerOptions = {
    ...defaultCompilerOptions,
    ...parsed.options,
  };

  if (options.cache !== false) {
    compilerOptionsCache.set(resolvedTsconfig, compilerOptions);
  }

  return compilerOptions;
}

function createProgramAndSource(
  filePath: string,
  source: string,
  compilerOptions: ts.CompilerOptions,
  cacheEnabled: boolean,
): { program: ts.Program; tsSource: ts.SourceFile } {
  const resolvedPath = path.resolve(filePath);
  const languageVersion = compilerOptions.target ?? ts.ScriptTarget.ES2020;
  const tsSource = ts.createSourceFile(resolvedPath, source, languageVersion);
  const host = ts.createCompilerHost(compilerOptions);

  host.getSourceFile = (fileName, languageVersionOverride) => {
    const resolvedName = path.resolve(fileName);
    if (resolvedName === resolvedPath) {
      return tsSource;
    }

    if (cacheEnabled) {
      const cached = sourceCache.get(resolvedName);
      if (cached) {
        return cached;
      }
    }

    const fileText = ts.sys.readFile(resolvedName);
    if (fileText == null) {
      return undefined;
    }

    const result = ts.createSourceFile(
      resolvedName,
      fileText,
      languageVersionOverride,
    );

    if (cacheEnabled) {
      sourceCache.set(resolvedName, result);
    }

    return result;
  };

  const program = ts.createProgram([resolvedPath], compilerOptions, host);

  return { program, tsSource };
}

/**
 * Hash the content of all user source files resolved by a TypeScript program.
 * Excludes node_modules files (lib.d.ts, type declarations, etc.) since they
 * don't affect schema output and would make the cache key change on unrelated installs.
 * This ensures the cache key changes when any transitively imported type changes.
 */
function hashProgramSources(program: ts.Program): string {
  const hash = createHash('sha256');
  const sources = program
    .getSourceFiles()
    .filter((sf) => !sf.fileName.includes('node_modules'))
    .sort((a, b) => a.fileName.localeCompare(b.fileName));

  for (const sf of sources) {
    hash.update(sf.fileName);
    hash.update(sf.text);
  }
  return hash.digest('hex');
}

export function transformTypiaSource(
  filePath: string,
  source: string,
  options: TypiaTransformOptions = {},
): TypiaTransformResult {
  const cacheEnabled = options.cache !== false;
  const cacheDir = cacheEnabled ? getCacheDir(options) : null;

  // Phase 1: Expand type macros
  const macroExpandedSource =
    options.typeMacros === false
      ? source
      : expandTypeMacrosInSource(filePath, source, {
          cache: cacheEnabled,
        }).code;

  // Phase 2: Skip if no typia references after macro expansion
  if (
    options.skipIfNoTypia !== false &&
    !macroExpandedSource.includes('typia')
  ) {
    return { code: macroExpandedSource, diagnostics: [] };
  }

  // Phase 3: Create TS program — resolves all imports so we can hash them.
  // This is fast (sourceCache helps) and must happen before cache check
  // so the cache key reflects transitive type dependencies.
  const compilerOptions = loadCompilerOptions(options);
  const { program, tsSource } = createProgramAndSource(
    filePath,
    macroExpandedSource,
    compilerOptions,
    cacheEnabled,
  );

  // Phase 4: Compute cache key including all resolved source file hashes.
  // This ensures the cache is invalidated when any imported type changes,
  // even if the .schemas.ts file itself is unchanged.
  const cacheKey = cacheEnabled
    ? createTransformCacheKey(
        filePath,
        macroExpandedSource,
        options,
        hashProgramSources(program),
      )
    : null;

  // Phase 5: Check disk cache
  if (cacheEnabled && cacheDir && cacheKey) {
    const cachedCode = readDiskCache(cacheDir, cacheKey);
    if (cachedCode !== undefined) {
      return { code: cachedCode, diagnostics: [] };
    }
  }

  // Phase 6: Run typia transform (the expensive part — only on cache miss)
  const diagnostics: ts.Diagnostic[] = [];
  const typiaTransformer = typiaTransform(program, options.typia, {
    addDiagnostic(diag: ts.Diagnostic) {
      diagnostics.push(diag);
      return diagnostics.length;
    },
  });

  const transformationResult = ts.transform(tsSource, [typiaTransformer], {
    ...program.getCompilerOptions(),
    sourceMap: true,
    inlineSources: true,
  });

  const transformedFile = transformationResult.transformed.find(
    (file) => path.resolve(file.fileName) === path.resolve(filePath),
  );

  if (!transformedFile) {
    transformationResult.dispose();
    throw new Error(`Typia transform failed for ${filePath}`);
  }

  const code = printer.printFile(transformedFile);
  transformationResult.dispose();

  // Phase 7: Write to disk cache
  if (cacheEnabled && cacheDir && cacheKey) {
    writeDiskCache(cacheDir, cacheKey, code);
  }

  return { code, diagnostics };
}

export function createTypiaTransformPlugin(
  options: TypiaTransformPluginOptions = {},
): BunPlugin {
  const { filter = /\.ts$/, onDiagnostics, ...transformOptions } = options;

  return {
    name: 'typia-transform',
    setup(build) {
      build.onLoad({ filter }, async ({ path: filePath }) => {
        const source = await Bun.file(filePath).text();
        const { code, diagnostics } = transformTypiaSource(
          filePath,
          source,
          transformOptions,
        );

        if (diagnostics.length > 0) {
          const baseDir = transformOptions.baseDir ?? process.cwd();
          const formatted = formatDiagnostics(diagnostics, baseDir);
          if (onDiagnostics) {
            onDiagnostics(diagnostics, formatted);
          } else {
            console.warn(formatted);
          }
        }

        return {
          contents: code,
          loader: 'ts',
        };
      });
    },
  };
}
