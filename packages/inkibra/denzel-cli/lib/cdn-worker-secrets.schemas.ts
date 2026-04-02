// biome-ignore lint/style/noRestrictedImports: typia allowed in schema files
import typia from 'typia';

export type CdnConfig = {
  signingIssuer: string;
  signingSecret: string;
};

export const validateCdnConfig = (input: unknown) =>
  typia.validate<CdnConfig>(input);
