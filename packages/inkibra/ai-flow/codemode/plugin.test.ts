import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import { _testing, type BindingMeta } from './plugin';

const {
  extractBindings,
  extractJSDocDescription,
  extractParamsType,
  extractDepsType,
  extractReturnType,
  extractResultType,
  generateCodeBindings,
} = _testing;

// Helper to create a source file for testing
function createSourceFile(source: string, filename = 'test.ts'): ts.SourceFile {
  return ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
}

// Helper to get a function declaration from source
function getFunctionDeclaration(
  source: string,
  funcName: string,
): ts.FunctionDeclaration | undefined {
  const sourceFile = createSourceFile(source);
  let result: ts.FunctionDeclaration | undefined;

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === funcName) {
      result = node;
    }
  });

  return result;
}

describe('plugin', () => {
  describe('unit tests', () => {
    describe('extractResultType', () => {
      test('extracts type from Promise<T>', () => {
        expect(extractResultType('Promise<User>')).toBe('User');
        expect(extractResultType('Promise<{ id: string }>')).toBe(
          '{ id: string }',
        );
        expect(extractResultType('Promise<void>')).toBe('void');
      });

      test('returns type as-is for non-Promise types', () => {
        expect(extractResultType('string')).toBe('string');
        expect(extractResultType('User')).toBe('User');
        expect(extractResultType('void')).toBe('void');
      });
    });

    describe('extractJSDocDescription', () => {
      test('extracts description from JSDoc comment', () => {
        const source = `
  /**
   * Fetches a user by ID
   */
  export async function fetchUser() {}
  `;
        const sourceFile = createSourceFile(source);
        const funcDecl = getFunctionDeclaration(source, 'fetchUser');
        expect(funcDecl).toBeDefined();

        const description = extractJSDocDescription(funcDecl!, sourceFile);
        expect(description).toBe('Fetches a user by ID');
      });

      test('extracts multi-line description', () => {
        const source = `
  /**
   * Fetches a user by ID
   * from the database
   */
  export async function fetchUser() {}
  `;
        const sourceFile = createSourceFile(source);
        const funcDecl = getFunctionDeclaration(source, 'fetchUser');

        const description = extractJSDocDescription(funcDecl!, sourceFile);
        expect(description).toContain('Fetches a user by ID');
        expect(description).toContain('from the database');
      });

      test('ignores @param and @returns tags', () => {
        const source = `
  /**
   * Fetches a user by ID
   * @param userId - The user ID
   * @returns The user object
   */
  export async function fetchUser() {}
  `;
        const sourceFile = createSourceFile(source);
        const funcDecl = getFunctionDeclaration(source, 'fetchUser');

        const description = extractJSDocDescription(funcDecl!, sourceFile);
        expect(description).toBe('Fetches a user by ID');
        expect(description).not.toContain('@param');
        expect(description).not.toContain('@returns');
      });

      test('returns fallback for function without JSDoc', () => {
        const source = 'export async function fetchUser() {}';
        const sourceFile = createSourceFile(source);
        const funcDecl = getFunctionDeclaration(source, 'fetchUser');

        const description = extractJSDocDescription(funcDecl!, sourceFile);
        expect(description).toBe('Function fetchUser');
      });
    });

    describe('extractParamsType', () => {
      test('extracts typed parameter', () => {
        const source =
          'export async function fetchUser({ userId }: { userId: string }) {}';
        const sourceFile = createSourceFile(source);
        const funcDecl = getFunctionDeclaration(source, 'fetchUser');

        const paramsType = extractParamsType(funcDecl!, sourceFile);
        expect(paramsType).toBe('{ userId: string }');
      });

      test('extracts complex parameter type', () => {
        const source =
          'export async function sendEmail({ to, subject, body }: { to: string; subject: string; body: string }) {}';
        const sourceFile = createSourceFile(source);
        const funcDecl = getFunctionDeclaration(source, 'sendEmail');

        const paramsType = extractParamsType(funcDecl!, sourceFile);
        expect(paramsType).toBe(
          '{ to: string; subject: string; body: string }',
        );
      });

      test('returns empty object for no parameters', () => {
        const source = 'export function getTime() {}';
        const sourceFile = createSourceFile(source);
        const funcDecl = getFunctionDeclaration(source, 'getTime');

        const paramsType = extractParamsType(funcDecl!, sourceFile);
        expect(paramsType).toBe('{}');
      });

      test('extracts named type reference', () => {
        const source = `
  type UserParams = { userId: string };
  export async function fetchUser(params: UserParams) {}
  `;
        const sourceFile = createSourceFile(source);
        const funcDecl = getFunctionDeclaration(source, 'fetchUser');

        const paramsType = extractParamsType(funcDecl!, sourceFile);
        expect(paramsType).toBe('UserParams');
      });
    });

    describe('extractReturnType', () => {
      test('extracts explicit return type', () => {
        const source = 'export async function fetchUser(): Promise<User> {}';
        const sourceFile = createSourceFile(source);
        const funcDecl = getFunctionDeclaration(source, 'fetchUser');

        const returnType = extractReturnType(funcDecl!, sourceFile);
        expect(returnType).toBe('Promise<User>');
      });

      test('returns Promise<unknown> for async function without return type', () => {
        const source = 'export async function fetchUser() {}';
        const sourceFile = createSourceFile(source);
        const funcDecl = getFunctionDeclaration(source, 'fetchUser');

        const returnType = extractReturnType(funcDecl!, sourceFile);
        expect(returnType).toBe('Promise<unknown>');
      });

      test('returns unknown for sync function without return type', () => {
        const source = 'export function getTime() {}';
        const sourceFile = createSourceFile(source);
        const funcDecl = getFunctionDeclaration(source, 'getTime');

        const returnType = extractReturnType(funcDecl!, sourceFile);
        expect(returnType).toBe('unknown');
      });

      test('extracts inline return type', () => {
        const source =
          'export async function sendEmail(): Promise<{ sent: boolean }> {}';
        const sourceFile = createSourceFile(source);
        const funcDecl = getFunctionDeclaration(source, 'sendEmail');

        const returnType = extractReturnType(funcDecl!, sourceFile);
        expect(returnType).toBe('Promise<{ sent: boolean }>');
      });
    });

    describe('extractDepsType', () => {
      test('extracts deps from inline object type', () => {
        const source = `
  export async function test(
  params: { id: string },
  { deps }: { deps: RoutineDeps }
  ): Promise<void> {}
  `;
        const sourceFile = createSourceFile(source);
        const funcDecl = getFunctionDeclaration(source, 'test');

        const depsType = extractDepsType(funcDecl!, sourceFile);
        expect(depsType).toBe('RoutineDeps');
      });

      test('extracts deps from FunctionContext generic', () => {
        const source = `
  export async function test(
  params: { id: string },
  context: FunctionContext<FlowCtx, RoutineDeps, Output>
  ): Promise<void> {}
  `;
        const sourceFile = createSourceFile(source);
        const funcDecl = getFunctionDeclaration(source, 'test');

        const depsType = extractDepsType(funcDecl!, sourceFile);
        expect(depsType).toBe('RoutineDeps');
      });

      test('handles nested generics in deps', () => {
        const source = `
  export async function test(
  params: unknown,
  { deps }: { deps: Record<string, Map<K, V>> }
  ): Promise<void> {}
  `;
        const sourceFile = createSourceFile(source);
        const funcDecl = getFunctionDeclaration(source, 'test');

        const depsType = extractDepsType(funcDecl!, sourceFile);
        expect(depsType).toBe('Record<string, Map<K, V>>');
      });

      test('handles union types in deps', () => {
        const source = `
  export async function test(
  params: unknown,
  { deps }: { deps: Logger | undefined }
  ): Promise<void> {}
  `;
        const sourceFile = createSourceFile(source);
        const funcDecl = getFunctionDeclaration(source, 'test');

        const depsType = extractDepsType(funcDecl!, sourceFile);
        expect(depsType).toBe('Logger | undefined');
      });

      test('handles qualified FunctionContext name', () => {
        const source = `
  export async function test(
  params: unknown,
  context: codemode.FunctionContext<A, B, C>
  ): Promise<void> {}
  `;
        const sourceFile = createSourceFile(source);
        const funcDecl = getFunctionDeclaration(source, 'test');

        const depsType = extractDepsType(funcDecl!, sourceFile);
        expect(depsType).toBe('B');
      });

      test('returns null for function without second param', () => {
        const source =
          'export async function test(params: { id: string }): Promise<void> {}';
        const sourceFile = createSourceFile(source);
        const funcDecl = getFunctionDeclaration(source, 'test');

        const depsType = extractDepsType(funcDecl!, sourceFile);
        expect(depsType).toBeNull();
      });

      test('returns null for unrecognized second param type', () => {
        const source = `
  export async function test(
  params: unknown,
  options: SomeOtherType
  ): Promise<void> {}
  `;
        const sourceFile = createSourceFile(source);
        const funcDecl = getFunctionDeclaration(source, 'test');

        const depsType = extractDepsType(funcDecl!, sourceFile);
        expect(depsType).toBeNull();
      });

      test('handles multiple properties in context object', () => {
        const source = `
  export async function test(
  params: unknown,
  { deps, ctx, output }: { deps: RoutineDeps; ctx: FlowContext; output: OutputAcc }
  ): Promise<void> {}
  `;
        const sourceFile = createSourceFile(source);
        const funcDecl = getFunctionDeclaration(source, 'test');

        const depsType = extractDepsType(funcDecl!, sourceFile);
        expect(depsType).toBe('RoutineDeps');
      });
    });

    describe('extractBindings', () => {
      test('extracts exported defineCodeBinding bindings', () => {
        const source = `
  import { defineCodeBinding } from '@inkibra/ai-flow/codemode';

  /**
   * Fetches a user
   */
  export const fetchUser = defineCodeBinding(async function fetchUser(
    { userId }: { userId: string }
  ): Promise<User> {
    return {} as User;
  });

  /**
   * Sends email
   */
  export const sendEmail = defineCodeBinding(async function sendEmail(
    { to }: { to: string }
  ): Promise<void> {});

  // Non-exported
  async function internal() {}
  `;
        const bindings = extractBindings('test.ts', source);

        expect(bindings).toHaveLength(2);
        expect(bindings[0]?.name).toBe('fetchUser');
        expect(bindings[0]?.description).toBe('Fetches a user');
        expect(bindings[0]?.paramsType).toBe('{ userId: string }');
        expect(bindings[0]?.returnType).toBe('Promise<User>');

        expect(bindings[1]?.name).toBe('sendEmail');
        expect(bindings[1]?.description).toBe('Sends email');
      });

      test('returns empty array for source with no defineCodeBinding exports', () => {
        const source = `
  const x = 1;
  function internal() {}
  `;
        const bindings = extractBindings('test.ts', source);
        expect(bindings).toHaveLength(0);
      });

      test('ignores non-defineCodeBinding exports', () => {
        const source = `
  export const config = {};
  export type User = { id: string };
  `;
        const bindings = extractBindings('test.ts', source);
        expect(bindings).toHaveLength(0);
      });

      test('throws for legacy exported function syntax', () => {
        const source = `
  export async function fetchUser({ userId }: { userId: string }): Promise<void> {
    void userId;
  }
  `;

        expect(() => extractBindings('test.tool.ts', source)).toThrow(
          '.tool.ts files now require defineCodeBinding syntax',
        );
      });
    });

    describe('generateCodeBindings', () => {
      test('generates CodeBinding wrappers', () => {
        const source = `
  import { defineCodeBinding } from '@inkibra/ai-flow/codemode';

  /**
   * Fetches a user
   */
  export const fetchUser = defineCodeBinding(async function fetchUser(
    { userId }: { userId: string }
  ): Promise<User> {
    return {} as User;
  });
  `;
        const bindings: BindingMeta[] = [
          {
            name: 'fetchUser',
            description: 'Fetches a user',
            paramsType: '{ userId: string }',
            returnType: 'Promise<User>',
            depsType: null,
          },
        ];

        const output = generateCodeBindings(source, bindings);

        // Should have typia import
        expect(output).toMatch(/import\s+typia\s+from\s+['"]typia['"]/);

        // Should create original function const
        expect(output).toContain('const __original_fetchUser = async function');
        expect(output).not.toMatch(/=\s*defineCodeBinding\(/);

        // Should export CodeBinding object
        expect(output).toContain('export const fetchUser = {');
        expect(output).toContain('description: "Fetches a user"');
        expect(output).toMatch(
          /declaration:\s*"\(params: \{ userId: string \}\) => Promise<User>"/,
        );
        expect(output).toMatch(
          /validate:\s*typia\.createValidate<\{[\s\S]*userId:\s*string;?[\s\S]*\}>\(\)/,
        );
        expect(output).toContain('fn: __original_fetchUser');
      });

      test('generates multiple bindings', () => {
        const source = `
  import { defineCodeBinding } from '@inkibra/ai-flow/codemode';

  export const fetchUser = defineCodeBinding(async function fetchUser(
    { userId }: { userId: string }
  ): Promise<User> {
    return {} as User;
  });

  export const sendEmail = defineCodeBinding(async function sendEmail(
    { to }: { to: string }
  ): Promise<void> {});
  `;
        const bindings: BindingMeta[] = [
          {
            name: 'fetchUser',
            description: 'Fetch',
            paramsType: '{ userId: string }',
            returnType: 'Promise<User>',
            depsType: null,
          },
          {
            name: 'sendEmail',
            description: 'Send',
            paramsType: '{ to: string }',
            returnType: 'Promise<void>',
            depsType: null,
          },
        ];

        const output = generateCodeBindings(source, bindings);

        expect(output).toContain('export const fetchUser = {');
        expect(output).toContain('export const sendEmail = {');
        expect(output).toContain('fn: __original_fetchUser');
        expect(output).toContain('fn: __original_sendEmail');
      });
    });
  });
});
