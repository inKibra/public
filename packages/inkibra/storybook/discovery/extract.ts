/**
 * AST-based extraction of story variants from TypeScript files.
 *
 * Extracts `meta`, `review`, and `vrt` from exported object literals
 * WITHOUT importing the file (pure static analysis).
 */

import ts from 'typescript';
import type {
  CaptureLaneConfig,
  PartialCaptureLaneConfig,
  StoryMeta,
  StoryShotPlan,
} from '../types';

// ============================================================================
// Types
// ============================================================================

/**
 * Extracted data from a single story variant export.
 */
export type ExtractedVariant = {
  /** Export name (e.g., 'Default', 'WithError') */
  exportName: string;
  /** Extracted meta object */
  meta: StoryMeta;
  /** Extracted review config (partial, needs normalization) */
  review?: PartialCaptureLaneConfig;
  /** Extracted vrt config (partial, needs normalization) */
  vrt?: PartialCaptureLaneConfig;
};

/**
 * Result of extracting variants from a file.
 */
export type ExtractionResult = {
  /** Successfully extracted variants */
  variants: ExtractedVariant[];
  /** Warnings/errors encountered during extraction */
  warnings: string[];
};

// ============================================================================
// Literal Value Extraction
// ============================================================================

// Allowed node kinds for literal extraction (for documentation):
// - StringLiteral, NumericLiteral, TrueKeyword, FalseKeyword, NullKeyword
// - ArrayLiteralExpression, ObjectLiteralExpression
// Anything else is rejected to ensure AST-only extraction.

/**
 * Extract a JSON-like value from an AST node.
 * Returns undefined if the node contains non-literal expressions.
 */
function extractLiteralValue(node: ts.Node): unknown {
  if (ts.isStringLiteral(node)) {
    return node.text;
  }

  if (ts.isNumericLiteral(node)) {
    return Number(node.text);
  }

  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }

  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }

  if (node.kind === ts.SyntaxKind.NullKeyword) {
    return null;
  }

  if (ts.isArrayLiteralExpression(node)) {
    const values: unknown[] = [];
    for (const element of node.elements) {
      const value = extractLiteralValue(element);
      if (value === undefined) {
        return undefined; // Non-literal in array
      }
      values.push(value);
    }
    return values;
  }

  if (ts.isObjectLiteralExpression(node)) {
    const obj: Record<string, unknown> = {};
    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop)) {
        return undefined; // Spread, shorthand, etc. not allowed
      }

      // Get property name
      let key: string | undefined;
      if (ts.isIdentifier(prop.name)) {
        key = prop.name.text;
      } else if (ts.isStringLiteral(prop.name)) {
        key = prop.name.text;
      } else {
        return undefined; // Computed property not allowed
      }

      const value = extractLiteralValue(prop.initializer);
      if (value === undefined) {
        return undefined; // Non-literal value
      }
      obj[key] = value;
    }
    return obj;
  }

  // Any other node type (identifiers, calls, etc.) is not allowed
  return undefined;
}

// ============================================================================
// Variant Extraction
// ============================================================================

/**
 * Check if an object literal looks like a StoryVariant.
 * Must have: meta (object with label), Story (function/arrow/method)
 */
function isStoryVariantShape(node: ts.ObjectLiteralExpression): boolean {
  let hasMeta = false;
  let hasStory = false;

  for (const prop of node.properties) {
    // Handle method syntax: Story(props) { ... }
    if (ts.isMethodDeclaration(prop)) {
      if (ts.isIdentifier(prop.name) && prop.name.text === 'Story') {
        hasStory = true;
      }
      continue;
    }

    if (!ts.isPropertyAssignment(prop)) continue;
    if (!ts.isIdentifier(prop.name)) continue;

    const name = prop.name.text;

    if (name === 'meta' && ts.isObjectLiteralExpression(prop.initializer)) {
      // Check meta has 'label'
      for (const metaProp of prop.initializer.properties) {
        if (
          ts.isPropertyAssignment(metaProp) &&
          ts.isIdentifier(metaProp.name) &&
          metaProp.name.text === 'label'
        ) {
          hasMeta = true;
          break;
        }
      }
    }

    if (name === 'Story') {
      // Story can be function expression or arrow function
      hasStory =
        ts.isFunctionExpression(prop.initializer) ||
        ts.isArrowFunction(prop.initializer);
    }
  }

  return hasMeta && hasStory;
}

/**
 * Extract variant data from an object literal.
 */
function extractVariantFromObject(
  exportName: string,
  node: ts.ObjectLiteralExpression,
): ExtractedVariant | { error: string } {
  let meta: StoryMeta | undefined;
  let review: PartialCaptureLaneConfig | undefined;
  let vrt: PartialCaptureLaneConfig | undefined;

  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (!ts.isIdentifier(prop.name)) continue;

    const name = prop.name.text;

    if (name === 'meta') {
      const extracted = extractLiteralValue(prop.initializer);
      if (extracted === undefined) {
        return { error: `meta in ${exportName} contains non-literal values` };
      }
      meta = extracted as StoryMeta;
    }

    if (name === 'review') {
      const extracted = extractLiteralValue(prop.initializer);
      if (extracted === undefined) {
        return { error: `review in ${exportName} contains non-literal values` };
      }
      review = extracted as PartialCaptureLaneConfig;
    }

    if (name === 'vrt') {
      const extracted = extractLiteralValue(prop.initializer);
      if (extracted === undefined) {
        return { error: `vrt in ${exportName} contains non-literal values` };
      }
      vrt = extracted as PartialCaptureLaneConfig;
    }
  }

  if (!meta) {
    return { error: `${exportName} is missing meta` };
  }

  return { exportName, meta, review, vrt };
}

// ============================================================================
// File Extraction
// ============================================================================

/**
 * Extract all story variants from a TypeScript source file.
 */
export function extractVariantsFromSource(
  sourceText: string,
  filePath: string,
): ExtractionResult {
  const variants: ExtractedVariant[] = [];
  const warnings: string[] = [];

  // Parse the source file
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  // Walk top-level statements looking for exports
  for (const statement of sourceFile.statements) {
    // Look for: export const X = { ... } satisfies StoryVariant
    // Or: export const X = { ... }
    if (!ts.isVariableStatement(statement)) continue;

    // Check for export modifier
    const hasExport = statement.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (!hasExport) continue;

    for (const decl of statement.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      const exportName = decl.name.text;

      let initNode = decl.initializer;

      // Handle `satisfies` expression: X = { ... } satisfies StoryVariant
      if (initNode && ts.isSatisfiesExpression(initNode)) {
        initNode = initNode.expression;
      }

      // Handle `as const` expression: X = { ... } as const
      if (initNode && ts.isAsExpression(initNode)) {
        initNode = initNode.expression;
      }

      if (!initNode || !ts.isObjectLiteralExpression(initNode)) continue;

      // Check if it looks like a StoryVariant
      if (!isStoryVariantShape(initNode)) continue;

      // Extract variant data
      const result = extractVariantFromObject(exportName, initNode);
      if ('error' in result) {
        warnings.push(`${filePath}: ${result.error}`);
        continue;
      }

      variants.push(result);
    }
  }

  return { variants, warnings };
}

/**
 * Extract variants from a file path.
 */
export async function extractVariantsFromFile(
  filePath: string,
): Promise<ExtractionResult> {
  const file = Bun.file(filePath);
  const sourceText = await file.text();
  return extractVariantsFromSource(sourceText, filePath);
}

// ============================================================================
// Normalization
// ============================================================================

/**
 * Default shot plan constant.
 */
const DEFAULT_SHOTS: StoryShotPlan = {
  sequences: [{ id: 'main', shots: [{ id: 'initial' }] }],
};

/**
 * Normalize a partial capture lane config to a full config.
 */
export function normalizeCaptureLaneConfig(
  partial: PartialCaptureLaneConfig | undefined,
  defaults: { enabled: boolean; shots?: StoryShotPlan },
): CaptureLaneConfig {
  return {
    enabled: partial?.enabled ?? defaults.enabled,
    shots: partial?.shots ?? defaults.shots ?? DEFAULT_SHOTS,
  };
}

/**
 * Normalize an extracted variant's capture configs.
 * - review.enabled defaults to true
 * - review.shots defaults to main/initial
 * - vrt.enabled defaults to false
 * - vrt.shots defaults to review.shots
 */
export function normalizeVariant(variant: ExtractedVariant): {
  meta: StoryMeta;
  review: CaptureLaneConfig;
  vrt: CaptureLaneConfig;
} {
  const review = normalizeCaptureLaneConfig(variant.review, {
    enabled: true,
    shots: DEFAULT_SHOTS,
  });

  const vrt = normalizeCaptureLaneConfig(variant.vrt, {
    enabled: false,
    shots: review.shots, // VRT inherits review shots if not specified
  });

  return {
    meta: variant.meta,
    review,
    vrt,
  };
}
