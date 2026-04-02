import { defineAppSchema } from '@inkibra/router';

export type DevAppConfigContract = {
  config: {
    version: string;
  };
};

export const devAppConfigSchema = defineAppSchema<DevAppConfigContract>();
