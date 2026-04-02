import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import { clientBuildPlugin } from './client-build-plugin';

const TEST_DIR = './test-output';
const TEST_CLIENT_FILE = './test-client.client.tsx';

beforeAll(async () => {
  // Create a test client file
  await Bun.write(
    TEST_CLIENT_FILE,
    `
console.log('Test client loaded!');
export default 'test-client';
`,
  );
});

afterAll(async () => {
  // Clean up test files
  if (fs.existsSync(TEST_CLIENT_FILE)) {
    await fs.promises.unlink(TEST_CLIENT_FILE);
  }
  if (fs.existsSync(TEST_DIR)) {
    await fs.promises.rm(TEST_DIR, { recursive: true });
  }
});

describe('clientBuildPlugin', () => {
  test('should build a .client.tsx file and return a hashed URL', async () => {
    // Create a test build that uses the plugin
    const testEntrypoint = './test-importer.ts';
    await Bun.write(
      testEntrypoint,
      `import clientUrl from '${TEST_CLIENT_FILE}';\nconsole.log('Client URL:', clientUrl);`,
    );

    try {
      const result = await Bun.build({
        entrypoints: [testEntrypoint],
        target: 'node',
        plugins: [
          clientBuildPlugin({
            outdir: TEST_DIR,
            buildScriptPath: './finalize-client-build.ts',
            publicPath: '/static',
          }),
        ],
      });

      expect(result.success).toBe(true);
      expect(result.outputs.length).toBeGreaterThan(0);

      const output = await result.outputs[0]?.text();
      if (!output) {
        throw new Error('No output generated');
      }

      // Check that the output contains a URL to the built client file
      expect(output).toContain('/static/');
      expect(output).toContain('.js');

      // Verify the built file exists in the output directory
      const files = await fs.promises.readdir(TEST_DIR);
      const jsFiles = files.filter((f) => f.toString().endsWith('.js'));
      expect(jsFiles.length).toBeGreaterThan(0);

      // Verify the file has a hash in the name
      const hasHashedFile = jsFiles.some((f) =>
        /test-client\.client\.[a-f0-9]{8}\.js/.test(f.toString()),
      );
      expect(hasHashedFile).toBe(true);
    } finally {
      // Clean up test entrypoint
      if (fs.existsSync(testEntrypoint)) {
        await fs.promises.unlink(testEntrypoint);
      }
    }
  }, 10000);
});
