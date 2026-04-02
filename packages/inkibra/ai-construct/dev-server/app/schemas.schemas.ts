import { defineLoaderSchema } from '@inkibra/router';
import type {
  ConstructLabSnapshot,
  ConstructRuntimeSnapshot,
  ConstructStudioSnapshot,
} from '../../lab/types';

export type DevLabLoaderResponse = {
  cursor?: string;
  studioSnapshot: ConstructStudioSnapshot;
  labSnapshot: ConstructLabSnapshot;
  runtimeSnapshot: ConstructRuntimeSnapshot;
};

export type DevLabLoaderError = {
  type: string;
  message?: string;
};

export type DevLabLoaderContract = {
  response: DevLabLoaderResponse;
  error: DevLabLoaderError;
};

export const devLabLoaderSchema = defineLoaderSchema<DevLabLoaderContract>();
