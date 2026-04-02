/**
 * Complete example of typed Server-Sent Events (SSE) implementation
 * Demonstrates both server-side and client-side usage with full type safety
 */

import * as Logger from '@inkibra/logger';
import { connectSseClientToRoute, FetchProvider } from '../classes/sdk';
import { SseRoute } from '../classes/sse-route';
import type { SseEventTypes } from '../constants/sse-event';

// Define your SSE event types
interface ChatEvents extends SseEventTypes {
  'user-joined': { userId: string; username: string };
  'user-left': { userId: string; username: string };
  message: { id: string; content: string; author: string };
  typing: { userId: string; isTyping: boolean };
}

// Define your SSE route types
type ChatStreamRouteTypes = {
  Name: 'chatStream';
  PathParamsType: { roomId: string };
  PathQueryType: { userId?: string };
  EventTypes: ChatEvents;
};

// Create the SSE route
const chatStreamRoute = new SseRoute<
  '/chat/stream/:roomId',
  ChatStreamRouteTypes
>({
  name: 'chatStream',
  path: '/chat/stream/:roomId',
  pathParamsValidator: (input) => ({
    success: true,
    data: input as { roomId: string },
  }),
  pathQueryValidator: (input) => ({
    success: true,
    data: input as { userId?: string },
  }),
  eventTypesValidator: () => ({ success: true, data: {} }),
});

// Example usage with FetchProvider
export function exampleUsage() {
  const logger = Logger.init('sse-example');

  // Create a FetchProvider (similar to how you'd use it for HTTP routes)
  const fetchProvider = new FetchProvider({
    fetch: globalThis.fetch,
    Request: globalThis.Request,
    Response: globalThis.Response,
    Headers: globalThis.Headers,
    domain: 'api.example.com',
    port: 443,
    protocol: 'https:',
    logger,
    storage: {
      authorization: 'Bearer your-auth-token',
    },
    includeCredentials: true,
  });

  // Create an SSE client using the new createSSERouteHandler method
  const sseClient = fetchProvider.createSSERouteHandler(chatStreamRoute);

  // Add typed event listeners
  sseClient.addEventListener('user-joined', (data) => {
    console.log(`${data.username} joined the chat`);
  });

  sseClient.addEventListener('message', (data) => {
    console.log(`${data.author}: ${data.content}`);
  });

  sseClient.addEventListener('typing', (data) => {
    if (data.isTyping) {
      console.log(`${data.userId} is typing...`);
    }
  });

  // Connect to the SSE stream
  sseClient.connect({
    pathParams: { roomId: 'general' },
    pathQuery: { userId: 'current-user-123' },
    // Note: baseUrl is automatically provided by the FetchProvider
  });

  // Handle connection events
  sseClient.onOpen(() => {
    console.log('Connected to chat stream');
  });

  sseClient.onError((error) => {
    console.error('SSE connection error:', error);
  });

  // Later, when you want to disconnect
  // sseClient.disconnect();
}

// Example of how this compares to regular HTTP routes
export function comparisonWithHttpRoutes() {
  const logger = Logger.init('comparison-example');

  const fetchProvider = new FetchProvider({
    fetch: globalThis.fetch,
    Request: globalThis.Request,
    Response: globalThis.Response,
    Headers: globalThis.Headers,
    domain: 'api.example.com',
    port: 443,
    protocol: 'https:',
    logger,
    storage: {
      authorization: 'Bearer your-auth-token',
    },
    includeCredentials: true,
  });

  // Regular HTTP route (existing pattern)
  // const httpHandler = fetchProvider.createRouteHandler(httpRoute);
  // const result = await httpHandler(args);

  // SSE route (new pattern)
  const sseClient = fetchProvider.createSSERouteHandler(chatStreamRoute);
  sseClient.addEventListener('message', (data) => {
    console.log('Received message:', data);
  });
  sseClient.connect({ pathParams: { roomId: 'general' } });
}

// Example of using SSE routes in a registry pattern (like in the app)
export function registryPatternExample() {
  const logger = Logger.init('registry-example');

  const fetchProvider = new FetchProvider({
    fetch: globalThis.fetch,
    Request: globalThis.Request,
    Response: globalThis.Response,
    Headers: globalThis.Headers,
    domain: 'api.example.com',
    port: 443,
    protocol: 'https:',
    logger,
    storage: {
      authorization: 'Bearer your-auth-token',
    },
    includeCredentials: true,
  });

  // HTTP routes use setupHandler
  // const httpRoutes = {
  //   ...routes.updateProfile.setupHandler<void>(async (args) => {
  //     return fetchProvider.createRouteHandler(routes.updateProfile)(args);
  //   }),
  // };

  // SSE routes use createClient
  const sseRoutes = {
    ...connectSseClientToRoute(chatStreamRoute, (route) => {
      return fetchProvider.createSSERouteHandler(route);
    }),
  };

  // Usage
  const chatClient = sseRoutes.chatStream.fn();
  chatClient.addEventListener('message', (data) => {
    console.log('Received message:', data);
  });
  chatClient.connect({ pathParams: { roomId: 'general' } });
}
