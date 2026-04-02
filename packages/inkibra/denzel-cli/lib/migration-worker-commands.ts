import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Argv, CommandModule } from 'yargs';
import { run } from './cdn-worker-utils';
import {
  resolveMigrationWorkerName,
  stagePath,
  synthesizeMigrationWrangler,
} from './migration-worker-utils';

export type MigrationWorkerArgs = {
  action: 'deploy' | 'tail' | 'dry-run' | 'set-secret';
  r2Bucket?: string;
  workerName?: string;
  stageDir?: string;
  keepStage?: boolean;
  secretValue?: string;
};

export const migrationWorkerCommands = {
  command: 'migration-worker <action>',
  describe: 'Deploy/manage GCS-to-R2 migration worker',
  builder: (y: Argv<MigrationWorkerArgs>) =>
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
  handler: async (args: MigrationWorkerArgs) => {
    const workerName = resolveMigrationWorkerName(args.workerName);

    if (args.action === 'tail') {
      await run('wrangler', ['tail', '--name', workerName]);
      return;
    }

    if (args.action === 'set-secret') {
      if (!args.secretValue) {
        throw new Error('--secret-value is required for set-secret action');
      }
      // Set the MIGRATION_SECRET
      const proc = Bun.spawn(
        ['wrangler', 'secret', 'put', 'MIGRATION_SECRET', '--name', workerName],
        {
          stdin: new TextEncoder().encode(args.secretValue),
          stdout: 'inherit',
          stderr: 'inherit',
        },
      );
      const exit = await proc.exited;
      if (exit !== 0) {
        throw new Error('Failed to set secret');
      }
      console.log(`Set MIGRATION_SECRET for worker ${workerName}`);
      return;
    }

    if (!args.r2Bucket) {
      throw new Error('--r2-bucket is required for deploy/dry-run actions');
    }

    const stageDir = stagePath(args.stageDir || undefined);
    mkdirSync(stageDir, { recursive: true });

    const wranglerToml = synthesizeMigrationWrangler(workerName, {
      r2BucketName: args.r2Bucket,
    });
    const configPath = join(stageDir, 'wrangler.toml');
    writeFileSync(configPath, wranglerToml, 'utf8');

    if (args.action === 'dry-run') {
      console.log('Generated wrangler.toml at:', configPath);
      console.log('\n--- wrangler.toml ---');
      console.log(wranglerToml);
      console.log('--- end wrangler.toml ---\n');
      return;
    }

    await run('wrangler', ['deploy', '--config', configPath]);
    console.log('\n--- wrangler.toml ---');
    console.log(wranglerToml);
    console.log('--- end wrangler.toml ---\n');

    console.log(
      '\nIMPORTANT: Set MIGRATION_SECRET using:',
      `\n  bun run denzel-cli migration-worker set-secret --secret-value <your-secret> --worker-name ${workerName}`,
    );

    if (!args.keepStage) {
      try {
        await run('rm', ['-rf', stageDir]);
      } catch {
        // Ignore cleanup errors
      }
    } else {
      console.log('Stage kept at', stageDir);
    }
  },
} as CommandModule<object, MigrationWorkerArgs>;
