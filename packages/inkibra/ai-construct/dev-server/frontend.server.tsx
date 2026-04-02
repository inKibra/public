/** @jsxImportSource react */

import {
  getClientAssetTags,
  getClientManifest,
  getVersionedManifestPath,
} from '@inkibra/build-pack';
import { createFrontend } from '@inkibra/denzel-bun';
import {
  AppShell,
  createSegmentSource,
  prepare,
  runServerSideRender,
} from '@inkibra/router/react';
import { DevServerApp } from './app';
import { devAuthCodec } from './auth';
import type { createDevBackend } from './backend';
import { buildConfig } from './frontend.client';

export function createDevServerFrontend(
  backend: ReturnType<typeof createDevBackend>,
) {
  return createFrontend({
    name: 'ai-construct-dev-frontend',
    mountPath: DevServerApp.mountPath,
    allowedDomains: ['localhost', '127.0.0.1'],
    contextCodecs: {
      auth: devAuthCodec,
    },
    render: async (request, context) => {
      const url = new URL(request.url);

      const clientManifest = await getClientManifest(buildConfig, {
        envDefines: {},
        hostname: url.hostname,
        manifestPath: getVersionedManifestPath(buildConfig.clientDir),
      });
      const clientAssetTags = getClientAssetTags(clientManifest);

      const ssr = await runServerSideRender(
        {
          preparedApp: prepare(DevServerApp),
          source: createSegmentSource(request.url),
          apiImplementations: backend.apiHandlers,
          sessionContext: {
            auth: context.session.auth ?? null,
          },
          deviceContext: {},
          mountPointId: 'dev-server-root',
        },
        <AppShell lang="en" clientScript={clientAssetTags}>
          <AppShell.Head>
            <meta
              name="viewport"
              content="width=device-width, initial-scale=1"
            />
            <title>ai-construct Dev Server</title>
            <style>{`
              html, body, #dev-server-root {
                margin: 0;
                padding: 0;
                height: 100%;
                background: #0a0a0a;
                color: #e0e0e0;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              }
            `}</style>
          </AppShell.Head>
          <AppShell.Body>
            <AppShell.MountPoint />
          </AppShell.Body>
        </AppShell>,
      );

      return {
        html: ssr.html,
        contextChanges: ssr.contextChanges,
      };
    },
  });
}
