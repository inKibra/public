import type { BunPlugin } from 'bun';
import { transformTypiaSource } from './typia-transform';

const schemaFilter = /(?:\.schemas|(?:^|[/\\])schemas)\.ts$/;

export const loadSchemasPlugin: BunPlugin = {
  name: 'load-schemas-plugin',
  setup(build) {
    build.onLoad({ filter: schemaFilter }, async ({ path }) => {
      const source = await Bun.file(path).text();
      const { code } = transformTypiaSource(path, source, {
        cache: true,
        skipIfNoTypia: true,
      });
      return { contents: code, loader: 'ts' };
    });
  },
};
