import type { ArgumentsCamelCase, Argv, CommandModule } from 'yargs';
import {
  deleteSecret,
  getDefaultProject,
  getScopedSecret,
  getSecret,
  mask,
  SECRET_KEYS,
  setScopedSecret,
  setSecret,
} from './secrets';

export type SecretsSetArgs = {
  project?: string;
  endpoint?: string;
  region?: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
};

export type SecretsGetArgs = { project?: string; key?: string; raw?: boolean };
export type SecretsDeleteArgs = {
  project?: string;
  key?: string;
  all?: boolean;
};

const setCmd: CommandModule<object, SecretsSetArgs> = {
  command: 'set',
  describe: 'Set one or more site-assets secrets',
  builder: (y: Argv<SecretsSetArgs>) =>
    y
      .option('project', {
        type: 'string',
        describe: 'Project to scope secrets (defaults to saved project)',
      })
      .option('endpoint', { type: 'string', describe: 'R2 endpoint URL' })
      .option('region', {
        type: 'string',
        describe: 'R2 region (default auto)',
      })
      .option('bucket', {
        type: 'string',
        describe: 'R2 bucket (default site-assets)',
      })
      .option('accessKeyId', { type: 'string', describe: 'R2 access key id' })
      .option('secretAccessKey', {
        type: 'string',
        describe: 'R2 secret access key',
      }),
  handler: async (args) => {
    const project = args.project || (await getDefaultProject()) || undefined;
    const updates: Array<[string, string]> = [];
    if (args.endpoint) updates.push(['SITE_ASSETS_ENDPOINT', args.endpoint]);
    if (args.region) updates.push(['SITE_ASSETS_REGION', args.region]);
    if (args.bucket) updates.push(['SITE_ASSETS_BUCKET', args.bucket]);
    if (args.accessKeyId)
      updates.push(['SITE_ASSETS_ACCESS_KEY_ID', args.accessKeyId]);
    if (args.secretAccessKey)
      updates.push(['SITE_ASSETS_SECRET_ACCESS_KEY', args.secretAccessKey]);
    if (updates.length === 0) {
      console.error(
        'Nothing to update. Pass at least one flag like --endpoint.',
      );
      process.exit(2);
    }
    for (const [k, v] of updates) {
      if (project) {
        await setScopedSecret(project, k as (typeof SECRET_KEYS)[number], v);
      } else {
        await setSecret(k, v);
      }
      console.log(`✓ Set ${k}`);
    }
  },
};

const getCmd: CommandModule<object, SecretsGetArgs> = {
  command: 'get',
  describe: 'Get a secret (masked by default)',
  builder: (y: Argv<SecretsGetArgs>) =>
    y
      .option('project', {
        type: 'string',
        describe: 'Project to read (defaults to saved project)',
      })
      .option('key', { type: 'string' })
      .option('raw', {
        type: 'boolean',
        default: false,
        describe: 'Print raw value (careful: sensitive)',
      }),
  handler: async (args) => {
    const project = args.project || (await getDefaultProject()) || undefined;
    if (args.key) {
      const v = project
        ? await getScopedSecret(
            project,
            args.key as (typeof SECRET_KEYS)[number],
          )
        : await getSecret(args.key);
      console.log(args.raw ? (v ?? '') : mask(v));
      return;
    }
    for (const k of SECRET_KEYS) {
      const v = project
        ? await getScopedSecret(project, k)
        : await getSecret(k);
      console.log(`${k}=${args.raw ? (v ?? '') : mask(v)}`);
    }
  },
};

const listCmd: CommandModule = {
  command: 'list',
  describe: 'List which secrets are set',
  builder: (y: Argv) =>
    y.option('project', {
      type: 'string',
      describe: 'Project to list (defaults to saved project)',
    }),
  handler: async (args: ArgumentsCamelCase<{ project?: string }>) => {
    const project = args.project || (await getDefaultProject()) || undefined;
    for (const k of SECRET_KEYS) {
      const v = project
        ? await getScopedSecret(project, k)
        : await getSecret(k);
      console.log(`${k}: ${v ? 'set' : 'unset'}`);
    }
  },
};

const deleteCmd: CommandModule<object, SecretsDeleteArgs> = {
  command: 'delete',
  describe: 'Delete a secret',
  builder: (y: Argv<SecretsDeleteArgs>) =>
    y
      .option('project', {
        type: 'string',
        describe: 'Project to delete (defaults to saved project)',
      })
      .option('key', { type: 'string' })
      .option('all', { type: 'boolean', default: false }),
  handler: async (args) => {
    const project = args.project || (await getDefaultProject()) || undefined;
    if (args.all) {
      let count = 0;
      for (const k of SECRET_KEYS) {
        const ok = project
          ? await deleteSecret(`${project}:${k}`)
          : await deleteSecret(k);
        if (ok) count++;
      }
      console.log(`Deleted ${count} secrets.`);
      return;
    }
    if (!args.key) {
      console.error('Provide --key <NAME> or --all');
      process.exit(2);
    }
    const ok = project
      ? await deleteSecret(`${project}:${args.key}`)
      : await deleteSecret(args.key);
    console.log(ok ? 'Deleted' : 'Not found');
  },
};

export const secretsCommands: CommandModule = {
  command: 'secrets <action>',
  describe: 'Manage Bun.secrets for site-assets',
  builder: (y: Argv) =>
    y
      .command(setCmd)
      .command(getCmd)
      .command(listCmd)
      .command(deleteCmd)
      .demandCommand(1),
  handler: () => {},
};
