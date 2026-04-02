import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';

type TypeMacroDefinition = {
  packageName: string;
  exportName: string;
  typeParameters: string[];
  parameterTexts: string[];
  bodyText: string;
  isAsync: boolean;
  usesTypia: boolean;
  sourcePath: string;
};

type ImportBinding = {
  localName: string;
  importedName: string;
  moduleSpecifier: string;
};

export type TypeMacroExpandOptions = {
  cache?: boolean;
};

export type TypeMacroExpandResult = {
  code: string;
  expanded: boolean;
};

const macroPackageCache = new Map<
  string,
  { definitions: Map<string, TypeMacroDefinition>; mtimeMs: number }
>();
const resolvedPackageJsonCache = new Map<string, string | null>();
const moduleCompilerOptionsCache = new Map<string, ts.CompilerOptions>();

export function expandTypeMacrosInSource(
  filePath: string,
  source: string,
  options: TypeMacroExpandOptions = {},
): TypeMacroExpandResult {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const importBindings = collectImportBindings(sourceFile);
  if (importBindings.length === 0) {
    return { code: source, expanded: false };
  }

  const importerDir = path.dirname(filePath);
  const cacheEnabled = options.cache !== false;

  const macroByLocalName = new Map<string, TypeMacroDefinition>();
  for (const binding of importBindings) {
    const macro = resolveTypeMacroForBinding(
      binding,
      filePath,
      importerDir,
      cacheEnabled,
    );
    if (!macro) {
      continue;
    }
    macroByLocalName.set(binding.localName, macro);
  }

  if (macroByLocalName.size === 0) {
    return { code: source, expanded: false };
  }

  let didExpand = false;
  let requiresTypiaImport = false;

  const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
    const visit: ts.Visitor = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const macro = macroByLocalName.get(node.expression.text);
        if (macro) {
          if (!node.typeArguments || node.typeArguments.length === 0) {
            return ts.visitEachChild(node, visit, context);
          }

          didExpand = true;
          requiresTypiaImport ||= macro.usesTypia;
          const expandedNode = createExpandedMacroCall(node, sourceFile, macro);
          return ts.visitEachChild(expandedNode, visit, context);
        }
      }
      return ts.visitEachChild(node, visit, context);
    };

    return (node) => ts.visitNode(node, visit) as ts.SourceFile;
  };

  const transformed = ts.transform(sourceFile, [transformer]);
  let transformedSource = transformed.transformed[0] ?? sourceFile;

  if (
    didExpand &&
    requiresTypiaImport &&
    !hasRuntimeTypiaImport(transformedSource)
  ) {
    const typiaImport = ts.factory.createImportDeclaration(
      undefined,
      ts.factory.createImportClause(
        false,
        ts.factory.createIdentifier('typia'),
        undefined,
      ),
      ts.factory.createStringLiteral('typia'),
    );

    transformedSource = ts.factory.updateSourceFile(transformedSource, [
      typiaImport,
      ...transformedSource.statements,
    ]);
  }

  const code = ts.createPrinter().printFile(transformedSource);
  transformed.dispose();

  return { code, expanded: didExpand };
}

function collectImportBindings(sourceFile: ts.SourceFile): ImportBinding[] {
  const bindings: ImportBinding[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue;
    }
    if (!ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }

    const moduleSpecifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) {
      continue;
    }

    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if (element.isTypeOnly) {
          continue;
        }

        const importedName = element.propertyName
          ? element.propertyName.text
          : element.name.text;
        bindings.push({
          localName: element.name.text,
          importedName,
          moduleSpecifier,
        });
      }
    }
  }

  return bindings;
}

function resolveTypeMacroForBinding(
  binding: ImportBinding,
  importerFilePath: string,
  importerDir: string,
  cacheEnabled: boolean,
): TypeMacroDefinition | null {
  const packageJsonPath = resolveImportedPackageJson(
    binding.moduleSpecifier,
    importerFilePath,
    importerDir,
    cacheEnabled,
  );
  if (!packageJsonPath) {
    return null;
  }

  const macros = loadTypeMacrosForPackage(packageJsonPath, cacheEnabled);
  return macros.get(binding.importedName) ?? null;
}

function resolveImportedPackageJson(
  moduleSpecifier: string,
  importerFilePath: string,
  importerDir: string,
  cacheEnabled: boolean,
): string | null {
  const cacheKey = `${importerDir}::${moduleSpecifier}`;
  if (cacheEnabled && resolvedPackageJsonCache.has(cacheKey)) {
    return resolvedPackageJsonCache.get(cacheKey) ?? null;
  }

  const packageName = extractPackageName(moduleSpecifier);
  if (!packageName) {
    if (cacheEnabled) {
      resolvedPackageJsonCache.set(cacheKey, null);
    }
    return null;
  }

  let resolved: string | null = null;

  const compilerOptions = loadModuleCompilerOptions(importerDir, cacheEnabled);
  const resolvedModule = ts.resolveModuleName(
    moduleSpecifier,
    importerFilePath,
    compilerOptions,
    ts.sys,
  ).resolvedModule;

  if (resolvedModule?.resolvedFileName) {
    resolved = findNearestPackageJson(
      path.dirname(resolvedModule.resolvedFileName),
    );
  }

  if (!resolved) {
    resolved = findNearestPackageJsonByName(packageName, importerDir);
  }

  if (cacheEnabled) {
    resolvedPackageJsonCache.set(cacheKey, resolved);
  }

  return resolved;
}

function extractPackageName(moduleSpecifier: string): string | null {
  if (moduleSpecifier.startsWith('.') || moduleSpecifier.startsWith('/')) {
    return null;
  }

  const parts = moduleSpecifier.split('/').filter(Boolean);
  if (parts.length === 0) {
    return null;
  }

  if (moduleSpecifier.startsWith('@')) {
    if (parts.length < 2) {
      return null;
    }
    const scope = parts[0];
    const name = parts[1];
    return scope && name ? `${scope}/${name}` : null;
  }

  const packageName = parts[0];
  return packageName ?? null;
}

function loadModuleCompilerOptions(
  importerDir: string,
  cacheEnabled: boolean,
): ts.CompilerOptions {
  const tsconfigPath = ts.findConfigFile(
    importerDir,
    ts.sys.fileExists,
    'tsconfig.json',
  );

  if (!tsconfigPath) {
    return {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2020,
    };
  }

  if (cacheEnabled) {
    const cached = moduleCompilerOptionsCache.get(tsconfigPath);
    if (cached) {
      return cached;
    }
  }

  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(tsconfigPath),
  );

  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2020,
    ...parsed.options,
  };

  if (cacheEnabled) {
    moduleCompilerOptionsCache.set(tsconfigPath, options);
  }

  return options;
}

function findNearestPackageJsonByName(
  packageName: string,
  importerDir: string,
): string | null {
  const parts = packageName.split('/').filter(Boolean);
  if (parts.length === 0) {
    return null;
  }

  let currentDir = importerDir;
  while (true) {
    const packageJsonPath = path.join(
      currentDir,
      'node_modules',
      ...parts,
      'package.json',
    );
    if (fs.existsSync(packageJsonPath)) {
      return packageJsonPath;
    }

    const parent = path.dirname(currentDir);
    if (parent === currentDir) {
      break;
    }
    currentDir = parent;
  }

  return null;
}

function findNearestPackageJson(startDir: string): string | null {
  let currentDir = startDir;

  while (true) {
    const packageJsonPath = path.join(currentDir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      return packageJsonPath;
    }

    const parent = path.dirname(currentDir);
    if (parent === currentDir) {
      break;
    }
    currentDir = parent;
  }

  return null;
}

function loadTypeMacrosForPackage(
  packageJsonPath: string,
  cacheEnabled: boolean,
): Map<string, TypeMacroDefinition> {
  const currentMtimeMs = fs.statSync(packageJsonPath).mtimeMs;
  if (cacheEnabled) {
    const cached = macroPackageCache.get(packageJsonPath);
    if (cached && cached.mtimeMs >= currentMtimeMs) {
      return cached.definitions;
    }
  }

  const packageDir = path.dirname(packageJsonPath);
  const packageJsonRaw = fs.readFileSync(packageJsonPath, 'utf-8');
  const packageJson = JSON.parse(packageJsonRaw) as {
    name?: string;
    inkibra?: {
      ['build-pack']?: {
        ['type-macros']?: string[];
      };
    };
  };

  const typeMacroFiles =
    packageJson.inkibra?.['build-pack']?.['type-macros'] ?? [];

  const definitions = new Map<string, TypeMacroDefinition>();

  if (!Array.isArray(typeMacroFiles) || typeMacroFiles.length === 0) {
    if (cacheEnabled) {
      macroPackageCache.set(packageJsonPath, {
        definitions,
        mtimeMs: currentMtimeMs,
      });
    }
    return definitions;
  }

  const packageName = packageJson.name ?? packageDir;

  for (const typeMacroFile of typeMacroFiles) {
    if (typeof typeMacroFile !== 'string') {
      continue;
    }

    const macroPath = path.resolve(packageDir, typeMacroFile);
    if (!macroPath.endsWith('.type-macros.ts')) {
      throw new Error(
        `[type-macros] Macro file must use .type-macros.ts extension: ${macroPath}`,
      );
    }

    const fileDefinitions = parseTypeMacroFile(macroPath, packageName);
    for (const definition of fileDefinitions) {
      if (definitions.has(definition.exportName)) {
        throw new Error(
          `[type-macros] Duplicate macro export "${definition.exportName}" in package ${packageName}`,
        );
      }
      definitions.set(definition.exportName, definition);
    }
  }

  if (cacheEnabled) {
    macroPackageCache.set(packageJsonPath, {
      definitions,
      mtimeMs: currentMtimeMs,
    });
  }

  return definitions;
}

function parseTypeMacroFile(
  macroPath: string,
  packageName: string,
): TypeMacroDefinition[] {
  const source = fs.readFileSync(macroPath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    macroPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const definitions: TypeMacroDefinition[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isFunctionDeclaration(statement)) {
      continue;
    }
    if (!hasExportModifier(statement) || !statement.name || !statement.body) {
      continue;
    }
    if (!statement.typeParameters || statement.typeParameters.length === 0) {
      continue;
    }

    validateMacroFunction(statement, sourceFile, macroPath);

    const modifiers = ts.canHaveModifiers(statement)
      ? ts.getModifiers(statement)
      : undefined;
    const isAsync =
      modifiers?.some((mod) => mod.kind === ts.SyntaxKind.AsyncKeyword) ??
      false;

    definitions.push({
      packageName,
      exportName: statement.name.text,
      typeParameters: statement.typeParameters.map((param) => param.name.text),
      parameterTexts: statement.parameters.map((param) =>
        param.getText(sourceFile),
      ),
      bodyText: statement.body.getText(sourceFile),
      isAsync,
      usesTypia: /\btypia\./.test(statement.body.getText(sourceFile)),
      sourcePath: macroPath,
    });
  }

  return definitions;
}

function hasExportModifier(node: {
  modifiers?: ts.NodeArray<ts.ModifierLike>;
}): boolean {
  return (
    node.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    ) ?? false
  );
}

function validateMacroFunction(
  fn: ts.FunctionDeclaration,
  sourceFile: ts.SourceFile,
  macroPath: string,
): void {
  if (!fn.body || !fn.name) {
    return;
  }

  const declaredNames = new Set<string>();
  declaredNames.add(fn.name.text);

  // Collect module-level import bindings so macros can use imported helpers.
  for (const stmt of sourceFile.statements) {
    if (ts.isImportDeclaration(stmt) && stmt.importClause) {
      const clause = stmt.importClause;
      if (clause.name) {
        declaredNames.add(clause.name.text);
      }
      if (clause.namedBindings) {
        if (ts.isNamedImports(clause.namedBindings)) {
          for (const specifier of clause.namedBindings.elements) {
            declaredNames.add(specifier.name.text);
          }
        } else if (ts.isNamespaceImport(clause.namedBindings)) {
          declaredNames.add(clause.namedBindings.name.text);
        }
      }
    }
  }

  for (const param of fn.parameters) {
    addBindingNames(param.name, declaredNames);
  }

  collectDeclaredNames(fn.body, declaredNames);

  const usedNames = new Set<string>();
  collectUsedValueIdentifiers(fn.body, usedNames);

  const freeNames = [...usedNames].filter(
    (name) => name !== 'typia' && !declaredNames.has(name),
  );

  if (freeNames.length > 0) {
    throw new Error(
      `[type-macros] Macro ${fn.name.text} in ${macroPath} references free identifiers: ${freeNames.join(', ')}. Macro functions must be self-contained (no globals/free vars).`,
    );
  }

  const hasReturn = fn.body.statements.some((statement) =>
    ts.isReturnStatement(statement),
  );
  if (!hasReturn) {
    throw new Error(
      `[type-macros] Macro ${fn.name.text} in ${macroPath} must return a value.`,
    );
  }

  void sourceFile;
}

function addBindingNames(name: ts.BindingName, into: Set<string>): void {
  if (ts.isIdentifier(name)) {
    into.add(name.text);
    return;
  }

  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) {
        addBindingNames(element.name, into);
      }
    }
  }
}

function collectDeclaredNames(node: ts.Node, into: Set<string>): void {
  const visit = (current: ts.Node): void => {
    if (
      ts.isVariableDeclaration(current) ||
      ts.isParameter(current) ||
      ts.isBindingElement(current)
    ) {
      addBindingNames(current.name, into);
    } else if (
      (ts.isFunctionDeclaration(current) ||
        ts.isFunctionExpression(current) ||
        ts.isClassDeclaration(current)) &&
      current.name
    ) {
      into.add(current.name.text);
    } else if (ts.isCatchClause(current) && current.variableDeclaration) {
      addBindingNames(current.variableDeclaration.name, into);
    }

    ts.forEachChild(current, visit);
  };

  visit(node);
}

function collectUsedValueIdentifiers(node: ts.Node, into: Set<string>): void {
  const visit = (current: ts.Node): void => {
    if (isTypeOnlyNode(current)) {
      return;
    }

    if (ts.isIdentifier(current)) {
      const parent = current.parent;
      if (!parent) {
        return;
      }

      if (isDeclarationIdentifier(current, parent)) {
        return;
      }

      if (isPropertyNameIdentifier(current, parent)) {
        return;
      }

      into.add(current.text);
      return;
    }

    ts.forEachChild(current, visit);
  };

  visit(node);
}

function isTypeOnlyNode(node: ts.Node): boolean {
  return (
    ts.isTypeNode(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeParameterDeclaration(node)
  );
}

function isDeclarationIdentifier(
  identifier: ts.Identifier,
  parent: ts.Node,
): boolean {
  return (
    (ts.isVariableDeclaration(parent) && parent.name === identifier) ||
    (ts.isParameter(parent) && parent.name === identifier) ||
    (ts.isBindingElement(parent) && parent.name === identifier) ||
    ((ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent)) &&
      parent.name === identifier) ||
    (ts.isImportClause(parent) && parent.name === identifier) ||
    (ts.isImportSpecifier(parent) &&
      (parent.name === identifier || parent.propertyName === identifier)) ||
    (ts.isExportSpecifier(parent) &&
      (parent.name === identifier || parent.propertyName === identifier)) ||
    (ts.isTypeParameterDeclaration(parent) && parent.name === identifier)
  );
}

function isPropertyNameIdentifier(
  identifier: ts.Identifier,
  parent: ts.Node,
): boolean {
  if (ts.isPropertyAccessExpression(parent)) {
    return parent.name === identifier;
  }
  if (ts.isPropertyAssignment(parent)) {
    return parent.name === identifier && parent.initializer !== identifier;
  }
  if (
    ts.isPropertyDeclaration(parent) ||
    ts.isPropertySignature(parent) ||
    ts.isMethodDeclaration(parent) ||
    ts.isMethodSignature(parent) ||
    ts.isEnumMember(parent)
  ) {
    return parent.name === identifier;
  }
  if (ts.isQualifiedName(parent)) {
    return true;
  }
  return false;
}

function createExpandedMacroCall(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  macro: TypeMacroDefinition,
): ts.Expression {
  if (!call.typeArguments || call.typeArguments.length === 0) {
    throw new Error(
      `[type-macros] Macro ${macro.exportName} requires explicit type arguments in ${sourceFile.fileName}.`,
    );
  }

  if (call.typeArguments.length !== macro.typeParameters.length) {
    throw new Error(
      `[type-macros] Macro ${macro.exportName} expected ${macro.typeParameters.length} type argument(s), received ${call.typeArguments.length} in ${sourceFile.fileName}.`,
    );
  }

  const typeAliases = macro.typeParameters
    .map((name, index) => {
      const typeArgument = call.typeArguments?.[index];
      if (!typeArgument) {
        throw new Error(
          `[type-macros] Missing type argument ${index} for macro ${macro.exportName} in ${sourceFile.fileName}.`,
        );
      }
      return `type ${name} = ${typeArgument.getText(sourceFile)};`;
    })
    .join('\n');

  const bodyInner = stripBraces(macro.bodyText);
  const paramsText = macro.parameterTexts.join(', ');
  const argsText = call.arguments
    .map((arg) => arg.getText(sourceFile))
    .join(', ');
  const asyncPrefix = macro.isAsync ? 'async ' : '';

  const expandedExpressionText = `(${asyncPrefix}function(${paramsText}) {\n${typeAliases}${typeAliases.length > 0 ? '\n' : ''}${bodyInner}\n})(${argsText})`;
  const expandedExpression = parseExpression(expandedExpressionText);
  if (!expandedExpression) {
    throw new Error(
      `[type-macros] Failed to parse expanded macro ${macro.exportName} from ${macro.sourcePath}.`,
    );
  }

  return markNodeSynthetic(expandedExpression);
}

function stripBraces(blockText: string): string {
  const trimmed = blockText.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return trimmed;
  }
  return trimmed.slice(1, -1).trim();
}

function parseExpression(expressionText: string): ts.Expression | null {
  const sourceFile = ts.createSourceFile(
    'macro-expansion.ts',
    `const __macro_expanded = ${expressionText};`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const firstStatement = sourceFile.statements[0];
  if (!firstStatement || !ts.isVariableStatement(firstStatement)) {
    return null;
  }

  const declaration = firstStatement.declarationList.declarations[0];
  if (!declaration || !declaration.initializer) {
    return null;
  }

  return declaration.initializer;
}

function markNodeSynthetic<TNode extends ts.Node>(node: TNode): TNode {
  const visit = (current: ts.Node): void => {
    (current as { pos: number }).pos = -1;
    (current as { end: number }).end = -1;
    ts.forEachChild(current, visit);
  };

  visit(node);
  return node;
}

function hasRuntimeTypiaImport(sourceFile: ts.SourceFile): boolean {
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

    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) {
      continue;
    }

    return true;
  }

  return false;
}

export function clearTypeMacroCaches(): void {
  macroPackageCache.clear();
  resolvedPackageJsonCache.clear();
  moduleCompilerOptionsCache.clear();
}
