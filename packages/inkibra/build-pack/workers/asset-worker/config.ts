export type AssetWorkerRoute = {
  pattern: string;
  zoneName: string;
};

export type AssetWorkerConfig = {
  workerName: string;
  routes: AssetWorkerRoute[];
  r2Bucket: string;
  assetOriginBase: string;
  assetRoot?: string;
  latestKey?: string;
  buildEndpoint?: string;
  cacheTtls?: {
    assetsTtl: number;
    manifestTtl: number;
  };
  compatibilityDate?: string;
};
