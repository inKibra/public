/**
 * Node built-in proxy modules for the sandbox.
 *
 * These are pure-JS reimplementations of node:path, node:buffer, etc.
 * that are safe to expose inside the sandboxed vm context.
 *
 * See spec §13.
 */

// ---------------------------------------------------------------------------
// node:path (Tier 1 — §13)
// ---------------------------------------------------------------------------

const POSIX_SEP = '/';

function join(...parts: string[]): string {
  return normalize(parts.join('/'));
}

function normalize(p: string): string {
  const isAbsolutePath = p.startsWith('/');
  const segments = p.split('/').filter(Boolean);
  const resolved: string[] = [];

  for (const seg of segments) {
    if (seg === '..') {
      resolved.pop();
    } else if (seg !== '.') {
      resolved.push(seg);
    }
  }

  const result = resolved.join('/');
  return isAbsolutePath ? `/${result}` : result || '.';
}

function resolve(...parts: string[]): string {
  let resolved = '';
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]!;
    resolved = resolved ? `${part}/${resolved}` : part;
    if (part.startsWith('/')) break;
  }
  if (!resolved.startsWith('/')) {
    resolved = `/${resolved}`;
  }
  return normalize(resolved);
}

function basename(p: string, ext?: string): string {
  const base = p.split('/').pop() ?? p;
  if (ext && base.endsWith(ext)) {
    return base.slice(0, -ext.length);
  }
  return base;
}

function dirname(p: string): string {
  const parts = p.split('/');
  parts.pop();
  return parts.join('/') || '/';
}

function extname(p: string): string {
  const base = p.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot) : '';
}

function isAbsolute(p: string): boolean {
  return p.startsWith('/');
}

function parse(p: string): {
  root: string;
  dir: string;
  base: string;
  ext: string;
  name: string;
} {
  const dir = dirname(p);
  const base = basename(p);
  const ext = extname(p);
  const name = ext ? base.slice(0, -ext.length) : base;
  return {
    root: p.startsWith('/') ? '/' : '',
    dir,
    base,
    ext,
    name,
  };
}

function format(pathObj: {
  root?: string;
  dir?: string;
  base?: string;
  name?: string;
  ext?: string;
}): string {
  const dir = pathObj.dir ?? pathObj.root ?? '';
  const base = pathObj.base ?? `${pathObj.name ?? ''}${pathObj.ext ?? ''}`;
  return dir ? `${dir}/${base}` : base;
}

function relative(from: string, to: string): string {
  const fromParts = resolve(from).split('/').filter(Boolean);
  const toParts = resolve(to).split('/').filter(Boolean);

  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common] === toParts[common]
  ) {
    common++;
  }

  const ups = fromParts.length - common;
  const downs = toParts.slice(common);
  const parts = [...Array(ups).fill('..'), ...downs];
  return parts.join('/') || '.';
}

export const nodePathProxy: Record<string, unknown> = {
  join,
  resolve,
  normalize,
  basename,
  dirname,
  extname,
  isAbsolute,
  parse,
  format,
  relative,
  sep: POSIX_SEP,
};

// ---------------------------------------------------------------------------
// node:buffer (Tier 1 — §13)
// ---------------------------------------------------------------------------

export const nodeBufferProxy: Record<string, unknown> = {
  Buffer: typeof Buffer !== 'undefined' ? Buffer : undefined,
};

// ---------------------------------------------------------------------------
// node:url (Tier 2 — §13)
// ---------------------------------------------------------------------------

export const nodeUrlProxy: Record<string, unknown> = {
  URL,
  URLSearchParams,
};

// ---------------------------------------------------------------------------
// node:assert (Tier 2 — §13)
// ---------------------------------------------------------------------------

function assert(value: unknown, message?: string): asserts value {
  if (!value) {
    throw new Error(message ?? `Assertion failed: ${String(value)}`);
  }
}

assert.ok = assert;

assert.strictEqual = (actual: unknown, expected: unknown, message?: string) => {
  if (actual !== expected) {
    throw new Error(
      message ?? `Expected ${String(expected)} but got ${String(actual)}`,
    );
  }
};

assert.deepStrictEqual = (
  actual: unknown,
  expected: unknown,
  message?: string,
) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      message ??
        `Deep equality failed:\n  actual: ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`,
    );
  }
};

assert.notStrictEqual = (
  actual: unknown,
  expected: unknown,
  message?: string,
) => {
  if (actual === expected) {
    throw new Error(
      message ?? `Expected ${String(actual)} to not equal ${String(expected)}`,
    );
  }
};

assert.throws = (fn: () => void, _expected?: unknown, message?: string) => {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(message ?? 'Expected function to throw');
};

export const nodeAssertProxy: Record<string, unknown> = {
  default: assert,
  ok: assert.ok,
  strictEqual: assert.strictEqual,
  deepStrictEqual: assert.deepStrictEqual,
  notStrictEqual: assert.notStrictEqual,
  throws: assert.throws,
};

// ---------------------------------------------------------------------------
// node:querystring (Tier 2 — §13)
// ---------------------------------------------------------------------------

function qsParse(str: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const pair of str.split('&')) {
    const [key, value] = pair.split('=').map(decodeURIComponent);
    if (!key) continue;
    const existing = result[key];
    if (existing !== undefined) {
      result[key] = Array.isArray(existing)
        ? [...existing, value ?? '']
        : [existing, value ?? ''];
    } else {
      result[key] = value ?? '';
    }
  }
  return result;
}

function qsStringify(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .flatMap(([key, value]) => {
      if (Array.isArray(value)) {
        return value.map(
          (v) => `${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`,
        );
      }
      return `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`;
    })
    .join('&');
}

export const nodeQuerystringProxy: Record<string, unknown> = {
  parse: qsParse,
  stringify: qsStringify,
  encode: qsStringify,
  decode: qsParse,
};

// ---------------------------------------------------------------------------
// node:os (Tier 2 — §13, sandboxed stubs)
// ---------------------------------------------------------------------------

export const nodeOsProxy: Record<string, unknown> = {
  EOL: '\n',
  platform: () => 'linux',
  arch: () => 'x64',
  homedir: () => '/home/sandbox',
  tmpdir: () => '/tmp',
  hostname: () => 'sandbox',
  type: () => 'Linux',
  cpus: () => [{ model: 'sandbox', speed: 0 }],
  totalmem: () => 0,
  freemem: () => 0,
};

// ---------------------------------------------------------------------------
// node:events (Tier 2 — §13)
// ---------------------------------------------------------------------------

class SandboxEventEmitter {
  private _listeners: Record<string, Array<(...args: unknown[]) => void>> = {};

  on(event: string, listener: (...args: unknown[]) => void): this {
    if (!this._listeners[event]) {
      this._listeners[event] = [];
    }
    this._listeners[event].push(listener);
    return this;
  }

  once(event: string, listener: (...args: unknown[]) => void): this {
    const wrapped = (...args: unknown[]) => {
      this.off(event, wrapped);
      listener(...args);
    };
    return this.on(event, wrapped);
  }

  off(event: string, listener: (...args: unknown[]) => void): this {
    const arr = this._listeners[event];
    if (arr) {
      this._listeners[event] = arr.filter((l) => l !== listener);
    }
    return this;
  }

  emit(event: string, ...args: unknown[]): boolean {
    const arr = this._listeners[event];
    if (!arr?.length) return false;
    for (const listener of arr) {
      listener(...args);
    }
    return true;
  }

  removeAllListeners(event?: string): this {
    if (event) {
      delete this._listeners[event];
    } else {
      this._listeners = {};
    }
    return this;
  }

  listenerCount(event: string): number {
    return this._listeners[event]?.length ?? 0;
  }
}

export const nodeEventsProxy: Record<string, unknown> = {
  EventEmitter: SandboxEventEmitter,
  default: SandboxEventEmitter,
};

// ---------------------------------------------------------------------------
// node:util (Tier 2 — §13, expanded)
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: required for promisify compatibility
type AnyFunction = (...args: any[]) => any;

function utilFormat(fmt: string, ...args: unknown[]): string {
  let i = 0;
  return fmt.replace(/%[sdjifoO%]/g, (match) => {
    if (match === '%%') return '%';
    if (i >= args.length) return match;
    const arg = args[i++];
    switch (match) {
      case '%s':
        return String(arg);
      case '%d':
      case '%i':
        return String(Number(arg));
      case '%f':
        return String(Number(arg));
      case '%j':
        return JSON.stringify(arg);
      case '%o':
      case '%O':
        return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
      default:
        return match;
    }
  });
}

function utilPromisify(fn: AnyFunction): AnyFunction {
  return (...args: unknown[]) =>
    new Promise((resolve, reject) => {
      fn(...args, (err: unknown, result: unknown) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
}

const utilTypes = {
  isDate: (value: unknown): value is Date => value instanceof Date,
  isRegExp: (value: unknown): value is RegExp => value instanceof RegExp,
  isArray: Array.isArray,
};

const nodeUtil = require('node:util');

export const nodeUtilProxy: Record<string, unknown> = {
  inspect: nodeUtil.inspect,
  format: utilFormat,
  promisify: utilPromisify,
  types: utilTypes,
};

// ---------------------------------------------------------------------------
// node:crypto (Tier 2 — §13, wraps WebCrypto)
// ---------------------------------------------------------------------------

export const nodeCryptoProxy: Record<string, unknown> = {
  randomUUID: () => crypto.randomUUID(),
  randomBytes: (size: number) => {
    const buf = new Uint8Array(size);
    crypto.getRandomValues(buf);
    return Buffer.from(buf);
  },
  createHash: (algorithm: string) => {
    const data: Uint8Array[] = [];
    return {
      update(input: string | Uint8Array) {
        data.push(
          typeof input === 'string' ? new TextEncoder().encode(input) : input,
        );
        return this;
      },
      async digest(encoding?: string) {
        const algoMap: Record<string, string> = {
          sha256: 'SHA-256',
          sha384: 'SHA-384',
          sha512: 'SHA-512',
          'sha-256': 'SHA-256',
          'sha-384': 'SHA-384',
          'sha-512': 'SHA-512',
        };
        const webAlgo = algoMap[algorithm.toLowerCase()];
        if (!webAlgo) {
          throw new Error(
            `Unsupported hash algorithm: ${algorithm}. Use sha256, sha384, or sha512.`,
          );
        }
        const totalLen = data.reduce((sum, d) => sum + d.length, 0);
        const merged = new Uint8Array(totalLen);
        let offset = 0;
        for (const d of data) {
          merged.set(d, offset);
          offset += d.length;
        }
        const hashBuf = await crypto.subtle.digest(webAlgo, merged);
        const hashArr = new Uint8Array(hashBuf);
        if (encoding === 'hex') {
          return Array.from(hashArr)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
        }
        if (encoding === 'base64') {
          return btoa(String.fromCharCode(...hashArr));
        }
        return Buffer.from(hashArr);
      },
    };
  },
};
