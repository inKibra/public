import type { OverlayFs } from '@inkibra/ai-flow';
import type { PreviewGlobals } from './globals';
import {
  nodeAssertProxy,
  nodeBufferProxy,
  nodeCryptoProxy,
  nodeEventsProxy,
  nodeOsProxy,
  nodePathProxy,
  nodeQuerystringProxy,
  nodeUrlProxy,
  nodeUtilProxy,
} from './node-proxies';
import { type AiSdkConfig, createAiSdk } from './sys-ai';

export type SystemStaticPackageRuntimeConfig = {
  fs: OverlayFs;
  globals: PreviewGlobals;
  aiSdkConfig?: AiSdkConfig;
};

export type SystemStaticPackageDefinition = {
  specifier: string;
  description: string;
  readme: string;
  contractSource: string;
  createExports: (
    config: SystemStaticPackageRuntimeConfig,
  ) => Record<string, unknown>;
};

function withDefaultExport(
  exports: Record<string, unknown>,
): Record<string, unknown> {
  return Object.hasOwn(exports, 'default')
    ? exports
    : { ...exports, default: exports };
}

export function createOverlayFsProxy(fs: OverlayFs): Record<string, unknown> {
  return {
    promises: {
      readFile: async (path: string, encoding?: string) => {
        const content = await fs.read(String(path));
        return encoding ? content : new TextEncoder().encode(content);
      },
      writeFile: async (path: string, data: string | Uint8Array) => {
        const content =
          typeof data === 'string' ? data : new TextDecoder().decode(data);
        await fs.write(String(path), content);
      },
      readdir: async (path: string) => {
        const entries = await fs.list(String(path));
        return entries.map((entry) => entry.name);
      },
      stat: async (path: string) => {
        const content = await fs.read(String(path));
        return {
          size: new TextEncoder().encode(content).length,
          isFile: () => true,
          isDirectory: () => false,
        };
      },
      unlink: async (path: string) => {
        await fs.delete(String(path));
      },
      mkdir: async () => {
        // Directories are implicit in OverlayFs.
      },
    },
  };
}

const SYS_CONTRACT = `/**
 * sys — command dispatch for the construct runtime.
 */

/**
 * Dispatch a registered command by name.
 * Arguments are validated against that command's schema at runtime.
 */
export declare function command(
  name: string,
  ...args: (string | number | boolean)[]
): Promise<unknown>;
`;

const SYS_AI_CONTRACT = `/**
 * sys/ai — lightweight LLM SDK for use inside preview code.
 */

type AiModelPreset = 'fast' | 'thinking' | 'default';

type SearchResult = {
  title: string;
  snippet: string;
  url?: string;
};

export declare const ai: {
  extract: <T>(
    text: string,
    schema: unknown,
    options?: { model?: AiModelPreset },
  ) => Promise<T>;
  search: (
    query: string,
    options?: { model?: AiModelPreset },
  ) => Promise<SearchResult[]>;
  generate: (
    prompt: string,
    options?: { model?: AiModelPreset; maxTokens?: number },
  ) => Promise<string>;
};
`;

const SYS_FS_CONTRACT = `/**
 * sys/fs — asynchronous filesystem access backed by the construct VFS.
 */

export declare const promises: {
  readFile: (
    path: string,
    encoding?: string,
  ) => Promise<string | Uint8Array>;
  writeFile: (path: string, data: string | Uint8Array) => Promise<void>;
  readdir: (path: string) => Promise<string[]>;
  stat: (
    path: string,
  ) => Promise<{
    size: number;
    isFile: () => boolean;
    isDirectory: () => boolean;
  }>;
  unlink: (path: string) => Promise<void>;
  mkdir: (path: string) => Promise<void>;
};
`;

const NODE_PATH_CONTRACT = `/**
 * node:path — POSIX path helpers available inside preview code.
 */

export declare function join(...paths: string[]): string;
export declare function resolve(...paths: string[]): string;
export declare function basename(path: string, ext?: string): string;
export declare function dirname(path: string): string;
export declare function extname(path: string): string;
export declare function normalize(path: string): string;
export declare function isAbsolute(path: string): boolean;
export declare function relative(from: string, to: string): string;
export declare function parse(path: string): {
  root: string;
  dir: string;
  base: string;
  ext: string;
  name: string;
};
export declare function format(pathObject: {
  root?: string;
  dir?: string;
  base?: string;
  ext?: string;
  name?: string;
}): string;
export declare const sep: string;
export declare const delimiter: string;
`;

const NODE_BUFFER_CONTRACT = `/**
 * node:buffer — Buffer helpers for binary data.
 */

export declare class Buffer {
  static from(data: string | ArrayBuffer | Uint8Array, encoding?: string): Buffer;
  static alloc(size: number, fill?: number): Buffer;
  static isBuffer(obj: unknown): obj is Buffer;
  static concat(list: Buffer[]): Buffer;
  toString(encoding?: string): string;
  readonly length: number;
  slice(start?: number, end?: number): Buffer;
}
`;

const NODE_URL_CONTRACT = `/**
 * node:url — URL and URLSearchParams primitives.
 */

export declare class URL {
  constructor(input: string, base?: string);
  readonly href: string;
  readonly origin: string;
  readonly protocol: string;
  readonly hostname: string;
  readonly port: string;
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
  readonly searchParams: URLSearchParams;
  toString(): string;
}

export declare class URLSearchParams {
  constructor(init?: string | Record<string, string>);
  get(name: string): string | null;
  set(name: string, value: string): void;
  append(name: string, value: string): void;
  delete(name: string): void;
  has(name: string): boolean;
  toString(): string;
  entries(): IterableIterator<[string, string]>;
}
`;

const NODE_CRYPTO_CONTRACT = `/**
 * node:crypto — sandbox-safe cryptographic helpers.
 */

export declare function randomUUID(): string;
export declare function randomBytes(size: number): Buffer;
export declare function createHash(algorithm: string): {
  update(data: string): { digest(encoding: string): string };
};
`;

const NODE_ASSERT_CONTRACT = `/**
 * node:assert — assertion helpers for preview code.
 */

declare function assert(value: unknown, message?: string): asserts value;

declare namespace assert {
  function ok(value: unknown, message?: string): asserts value;
  function strictEqual<T>(
    actual: unknown,
    expected: T,
    message?: string,
  ): asserts actual is T;
  function notStrictEqual(
    actual: unknown,
    expected: unknown,
    message?: string,
  ): void;
  function deepStrictEqual(
    actual: unknown,
    expected: unknown,
    message?: string,
  ): void;
  function throws(fn: () => void, message?: string): void;
}

export default assert;
`;

const NODE_QUERYSTRING_CONTRACT = `/**
 * node:querystring — query-string parsing helpers.
 */

export declare function parse(
  str: string,
): Record<string, string | string[]>;
export declare function stringify(
  obj: Record<string, string | number | boolean>,
): string;
export declare function escape(str: string): string;
export declare function unescape(str: string): string;
`;

const NODE_OS_CONTRACT = `/**
 * node:os — construct-scoped operating-system metadata.
 */

export declare function platform(): string;
export declare function hostname(): string;
export declare function tmpdir(): string;
export declare function homedir(): string;
export declare function type(): string;
export declare function arch(): string;
export declare const EOL: string;
`;

const NODE_EVENTS_CONTRACT = `/**
 * node:events — EventEmitter implementation for preview code.
 */

export declare class EventEmitter {
  on(event: string, listener: (...args: unknown[]) => void): this;
  once(event: string, listener: (...args: unknown[]) => void): this;
  off(event: string, listener: (...args: unknown[]) => void): this;
  emit(event: string, ...args: unknown[]): boolean;
  removeAllListeners(event?: string): this;
  listenerCount(event: string): number;
}
`;

const NODE_UTIL_CONTRACT = `/**
 * node:util — lightweight utility helpers.
 */

export declare function inspect(
  value: unknown,
  options?: { depth?: number; colors?: boolean },
): string;
export declare function format(fmt: string, ...args: unknown[]): string;
export declare function promisify<T>(
  fn: (...args: [...unknown[], (err: Error | null, result: T) => void]) => void,
): (...args: unknown[]) => Promise<T>;
`;

const systemStaticPackageDefinitions = [
  {
    specifier: 'sys',
    description: 'Command dispatch for the construct runtime',
    readme: `# sys

Dispatches registered computer commands from preview code.

Use this when you want the runtime to validate arguments and run a named command such as read, write, cron, or pm.

- Import with 'import { command } from "sys"'
- Commands are registered by the host before preview execution starts
- Command docs are available separately under the command capability directories loaded into context
`,
    contractSource: SYS_CONTRACT,
    createExports: ({ globals }) => ({ command: globals.command }),
  },
  {
    specifier: 'sys/ai',
    description: 'Lightweight LLM SDK for preview code',
    readme: `# sys/ai

Model-backed helpers for extraction, search, and generation from preview code.

Use this only when the preview itself needs model reasoning as part of the workflow. The host enforces the configured provider and budget.
`,
    contractSource: SYS_AI_CONTRACT,
    createExports: ({ aiSdkConfig }) => ({
      ai: createAiSdk(aiSdkConfig ?? {}),
    }),
  },
  {
    specifier: 'sys/fs',
    description: 'Virtual filesystem API backed by the construct VFS',
    readme: `# sys/fs

Asynchronous filesystem access backed by the construct virtual filesystem.

This is not the host machine filesystem. Paths such as /agent/home/... and /logs/... refer to the construct state visible inside preview execution.

Use sys/fs when direct file reads and writes are more natural than command('read', ...) or command('write', ...).
`,
    contractSource: SYS_FS_CONTRACT,
    createExports: ({ fs }) => withDefaultExport(createOverlayFsProxy(fs)),
  },
  {
    specifier: 'node:path',
    description: 'POSIX path utilities',
    readme: `# node:path

Pure path helpers for construct paths.

These functions operate on strings only. They do not touch the filesystem.
`,
    contractSource: NODE_PATH_CONTRACT,
    createExports: () => nodePathProxy,
  },
  {
    specifier: 'node:buffer',
    description: 'Buffer utilities for binary data',
    readme: `# node:buffer

Buffer helpers for binary encodings and byte-oriented work inside preview code.
`,
    contractSource: NODE_BUFFER_CONTRACT,
    createExports: () => nodeBufferProxy,
  },
  {
    specifier: 'node:url',
    description: 'URL and URLSearchParams primitives',
    readme: `# node:url

URL parsing and construction helpers.
`,
    contractSource: NODE_URL_CONTRACT,
    createExports: () => nodeUrlProxy,
  },
  {
    specifier: 'node:crypto',
    description: 'Sandbox-safe cryptographic helpers',
    readme: `# node:crypto

Cryptographic helpers exposed to preview code.
`,
    contractSource: NODE_CRYPTO_CONTRACT,
    createExports: () => nodeCryptoProxy,
  },
  {
    specifier: 'node:assert',
    description: 'Assertion utilities',
    readme: `# node:assert

Assertion helpers for validating assumptions inside preview code.
`,
    contractSource: NODE_ASSERT_CONTRACT,
    createExports: () => nodeAssertProxy,
  },
  {
    specifier: 'node:querystring',
    description: 'Query-string parsing helpers',
    readme: `# node:querystring

Helpers for parsing and serializing URL query strings.
`,
    contractSource: NODE_QUERYSTRING_CONTRACT,
    createExports: () => nodeQuerystringProxy,
  },
  {
    specifier: 'node:os',
    description: 'Construct-scoped operating-system metadata',
    readme: `# node:os

Construct-scoped platform metadata.

Values describe the construct sandbox, not the host machine running the service.
`,
    contractSource: NODE_OS_CONTRACT,
    createExports: () => nodeOsProxy,
  },
  {
    specifier: 'node:events',
    description: 'EventEmitter implementation',
    readme: `# node:events

EventEmitter helpers for preview code.
`,
    contractSource: NODE_EVENTS_CONTRACT,
    createExports: () => nodeEventsProxy,
  },
  {
    specifier: 'node:util',
    description: 'Utility functions',
    readme: `# node:util

Utility helpers such as inspect, format, and promisify.
`,
    contractSource: NODE_UTIL_CONTRACT,
    createExports: () => nodeUtilProxy,
  },
] satisfies ReadonlyArray<SystemStaticPackageDefinition>;

export function getSystemStaticPackageDefinitions(): ReadonlyArray<SystemStaticPackageDefinition> {
  return systemStaticPackageDefinitions;
}

export function createSystemStaticModuleMap(
  config: SystemStaticPackageRuntimeConfig,
): Map<string, Record<string, unknown>> {
  return new Map(
    systemStaticPackageDefinitions.map((definition) => [
      definition.specifier,
      definition.createExports(config),
    ]),
  );
}
