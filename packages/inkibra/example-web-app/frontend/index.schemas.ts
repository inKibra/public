/**
 * App configuration schemas
 *
 * Defines the app config type and validation schema
 */

import { defineAppSchema } from '@inkibra/router';
// biome-ignore lint/style/noRestrictedImports: typia is allowed in schema files
import typia from 'typia';

/**
 * App configuration type - custom config for this app
 * Framework fields (appId, mountPath) are now top-level in createApp
 */
export type ExampleAppConfig = {
  /** App version */
  version: string;
};

/**
 * App config schema - validates config at runtime
 */
export const appConfigSchema = defineAppSchema({
  config: typia.createValidate<ExampleAppConfig>(),
});
