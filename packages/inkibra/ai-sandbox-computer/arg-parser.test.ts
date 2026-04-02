import { describe, expect, test } from 'bun:test';
import { generateArgHelp, parseArgs } from './arg-parser';
import type { ArgDef } from './types';

const readArgs: Record<string, ArgDef> = {
  path: {
    type: 'string',
    position: 0,
    required: true,
    description: 'File path',
  },
  head: { type: 'number', flag: '--head', description: 'First N lines' },
  tail: { type: 'number', flag: '--tail', description: 'Last N lines' },
};

describe('parseArgs', () => {
  test('parses positional arg', () => {
    const result = parseArgs(readArgs, ['/agent/home/notes.md']);
    expect(result).toEqual({
      success: true,
      parsed: { path: '/agent/home/notes.md' },
    });
  });

  test('parses positional + flag', () => {
    const result = parseArgs(readArgs, [
      '/agent/home/notes.md',
      '--head',
      '10',
    ]);
    expect(result).toEqual({
      success: true,
      parsed: { path: '/agent/home/notes.md', head: 10 },
    });
  });

  test('parses multiple flags', () => {
    const result = parseArgs(readArgs, [
      '/foo.md',
      '--head',
      '5',
      '--tail',
      '3',
    ]);
    expect(result).toEqual({
      success: true,
      parsed: { path: '/foo.md', head: 5, tail: 3 },
    });
  });

  test('fails on missing required positional', () => {
    const result = parseArgs(readArgs, []);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Missing required');
      expect(result.error).toContain('path');
    }
  });

  test('fails on unknown flag', () => {
    const result = parseArgs(readArgs, ['/foo.md', '--unknown', 'val']);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Unknown flag');
    }
  });

  test('fails on wrong type for number flag', () => {
    const result = parseArgs(readArgs, ['/foo.md', '--head', 'abc']);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('expected a number');
    }
  });

  test('applies defaults', () => {
    const args: Record<string, ArgDef> = {
      path: { type: 'string', position: 0, default: '.' },
    };
    const result = parseArgs(args, []);
    expect(result).toEqual({ success: true, parsed: { path: '.' } });
  });

  test('positional overrides default', () => {
    const args: Record<string, ArgDef> = {
      path: { type: 'string', position: 0, default: '.' },
    };
    const result = parseArgs(args, ['/home']);
    expect(result).toEqual({ success: true, parsed: { path: '/home' } });
  });

  test('boolean flag without value', () => {
    const args: Record<string, ArgDef> = {
      path: { type: 'string', position: 0, required: true },
      recursive: { type: 'boolean', flag: '--recursive', default: false },
    };
    const result = parseArgs(args, ['/home', '--recursive']);
    expect(result).toEqual({
      success: true,
      parsed: { path: '/home', recursive: true },
    });
  });

  test('handles --help', () => {
    const result = parseArgs(readArgs, ['--help']);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('__help__');
    }
  });

  test('multiple positional args', () => {
    const args: Record<string, ArgDef> = {
      path: { type: 'string', position: 0, required: true },
      old: { type: 'string', position: 1, required: true },
      new: { type: 'string', position: 2, required: true },
    };
    const result = parseArgs(args, ['/foo.md', 'hello', 'world']);
    expect(result).toEqual({
      success: true,
      parsed: { path: '/foo.md', old: 'hello', new: 'world' },
    });
  });
});

describe('generateArgHelp', () => {
  test('generates help text', () => {
    const help = generateArgHelp('read', 'Read a file', readArgs);
    expect(help).toContain('read — Read a file');
    expect(help).toContain('path');
    expect(help).toContain('--head');
    expect(help).toContain('--tail');
  });
});
