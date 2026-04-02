/**
 * Shared transpilation helpers used by both preview-engine and commit-engine.
 */

/**
 * Transpile TypeScript to JavaScript using Bun's built-in transpiler.
 */
export function transpileTs(code: string): string {
  const transpiler = new Bun.Transpiler({ loader: 'ts' });
  return transpiler.transformSync(code);
}

/**
 * Split transpiled JS into import statements and body code.
 * After Bun.Transpiler, imports are hoisted to the top as clean single-line
 * statements. Everything after the last import is body code.
 */
export function splitImportsAndBody(js: string): {
  imports: string[];
  body: string[];
} {
  const lines = js.split('\n');
  const imports: string[] = [];
  const body: string[] = [];
  let pastImports = false;

  for (const line of lines) {
    if (!pastImports && (line.startsWith('import ') || line.trim() === '')) {
      imports.push(line);
    } else {
      pastImports = true;
      body.push(line);
    }
  }

  return { imports, body };
}

/**
 * Wrap body code in an async IIFE with completion signaling.
 * Imports stay at module scope (no await there).
 * Body goes inside the IIFE (where await is allowed).
 */
export function wrapForSourceTextModule(
  imports: string[],
  body: string[],
): string {
  return [
    ...imports,
    '(async () => {',
    ...body,
    '})().then(() => __resolve()).catch(e => __reject(e));',
  ].join('\n');
}
