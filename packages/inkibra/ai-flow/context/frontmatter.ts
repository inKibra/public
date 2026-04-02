/**
 * Frontmatter Parsing
 *
 * Utilities for parsing and serializing markdown files with YAML frontmatter.
 */

import matter from 'gray-matter';
import type { ContextMeta } from './types';

/**
 * Parse a markdown file with YAML frontmatter
 */
export function parseContextFile(content: string): {
  meta: Partial<ContextMeta>;
  content: string;
} {
  const { data, content: markdownContent } = matter(content);

  // Ensure required fields have defaults
  const meta: Partial<ContextMeta> = {
    id: data.id || '',
    tags: Array.isArray(data.tags) ? data.tags : [],
    created: data.created || new Date().toISOString(),
    updated: data.updated || new Date().toISOString(),
    ...data,
  };

  return {
    meta,
    content: markdownContent.trim(),
  };
}

/**
 * Serialize context to a markdown file with YAML frontmatter
 */
export function serializeContextFile(
  meta: ContextMeta,
  content: string,
): string {
  // Create a clean meta object without empty arrays or undefined values
  const cleanMeta: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    cleanMeta[key] = value;
  }

  return matter.stringify(content, cleanMeta);
}

/**
 * Generate a unique ID for a new context
 */
export function generateContextId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `ctx-${timestamp}-${random}`;
}

/**
 * Validate and complete a partial context meta object
 */
export function completeContextMeta(
  partial: Partial<ContextMeta>,
): ContextMeta {
  const now = new Date().toISOString();

  return {
    id: partial.id || generateContextId(),
    tags: partial.tags || [],
    created: partial.created || now,
    updated: now,
    ...partial,
  };
}

/**
 * Extract a filename from a context ID
 */
export function contextToFilename(id: string): string {
  // Preserve leading slash for absolute paths so callers like contextIdToPath
  // can distinguish non-context paths (e.g. /runtime/...) from context-relative ones.
  const isAbsolute = id.startsWith('/');
  const normalized = isAbsolute ? id.slice(1) : id;
  if (!normalized) {
    return `${generateContextId()}.md`;
  }

  const hasExtension = /[^/]+\.[^/]+$/.test(normalized);
  const result = hasExtension ? normalized : `${normalized}.md`;
  return isAbsolute ? `/${result}` : result;
}

/**
 * Parse a filename back to context info
 */
export function filenameToContext(filename: string): { id: string } | null {
  const normalized = filename.replace(/^\/+/, '');
  if (!normalized) return null;

  const hasExtension = /[^/]+\.[^/]+$/.test(normalized);
  if (!hasExtension) {
    return null;
  }

  return {
    id: normalized,
  };
}
