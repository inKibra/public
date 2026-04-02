import fs from 'node:fs';
import path from 'node:path';
import { getServerPackageDir } from './client-manifest';
import { getServerVersion } from './version';

const DEFAULT_DEPLOYMENT_ID_ENV = 'ASSET_DEPLOYMENT_ID';
const DEFAULT_DEPLOYMENT_ID = 'local';

function getDeploymentIdEnvName(): string {
  try {
    const pkgPath = path.join(getServerPackageDir(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
      assetsDeploymentIdEnv?: string;
    };
    return pkg.assetsDeploymentIdEnv ?? DEFAULT_DEPLOYMENT_ID_ENV;
  } catch {
    return DEFAULT_DEPLOYMENT_ID_ENV;
  }
}

export function getVersionedManifestPath(clientDir: string): string {
  const envName = getDeploymentIdEnvName();
  const deploymentId = process.env[envName] ?? DEFAULT_DEPLOYMENT_ID;
  const version = getServerVersion();
  return `${clientDir}/manifest-${version}-${deploymentId}.json`;
}
