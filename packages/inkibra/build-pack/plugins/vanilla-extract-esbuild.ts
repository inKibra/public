import * as path from 'node:path';
import * as integration from '@vanilla-extract/integration';
import {
  cssFileFilter,
  getSourceFromVirtualCssFile,
} from '@vanilla-extract/integration';
import type { Plugin } from 'esbuild';
import { processVanillaFile } from './vanilla-extract-process';

type VanillaExtractPluginOptions = {
  outputCss?: boolean;
  externals?: string[];
  runtime?: boolean;
  processCss?: (css: string) => string | Promise<string>;
  identifiers?: 'short' | 'debug';
  esbuildOptions?: Parameters<typeof integration.compile>[0]['esbuildOptions'];
};

const vanillaCssNamespace = 'vanilla-extract-css-ns';

export function vanillaExtractPlugin({
  outputCss,
  externals = [],
  runtime = false,
  processCss,
  identifiers,
  esbuildOptions,
}: VanillaExtractPluginOptions = {}): Plugin {
  if (runtime) {
    return integration.vanillaExtractTransformPlugin({
      identOption: identifiers,
    });
  }

  return {
    name: 'vanilla-extract',
    setup(build) {
      build.onResolve({ filter: integration.virtualCssFileFilter }, (args) => {
        return { path: args.path, namespace: vanillaCssNamespace };
      });

      build.onLoad(
        { filter: /.*/, namespace: vanillaCssNamespace },
        async ({ path: virtualPath }) => {
          let { source, fileName } =
            await getSourceFromVirtualCssFile(virtualPath);
          if (typeof processCss === 'function') {
            source = await processCss(source);
          }
          const rootDir = build.initialOptions.absWorkingDir ?? process.cwd();
          const resolveDir = path.dirname(path.join(rootDir, fileName));
          return {
            contents: source,
            loader: 'css',
            resolveDir,
          };
        },
      );

      build.onLoad({ filter: cssFileFilter }, async ({ path: filePath }) => {
        const combinedEsbuildOptions = {
          ...(esbuildOptions ?? {}),
        } as NonNullable<typeof esbuildOptions>;
        const identOption =
          identifiers ?? (build.initialOptions.minify ? 'short' : 'debug');

        if (externals) {
          if (combinedEsbuildOptions.external) {
            combinedEsbuildOptions.external.push(...externals);
          } else {
            combinedEsbuildOptions.external = externals;
          }
        }

        const { source, watchFiles } = await integration.compile({
          filePath,
          cwd: build.initialOptions.absWorkingDir,
          esbuildOptions: combinedEsbuildOptions,
          identOption,
        });

        const contents = await processVanillaFile({
          source,
          filePath,
          outputCss,
          identOption,
        });

        return {
          contents,
          loader: 'js',
          watchFiles,
        };
      });
    },
  };
}
