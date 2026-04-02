import { describe, expect, test } from 'bun:test';
import {
  materializeCapabilityDocs,
  resolveDeveloperExampleCapabilityDocs,
  resolveSystemCapabilityDocs,
} from './capability-docs';

describe('capability docs', () => {
  test('materializes system package and command docs from shared descriptors', () => {
    const files = materializeCapabilityDocs(resolveSystemCapabilityDocs());

    expect(files['/system/packages/sys/fs/README.md']).toContain('# sys/fs');
    expect(files['/system/packages/sys/fs/index.d.ts']).toContain(
      'asynchronous filesystem access backed by the construct VFS',
    );
    expect(files['/system/commands/read/README.md']).toContain('## Usage');
    expect(files['/system/commands/read/index.d.ts']).toContain(
      'description: "Read a file, optionally first/last N lines"',
    );
  });

  test('derives developer example docs from actual module definitions', () => {
    const files = materializeCapabilityDocs(
      resolveDeveloperExampleCapabilityDocs(),
    );
    expect(files['/developer/packages/todo-example/README.md']).toContain(
      'Todo management bindings plus command adapters',
    );
    expect(files['/developer/packages/notifications/index.d.ts']).toContain(
      'sendNotification',
    );
    expect(files['/developer/commands/todo-add/README.md']).toContain(
      '`todo-add <text>`',
    );
  });
});
