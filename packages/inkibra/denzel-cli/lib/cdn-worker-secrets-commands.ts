import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Argv, CommandModule } from 'yargs';
import type { CdnConfig } from './cdn-worker-secrets.schemas';
import { validateCdnConfig } from './cdn-worker-secrets.schemas';
import {
  readConfigFromStdinOrFile,
  resolveWorkerName,
  run,
  stagePath,
  synthesizeWrangler,
} from './cdn-worker-utils';

export type CdnWorkerSecretsArgs = {
  configFile?: string;
  workerName?: string;
  stageDir?: string;
  dryRun?: boolean;
};

async function runWithStdin(
  cmd: string,
  args: string[],
  stdin: string,
): Promise<void> {
  const proc = Bun.spawn([cmd, ...args], {
    stdin: 'pipe',
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const encoder = new TextEncoder();
  await proc.stdin.write(encoder.encode(stdin));
  proc.stdin.end();

  const exit = await proc.exited;
  if (exit !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
  }
}

type PutWranglerSecretArgs = {
  secretName: string;
  secretValue: string;
  configPath: string;
  workerName: string;
};

async function putWranglerSecret({
  secretName,
  secretValue,
  configPath,
  workerName,
}: PutWranglerSecretArgs): Promise<void> {
  console.log(`Setting ${secretName}...`);
  await runWithStdin(
    'wrangler',
    ['secret', 'put', secretName, '--config', configPath, '--name', workerName],
    secretValue,
  );
}

export const cdnWorkerSecretsCommands: CommandModule<
  object,
  CdnWorkerSecretsArgs
> = {
  command: 'cdn-workers set-secrets',
  describe: 'Set CDN worker secrets from CDN_CONFIG environment variable',
  builder: (y: Argv<object>) =>
    y
      .option('config-file', {
        type: 'string',
        describe: 'CDN worker config file (or pipe JSON to stdin)',
      })
      .option('worker-name', { type: 'string' })
      .option('stage-dir', { type: 'string' })
      .option('dry-run', {
        type: 'boolean',
        default: false,
        describe:
          'Print the derived settings without updating wrangler secrets',
      }),
  handler: async (args: CdnWorkerSecretsArgs) => {
    const workerName = resolveWorkerName(args.workerName);

    // Read CDN_CONFIG from environment
    const cdnConfigEnv = process.env.CDN_CONFIG;
    if (!cdnConfigEnv) {
      throw new Error(
        'CDN_CONFIG environment variable is required. Expected JSON with signingIssuer and signingSecret.',
      );
    }

    let parsedConfig: unknown;
    try {
      parsedConfig = JSON.parse(cdnConfigEnv) as unknown;
    } catch (error) {
      throw new Error(
        `Failed to parse CDN_CONFIG as JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const validation = validateCdnConfig(parsedConfig);
    if (!validation.success) {
      const errors = validation.errors
        .map((err) => (typeof err === 'string' ? err : JSON.stringify(err)))
        .slice(0, 5)
        .join('\n  ');
      const moreErrors =
        validation.errors.length > 5
          ? `\n  ... and ${validation.errors.length - 5} more errors`
          : '';
      throw new Error(
        `CDN_CONFIG must contain both signingIssuer and signingSecret fields.\n  ${errors}${moreErrors}`,
      );
    }
    const cdnConfig: CdnConfig = validation.data;

    // Read worker config to generate wrangler.toml (needed for --config flag)
    const config = await readConfigFromStdinOrFile(args.configFile);

    const stageDir = stagePath(args.stageDir || undefined);
    mkdirSync(stageDir, { recursive: true });

    const wranglerToml = synthesizeWrangler(workerName, config);
    const configPath = join(stageDir, 'wrangler.toml');
    writeFileSync(configPath, wranglerToml, 'utf8');

    if (args.dryRun) {
      console.log(`DRY RUN: would set secrets for worker "${workerName}"`);
      console.log(`- signingIssuer: ${cdnConfig.signingIssuer}`);
      console.log(
        `- signingSecret length: ${cdnConfig.signingSecret.length} characters`,
      );
      console.log(`- wrangler config path: ${configPath}`);
      console.log('No secrets were updated.');
      try {
        await run('rm', ['-rf', stageDir]);
      } catch {
        // ignore cleanup failures
      }
      return;
    }

    console.log(`Setting secrets for worker: ${workerName}`);

    const secrets = [
      { name: 'CDN_SIGNATURE_SECRET', value: cdnConfig.signingSecret },
      { name: 'CDN_SIGNATURE_ISSUER', value: cdnConfig.signingIssuer },
    ];
    for (const secret of secrets) {
      await putWranglerSecret({
        secretName: secret.name,
        secretValue: secret.value,
        configPath,
        workerName,
      });
    }

    console.log('✓ CDN worker secrets set successfully');

    // Cleanup
    try {
      await run('rm', ['-rf', stageDir]);
    } catch {
      // Ignore cleanup errors
    }
  },
};
