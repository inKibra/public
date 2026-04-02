# Server-Sent Events (SSE) Implementation

This directory contains a complete, type-safe implementation of Server-Sent Events (SSE) for the InKibra API base package.

## Overview

The SSE implementation provides:
- **Type-safe server-side event streaming** with `EventStreamImpl`
- **Type-safe client-side event consumption** with `SseClient`
- **Route definition and validation** with `SseRoute`
- **Event formatting utilities** for proper SSE protocol compliance

## Components

### 1. `EventStreamImpl` (Server-side)
Manages SSE connections and sends typed events to clients.

**Features:**
- Automatic SSE header setup
- Type-safe event sending
- Connection lifecycle management
- Error handling and cleanup
- Heartbeat support

### 2. `SseClient` (Client-side)
Provides a type-safe wrapper around the browser's `EventSource` API.

**Features:**
- Type-safe event listeners
- Automatic reconnection
- Connection state management
- URL construction from route parameters

### 3. `SseRoute` (Route Definition)
Defines SSE routes with full type safety and validation. SSE routes only support GET requests and don't handle request bodies or file uploads, as per the SSE specification.

**Features:**
- Path parameter validation
- Query parameter validation
- Event type validation
- Route construction utilities
- GET-only request handling (as per SSE spec)

## Usage Example

### 1. Define Event Types
```typescript
interface ChatEvents extends SseEventTypes {
  'user-joined': { userId: string; username: string };
  'user-left': { userId: string; username: string };
  'message': { id: string; content: string; author: string };
  'typing': { userId: string; isTyping: boolean };
}
```

### 2. Create SSE Route
```typescript
const chatStreamRoute = new SseRoute<'/chat/stream/:roomId', ChatStreamRouteTypes>({
  name: 'chatStream',
  path: '/chat/stream/:roomId',
  pathParamsValidator: (input) => validatePathParams(input),
  pathQueryValidator: (input) => validateQuery(input),
  eventTypesValidator: (eventType, data) => validateEvent(eventType, data),
});
```

### 3. Server-side Handler
```typescript
const chatHandler: SseHandlerFunction<'/chat/stream/:roomId', ChatStreamRouteTypes, Context> = 
  async (args, ctx, stream) => {
    const { roomId } = args.pathParams;
    
    // Send welcome message
    stream.send('user-joined', {
      userId: 'system',
      username: 'System'
    });
    
    // Set up cleanup on disconnect
    stream.onClose(() => {
      console.log(`User left room ${roomId}`);
    });
    
    // Send periodic heartbeats
    const heartbeat = setInterval(() => {
      if (stream.isActive()) {
        stream.sendHeartbeat();
      }
    }, 30000);
    
    stream.onClose(() => clearInterval(heartbeat));
  };
```

### 4. Client-side Usage
```typescript
const client = createSseClient(chatStreamRoute, {
  autoReconnect: true,
  reconnectDelay: 3000,
  maxReconnectAttempts: 5,
});

// Add typed event listeners
client.addEventListener('user-joined', (data) => {
  console.log(`${data.username} joined the chat`);
});

client.addEventListener('message', (data) => {
  console.log(`${data.author}: ${data.content}`);
});

// Connect to the stream
client.connect({
  pathParams: { roomId: 'general' },
  pathQuery: { userId: 'user123' },
  baseUrl: 'https://api.example.com',
});
```

## Testing

### Running Tests
```bash
# Run comprehensive tests (may have some mock-related issues)
bun test classes/sse.test.ts

# Run simplified core functionality tests (recommended)
bun test classes/sse-simple.test.ts
```

### Test Coverage
The tests cover:
- ✅ SSE event formatting
- ✅ EventStreamImpl initialization and headers
- ✅ Type-safe event sending
- ✅ Connection lifecycle management
- ✅ Error handling
- ✅ Stream cleanup
- ✅ Heartbeat functionality
- ✅ Graceful connection closing
- ✅ Integration scenarios

### Simple Test Example
```typescript
import { EventStreamImpl } from './event-stream';
import { formatSseEvent } from '../constants/sse-event';

test('should format SSE event correctly', () => {
  const event = {
    type: 'user-joined',
    data: { userId: '123', username: 'alice' },
    id: 'event-1',
  };

  const formatted = formatSseEvent(event);
  
  expect(formatted).toBe(
    'id: event-1\nevent: user-joined\ndata: {"userId":"123","username":"alice"}\n\n'
  );
});
```

## API Simplification

The SSE route implementation has been simplified to align with the SSE specification:

- **GET-only requests**: SSE routes only support GET requests (no HTTP method parameter needed)
- **No request body**: SSE connections don't handle request bodies (bodyValidator removed)
- **No file uploads**: File upload support removed as it's not part of the SSE spec
- **Simplified constructor**: Fewer parameters needed when creating SSE routes

## Best Practices

### Server-side
1. **Always handle cleanup**: Use `stream.onClose()` to clean up resources
2. **Check stream status**: Use `stream.isActive()` before sending events
3. **Send heartbeats**: Use `stream.sendHeartbeat()` for long-lived connections
4. **Handle errors gracefully**: Wrap event sending in try-catch blocks
5. **Use graceful disconnection**: The framework automatically handles graceful SSE connection closing

### Client-side
1. **Use typed event listeners**: Take advantage of TypeScript's type safety
2. **Handle reconnection**: Configure appropriate reconnection settings
3. **Clean up**: Call `client.disconnect()` when done
4. **Monitor connection state**: Use `client.isConnected()` to check status
5. **Listen for disconnect events**: The client automatically handles server-initiated graceful disconnections

## Integration with Denzel Framework

The SSE implementation integrates seamlessly with the Denzel framework:

```typescript
// In your Denzel context
context.attachSSERouteHandlerWithMiddlewares(
  chatStreamRoute,
  [authMiddleware], // Additional middlewares
  chatHandler
);
```

## Error Handling

The implementation includes robust error handling:
- Connection errors are logged and trigger cleanup
- Invalid events are caught and logged
- Network errors trigger reconnection (client-side)
- Stream errors close the connection gracefully
- Graceful disconnection pattern eliminates spurious connection errors

## Performance Considerations

- Events are sent asynchronously to avoid blocking
- Heartbeats prevent connection timeouts
- Automatic cleanup prevents memory leaks
- Efficient event formatting minimizes bandwidth usage

## Browser Compatibility

The client-side implementation uses the standard `EventSource` API, which is supported in:
- Chrome 6+
- Firefox 6+
- Safari 5+
- Edge 79+
- All modern browsers

For older browsers, consider using a polyfill. 