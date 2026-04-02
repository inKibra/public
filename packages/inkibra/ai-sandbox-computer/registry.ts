/**
 * Command Registry — The map of command names → handlers.
 *
 * Three tiers: built-in, developer, AI-installed.
 * See spec §8.2–8.4.
 */

import { generateArgHelp, parseArgs } from './arg-parser';
import type {
  Command,
  CommandContext,
  CommandRegistry,
  RegisteredCommand,
} from './types';

function eraseCommand<TResult>(command: Command<TResult>): RegisteredCommand {
  return {
    name: command.name,
    description: command.description,
    readme: command.readme,
    args: command.args,
    fn: (parsed, ctx) => command.fn(parsed, ctx),
    render: (result) => command.render(result as TResult),
  };
}

export function createCommandRegistry(
  seed: RegisteredCommand[] = [],
): CommandRegistry {
  const commands = new Map<string, RegisteredCommand>(
    seed.map((command) => [command.name, command]),
  );

  const registry: CommandRegistry = {
    register(command: Command<any>) {
      if (commands.has(command.name)) {
        throw new Error(`Command "${command.name}" is already registered`);
      }
      commands.set(command.name, eraseCommand(command));
    },

    get(name: string) {
      return commands.get(name);
    },

    has(name: string) {
      return commands.has(name);
    },

    async dispatch(
      name: string,
      args: (string | number | boolean)[],
      ctx: CommandContext,
    ) {
      const command = commands.get(name);
      if (!command) {
        throw new Error(`Unknown command: ${name}`);
      }

      // Handle --help
      if (args.length === 1 && args[0] === '--help') {
        return generateArgHelp(command.name, command.description, command.args);
      }

      const result = parseArgs(command.args, args);
      if (!result.success) {
        if (result.error === '__help__') {
          return generateArgHelp(
            command.name,
            command.description,
            command.args,
          );
        }
        throw new Error(`${name}: ${result.error}`);
      }

      return command.fn(result.parsed, ctx);
    },

    list() {
      return Array.from(commands.values());
    },

    generateHelp(name: string) {
      const command = commands.get(name);
      if (!command) return undefined;
      return generateArgHelp(command.name, command.description, command.args);
    },
  };

  return registry;
}
