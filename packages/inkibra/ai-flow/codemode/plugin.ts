/**
 * Code Function Bun Plugin
 *
 * Transforms `.tool.ts` files into CodeFunction objects by:
 * 1. Extracting `defineCodeBinding(...)` metadata (JSDoc, types, deps)
 * 2. Generating CodeFunction wrappers with typia validators
 * 3. Running typia's transform to generate actual validators
 *
 * defineCodeBinding functions in .tool.ts files can have two parameters:
 * - First parameter: The input params (validated by typia)
 * - Second parameter: FunctionContext with { fs, ctx, deps, output }
 *
 * @example
 * ```typescript
 * // Register the plugin
 * import { codeBindingPlugin } from '@inkibra/ai-flow/codemode/plugin';
 * Bun.plugin(codeBindingPlugin);
 *
 * // Write a .tool.ts file with optional deps
 * // routines.tool.ts
 * import { defineCodeBinding } from '@inkibra/ai-flow/codemode';
 *
 * /**
 *  * Fetches a user by ID from the database
 *  *\/
 * export const fetchUser = defineCodeBinding(
 *   async function fetchUser(
 *     { userId }: { userId: string },
 *     { deps }: { deps: RoutineDeps }
 *   ): Promise<User> {
 *     deps.logger.debug('Fetching user', { userId });
 *     return deps.db.getUser(userId);
 *   },
 * );
 *
 * // Then import normally
 * import { fetchUser } from './routines.tool';
 * // fetchUser is now a CodeFunction<{ userId: string }, User, RoutineDeps>
 * ```
 */

import { createHash } from 'node:crypto';
import type { BunPlugin } from 'bun';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import ts from 'typescript';
import { transform as typiaTransform } from 'typia/lib/transform.js';

/**
 * Metadata extracted from a defineCodeBinding declaration
 */
export type BindingMeta = {
  name: string;
  description: string;
  paramsType: string;
  returnType: string;
  /** The deps type extracted from the second parameter, if any */
  depsType: string | null;
};

const CODE_BINDING_MARKER_NAMES = new Set(['defineCodeBinding']);

/**
 * Cache for tsconfig compiler options
 */
let cachedCompilerOptions: ts.CompilerOptions | undefined;

const codeModeTransformCacheDir = process.env.INKIBRA_TYPIA_CACHE_DIR
  ? join(process.env.INKIBRA_TYPIA_CACHE_DIR, 'codemode')
  : resolve(process.cwd(), 'node_modules/.cache/inkibra-typia/codemode');

function createCodeModeCacheKey(
  id: string,
  source: string,
  baseOptions: ts.CompilerOptions,
): string {
  return createHash('sha256')
    .update(
      [
        resolve(id),
        createHash('sha256').update(source).digest('hex'),
        ts.version,
        JSON.stringify(baseOptions),
      ].join('\n'),
    )
    .digest('hex');
}

/**
 * The Bun plugin for transforming .tool.ts files
 */
export const codeBindingPlugin: BunPlugin = {
  name: 'code-binding-transform',
  setup(build) {
    // Only process .tool.ts files
    build.onLoad({ filter: /\.tool\.ts$/ }, async (args) => {
      const source = await Bun.file(args.path).text();
      const id = args.path;

      try {
        // 1. Parse source and extract defineCodeBinding metadata
        const bindings = extractBindings(id, source);

        if (bindings.length === 0) {
          // No defineCodeBinding exports found, return as-is
          return { contents: source, loader: 'ts' };
        }

        // 2. Generate intermediate code with typia calls
        const intermediateCode = generateCodeBindings(source, bindings);

        // 3. Transform with typia to generate validators
        const finalCode = await transformWithTypia(id, intermediateCode);

        return {
          contents: finalCode,
          loader: 'js',
        };
      } catch (error) {
        console.error(`Error transforming ${id}:`, error);
        throw error;
      }
    });
  },
};

/**
 * Extract defineCodeBinding metadata from TypeScript source
 */
function extractBindings(id: string, source: string): BindingMeta[] {
  const sourceFile = ts.createSourceFile(
    id,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const bindings: BindingMeta[] = [];
  const legacyFunctionExports: string[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && hasExportModifier(statement)) {
      legacyFunctionExports.push(statement.name?.text ?? '<anonymous>');
      continue;
    }

    if (!ts.isVariableStatement(statement) || !hasExportModifier(statement)) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) {
        continue;
      }

      const name = declaration.name.text;
      const initializer = declaration.initializer;
      if (!initializer || !isCodeBindingCall(initializer)) {
        continue;
      }

      const functionNode = getCodeBindingFunctionArg(initializer);
      if (!functionNode) {
        throw new Error(
          `[codemode] Invalid defineCodeBinding declaration "${name}" in ${id}. Expected: export const ${name} = defineCodeBinding(async function ...).`,
        );
      }

      const description = extractJSDocDescription(statement, sourceFile, name);
      const paramsType = extractParamsType(functionNode, sourceFile);
      const returnType = extractReturnType(functionNode, sourceFile);
      const depsType = extractDepsType(functionNode, sourceFile);

      bindings.push({ name, description, paramsType, returnType, depsType });
    }
  }

  if (legacyFunctionExports.length > 0) {
    throw new Error(
      `[codemode] .tool.ts files now require defineCodeBinding syntax. Replace exported functions with export const <name> = defineCodeBinding(async function <name>(...) { ... }). Found legacy exports in ${id}: ${legacyFunctionExports.join(', ')}`,
    );
  }

  return bindings;
}

function hasExportModifier(node: {
  modifiers?: ts.NodeArray<ts.ModifierLike>;
}): boolean {
  return (
    node.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword) ??
    false
  );
}

function isCodeBindingCall(
  expression: ts.Expression,
): expression is ts.CallExpression {
  return (
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    CODE_BINDING_MARKER_NAMES.has(expression.expression.text)
  );
}

function getCodeBindingFunctionArg(
  call: ts.CallExpression,
): ts.FunctionExpression | ts.ArrowFunction | null {
  if (call.arguments.length !== 1) {
    return null;
  }
  const arg = call.arguments[0];
  if (!arg) {
    return null;
  }
  if (ts.isFunctionExpression(arg) || ts.isArrowFunction(arg)) {
    return arg;
  }
  return null;
}

/**
 * Extract JSDoc description from a node
 */
function extractJSDocDescription(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  fallbackName?: string,
): string {
  const jsDocs = ts.getJSDocCommentsAndTags(node);

  for (const jsDoc of jsDocs) {
    if (ts.isJSDoc(jsDoc)) {
      if (typeof jsDoc.comment === 'string') {
        return jsDoc.comment;
      }
      if (Array.isArray(jsDoc.comment)) {
        return jsDoc.comment
          .map((part) =>
            'text' in part ? (part as { text: string }).text : '',
          )
          .join('');
      }
    }
  }

  // Fallback: try to get leading comment
  const fullText = sourceFile.getFullText();
  const nodeStart = node.getFullStart();
  const leadingComments = ts.getLeadingCommentRanges(fullText, nodeStart);

  if (leadingComments && leadingComments.length > 0) {
    const lastComment = leadingComments[leadingComments.length - 1];
    if (lastComment) {
      const commentText = fullText.slice(lastComment.pos, lastComment.end);

      // Parse /** ... */ style comments
      const match = commentText.match(/\/\*\*\s*([\s\S]*?)\s*\*\//);
      if (match && match[1]) {
        return match[1]
          .split('\n')
          .map((line) => line.replace(/^\s*\*\s?/, '').trim())
          .filter((line) => !line.startsWith('@'))
          .join(' ')
          .trim();
      }
    }
  }

  const name =
    fallbackName ??
    (ts.isFunctionDeclaration(node) && node.name
      ? node.name.text
      : ts.isVariableStatement(node)
        ? node.declarationList.declarations
            .find((decl) => ts.isIdentifier(decl.name))
            ?.name.getText(sourceFile)
        : 'unknown');

  return `Function ${name}`;
}

/**
 * Extract the first parameter type (input params) as a string
 */
function extractParamsType(
  node: ts.FunctionLikeDeclarationBase,
  sourceFile: ts.SourceFile,
): string {
  if (node.parameters.length === 0) {
    return '{}';
  }

  // We expect a single destructured parameter like { userId }: { userId: string }
  const param = node.parameters[0]!;

  if (param.type) {
    return param.type.getText(sourceFile);
  }

  // Fallback: try to reconstruct from destructuring pattern
  if (ts.isObjectBindingPattern(param.name)) {
    const properties: string[] = [];
    for (const element of param.name.elements) {
      if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) {
        properties.push(`${element.name.text}: unknown`);
      }
    }
    return `{ ${properties.join('; ')} }`;
  }

  return 'unknown';
}

/**
 * Extract the deps type from the second parameter using TypeScript AST.
 *
 * Expected patterns:
 * - { deps }: { deps: RoutineDeps }
 * - { deps, ctx }: { deps: RoutineDeps; ctx: FlowContext }
 * - context: FunctionContext<FlowContext, RoutineDeps, Output>
 *
 * Returns null if no deps type found.
 */
function extractDepsType(
  node: ts.FunctionLikeDeclarationBase,
  sourceFile: ts.SourceFile,
): string | null {
  if (node.parameters.length < 2) {
    return null;
  }

  const secondParam = node.parameters[1]!;
  if (!secondParam.type) {
    return null;
  }

  // Pattern 1: { deps: RoutineDeps; ... } - inline object type literal
  if (ts.isTypeLiteralNode(secondParam.type)) {
    return extractDepsFromTypeLiteral(secondParam.type, sourceFile);
  }

  // Pattern 2: FunctionContext<TCtx, TDeps, TOutput> - type reference with generics
  if (ts.isTypeReferenceNode(secondParam.type)) {
    return extractDepsFromTypeReference(secondParam.type, sourceFile);
  }

  return null;
}

/**
 * Extract deps type from an inline object type literal: { deps: RoutineDeps; ... }
 * Uses TypeScript AST to properly handle nested generics, unions, and complex types.
 */
function extractDepsFromTypeLiteral(
  typeLiteral: ts.TypeLiteralNode,
  sourceFile: ts.SourceFile,
): string | null {
  for (const member of typeLiteral.members) {
    if (
      ts.isPropertySignature(member) &&
      member.name &&
      ts.isIdentifier(member.name) &&
      member.name.text === 'deps' &&
      member.type
    ) {
      return member.type.getText(sourceFile);
    }
  }
  return null;
}

/**
 * Extract deps type from a type reference like FunctionContext<TCtx, TDeps, TOutput>
 * by accessing the second type argument directly from the AST.
 * This properly handles nested generics without manual bracket counting.
 */
function extractDepsFromTypeReference(
  typeRef: ts.TypeReferenceNode,
  sourceFile: ts.SourceFile,
): string | null {
  const typeName = getTypeReferenceName(typeRef.typeName);

  // FunctionContext<TCtx, TDeps, TOutput> - we want TDeps (index 1)
  if (
    typeName === 'FunctionContext' &&
    typeRef.typeArguments &&
    typeRef.typeArguments.length >= 2
  ) {
    return typeRef.typeArguments[1]!.getText(sourceFile);
  }

  return null;
}

/**
 * Get the name from a TypeReferenceNode's typeName.
 * Handles both simple identifiers (Foo) and qualified names (Ns.Foo).
 */
function getTypeReferenceName(typeName: ts.EntityName): string {
  if (ts.isIdentifier(typeName)) {
    return typeName.text;
  }
  if (ts.isQualifiedName(typeName)) {
    return typeName.right.text;
  }
  return '';
}

/**
 * Extract the return type as a string
 */
function extractReturnType(
  node: ts.FunctionLikeDeclarationBase,
  sourceFile: ts.SourceFile,
): string {
  if (node.type) {
    return node.type.getText(sourceFile);
  }

  // Check if function is async
  const modifiers = ts.canHaveModifiers(node)
    ? ts.getModifiers(node)
    : undefined;
  const isAsync =
    modifiers?.some((mod) => mod.kind === ts.SyntaxKind.AsyncKeyword) ?? false;

  return isAsync ? 'Promise<unknown>' : 'unknown';
}

/**
 * Extract result type from Promise<T> or return type directly
 */
function extractResultType(returnType: string): string {
  const match = returnType.match(/^Promise<(.+)>$/);
  if (match && match[1]) {
    return match[1];
  }
  return returnType;
}

/**
 * Generate intermediate code with CodeFunction wrappers and typia calls
 */
function generateCodeBindings(
  originalSource: string,
  bindings: BindingMeta[],
): string {
  const sourceFile = ts.createSourceFile(
    'code.tool.ts',
    originalSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const bindingMap = new Map(
    bindings.map((binding) => [binding.name, binding]),
  );
  const transformedStatements: ts.Statement[] = [];

  const typiaIdentifier = getOrCreateTypiaIdentifier(
    sourceFile,
    transformedStatements,
  );

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || !hasExportModifier(statement)) {
      transformedStatements.push(statement);
      continue;
    }

    const preservedDeclarations: ts.VariableDeclaration[] = [];

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) {
        preservedDeclarations.push(declaration);
        continue;
      }

      const binding = bindingMap.get(declaration.name.text);
      if (!binding) {
        preservedDeclarations.push(declaration);
        continue;
      }

      const initializer = declaration.initializer;
      if (!initializer || !isCodeBindingCall(initializer)) {
        preservedDeclarations.push(declaration);
        continue;
      }

      const functionNode = getCodeBindingFunctionArg(initializer);
      if (!functionNode) {
        throw new Error(
          `[codemode] Invalid defineCodeBinding declaration "${binding.name}". Expected: defineCodeBinding(async function ...).`,
        );
      }

      const originalFunctionName = `__original_${binding.name}`;

      transformedStatements.push(
        ts.factory.createVariableStatement(
          undefined,
          ts.factory.createVariableDeclarationList(
            [
              ts.factory.createVariableDeclaration(
                ts.factory.createIdentifier(originalFunctionName),
                undefined,
                undefined,
                functionNode,
              ),
            ],
            ts.NodeFlags.Const,
          ),
        ),
      );

      transformedStatements.push(
        createCodeBindingExportStatement(
          binding,
          originalFunctionName,
          typiaIdentifier,
        ),
      );
    }

    if (preservedDeclarations.length > 0) {
      transformedStatements.push(
        ts.factory.updateVariableStatement(
          statement,
          statement.modifiers,
          ts.factory.updateVariableDeclarationList(
            statement.declarationList,
            preservedDeclarations,
          ),
        ),
      );
    }
  }

  const transformedSourceFile = ts.factory.updateSourceFile(
    sourceFile,
    transformedStatements,
  );

  return ts.createPrinter().printFile(transformedSourceFile);
}

function getOrCreateTypiaIdentifier(
  sourceFile: ts.SourceFile,
  statements: ts.Statement[],
): string {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue;
    }
    if (
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'typia'
    ) {
      continue;
    }

    const importClause = statement.importClause;
    if (!importClause) {
      continue;
    }

    if (importClause.name) {
      return importClause.name.text;
    }

    if (
      importClause.namedBindings &&
      ts.isNamespaceImport(importClause.namedBindings)
    ) {
      return importClause.namedBindings.name.text;
    }
  }

  const typiaImport = ts.factory.createImportDeclaration(
    undefined,
    ts.factory.createImportClause(
      false,
      ts.factory.createIdentifier('typia'),
      undefined,
    ),
    ts.factory.createStringLiteral('typia'),
  );

  statements.push(typiaImport);
  return 'typia';
}

function createCodeBindingExportStatement(
  binding: BindingMeta,
  originalFunctionName: string,
  typiaIdentifier: string,
): ts.VariableStatement {
  const declaration = `(params: ${binding.paramsType}) => ${binding.returnType}`;

  return ts.factory.createVariableStatement(
    [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
    ts.factory.createVariableDeclarationList(
      [
        ts.factory.createVariableDeclaration(
          ts.factory.createIdentifier(binding.name),
          undefined,
          undefined,
          ts.factory.createObjectLiteralExpression(
            [
              ts.factory.createPropertyAssignment(
                'description',
                ts.factory.createStringLiteral(binding.description),
              ),
              ts.factory.createPropertyAssignment(
                'declaration',
                ts.factory.createStringLiteral(declaration),
              ),
              ts.factory.createPropertyAssignment(
                'validate',
                ts.factory.createCallExpression(
                  ts.factory.createPropertyAccessExpression(
                    ts.factory.createIdentifier(typiaIdentifier),
                    'createValidate',
                  ),
                  [parseTypeNode(binding.paramsType)],
                  [],
                ),
              ),
              ts.factory.createPropertyAssignment(
                'fn',
                ts.factory.createIdentifier(originalFunctionName),
              ),
            ],
            true,
          ),
        ),
      ],
      ts.NodeFlags.Const,
    ),
  );
}

function parseTypeNode(typeText: string): ts.TypeNode {
  const source = ts.createSourceFile(
    'type.ts',
    `type __CodeToolType = ${typeText};`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const statement = source.statements[0];
  if (!statement || !ts.isTypeAliasDeclaration(statement)) {
    throw new Error(`[codemode] Failed to parse type: ${typeText}`);
  }

  return statement.type;
}

/**
 * Get TypeScript compiler options from tsconfig.json
 */
async function getTsCompilerOptions(): Promise<ts.CompilerOptions> {
  if (cachedCompilerOptions) {
    return cachedCompilerOptions;
  }

  // Try to find and parse tsconfig.json
  const tsconfigPath = await findTsConfig();

  if (tsconfigPath) {
    const result = ts.readConfigFile(tsconfigPath, ts.sys.readFile);

    if (!result.error) {
      const parsed = ts.parseJsonConfigFileContent(
        result.config,
        ts.sys,
        dirname(tsconfigPath),
      );
      cachedCompilerOptions = parsed.options;
      return cachedCompilerOptions;
    }
  }

  // Fallback to sensible defaults
  cachedCompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
  };

  return cachedCompilerOptions;
}

/**
 * Find tsconfig.json by walking up directories
 */
async function findTsConfig(): Promise<string | null> {
  let dir = process.cwd();

  // Check parent directories until we reach the root
  // On Unix: dirname('/') === '/'
  // On Windows: dirname('C:\\') === 'C:\\'
  let prevDir = '';
  while (dir !== prevDir) {
    const tsconfigPath = resolve(dir, 'tsconfig.json');
    if (existsSync(tsconfigPath)) {
      return tsconfigPath;
    }
    prevDir = dir;
    dir = dirname(dir);
  }

  return null;
}

/**
 * Run typia's transform to generate validators and emit JavaScript
 */
async function transformWithTypia(id: string, source: string): Promise<string> {
  // Get tsconfig compiler options
  const baseOptions = await getTsCompilerOptions();
  const cacheKey = createCodeModeCacheKey(id, source, baseOptions);
  const cachePath = join(codeModeTransformCacheDir, `${cacheKey}.js`);

  if (existsSync(cachePath)) {
    return readFileSync(cachePath, 'utf-8');
  }

  // Compiler options for emit (output JS, not TS)
  const compilerOptions: ts.CompilerOptions = {
    ...baseOptions,
    declaration: false,
    declarationMap: false,
    sourceMap: false,
    inlineSourceMap: false,
    removeComments: false,
    // Ensure we emit JS
    noEmit: false,
  };

  // Create source file
  const sourceFile = ts.createSourceFile(
    id,
    source,
    compilerOptions.target ?? ts.ScriptTarget.ES2020,
  );

  // Create compiler host with custom emit
  const host = createCompilerHost(id, sourceFile, compilerOptions);

  // Capture emitted output
  let emittedOutput = '';
  host.writeFile = (fileName, text) => {
    if (fileName.endsWith('.js')) {
      emittedOutput = text;
    }
  };

  // Create program
  const program = ts.createProgram([id], compilerOptions, host);

  // Create typia transformer
  const diagnostics: ts.Diagnostic[] = [];
  const typiaTransformer = typiaTransform(
    program,
    {},
    {
      addDiagnostic(diag) {
        return diagnostics.push(diag);
      },
    },
  );

  // Emit with the typia transformer
  const emitResult = program.emit(sourceFile, undefined, undefined, false, {
    before: [typiaTransformer],
  });

  if (diagnostics.length > 0) {
    for (const diagnostic of diagnostics) {
      const message = ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        '\n',
      );
      console.warn(`[typia] ${message}`);
    }
  }

  // Check for emit errors
  const allDiagnostics = [...emitResult.diagnostics, ...diagnostics];
  if (allDiagnostics.some((d) => d.category === ts.DiagnosticCategory.Error)) {
    const errors = allDiagnostics
      .filter((d) => d.category === ts.DiagnosticCategory.Error)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
      .join('\n');
    throw new Error(`TypeScript emit errors:\n${errors}`);
  }

  if (!emittedOutput) {
    throw new Error(`No output emitted for ${id}`);
  }

  mkdirSync(codeModeTransformCacheDir, { recursive: true });
  writeFileSync(cachePath, emittedOutput, 'utf-8');

  return emittedOutput;
}

/**
 * Create a minimal compiler host that serves our source file
 */
function createCompilerHost(
  id: string,
  sourceFile: ts.SourceFile,
  compilerOptions: ts.CompilerOptions,
): ts.CompilerHost {
  const host = ts.createCompilerHost(compilerOptions);
  const originalGetSourceFile = host.getSourceFile.bind(host);

  // Source file cache for performance
  const sourceFileCache = new Map<string, ts.SourceFile>();
  sourceFileCache.set(resolve(id), sourceFile);

  host.getSourceFile = (fileName, languageVersion) => {
    const resolvedPath = resolve(fileName);

    // Check cache first
    const cached = sourceFileCache.get(resolvedPath);
    if (cached) {
      return cached;
    }

    // Check if it's our target file
    if (resolvedPath === resolve(id)) {
      return sourceFile;
    }

    // Try to read from disk
    const content = ts.sys.readFile(fileName);
    if (content !== undefined) {
      const file = ts.createSourceFile(fileName, content, languageVersion);
      sourceFileCache.set(resolvedPath, file);
      return file;
    }

    // Fallback to original
    return originalGetSourceFile(fileName, languageVersion);
  };

  return host;
}

// Export for programmatic use
export default codeBindingPlugin;

// Export internal functions for testing
export const _testing = {
  extractBindings,
  extractJSDocDescription,
  extractParamsType,
  extractDepsType,
  extractReturnType,
  extractResultType,
  generateCodeBindings,
  transformWithTypia,
};
