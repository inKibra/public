/** @jsxImportSource react */
/**
 * Client Entry Point
 *
 * Hydrates the React app on the client:
 * - prepare(ExampleApp) reads config, loaderData, initialStorage from meta tags
 * - createFetchTransport sets up API transport with storage adapters
 * - hydrate() renders the matched route tree and hydrates at the mount point
 */

import { defineClientBuild } from '@inkibra/build-pack/client-config';

// ============================================================================
// Build Configuration
// ============================================================================

/**
 * Client build configuration for the example app.
 * Extracted by clientStubPlugin for server-side manifest generation.
 */
export const buildConfig = defineClientBuild({
  clientDir: 'example',
  plugins: {
    vanillaExtract: false,
    assetsPath: true,
    loadSchemas: true,
  },
});

import createLogger from '@inkibra/logger';
import { implementEventStreamRoutes } from '@inkibra/router';
import {
  createFetchTransport,
  createLocalStorageAdapter,
  createSegmentSource,
  createSessionStorageAdapter,
  hydrate,
  prepare,
} from '@inkibra/router/react';
import {
  getCurrentUserRoute,
  loginRoute,
  logoutRoute,
} from '../api/routes/auth';
// Import API routes for creating implementations
import {
  createBlogPostRoute,
  getBlogPostRoute,
  listBlogPostsRoute,
} from '../api/routes/blog';
import {
  createBoardRoute,
  createListRoute,
  getBoardRoute,
  listBoardsRoute,
} from '../api/routes/boards';
import {
  createChannelRoute,
  getChannelRoute,
  getMessagesRoute,
  listChannelsRoute,
  sendMessageRoute,
} from '../api/routes/chat';
import {
  createTaskRoute,
  deleteTaskRoute,
  getTaskRoute,
  listAllTasksRoute,
  listTasksRoute,
  updateTaskRoute,
} from '../api/routes/tasks';
import { boardUpdatesRoute, chatMessagesRoute } from '../api/streams';
import { ExampleApp } from './index';

// ============================================================================
// Hydrate App
// ============================================================================

async function hydrateApp() {
  // 1. Read app config, loader data, and storage from meta tags
  const preparedApp = prepare(ExampleApp);

  console.log('[ExampleApp] Hydrating with config:', preparedApp.config);
  console.log('[ExampleApp] Loader data:', preparedApp.loaderData);
  console.log(
    '[ExampleApp] Initial session storage:',
    preparedApp.initialSessionStorage,
  );
  console.log(
    '[ExampleApp] Initial device storage:',
    preparedApp.initialDeviceStorage,
  );
  console.log('[ExampleApp] Mount point:', preparedApp.mountPointId);

  // 2. Create fetch transport with storage adapters initialized from SSR
  const fetchTransport = createFetchTransport({
    logger: createLogger('FetchTransport'),
    includeCredentials: true,
    storageAdapters: {
      session: createSessionStorageAdapter(preparedApp.initialSessionStorage),
      device: createLocalStorageAdapter(preparedApp.initialDeviceStorage),
    },
  });

  const eventStreamImplementations = implementEventStreamRoutes(
    fetchTransport.provider,
    {
      boardUpdates: boardUpdatesRoute,
      chatMessages: chatMessagesRoute,
    },
  );

  // 3. Create location source for routing
  const source = createSegmentSource(window.location.href);

  // 4. Hydrate the app
  void hydrate({
    preparedApp,
    source,
    apiImplementations: {
      // Auth routes
      login: fetchTransport.createApiHandler(loginRoute),
      logout: fetchTransport.createApiHandler(logoutRoute),
      getCurrentUser: fetchTransport.createApiHandler(getCurrentUserRoute),
      // Board routes
      listBoards: fetchTransport.createApiHandler(listBoardsRoute),
      getBoard: fetchTransport.createApiHandler(getBoardRoute),
      createBoard: fetchTransport.createApiHandler(createBoardRoute),
      createList: fetchTransport.createApiHandler(createListRoute),
      // Chat routes
      listChannels: fetchTransport.createApiHandler(listChannelsRoute),
      getChannel: fetchTransport.createApiHandler(getChannelRoute),
      createChannel: fetchTransport.createApiHandler(createChannelRoute),
      getMessages: fetchTransport.createApiHandler(getMessagesRoute),
      sendMessage: fetchTransport.createApiHandler(sendMessageRoute),
      // Task routes
      getTask: fetchTransport.createApiHandler(getTaskRoute),
      listTasks: fetchTransport.createApiHandler(listTasksRoute),
      createTask: fetchTransport.createApiHandler(createTaskRoute),
      updateTask: fetchTransport.createApiHandler(updateTaskRoute),
      deleteTask: fetchTransport.createApiHandler(deleteTaskRoute),
      listAllTasks: fetchTransport.createApiHandler(listAllTasksRoute),
      // Blog routes
      listBlogPosts: fetchTransport.createApiHandler(listBlogPostsRoute),
      getBlogPost: fetchTransport.createApiHandler(getBlogPostRoute),
      createBlogPost: fetchTransport.createApiHandler(createBlogPostRoute),
    },
    readContext: fetchTransport.readContext,
    eventStreamImplementations,
  });

  console.log('[ExampleApp] Hydration complete');
}

// Start hydration when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    hydrateApp().catch(console.error);
  });
} else {
  hydrateApp().catch(console.error);
}
