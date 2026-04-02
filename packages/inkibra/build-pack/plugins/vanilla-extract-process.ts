import { createRequire } from 'node:module';
import util from 'node:util';
import zlib from 'node:zlib';
import { transformCss } from '@vanilla-extract/css/transformCss';
import {
  parseFileScope,
  serializeVanillaModule,
  stringifyFileScope,
} from '@vanilla-extract/integration';

const require = createRequire(import.meta.url);
const evalCode = require('eval') as (
  code: string,
  filename: string,
  context: Record<string, unknown>,
  useStrict: boolean,
) => unknown;
const env = process.env as Record<string, string | undefined>;
const originalNodeEnv = env.NODE_ENV;

export type ProcessVanillaFileOptions = {
  source: string;
  filePath: string;
  outputCss?: boolean;
  identOption?: 'short' | 'debug';
  serializeVirtualCssPath?: (args: {
    fileName: string;
    fileScope: { filePath: string; packageName?: string };
    source: string;
  }) => string | Promise<string>;
};

const zip = util.promisify(zlib.gzip);
const compressionThreshold = 1000;
const compressionFlag = '#';

async function serializeCss(source: string) {
  if (source.length > compressionThreshold) {
    const compressedSource = await zip(source);
    return compressionFlag + compressedSource.toString('base64');
  }
  return Buffer.from(source, 'utf-8').toString('base64');
}

export async function processVanillaFile({
  source,
  filePath,
  outputCss = true,
  identOption = 'short',
  serializeVirtualCssPath,
}: ProcessVanillaFileOptions): Promise<string> {
  const cssByFileScope = new Map<string, string[]>();
  const localClassNames = new Set<string>();
  const composedClassLists: Array<{
    identifier: string;
    composedClassList: string;
  }> = [];
  const usedCompositions = new Set<string>();

  const cssAdapter = {
    appendCss: (
      css: string,
      fileScope: { filePath: string; packageName?: string },
    ) => {
      if (outputCss) {
        const serialisedFileScope = stringifyFileScope(fileScope);
        const fileScopeCss = cssByFileScope.get(serialisedFileScope) ?? [];
        fileScopeCss.push(css);
        cssByFileScope.set(serialisedFileScope, fileScopeCss);
      }
    },
    registerClassName: (className: string) => {
      localClassNames.add(className);
    },
    registerComposition: (composedClassList: {
      identifier: string;
      composedClassList: string;
    }) => {
      composedClassLists.push(composedClassList);
    },
    markCompositionUsed: (identifier: string) => {
      usedCompositions.add(identifier);
    },
    onEndFileScope: () => {},
    getIdentOption: () => identOption,
  };

  const currentNodeEnv = env.NODE_ENV;

  env.NODE_ENV = originalNodeEnv;
  const adapterBoundSource = `
    __vanilla_css_adapter__.setAdapter(__adapter__);
    ${source
      .replace(
        /require\(['"]@vanilla-extract\/css\/fileScope['"]\)/g,
        '__vanilla_css_filescope__',
      )
      .replace(
        /require\(['"]@vanilla-extract\/css\/adapter['"]\)/g,
        '__vanilla_css_adapter__',
      )
      .replace(/require\(['"]@vanilla-extract\/css['"]\)/g, '__vanilla_css__')
      .replace(
        /require\(['"]@vanilla-extract\/recipes['"]\)/g,
        '__vanilla_recipes__',
      )
      .replace(
        /require\(['"]@vanilla-extract\/sprinkles['"]\)/g,
        '__vanilla_sprinkles__',
      )}
  `;

  const evalResult = evalCode(
    adapterBoundSource,
    filePath,
    {
      console,
      process,
      __adapter__: cssAdapter,
      __vanilla_css_adapter__: require('@vanilla-extract/css/adapter'),
      __vanilla_css_filescope__: require('@vanilla-extract/css/fileScope'),
      __vanilla_css__: require('@vanilla-extract/css'),
      __vanilla_recipes__: require('@vanilla-extract/recipes'),
      __vanilla_sprinkles__: require('@vanilla-extract/sprinkles'),
    } as Record<string, unknown>,
    true,
  ) as Record<string, unknown>;

  env.NODE_ENV = currentNodeEnv;

  const cssImports: string[] = [];
  for (const [serialisedFileScope, fileScopeCss] of cssByFileScope) {
    const fileScope = parseFileScope(serialisedFileScope);
    const css = (transformCss as (args: any) => string[])({
      localClassNames: Array.from(localClassNames),
      composedClassLists,
      cssObjs: fileScopeCss,
    }).join('\n');

    const fileName = `${fileScope.filePath}.vanilla.css`;
    let virtualCssFilePath: string;

    if (serializeVirtualCssPath) {
      const serializedResult = serializeVirtualCssPath({
        fileName,
        fileScope,
        source: css,
      });
      if (typeof serializedResult === 'string') {
        virtualCssFilePath = serializedResult;
      } else {
        virtualCssFilePath = await serializedResult;
      }
    } else {
      const serializedCss = await serializeCss(css);
      virtualCssFilePath = `import '${fileName}?source=${serializedCss}';`;
    }
    cssImports.push(virtualCssFilePath);
  }

  evalCode(
    `const __ve_adapter__ = typeof __vanilla_css_adapter__ !== 'undefined' && __vanilla_css_adapter__ || require('@vanilla-extract/css/adapter');
    const removeAdapter = __ve_adapter__ && __ve_adapter__.removeAdapter;
    // Backwards compat with older versions of @vanilla-extract/css
    if (removeAdapter) {
      removeAdapter();
    }
  `,
    filePath,
    {
      console,
      process,
      __vanilla_css_adapter__: require('@vanilla-extract/css/adapter'),
    } as Record<string, unknown>,
    true,
  );

  const unusedCompositions = composedClassLists
    .filter(({ identifier }) => !usedCompositions.has(identifier))
    .map(({ identifier }) => identifier);

  const unusedCompositionRegex =
    unusedCompositions.length > 0
      ? RegExp(`(${unusedCompositions.join('|')})\\s`, 'g')
      : null;

  return serializeVanillaModule(cssImports, evalResult, unusedCompositionRegex);
}
