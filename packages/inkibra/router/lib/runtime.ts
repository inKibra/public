import { StatusCode } from '../constants/status-code';
import type { ApiRouteImplementations } from './app-route';
import { SerializableResult } from './result';
import type { MatchedBranch, MatchResult } from './route-matcher';

type LoadOptions = {
  apiImplementations?: ApiRouteImplementations<any>;
  readContext?: (...args: any[]) => Promise<unknown> | unknown;
  readContextResult?: (...args: any[]) => Promise<unknown> | unknown;
};

/**
 * Convert a runtime error to a SerializableResult error
 */
function runtimeErrorToResult(
  err: unknown,
): SerializableResult<unknown, unknown> {
  const message = err instanceof Error ? err.message : String(err);
  return SerializableResult.toErr(
    { type: 'RuntimeError', message },
    StatusCode.INTERNAL_SERVER_ERROR,
  );
}

export async function loadMatchedBranches(
  match: MatchResult,
  options: LoadOptions = {},
): Promise<LoaderResult[]> {
  const results: LoaderResult[] = [];
  const tasks: Promise<void>[] = [];

  // Handle root page loader
  if (match.root) {
    // biome-ignore lint/suspicious/noExplicitAny: runtime type access
    const rootPage = (match.root.node as any).__page;
    if (rootPage?.loader?.load) {
      tasks.push(
        (async () => {
          try {
            const ctx =
              // biome-ignore lint/suspicious/noExplicitAny: runtime type access
              (await options.readContext?.()) ?? (rootPage as any).__ctx ?? {};
            const ctxResult = (await options.readContextResult?.()) ?? {};
            const apiImpl =
              // biome-ignore lint/suspicious/noExplicitAny: runtime type access
              (options.apiImplementations as any) ?? rootPage.apiRoutes ?? {};
            const res = await rootPage.loader.load(apiImpl, {
              params: {},
              query: {},
              ctx,
              ctxResult,
            });
            results.push({
              key: buildKey(match.root!.pattern, match.root!.outletPath),
              pattern: match.root!.pattern,
              outletPath: match.root!.outletPath,
              result: res,
            });
          } catch (err) {
            results.push({
              key: buildKey(match.root!.pattern, match.root!.outletPath),
              pattern: match.root!.pattern,
              outletPath: match.root!.outletPath,
              result: runtimeErrorToResult(err),
            });
          }
        })(),
      );
    }
  }

  function walk(branch: MatchedBranch | null) {
    if (!branch) return;
    if (branch.kind === 'leaf') {
      // biome-ignore lint/suspicious/noExplicitAny: runtime type access
      const page = branch.node.__page as any;
      if (page?.loader?.load) {
        tasks.push(
          (async () => {
            try {
              const ctx =
                // biome-ignore lint/suspicious/noExplicitAny: runtime type access
                (await options.readContext?.()) ?? (page as any).__ctx ?? {};
              const ctxResult = (await options.readContextResult?.()) ?? {};
              const apiImpl =
                // biome-ignore lint/suspicious/noExplicitAny: runtime type access
                (options.apiImplementations as any) ?? page.apiRoutes ?? {};
              const res = await page.loader.load(apiImpl, {
                params: branch.params,
                query: branch.query,
                ctx,
                ctxResult,
              });
              results.push({
                key: buildKey(branch.pattern, branch.outletPath),
                pattern: branch.pattern,
                outletPath: branch.outletPath,
                result: res,
              });
            } catch (err) {
              results.push({
                key: buildKey(branch.pattern, branch.outletPath),
                pattern: branch.pattern,
                outletPath: branch.outletPath,
                result: runtimeErrorToResult(err),
              });
            }
          })(),
        );
      }
    } else {
      // biome-ignore lint/suspicious/noExplicitAny: runtime type access
      const page = branch.node.__page as any;
      if (page?.loader?.load) {
        tasks.push(
          (async () => {
            try {
              const ctx =
                // biome-ignore lint/suspicious/noExplicitAny: runtime type access
                (await options.readContext?.()) ?? (page as any).__ctx ?? {};
              const ctxResult = (await options.readContextResult?.()) ?? {};
              const apiImpl =
                // biome-ignore lint/suspicious/noExplicitAny: runtime type access
                (options.apiImplementations as any) ?? page.apiRoutes ?? {};
              const res = await page.loader.load(apiImpl, {
                params: branch.params,
                query: branch.query,
                ctx,
                ctxResult,
              });
              results.push({
                key: buildKey(branch.pattern, branch.outletPath),
                pattern: branch.pattern,
                outletPath: branch.outletPath,
                result: res,
              });
            } catch (err) {
              results.push({
                key: buildKey(branch.pattern, branch.outletPath),
                pattern: branch.pattern,
                outletPath: branch.outletPath,
                result: runtimeErrorToResult(err),
              });
            }
          })(),
        );
      }
      for (const child of Object.values(branch.outlets)) {
        walk(child);
      }
    }
  }

  for (const outlet of Object.values(match.outlets)) {
    walk(outlet);
  }

  await Promise.all(tasks);
  return results;
}

export type LoaderResult = {
  key: string;
  pattern: string;
  outletPath: string[];
  /** The SerializableResult from the loader (or a RuntimeError result if loader threw) */
  result: SerializableResult<unknown, unknown>;
};

function buildKey(pattern: string, outletPath: string[]): string {
  const outletPart = outletPath.length ? `::${outletPath.join('.')}` : '';
  return `${pattern}${outletPart}`;
}
