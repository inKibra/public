import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type { Argv, CommandModule } from 'yargs';
import type { CdnWorkerDeploymentRecord } from './cdn-worker-config';
import { validateParseCdnWorkerDeploymentRecord } from './cdn-worker-config.schemas';
import {
  readConfigFromStdinOrFile,
  resolveWorkerName,
  run,
  stagePath,
  synthesizeWrangler,
} from './cdn-worker-utils';

export type CdnWorkerArgs = {
  action: 'deploy' | 'tail' | 'dry-run';
  configFile?: string;
  workerName?: string;
  recordPackage?: string;
  stageDir?: string;
  keepStage?: boolean;
};

function writeDeploymentRecord(
  recordPackage: string,
  workerName: string,
): void {
  const recordPath = join(recordPackage, 'workers', 'cdn-worker.json');
  const recordDir = dirname(recordPath);

  // Ensure directory exists
  mkdirSync(recordDir, { recursive: true });

  let existingRecord: CdnWorkerDeploymentRecord = { workers: [] };

  try {
    const recordJson = readFileSync(recordPath, 'utf8');
    const validation = validateParseCdnWorkerDeploymentRecord(recordJson);
    if (validation.success) {
      existingRecord = validation.data;
    }
  } catch {
    // File doesn't exist or is invalid, use default
  }

  // Add worker name if not already present
  if (!existingRecord.workers.includes(workerName)) {
    existingRecord.workers.push(workerName);
  }

  // Write back to file
  writeFileSync(recordPath, JSON.stringify(existingRecord, null, 2), 'utf8');
  console.log(`Updated deployment record at ${recordPath}`);
}

export const cdnWorkerCommands = {
  command: 'cdn-workers <action>',
  describe: 'Deploy/manage CDN workers via Wrangler',
  builder: (y: Argv<CdnWorkerArgs>) =>
    y
      .positional('action', {
        type: 'string',
        choices: ['deploy', 'tail', 'dry-run'] as const,
      })
      .option('config-file', { type: 'string' })
      .option('worker-name', { type: 'string' })
      .option('record-package', { type: 'string' })
      .option('stage-dir', { type: 'string' })
      .option('keep-stage', { type: 'boolean', default: false }),
  handler: async (args: CdnWorkerArgs) => {
    const workerName = resolveWorkerName(args.workerName);

    if (args.action === 'tail') {
      await run('wrangler', ['tail', '--name', workerName]);
      return;
    }

    const config = await readConfigFromStdinOrFile(args.configFile);

    const stageDir = stagePath(args.stageDir || undefined);
    mkdirSync(stageDir, { recursive: true });

    const wranglerToml = synthesizeWrangler(workerName, config);
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
      'Skipping secret syncing; run `cdn-workers set-secrets` separately when needed.',
    );

    // Write deployment record if --record-package provided
    if (args.recordPackage) {
      writeDeploymentRecord(args.recordPackage, workerName);
    }

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
} as CommandModule<object, CdnWorkerArgs>;
