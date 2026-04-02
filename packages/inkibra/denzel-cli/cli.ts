#!/usr/bin/env bun

import type { ArgumentsCamelCase } from 'yargs';
import { hideBin } from 'yargs/helpers';
import yargs from 'yargs/yargs';
import type { CdnWorkerArgs } from './lib/cdn-worker-commands';
import type { CdnWorkerSecretsArgs } from './lib/cdn-worker-secrets-commands';
import type { MigrationWorkerArgs } from './lib/migration-worker-commands';

type CdnWorkerSecretsCliArgs = ArgumentsCamelCase<
  CdnWorkerSecretsArgs & { action: 'set-secrets' }
>;
type CdnWorkerCliArgs = ArgumentsCamelCase<CdnWorkerArgs>;
type CdnWorkersCommandArgs = CdnWorkerSecretsCliArgs | CdnWorkerCliArgs;

const cdnWorkerActionChoices = [
  'deploy',
  'tail',
  'dry-run',
  'set-secrets',
] as const;

const isSetSecretsArgs = (
  args: CdnWorkersCommandArgs,
): args is CdnWorkerSecretsCliArgs => args.action === 'set-secrets';

import { secretsCommands } from './lib/secrets-commands';
import { commands } from './lib/site-assets';
import { runWizard } from './lib/wizard';

const parser = yargs(hideBin(process.argv))
  .scriptName('inkibra-denzel')
  .usage('$0 <cmd> [args]')
  .strictCommands()
  .option('interactive', { type: 'boolean' })
  .option('yes', {
    type: 'boolean',
    describe: 'Auto-confirm prompts in interactive mode',
  })
  // Top-level wizard shortcut
  .command(
    'wizard',
    'Interactive wizard for favicon upload and worker deploy',
    () => {},
    async (args) => {
      const interactive = args.interactive ?? process.stdout.isTTY;
      if (!interactive) {
        console.error(
          'Wizard requires interactive terminal. Use non-interactive subcommands.',
        );
        process.exit(2);
      }
      await runWizard({ autoYes: Boolean(args.yes) });
    },
  )
  // Grouped commands under site-assets
  .command(
    'site-assets <subcmd>',
    'Manage site assets (favicons) and worker',
    (y) =>
      y
        .command(
          'wizard',
          'Interactive wizard for favicon upload and worker deploy',
          () => {},
          async (args) => {
            const interactive = args.interactive ?? process.stdout.isTTY;
            if (!interactive) {
              console.error(
                'Wizard requires interactive terminal. Use non-interactive subcommands.',
              );
              process.exit(2);
            }
            await runWizard({ autoYes: Boolean(args.yes) });
          },
        )
        .command(secretsCommands)
        .command(commands.upload)
        .command(commands.jsx)
        .command(commands.mappings)
        .command(commands.worker)
        .demandCommand(1),
    () => {},
  )
  .command<CdnWorkersCommandArgs>(
    'cdn-workers <action>',
    'Deploy/manage CDN workers via Wrangler',
    (y) =>
      y
        .positional('action', {
          type: 'string',
          choices: cdnWorkerActionChoices,
        })
        .option('config-file', { type: 'string' })
        .option('worker-name', { type: 'string' })
        .option('record-package', { type: 'string' })
        .option('stage-dir', { type: 'string' })
        .option('keep-stage', { type: 'boolean', default: false })
        .option('dry-run', {
          type: 'boolean',
          default: false,
          describe:
            'Print the derived settings without updating wrangler secrets',
        }),
    async (args) => {
      if (isSetSecretsArgs(args)) {
        const { cdnWorkerSecretsCommands } = await import(
          './lib/cdn-worker-secrets-commands'
        );
        await cdnWorkerSecretsCommands.handler(args);
        return;
      }

      const { cdnWorkerCommands } = await import('./lib/cdn-worker-commands');
      await cdnWorkerCommands.handler(args);
    },
  )
  .command(
    'site-asset-worker <action>',
    'Deploy/manage site asset worker (multi-origin with stale-while-revalidate)',
    (y) =>
      y
        .positional('action', {
          type: 'string',
          choices: ['deploy', 'tail', 'dry-run'] as const,
        })
        .option('config-file', {
          type: 'string',
          description: 'Path to site-asset-worker.json config file',
          demandOption: true,
        })
        .option('stage-dir', { type: 'string' })
        .option('keep-stage', { type: 'boolean', default: false }),
    async (args) => {
      const { runSiteAssetWorkerCli } = await import(
        '@inkibra/build-pack/workers/site-asset-worker/cli'
      );
      const cliArgs = [
        args.action as string,
        '--config-file',
        args.configFile as string,
      ];
      if (args.stageDir) {
        cliArgs.push('--stage-dir', args.stageDir as string);
      }
      if (args.keepStage) {
        cliArgs.push('--keep-stage');
      }
      await runSiteAssetWorkerCli(cliArgs);
    },
  )
  .command<MigrationWorkerArgs>(
    'migration-worker <action>',
    'Deploy/manage GCS-to-R2 migration worker',
    (y) =>
      y
        .positional('action', {
          type: 'string',
          choices: ['deploy', 'tail', 'dry-run', 'set-secret'] as const,
        })
        .option('r2-bucket', {
          type: 'string',
          description: 'R2 bucket name to migrate files into',
        })
        .option('worker-name', {
          type: 'string',
          description: 'Worker name (default: gcs-r2-migration-worker)',
        })
        .option('stage-dir', { type: 'string' })
        .option('keep-stage', { type: 'boolean', default: false })
        .option('secret-value', {
          type: 'string',
          description: 'Secret value for set-secret action',
        }),
    async (args) => {
      const { migrationWorkerCommands } = await import(
        './lib/migration-worker-commands'
      );
      await migrationWorkerCommands.handler(args);
    },
  )
  .demandCommand(1)
  .help();

parser.parse();
