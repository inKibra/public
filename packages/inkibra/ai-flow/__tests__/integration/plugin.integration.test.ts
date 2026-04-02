import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { isCodeFunction } from '../../codemode/index';
import { _testing, codeBindingPlugin } from '../../codemode/plugin';

const { extractBindings, generateCodeBindings, transformWithTypia } = _testing;

describe('plugin integration', () => {
  describe('integration tests', () => {
    const fixtureSource = readFileSync(
      resolve(__dirname, '../fixtures/user.tool.ts'),
      'utf-8',
    );

    test('extractBindings finds all exported defineCodeBinding bindings in fixture', () => {
      const bindings = extractBindings('user.tool.ts', fixtureSource);

      expect(bindings).toHaveLength(3);

      // fetchUser
      const fetchUser = bindings.find((b) => b.name === 'fetchUser');
      expect(fetchUser).toBeDefined();
      expect(fetchUser?.description).toBe(
        'Fetches a user by ID from the database',
      );
      expect(fetchUser?.paramsType).toMatch(/userId:\s*string/);
      expect(fetchUser?.returnType).toBe('Promise<User>');

      // sendEmail
      const sendEmail = bindings.find((b) => b.name === 'sendEmail');
      expect(sendEmail).toBeDefined();
      expect(sendEmail?.description).toBe('Sends an email to a recipient');
      expect(sendEmail?.paramsType).toBe('Email');
      expect(sendEmail?.returnType).toMatch(/sent:\s*boolean/);
      expect(sendEmail?.returnType).toMatch(/messageId:\s*string/);

      // getServerTime
      const getServerTime = bindings.find((b) => b.name === 'getServerTime');
      expect(getServerTime).toBeDefined();
      expect(getServerTime?.description).toBe(
        'A simple sync function without parameters',
      );
      expect(getServerTime?.paramsType).toBe('{}');
      expect(getServerTime?.returnType).toBe('Promise<string>');
    });

    test('generateCodeBindings transforms fixture correctly', () => {
      const bindings = extractBindings('user.tool.ts', fixtureSource);
      const output = generateCodeBindings(fixtureSource, bindings);

      // Check structure
      expect(output).toMatch(/import\s+typia\s+from\s+['"]typia['"]/);

      // Original functions extracted
      expect(output).toContain('const __original_fetchUser = async function');
      expect(output).toContain('const __original_sendEmail = async function');
      expect(output).toContain(
        'const __original_getServerTime = async function',
      );

      // Exports created
      expect(output).toContain('export const fetchUser = {');
      expect(output).toContain('export const sendEmail = {');
      expect(output).toContain('export const getServerTime = {');

      // Non-defineCodeBinding exports should not be transformed
      expect(output).toContain('export const internalHelper');
      expect(output).not.toContain('__original_internalHelper');
      expect(output).not.toMatch(/=\s*defineCodeBinding\(/);
    });
  });

  describe('end-to-end tests', () => {
    const fixtureSource = readFileSync(
      resolve(__dirname, '../fixtures/user.tool.ts'),
      'utf-8',
    );
    const fixturePath = resolve(__dirname, '../fixtures/user.tool.ts');

    test('full pipeline produces valid JavaScript with typia validators', async () => {
      // Extract bindings
      const bindings = extractBindings(fixturePath, fixtureSource);
      expect(bindings.length).toBeGreaterThan(0);

      // Generate intermediate code
      const intermediateCode = generateCodeBindings(fixtureSource, bindings);
      expect(intermediateCode).toContain('typia.createValidate');

      // Transform with typia
      const finalCode = await transformWithTypia(fixturePath, intermediateCode);

      // Typia should have replaced createValidate calls with actual validator code
      expect(finalCode).not.toContain('typia.createValidate');

      // Should still have the structure
      expect(finalCode).toContain('fetchUser');
      expect(finalCode).toContain('sendEmail');
      expect(finalCode).toContain('getServerTime');

      // Should have validation logic (typia generates specific patterns)
      // The exact output varies but should include type checking
      expect(finalCode.length).toBeGreaterThan(intermediateCode.length);
    });

    // Track temp files for cleanup
    const tempFiles: string[] = [];

    afterAll(() => {
      for (const file of tempFiles) {
        if (existsSync(file)) {
          try {
            unlinkSync(file);
          } catch {
            // Ignore cleanup errors
          }
        }
      }
    });

    test('transformed code has validate functions that work correctly', async () => {
      // Extract and transform
      const bindings = extractBindings(fixturePath, fixtureSource);
      const intermediateCode = generateCodeBindings(fixtureSource, bindings);
      const finalCode = await transformWithTypia(fixturePath, intermediateCode);

      // Write to a temp file for proper module resolution
      const tempFile = resolve(
        __dirname,
        `../fixtures/_temp_transformed_${Date.now()}.js`,
      );
      tempFiles.push(tempFile);
      writeFileSync(tempFile, finalCode);

      try {
        const module = await import(tempFile);

        // Check that exports are CodeBinding objects
        expect(module.fetchUser).toBeDefined();
        expect(isCodeFunction(module.fetchUser)).toBe(true);

        expect(module.sendEmail).toBeDefined();
        expect(isCodeFunction(module.sendEmail)).toBe(true);

        expect(module.getServerTime).toBeDefined();
        expect(isCodeFunction(module.getServerTime)).toBe(true);

        // Test validation - valid input
        const validResult = module.fetchUser.validate({ userId: 'user-123' });
        expect(validResult.success).toBe(true);

        // Test validation - invalid input (wrong type)
        const invalidResult = module.fetchUser.validate({ userId: 123 });
        expect(invalidResult.success).toBe(false);

        // Test validation - missing field
        const missingResult = module.fetchUser.validate({});
        expect(missingResult.success).toBe(false);

        // Test the actual function works
        const user = await module.fetchUser.fn({ userId: 'test-id' });
        expect(user.id).toBe('test-id');
        expect(user.name).toBe('Test User');
      } finally {
        // Cleanup happens in afterAll
      }
    });

    test('plugin structure is correct', () => {
      expect(codeBindingPlugin).toBeDefined();
      expect(codeBindingPlugin.name).toBe('code-binding-transform');
      expect(codeBindingPlugin.setup).toBeInstanceOf(Function);
    });
  });
});
