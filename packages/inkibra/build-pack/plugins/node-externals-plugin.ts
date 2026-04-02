import type { BunPlugin } from 'bun';

/**
 * List of Node.js-only modules that should be stubbed out in browser builds.
 * These modules are replaced with empty exports to prevent runtime errors.
 */
const NODE_EXTERNALS = [
  'pino',
  'pino-pretty',
  'worker_threads',
  'module',
  'thread-stream',
  'node:worker_threads',
  'node:module',
];

/**
 * Plugin that replaces Node.js-only modules with empty stubs for browser builds.
 *
 * Unlike `external`, this actually resolves the imports to empty modules
 * so browsers don't fail with "Module name does not resolve to a valid URL".
 */
export const nodeExternalsPlugin: BunPlugin = {
  name: 'node-externals-stub',
  setup(build) {
    // Create a filter regex from the externals list
    const filterPattern = new RegExp(
      `^(${NODE_EXTERNALS.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`,
    );

    build.onResolve({ filter: filterPattern }, (args) => {
      return {
        path: args.path,
        namespace: 'node-external-stub',
      };
    });

    build.onLoad({ filter: /.*/, namespace: 'node-external-stub' }, (args) => {
      // Return an empty module with common exports stubbed
      const contents = `
// Stubbed Node.js module: ${args.path}
// This module is not available in browser environments
export default undefined;
export const createRequire = () => () => undefined;
export const pino = () => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => pino(),
});
`;
      return {
        contents,
        loader: 'js',
      };
    });
  },
};
