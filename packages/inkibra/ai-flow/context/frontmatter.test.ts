import { describe, expect, test } from 'bun:test';
import {
  completeContextMeta,
  contextToFilename,
  filenameToContext,
  generateContextId,
  parseContextFile,
  serializeContextFile,
} from './index';

describe('context frontmatter utilities', () => {
  describe('frontmatter utilities', () => {
    test('parseContextFile extracts frontmatter and content', () => {
      const input = `---
id: test-123
tags:
  - fitness
  - goals
created: 2025-01-01T00:00:00Z
---

# User Preferences

Some content here.
`;

      const result = parseContextFile(input);

      expect(result.meta.id).toBe('test-123');
      expect(result.meta.tags).toEqual(['fitness', 'goals']);
      expect(String(result.meta.created)).toContain('2025');
      expect(result.content).toContain('# User Preferences');
      expect(result.content).toContain('Some content here.');
    });

    test('serializeContextFile creates valid frontmatter', () => {
      const meta = {
        id: 'test-456',
        tags: ['fitness'],
        created: '2025-01-01T00:00:00Z',
        updated: '2025-01-02T00:00:00Z',
      };
      const content = '# Workout History\n\nContent here.';

      const result = serializeContextFile(meta, content);

      expect(result).toContain('id: test-456');
      expect(result).toContain('# Workout History');
      expect(result).toContain('Content here.');
    });

    test('generateContextId creates unique IDs', () => {
      const id1 = generateContextId();
      const id2 = generateContextId();

      expect(id1).toContain('ctx-');
      expect(id2).toContain('ctx-');
      expect(id1).not.toBe(id2);
    });

    test('completeContextMeta fills in missing fields', () => {
      const partial = { tags: ['fitness'] };
      const result = completeContextMeta(partial);

      expect(result.id).toContain('ctx-');
      expect(result.tags).toEqual(['fitness']);
      expect(result.created).toBeDefined();
      expect(result.updated).toBeDefined();
    });

    test('contextToFilename creates correct path', () => {
      expect(contextToFilename('test-123')).toBe('test-123.md');
      expect(contextToFilename('memory/today.log')).toBe('memory/today.log');
    });

    test('filenameToContext parses path correctly', () => {
      const result = filenameToContext('user-preferences/test-123.md');
      expect(result).toEqual({ id: 'user-preferences/test-123.md' });
    });

    test('filenameToContext returns null for invalid paths', () => {
      expect(filenameToContext('invalid')).toBeNull();
      expect(filenameToContext('no-extension/file')).toBeNull();
    });
  });
});
