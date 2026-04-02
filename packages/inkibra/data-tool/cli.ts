#!/usr/bin/env bun

import { GetEnvironmentVariable } from '@inkibra/environment';
import yargs from 'yargs/yargs';
import { InkibraDataTool } from './index';

yargs(process.argv.slice(2))
  .scriptName('inkibra-data-tool')
  .usage('$0 <cmd> [args]')
  .command(
    'clone',
    'Clone collections from source database to destination database',
    (yargs) => {
      return yargs.option('clear-dest', {
        type: 'boolean',
        describe:
          'Delete the specified types from destination database before cloning',
        default: false,
      });
    },
    async (argv) => {
      // Get collections from environment variable (comma-separated)
      const collectionsStr = GetEnvironmentVariable('CLONE_COLLECTIONS');
      const collectionSpecStrings = collectionsStr
        .split(',')
        .map((c) => c.trim());

      // Parse collection specs (supports collection:type format)
      const collectionSpecs = InkibraDataTool.parseCollectionSpecs(
        collectionSpecStrings,
      );

      // Get source and destination configs
      const sourceConfig = InkibraDataTool.getDbConfigFromEnv('SOURCE_DB');
      const destConfig = InkibraDataTool.getDbConfigFromEnv('DEST_DB');

      // If clear-dest flag is set, delete the types from destination first
      if (argv['clear-dest']) {
        await InkibraDataTool.clearDestinationTypes(
          destConfig,
          collectionSpecs,
        );
      }

      // Perform the clone operation
      await InkibraDataTool.cloneCollections(
        sourceConfig,
        destConfig,
        collectionSpecs,
      );
    },
  )
  .command(
    'count [collection]',
    'Counts items in the collection (optionally matching the type)',
    (yargs) => {
      return yargs
        .option('type', {
          type: 'string',
          describe: 'The type (string) you want to count.',
          demandOption: false,
        })
        .positional('collection', {
          type: 'string',
          describe: 'The collection (string) you want to count.',
          demandOption: true,
        });
    },
    async (argv) => {
      const db = await InkibraDataTool.startup();
      if (argv.type) {
        const ret = await InkibraDataTool.countOfType(
          db,
          argv.type,
          argv.collection,
        );
        console.log(ret);
      } else {
        const ret = await InkibraDataTool.countAll(db, argv.collection);
        console.log(ret);
      }
      await db.disconnect();
    },
  )
  .command(
    'delete [collection]',
    'Deletes items matching the collection',
    (yargs) => {
      return yargs
        .option('type', {
          type: 'string',
          describe: 'The type (string) you want to delete.',
          demandOption: false,
        })
        .positional('collection', {
          type: 'string',
          describe: 'The collection (string) you want to delete.',
          demandOption: true,
        });
    },
    async (argv) => {
      const db = await InkibraDataTool.startup();
      if (argv.type) {
        const ret = await InkibraDataTool.deleteOfType(
          db,
          argv.type,
          argv.collection,
        );
        console.log(ret);
      } else {
        const ret = await InkibraDataTool.deleteAll(db, argv.collection);
        console.log(ret);
      }
      await db.disconnect();
    },
  )
  .command(
    'download [collection] [path]',
    'Downloads all items in the collection and saves them to the path',
    (yargs) => {
      return yargs
        .positional('collection', {
          type: 'string',
          describe: 'The collection (string) you want to download.',
          demandOption: true,
        })
        .positional('path', {
          type: 'string',
          describe: 'The path (string) you want to save the data to.',
          demandOption: true,
        });
    },
    async (argv) => {
      const db = await InkibraDataTool.startup();
      await InkibraDataTool.downloadAllAndSave(db, argv.collection, argv.path);
      await db.disconnect();
    },
  )
  .command(
    'upload [path] [collection]',
    'Upload all items in the collection from the path',
    (yargs) => {
      return yargs
        .positional('collection', {
          type: 'string',
          describe: 'The collection (string) you want to upload.',
          demandOption: true,
        })
        .positional('path', {
          type: 'string',
          describe: 'The path (string) you want to upload the data from.',
          demandOption: true,
        })
        .positional('list', {
          type: 'boolean',
          describe: 'The input path is a list of objects',
          demandOption: false,
        });
    },
    async (argv) => {
      const db = await InkibraDataTool.startup();
      if (argv.list) {
        await InkibraDataTool.uploadFromObjectList(
          db,
          argv.collection,
          argv.path,
        );
      } else {
        await InkibraDataTool.uploadFromSave(db, argv.collection, argv.path);
      }
      await db.disconnect();
    },
  )
  .help().argv;
