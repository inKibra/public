import * as vm from 'node:vm';
import type { OverlayFs } from '@inkibra/ai-flow';
import {
  listVfsCommandSpecs,
  loadVfsSource,
  resolveVfsCommandPath,
  resolveVfsPackagePath,
} from './module-resolver';
import type { Command, CommandRegistry } from './types';

type LinkerModuleMap = Map<string, Record<string, unknown>>;

function lookupStaticModule(
  specifier: string,
  moduleMap: LinkerModuleMap,
): Record<string, unknown> | undefined {
  const direct = moduleMap.get(specifier);
  if (direct) {
    return direct;
  }

  const packageMatch = specifier.match(
    /^\/?(?:developer|agent)\/packages\/([^/]+)/,
  );
  if (packageMatch?.[1]) {
    return moduleMap.get(packageMatch[1]);
  }

  return undefined;
}

export function createVfsModuleLinker(args: {
  moduleMap: LinkerModuleMap;
  context: vm.Context;
  fs: OverlayFs;
}) {
  const cache = new Map<string, vm.Module>();

  const linker = async (specifier: string): Promise<vm.Module> => {
    const cached = cache.get(specifier);
    if (cached) {
      return cached;
    }

    const staticExports = lookupStaticModule(specifier, args.moduleMap);
    if (staticExports) {
      const synth = new vm.SyntheticModule(
        Object.keys(staticExports),
        function (this: vm.SyntheticModule) {
          for (const [name, value] of Object.entries(staticExports)) {
            this.setExport(name, value);
          }
        },
        { context: args.context, identifier: specifier },
      );
      cache.set(specifier, synth);
      return synth;
    }

    const sourcePath =
      (await resolveVfsCommandPath(specifier, args.fs)) ??
      (await resolveVfsPackagePath(specifier, args.fs));
    if (!sourcePath) {
      throw new Error(
        `Module not found: "${specifier}". Available: ${Array.from(args.moduleMap.keys()).join(', ')}`,
      );
    }

    const source = await loadVfsSource(sourcePath, args.fs);
    const sourceModule = new vm.SourceTextModule(source, {
      context: args.context,
      identifier: sourcePath,
    });
    cache.set(specifier, sourceModule);
    await sourceModule.link(linker);
    return sourceModule;
  };

  return linker;
}

function isCommandShape(value: unknown): value is Command<unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.name === 'string' &&
    typeof record.description === 'string' &&
    typeof record.args === 'object' &&
    record.args !== null &&
    typeof record.fn === 'function' &&
    typeof record.render === 'function'
  );
}

export async function registerAgentCommands(args: {
  fs: OverlayFs;
  registry: CommandRegistry;
  linker: (specifier: string) => Promise<vm.Module>;
}): Promise<void> {
  const specs = await listVfsCommandSpecs(args.fs);

  for (const spec of specs) {
    const mod = await args.linker(spec.specifier);
    if (mod.status !== 'evaluated') {
      await mod.evaluate();
    }

    const namespace = mod.namespace as Record<string, unknown>;
    const defaultExport = namespace.default ?? namespace;
    if (!isCommandShape(defaultExport)) {
      throw new Error(
        `Agent command module "${spec.specifier}" must default-export a valid Command`,
      );
    }

    args.registry.register(defaultExport);
  }
}
