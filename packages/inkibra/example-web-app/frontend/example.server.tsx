/** @jsxImportSource react */
/**
 * Example Frontend Server
 *
 * SSR rendering with fluent route tree API.
 * Uses the context codec pattern where createFrontend declares codecs
 * and deserializes context automatically.
 *
 * Now with bundle splitting support - uses getClientAssetTags() to get
 * all client assets including modulepreload links for chunks.
 */

import { getClientAssetTags, getClientManifest } from '@inkibra/build-pack';
import { createFrontend } from '@inkibra/denzel-bun';
import { DescriptionTags, GoogleFonts } from '@inkibra/denzel-bun/react';
import {
  AppShell,
  createSegmentSource,
  prepare,
  runServerSideRender,
} from '@inkibra/router/react';
import { SessionCodec } from '../api/routes/auth';
import {
  authBackend,
  blogBackend,
  boardBackend,
  chatBackend,
} from '../server/backends';
import { buildConfig } from './example.client';
import { ExampleApp } from './index';

// ============================================================================
// Create Frontend
// ============================================================================

export const ExampleFrontend = createFrontend({
  name: 'ExampleFrontend',
  mountPath: ExampleApp.mountPath,
  allowedDomains: ['localhost', '127.0.0.1'],

  // Domain assets (favicons, manifests, etc.)
  domainAssets: {
    'favicon.ico': './assets/favicon.ico',
  },

  // Context codecs - declares what context this frontend reads/writes
  contextCodecs: {
    session: SessionCodec,
  },

  // SSR render function
  render: async (request, context) => {
    // Build client bundle on-demand and get asset tags
    const manifest = await getClientManifest(buildConfig, {
      envDefines: { NODE_ENV: process.env.NODE_ENV },
      hostname: 'no-site-worker',
    });
    const clientAssetTags = getClientAssetTags(manifest);

    const { html, contextChanges } = await runServerSideRender(
      {
        preparedApp: prepare(ExampleApp),
        source: createSegmentSource(request.url),
        apiImplementations: {
          // Auth Routes
          login: authBackend.apiHandlers.login,
          logout: authBackend.apiHandlers.logout,
          getCurrentUser: authBackend.apiHandlers.getCurrentUser,
          // Board Routes
          listBoards: boardBackend.apiHandlers.listBoards,
          getBoard: boardBackend.apiHandlers.getBoard,
          createBoard: boardBackend.apiHandlers.createBoard,
          createList: boardBackend.apiHandlers.createList,
          // Chat Routes
          listChannels: chatBackend.apiHandlers.listChannels,
          getChannel: chatBackend.apiHandlers.getChannel,
          createChannel: chatBackend.apiHandlers.createChannel,
          getMessages: chatBackend.apiHandlers.getMessages,
          sendMessage: chatBackend.apiHandlers.sendMessage,
          // Task Routes
          getTask: boardBackend.apiHandlers.getTask,
          listTasks: boardBackend.apiHandlers.listTasks,
          createTask: boardBackend.apiHandlers.createTask,
          updateTask: boardBackend.apiHandlers.updateTask,
          deleteTask: boardBackend.apiHandlers.deleteTask,
          listAllTasks: boardBackend.apiHandlers.listAllTasks,
          // Blog Routes
          listBlogPosts: blogBackend.apiHandlers.listBlogPosts,
          getBlogPost: blogBackend.apiHandlers.getBlogPost,
          createBlogPost: blogBackend.apiHandlers.createBlogPost,
        },
        mountPointId: 'app-root',
        // TODO: can we just pass this as context
        sessionContext: context.session,
        deviceContext: context.device,
      },
      <AppShell lang="en" clientScript={clientAssetTags}>
        <AppShell.Head>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <DescriptionTags
            title="Workspace"
            description="A collaborative workspace with boards and blog"
          />
          <GoogleFonts families={['Inter:wght@400;500;600;700']} />
          <style
            dangerouslySetInnerHTML={{
              __html: `
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body {
                  font-family: 'Inter', system-ui, -apple-system, sans-serif;
                  background-color: #0f0f0f;
                  color: #ffffff;
                }
                a { color: inherit; text-decoration: none; }
                button { font-family: inherit; cursor: pointer; }
                input, textarea { font-family: inherit; }
              `,
            }}
          />
        </AppShell.Head>
        <AppShell.Body>
          <AppShell.MountPoint />
        </AppShell.Body>
      </AppShell>,
    );

    return { html, contextChanges };
  },
});
