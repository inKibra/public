// biome-ignore lint/style/noRestrictedImports: typia is allowed in schemas
import typia from 'typia';
import type {
  CdnWorkerConfig,
  CdnWorkerDeploymentRecord,
} from './cdn-worker-config';

export const validateParseCdnWorkerConfig =
  typia.json.createValidateParse<CdnWorkerConfig>();

export const validateParseCdnWorkerDeploymentRecord =
  typia.json.createValidateParse<CdnWorkerDeploymentRecord>();
