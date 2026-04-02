import type { CodeFunction } from '@inkibra/ai-flow/codemode/types';
import { contextManagementCommands } from './commands/context-management';
import { cronCommand } from './commands/cron';
import { fileOperationCommands } from './commands/file-ops';
import { pmCommand } from './commands/pm';
import type { AiComputerModule } from './define-module';
import { instantiateModuleCommandStubs } from './module-runtime';
import { getSystemStaticPackageDefinitions } from './system-static-packages';
import type { ArgDef, Command } from './types';

export const CAPABILITY_DOC_EXECUTION_FILES = [
  'README.md',
  'index.d.ts',
] as const;

export const CAPABILITY_DOC_PLANNING_FILES = ['README.md'] as const;

export type CapabilityDocTier = 'system' | 'developer' | 'agent';
export type CapabilityDocKind = 'package' | 'command';

export type ResolvedCapabilityDoc = {
  tier: CapabilityDocTier;
  kind: CapabilityDocKind;
  name: string;
  description: string;
  readme: string;
  contractSource: string;
};

function normalizeCapabilityPath(name: string): string {
  return name
    .split('/')
    .flatMap((segment) => segment.split(':'))
    .filter(Boolean)
    .join('/');
}

function getCapabilityDocDir(doc: ResolvedCapabilityDoc): string {
  const kindDir = doc.kind === 'package' ? 'packages' : 'commands';
  return `/${doc.tier}/${kindDir}/${normalizeCapabilityPath(doc.name)}`;
}

export function materializeCapabilityDocs(
  docs: ReadonlyArray<ResolvedCapabilityDoc>,
): Record<string, string> {
  return Object.fromEntries(
    docs.flatMap((doc) => {
      const dir = getCapabilityDocDir(doc);
      return [
        [`${dir}/README.md`, `${doc.readme.trim()}\n`],
        [`${dir}/index.d.ts`, `${doc.contractSource.trim()}\n`],
      ];
    }),
  );
}

function extractDescriptionFromReadme(
  readme: string,
  fallback: string,
): string {
  const candidate = readme
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('#'));
  return candidate ?? fallback;
}

function renderBindingContract(
  bindings: Record<string, CodeFunction<unknown, unknown, unknown>>,
): string {
  const blocks = Object.entries(bindings).map(([name, binding]) => {
    return [
      '/**',
      ` * ${binding.description}`,
      ' */',
      `export declare const ${name}: ${binding.declaration};`,
    ].join('\n');
  });

  return blocks.length > 0 ? blocks.join('\n\n') : 'export {}';
}

function renderArgDef(def: ArgDef): string {
  const parts = [`type: ${JSON.stringify(def.type)}`];
  if (def.position !== undefined) parts.push(`position: ${def.position}`);
  if (def.flag) parts.push(`flag: ${JSON.stringify(def.flag)}`);
  if (def.required !== undefined) parts.push(`required: ${def.required}`);
  if (def.default !== undefined) {
    parts.push(`default: ${JSON.stringify(def.default)}`);
  }
  if (def.description) {
    parts.push(`description: ${JSON.stringify(def.description)}`);
  }
  return `{ ${parts.join(', ')} }`;
}

function renderCommandContract(command: Command): string {
  const argLines = Object.entries(command.args).map(
    ([name, def]) => `    ${JSON.stringify(name)}: ${renderArgDef(def)},`,
  );

  return [
    '/**',
    ` * ${command.description}`,
    ' */',
    'declare const command: {',
    `  name: ${JSON.stringify(command.name)};`,
    `  description: ${JSON.stringify(command.description)};`,
    '  args: {',
    ...(argLines.length > 0 ? argLines : ['    // no args']),
    '  };',
    '};',
    '',
    'export default command;',
  ].join('\n');
}

function renderCommandUsage(command: Command): string {
  const positional = Object.entries(command.args)
    .filter(([, def]) => def.position !== undefined)
    .sort(([, left], [, right]) => (left.position ?? 0) - (right.position ?? 0))
    .map(([name, def]) => (def.required === false ? `[${name}]` : `<${name}>`));

  const flags = Object.entries(command.args)
    .filter(([, def]) => def.flag)
    .sort(([, left], [, right]) =>
      (left.flag ?? '').localeCompare(right.flag ?? ''),
    )
    .map(([name, def]) => {
      if (!def.flag) return '';
      if (def.type === 'boolean') {
        return `[${def.flag}]`;
      }
      return `[${def.flag} <${name}>]`;
    })
    .filter(Boolean);

  return [command.name, ...positional, ...flags].join(' ');
}

function renderCommandReadme(command: Command): string {
  const authored = command.readme?.trim();
  const lines = [`# ${command.name}`, '', authored ?? command.description, ''];
  lines.push('## Usage', '', `\`${renderCommandUsage(command)}\``, '');

  const argEntries = Object.entries(command.args);
  if (argEntries.length > 0) {
    lines.push('## Arguments', '');
    for (const [name, def] of argEntries) {
      const locator =
        def.position !== undefined ? `position ${def.position}` : def.flag;
      const requirement = def.required === false ? 'optional' : 'required';
      const defaultText =
        def.default !== undefined
          ? `; default ${JSON.stringify(def.default)}`
          : '';
      lines.push(
        `- ${name} (${def.type}, ${locator ?? 'implicit'}, ${requirement}${defaultText}) — ${def.description ?? 'No description provided.'}`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function resolveCapabilityDocsFromModules(
  tier: CapabilityDocTier,
  modules: ReadonlyArray<AiComputerModule<any, any, any, any>>,
): ResolvedCapabilityDoc[] {
  const packageDocs = modules.map((module) => {
    const readme =
      module.readme?.trim() ??
      `# ${module.name}\n\nPublic package surface for ${module.name}.`;

    return {
      tier,
      kind: 'package' as const,
      name: module.name,
      description: extractDescriptionFromReadme(
        readme,
        `Package ${module.name}`,
      ),
      readme,
      contractSource: renderBindingContract(
        module.bindings as Record<
          string,
          CodeFunction<unknown, unknown, unknown>
        >,
      ),
    };
  });

  const commandDocs = instantiateModuleCommandStubs([...modules]).map(
    (command) => ({
      tier,
      kind: 'command' as const,
      name: command.name,
      description: command.description,
      readme: renderCommandReadme(command),
      contractSource: renderCommandContract(command),
    }),
  );

  return [...packageDocs, ...commandDocs];
}

export function resolveCapabilityDocsFromCommands(
  tier: CapabilityDocTier,
  commands: ReadonlyArray<Command<any>>,
): ResolvedCapabilityDoc[] {
  return commands.map((command) => ({
    tier,
    kind: 'command' as const,
    name: command.name,
    description: command.description,
    readme: renderCommandReadme(command),
    contractSource: renderCommandContract(command),
  }));
}

export function resolveSystemCapabilityDocs(): ResolvedCapabilityDoc[] {
  const packageDocs = getSystemStaticPackageDefinitions().map((definition) => ({
    tier: 'system' as const,
    kind: 'package' as const,
    name: definition.specifier,
    description: definition.description,
    readme: definition.readme,
    contractSource: definition.contractSource,
  }));

  const commandDocs = resolveCapabilityDocsFromCommands('system', [
    ...fileOperationCommands,
    ...contextManagementCommands,
    cronCommand,
    pmCommand,
  ]);

  return [...packageDocs, ...commandDocs];
}
