/**
 * Vanilla Extract Noop Stub
 *
 * Provides noop implementations of @vanilla-extract/css functions for SSR.
 * When VE build support is disabled, this allows .css.ts files to execute
 * without crashing, returning empty class names.
 *
 * Note: Class names won't match between server and client. The client build
 * still uses real VE, so styles will work after hydration. There may be a
 * brief flash of unstyled content (FOUC) on initial load.
 */

// Counter for generating unique class names
let classCounter = 0;

function generateClassName(debugId?: string): string {
  classCounter++;
  return debugId ? `${debugId}_${classCounter}` : `ve_${classCounter}`;
}

// ============================================================================
// @vanilla-extract/css exports
// ============================================================================

/**
 * Noop style() - returns empty string (no class name)
 */
export function style(_rule: unknown, debugId?: string): string {
  return generateClassName(debugId);
}

/**
 * Noop styleVariants() - returns object with empty string values
 */
export function styleVariants<
  StyleMap extends Record<string | number, unknown>,
>(
  styleMap: StyleMap,
  _mapFn?: unknown,
  debugId?: string,
): Record<keyof StyleMap, string> {
  const result = {} as Record<keyof StyleMap, string>;
  for (const key of Object.keys(styleMap) as Array<keyof StyleMap>) {
    result[key] = generateClassName(
      debugId ? `${debugId}_${String(key)}` : undefined,
    );
  }
  return result;
}

/**
 * Noop globalStyle() - does nothing
 */
export function globalStyle(_selector: string, _rule: unknown): void {
  // noop
}

/**
 * Noop keyframes() - returns empty animation name
 */
export function keyframes(_rule: unknown, debugId?: string): string {
  return generateClassName(debugId);
}

/**
 * Noop fontFace() - returns empty font family
 */
export function fontFace(_rule: unknown, debugId?: string): string {
  return generateClassName(debugId);
}

/**
 * Noop createVar() - returns CSS variable reference
 */
export function createVar(debugId?: string): string {
  return `var(--${generateClassName(debugId)})`;
}

/**
 * Noop fallbackVar() - returns first var
 */
export function fallbackVar(...vars: string[]): string {
  return vars[0] || '';
}

/**
 * Noop assignVars() - returns empty object
 */
export function assignVars(
  _contract: unknown,
  _values: unknown,
): Record<string, string> {
  return {};
}

/**
 * Noop createThemeContract() - returns proxy that returns CSS variable refs
 */
export function createThemeContract<Contract extends Record<string, unknown>>(
  contract: Contract,
): Contract {
  return createVarsProxy(contract, []) as Contract;
}

function createVarsProxy(obj: unknown, path: string[]): unknown {
  if (obj === null || typeof obj !== 'object') {
    // Leaf node - return a CSS variable reference
    const varName = path.join('-') || 'var';
    return `var(--${varName})`;
  }

  return new Proxy(obj as Record<string, unknown>, {
    get(target, prop) {
      if (typeof prop === 'string') {
        const value = target[prop];
        return createVarsProxy(value, [...path, prop]);
      }
      return undefined;
    },
  });
}

/**
 * Noop createTheme() - returns class name
 */
export function createTheme(
  _contractOrVars: unknown,
  _tokens?: unknown,
  debugId?: string,
): string {
  return generateClassName(debugId);
}

/**
 * Noop createGlobalTheme() - does nothing
 */
export function createGlobalTheme(
  _selector: string,
  _contractOrTokens: unknown,
  _tokens?: unknown,
): void {
  // noop
}

/**
 * Noop createGlobalThemeContract() - returns proxy
 */
export function createGlobalThemeContract<
  Contract extends Record<string, unknown>,
>(contract: Contract): Contract {
  return createThemeContract(contract);
}

/**
 * Noop composeStyles() - joins class names
 */
export function composeStyles(
  ...classNames: Array<string | undefined>
): string {
  return classNames.filter(Boolean).join(' ');
}

/**
 * Noop layer() - returns layer name
 */
export function layer(
  options?: { parent?: string } | string,
  debugId?: string,
): string {
  if (typeof options === 'string') {
    debugId = options;
  }
  return generateClassName(debugId);
}

/**
 * Noop globalLayer() - returns layer name
 */
export function globalLayer(
  options?: { parent?: string } | string,
  debugId?: string,
): string {
  return layer(options, debugId);
}

// ============================================================================
// @vanilla-extract/css/fileScope exports
// ============================================================================

let currentFileScope: { filePath: string; packageName?: string } | null = null;

export function setFileScope(filePath: string, packageName?: string): void {
  currentFileScope = { filePath, packageName };
}

export function endFileScope(): void {
  currentFileScope = null;
}

export function getFileScope(): { filePath: string; packageName?: string } {
  if (!currentFileScope) {
    // Return a dummy scope instead of throwing
    return { filePath: 'unknown', packageName: undefined };
  }
  return currentFileScope;
}

export function hasFileScope(): boolean {
  return currentFileScope !== null;
}

// ============================================================================
// @vanilla-extract/recipes exports (commonly used with VE)
// ============================================================================

export function recipe(_options: unknown): (...args: unknown[]) => string {
  const baseName = generateClassName('recipe');
  return (..._variants: unknown[]) => baseName;
}

// ============================================================================
// @vanilla-extract/sprinkles exports (commonly used with VE)
// ============================================================================

export function createSprinkles(
  ..._configs: unknown[]
): (...args: unknown[]) => string {
  return (..._props: unknown[]) => generateClassName('sprinkles');
}

export function defineProperties(_options: unknown): unknown {
  return {};
}

// ============================================================================
// Reset counter (useful for testing)
// ============================================================================

export function resetCounter(): void {
  classCounter = 0;
}
