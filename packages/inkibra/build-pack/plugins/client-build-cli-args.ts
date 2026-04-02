export type ClientBuildCliArgs = {
  entryPoint: string;
  outputPath: string;
  /** Output directory for bundle splitting (when splitting is enabled) */
  outputDir: string;
  /** Public path prefix for URLs */
  publicPath: string;
  minify: boolean;
  sourcemap: 'none' | 'inline' | 'external';
  assetsPath: string;
  assetsOutdir: string;
  assetsPublicPath: string;
  /** Enable bundle splitting for code-split chunks */
  splitting: boolean;
  /** Output format (esm, cjs, or iife) */
  format: 'esm' | 'cjs' | 'iife';
  /** Inline CSS into JS bundle instead of extracting */
  inlineCss: boolean;
  /** Generate OTA manifest with hash, url, version fields */
  otaManifest: boolean;
  /** Package version (for OTA manifest) */
  version: string;
};

/**
 * Information about a single output chunk (for bundle splitting)
 */
export type ChunkOutput = {
  /** Relative path from outputDir */
  path: string;
  /** Public URL */
  url: string;
  /** Short content hash (8 chars) for cache busting */
  hash: string;
  /** Full SHA256 hash (64 chars) for integrity verification (e.g., OTA updates) */
  fullHash: string;
  /** Original import path that created this chunk (e.g., './routes/layout') */
  importPath: string;
  /** Output kind */
  kind: 'entry-point' | 'chunk';
};

/**
 * Legacy result format (backwards compatible)
 */
export type ClientBuildResult = {
  outputPath: string;
  success: boolean;
};

/**
 * New result format with bundle splitting support
 */
export type ClientBuildResultWithChunks = {
  success: boolean;
  /** Entry point URL */
  entryUrl: string;
  /** Output format for the entry bundle */
  format?: 'esm' | 'iife' | 'cjs';
  /** Entry point short hash (8 chars) for cache busting */
  entryHash: string;
  /** Entry point full SHA256 hash (64 chars) for integrity verification */
  entryFullHash: string;
  /** All outputs (entry + chunks) */
  outputs: ChunkOutput[];
  /** Map from import path to chunk URL */
  chunkMap: Record<string, string>;
  /** Directories containing source files (relative to package root) */
  watchDirs?: string[];
  /** CSS URL (when cssOutput is 'external') */
  cssUrl?: string;
  /** CSS content hash (when cssOutput is 'external') */
  cssHash?: string;
};

export function parseClientBuildArgs(args: string[]): ClientBuildCliArgs {
  const parsed: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg?.startsWith('--')) {
      const key = arg.slice(2);
      const value = args[i + 1];
      if (value !== undefined && !value.startsWith('--')) {
        parsed[key] = value;
        i++;
      } else if (
        key === 'minify' ||
        key === 'splitting' ||
        key === 'inline-css' ||
        key === 'ota-manifest'
      ) {
        parsed[key] = 'true';
      }
    }
  }

  return {
    entryPoint: parsed['entry-point'] || '',
    outputPath: parsed['output-path'] || '',
    outputDir: parsed['output-dir'] || '',
    publicPath: parsed['public-path'] || '/dist',
    minify: parsed.minify === 'true',
    splitting: parsed.splitting === 'true',
    sourcemap: (parsed.sourcemap as 'none' | 'inline' | 'external') || 'inline',
    assetsPath: parsed['assets-path'] || '',
    assetsOutdir: parsed['assets-outdir'] || '',
    assetsPublicPath: parsed['assets-public-path'] || '',
    format: (parsed.format as 'esm' | 'cjs' | 'iife') || 'esm',
    inlineCss: parsed['inline-css'] === 'true',
    otaManifest: parsed['ota-manifest'] === 'true',
    version: parsed.version || '0.0.0',
  };
}
