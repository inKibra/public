import { describe, expect, test } from 'bun:test';
import { codeFunction } from '@inkibra/ai-flow/codemode';
import {
  defineAiComputerModule,
  defineCommand,
} from '@inkibra/ai-sandbox-computer';
import { getInitialLogsContextConfig, getInitialVfsStructure } from './layout';

type ParsedContextFile = {
  stages?: Record<string, { selector?: { include?: string[] } }>;
  lanes?: Record<string, Record<string, { selector?: { include?: string[] } }>>;
};

type ParsedManifest = {
  directories?: string[];
};

function parseYaml<T>(raw: string): T {
  return Bun.YAML.parse(raw) as T;
}

function requireFile(files: Record<string, string>, path: string): string {
  const content = files[path];
  if (!content) throw new Error(`Missing expected file: ${path}`);
  return content;
}

describe('capability context scoping', () => {
  test('adds capability directories to the context manifest', () => {
    const files = getInitialVfsStructure();
    const manifest = parseYaml<ParsedManifest>(
      requireFile(files, '/runtime/handles/context-dirs.yaml'),
    );

    expect(manifest.directories).toContain('/agent/packages/');
    expect(manifest.directories).toContain('/agent/commands/');
    expect(manifest.directories).toContain('/system/commands/');
  });

  test('scopes capability docs to execution and planning stages only', () => {
    const files = getInitialVfsStructure({
      lanes: { conversation: {}, heartbeat: {} },
    });
    const context = parseYaml<ParsedContextFile>(
      requireFile(files, '/system/packages/CONTEXT.yaml'),
    );

    expect(context.stages?.scheduler).toBeUndefined();
    expect(context.stages?.['nap/commit']?.selector?.include).toEqual([
      'README.md',
      'index.d.ts',
    ]);
    expect(context.lanes?.conversation?.impulse?.selector?.include).toEqual([
      'README.md',
      'index.d.ts',
    ]);
    expect(context.lanes?.conversation?.response).toBeUndefined();
    expect(
      context.lanes?.conversation?.['nap/analyze']?.selector?.include,
    ).toEqual(['README.md']);
    expect(
      context.lanes?.conversation?.['nap/propose']?.selector?.include,
    ).toEqual(['README.md']);
  });

  test('exposes the same scoped policy to system commands and agent packages', () => {
    const files = getInitialVfsStructure({ lanes: { conversation: {} } });
    const systemCommands = parseYaml<ParsedContextFile>(
      requireFile(files, '/system/commands/CONTEXT.yaml'),
    );
    const agentPackages = parseYaml<ParsedContextFile>(
      requireFile(files, '/agent/packages/CONTEXT.yaml'),
    );

    expect(systemCommands.lanes?.conversation?.response).toBeUndefined();
    expect(
      agentPackages.lanes?.conversation?.impulse?.selector?.include,
    ).toEqual(['README.md', 'index.d.ts']);
  });

  test('builds a default logs context that creators can extend', () => {
    const context = getInitialLogsContextConfig({
      conversation: {},
      heartbeat: { can_respond_to: ['conversation'] },
    });

    expect(context.stages['nap/commit'].renderer.type).toBe('timeline');
    expect(context.stages['nap/commit'].selector.include).toContain(
      '*.nap.log',
    );
    expect(context.stages.scheduler.selector.include).toEqual([
      '*.conversation.log',
      '*.heartbeat.log',
    ]);
    expect(context.lanes.heartbeat?.response.selector.include).toEqual([
      '*.heartbeat.log',
      '*.conversation.log',
    ]);
    expect(
      context.lanes.conversation?.['nap/analyze'].selector.include,
    ).toEqual(['*.conversation.log', '*.nap.log']);
    expect(context.lanes.conversation?.impulse.renderer.ops?.[0]).toEqual({
      filter: {
        window: '15m',
        where: { lanes: ['this'], item_kinds: ['entry'] },
      },
    });
    expect(context.lanes.conversation?.impulse.renderer.ops?.[2]).toEqual({
      filter: {
        max_items: 50,
        where: { lanes: ['this'], item_kinds: ['entry'] },
      },
    });
  });

  test('derives developer capability docs from configured modules', () => {
    const projectsModule = defineAiComputerModule({
      name: 'projects',
      readme: '# projects\n\nProject planning bindings and command adapters.',
      bindings: {
        listProjects: codeFunction({
          description: 'List known projects',
          declaration: '(params?: { archived?: boolean }) => Promise<string[]>',
          validate: (input: unknown) => ({
            success: true as const,
            data: (input ?? {}) as { archived?: boolean },
          }),
          fn: async () => ['alpha'],
        }),
      },
      commands: [
        defineCommand({
          name: 'project-list',
          description: 'List known projects',
          args: {
            archived: {
              type: 'boolean',
              flag: '--archived',
              description: 'Include archived projects',
            },
          },
          render: () => 'alpha',
          fn: async () => ['alpha'],
        }),
      ],
    });

    const files = getInitialVfsStructure({ modules: [projectsModule] });

    expect(files['/developer/packages/projects/README.md']).toContain(
      'Project planning bindings and command adapters.',
    );
    expect(files['/developer/packages/projects/index.d.ts']).toContain(
      'export declare const listProjects',
    );
    expect(files['/developer/commands/project-list/README.md']).toContain(
      '`project-list [--archived]`',
    );
  });
});
