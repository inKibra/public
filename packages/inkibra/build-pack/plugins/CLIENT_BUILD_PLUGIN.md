# Client Build Plugin

A Bun plugin that automatically builds `.client.tsx` files as separate browser bundles with content-based hashing.

## Features

- ✨ Automatically builds `.client.tsx` files when imported
- 🔒 Content-based hashing for cache busting
- 📦 Separate bundles for each client file
- 🚀 Build caching to avoid rebuilding unchanged files
- ⚙️ Configurable minification, sourcemaps, and output paths

## Installation

```bash
bun add @inkibra/build-pack
```

## Usage

### Basic Usage

In your build script:

```typescript
import { clientBuildPlugin } from '@inkibra/build-pack';

await Bun.build({
  entrypoints: ['./server.tsx'],
  plugins: [
    clientBuildPlugin({
      outdir: './dist',
      publicPath: '/dist',
    }),
  ],
});
```

In your server code, import the client file:

```typescript
// server.tsx
import tempoClientUrl from './frontends/tempo/tempo.client.tsx';

// tempoClientUrl will be something like: '/dist/tempo/tempo.client.a1b2c3d4.js'

app.get('/tempo', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Tempo</title>
      </head>
      <body>
        <div id="root"></div>
        <script src="${tempoClientUrl}"></script>
      </body>
    </html>
  `);
});
```

### Advanced Options

```typescript
clientBuildPlugin({
  // Output directory for built client files
  outdir: './dist',
  
  // Base path for the client files in URLs
  publicPath: '/dist',
  
  // Environment variables to inject
  env: {
    NODE_ENV: 'production',
    API_URL: 'https://api.example.com',
  },
  
  // Whether to minify (defaults to true in production)
  minify: true,
  
  // Sourcemap configuration
  sourcemap: 'none', // 'none' | 'inline' | 'external'
  
  // Additional plugins for building client files
  plugins: [
    loadSchemasPlugin,
    assetsPathPlugin,
  ],
})
```

## How It Works

1. When the plugin encounters an import to a `.client.tsx` file, it intercepts the import
2. It computes a content hash based on the file contents
3. It spawns a subprocess with `bun` to build the client file (this avoids Bun's limitation on recursive builds)
4. It outputs the bundle to `{outdir}/{clientDir}/{filename}.{hash}.js`
5. It returns a module that exports the public URL to the built file

**Note:** The plugin uses subprocesses to build client files, which avoids Bun's limitation on nested `Bun.build()` calls but may be slightly slower for many clients. The builds are cached by content hash, so unchanged files are not rebuilt.

## Example Client File

```tsx
// tempo.client.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app';

const root = document.getElementById('root');
if (root) {
  ReactDOM.hydrateRoot(root, <App />);
}
```

## File Structure

Given this structure:

```
frontends/
  tempo/
    tempo.client.tsx
    index.tsx
```

The plugin will output:

```
dist/
  tempo/
    tempo.client.a1b2c3d4.js
```

And importing `tempo.client.tsx` will return: `'/dist/tempo/tempo.client.a1b2c3d4.js'`

## Caching

The plugin caches builds per file path. If you import the same client file multiple times in your build, it will only be built once and the same hashed URL will be returned.

## Integration with Existing Code

This plugin is designed to work alongside your existing build process. You can gradually migrate from manual `buildClient()` calls to using this plugin.

### Before:

```typescript
// build-clients.ts
await buildClient(
  './frontends/tempo/tempo.client.tsx',
  './dist/tempo/tempo.client.js',
  env
);

// server.tsx
const clientUrl = '/dist/tempo/tempo.client.js';
```

### After:

```typescript
// server.tsx
import clientUrl from './frontends/tempo/tempo.client.tsx';
// clientUrl is automatically available with hash
```

## TypeScript

The plugin automatically generates the correct type. When you import a `.client.tsx` file, TypeScript will infer the type as `string`.

To improve type safety, you can add a declaration file:

```typescript
// client.d.ts
declare module '*.client.tsx' {
  const url: string;
  export default url;
}
```

