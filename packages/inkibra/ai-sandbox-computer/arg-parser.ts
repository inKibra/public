/**
 * Arg Parser — Lightweight runtime parser for command arguments.
 *
 * Handles positional args and flags per the spec §8.1.
 * `command('read', '/agent/home/notes.md', '--head', '10')` parses to
 * `{ path: '/agent/home/notes.md', head: 10 }`.
 */

import type { ArgDef, ArgParseResult, ParsedArgs } from './types';

/**
 * Parse raw command arguments against a command's arg definitions.
 */
export function parseArgs(
  argDefs: Record<string, ArgDef>,
  rawArgs: (string | number | boolean)[],
): ArgParseResult {
  // Handle --help
  if (rawArgs.length === 1 && rawArgs[0] === '--help') {
    return { success: false, error: '__help__' };
  }

  const parsed: ParsedArgs = {};
  const positionalDefs = getPositionalDefs(argDefs);
  const flagDefs = getFlagDefs(argDefs);

  // Apply defaults
  for (const [name, def] of Object.entries(argDefs)) {
    if (def.default !== undefined) {
      parsed[name] = def.default;
    }
  }

  // Track which positional index we're at
  let positionalIndex = 0;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === undefined) continue;

    if (
      typeof arg === 'string' &&
      arg.startsWith('--') &&
      /^--[a-zA-Z]/.test(arg)
    ) {
      // Flag argument
      const flagName = arg;
      const entry = flagDefs.get(flagName);
      if (!entry) {
        return { success: false, error: `Unknown flag: ${flagName}` };
      }
      const [name, def] = entry;

      if (def.type === 'boolean') {
        parsed[name] = true;
      } else {
        // Next arg is the value
        i++;
        const flagValue = rawArgs[i];
        if (flagValue === undefined) {
          return {
            success: false,
            error: `Flag ${flagName} requires a value`,
          };
        }
        const coerced = coerceValue(flagValue, def.type);
        if ('error' in coerced) {
          return {
            success: false,
            error: `Flag ${flagName}: ${coerced.error}`,
          };
        }
        parsed[name] = coerced.value;
      }
    } else {
      // Positional argument
      const entry = positionalDefs.get(positionalIndex);
      if (entry) {
        const [name, def] = entry;
        const coerced = coerceValue(arg, def.type);
        if ('error' in coerced) {
          return {
            success: false,
            error: `Argument "${name}" (position ${positionalIndex}): ${coerced.error}`,
          };
        }
        parsed[name] = coerced.value;
      }
      // If no positional def, we still advance (extra args are ignored)
      positionalIndex++;
    }
  }

  // Check required fields
  for (const [name, def] of Object.entries(argDefs)) {
    if (def.required && parsed[name] === undefined) {
      const location =
        def.position !== undefined
          ? `positional argument ${def.position}`
          : `flag ${def.flag}`;
      return {
        success: false,
        error: `Missing required ${location}: "${name}"`,
      };
    }
  }

  return { success: true, parsed };
}

/**
 * Generate help text for a command's arg definitions.
 */
export function generateArgHelp(
  commandName: string,
  description: string,
  argDefs: Record<string, ArgDef>,
): string {
  const lines: string[] = [];
  lines.push(`${commandName} — ${description}`);
  lines.push('');

  const positionals = Object.entries(argDefs)
    .filter(([, def]) => def.position !== undefined)
    .sort(([, a], [, b]) => (a.position ?? 0) - (b.position ?? 0));

  const flags = Object.entries(argDefs).filter(
    ([, def]) => def.flag !== undefined,
  );

  if (positionals.length > 0) {
    lines.push('Arguments:');
    for (const [name, def] of positionals) {
      const req = def.required ? ' (required)' : '';
      const dflt =
        def.default !== undefined ? ` [default: ${def.default}]` : '';
      const desc = def.description ? ` — ${def.description}` : '';
      lines.push(`  ${name}: ${def.type}${req}${dflt}${desc}`);
    }
    lines.push('');
  }

  if (flags.length > 0) {
    lines.push('Flags:');
    for (const [name, def] of flags) {
      const req = def.required ? ' (required)' : '';
      const dflt =
        def.default !== undefined ? ` [default: ${def.default}]` : '';
      const desc = def.description ? ` — ${def.description}` : '';
      lines.push(`  ${def.flag} <${name}>: ${def.type}${req}${dflt}${desc}`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPositionalDefs(
  argDefs: Record<string, ArgDef>,
): Map<number, [string, ArgDef]> {
  const map = new Map<number, [string, ArgDef]>();
  for (const [name, def] of Object.entries(argDefs)) {
    if (def.position !== undefined) {
      map.set(def.position, [name, def]);
    }
  }
  return map;
}

function getFlagDefs(
  argDefs: Record<string, ArgDef>,
): Map<string, [string, ArgDef]> {
  const map = new Map<string, [string, ArgDef]>();
  for (const [name, def] of Object.entries(argDefs)) {
    if (def.flag) {
      map.set(def.flag, [name, def]);
    }
  }
  return map;
}

function coerceValue(
  raw: string | number | boolean,
  type: 'string' | 'number' | 'boolean',
):
  | { value: string | number | boolean; error?: never }
  | { value?: never; error: string } {
  if (type === 'string') {
    return { value: String(raw) };
  }
  if (type === 'number') {
    const num = Number(raw);
    if (Number.isNaN(num)) {
      return { error: `expected a number, got "${raw}"` };
    }
    return { value: num };
  }
  if (type === 'boolean') {
    if (raw === true || raw === 'true' || raw === '1') return { value: true };
    if (raw === false || raw === 'false' || raw === '0')
      return { value: false };
    return { error: `expected a boolean, got "${raw}"` };
  }
  return { error: `unknown type: ${type}` };
}
