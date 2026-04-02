/**
 * REPL
 *
 * Read-Eval-Print Loop for the demo.
 */

import * as readline from 'node:readline';
import type { Construct } from '../construct/construct';
import { formatPerceptionSummary } from '../construct/perception';
import { CONSTRUCT_SYSTEM_EVENT_NAME } from '../impulse/keys';
import type { ConstructOp } from '../runtime/ops';
import {
  type CliConstructHandle,
  handleCommand,
  parseCommand,
} from './commands';
/**
 * REPL configuration.
 */
export type ReplConfig = {
  prompt: string;
  constructPrompt: string;
};

const DEFAULT_REPL_CONFIG: ReplConfig = {
  prompt: 'you> ',
  constructPrompt: 'construct> ',
};

/**
 * Start the REPL.
 */
export async function startRepl(
  construct: Construct,
  config: Partial<ReplConfig> = {},
): Promise<void> {
  const fullConfig = { ...DEFAULT_REPL_CONFIG, ...config };
  const cliHandle: CliConstructHandle = {
    constructId: 'repl',
    construct,
    submit: (op) => submitViaConstruct(construct, op),
    flush: () => construct.flush(),
  };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Set up construct event handlers
  construct.onEvent((event) => {
    switch (event.type) {
      case 'impulse:started':
        console.log(
          `\x1b[90m[${event.impulseId}] processing ${formatPerceptionSummary(event.perception)}...\x1b[0m`,
        );
        break;
      case 'impulse:completed':
        console.log(
          `\x1b[90m[${event.impulseId}] completed in ${event.durationMs}ms\x1b[0m`,
        );
        break;
      case 'impulse:error':
        console.log(
          `\x1b[31m[${event.impulseId}] error: ${event.error.message}\x1b[0m`,
        );
        break;
      case 'response:scheduled':
        console.log(
          `\x1b[90m[scheduler] response scheduled: ${event.responseId}\x1b[0m`,
        );
        break;
      case 'response:executing':
        console.log(
          `\x1b[90m[scheduler] executing response: ${event.responseId}\x1b[0m`,
        );
        break;
    }
  });

  // Track streaming state
  let isStreamingThinking = false;
  let isStreamingResponse = false;

  // Set up thinking stream
  construct.onThinking((chunk) => {
    if (!isStreamingThinking) {
      isStreamingThinking = true;
      process.stdout.write('\x1b[90m'); // Start gray
    }
    process.stdout.write(chunk);
  });

  // Set up response stream
  construct.onResponseStream((chunk) => {
    if (!isStreamingResponse) {
      // End thinking color if active
      if (isStreamingThinking) {
        process.stdout.write('\x1b[0m\n'); // End gray, newline
        isStreamingThinking = false;
      }
      isStreamingResponse = true;
      process.stdout.write(`\x1b[36m${fullConfig.constructPrompt}\x1b[0m`);
    }
    process.stdout.write(chunk);
  });

  // Set up response handler (called when response is complete)
  construct.onResponse(() => {
    if (isStreamingResponse) {
      process.stdout.write('\n\n'); // Newlines after response
      isStreamingResponse = false;
    } else if (isStreamingThinking) {
      process.stdout.write('\x1b[0m\n'); // End gray if no response was generated
      isStreamingThinking = false;
    }
  });

  // Start the construct
  construct.start();

  console.log('');
  console.log('Type messages to chat, or :help for commands.');
  console.log('');

  // REPL loop
  const prompt = (): void => {
    rl.question(fullConfig.prompt, async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      // Check if it's a command
      const parsed = parseCommand(trimmed);

      if (parsed) {
        try {
          const result = await handleCommand(
            cliHandle,
            parsed.command,
            parsed.args,
          );
          console.log(result.output);
          console.log('');

          if (result.exit) {
            construct.stop();
            rl.close();
            return;
          }
        } catch (err) {
          console.log(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } else {
        // Treat as user message
        try {
          await cliHandle.submit({
            opId: `user-message:repl:${crypto.randomUUID()}`,
            kind: 'user_message',
            payload: {
              content: trimmed,
              timestamp: new Date().toISOString(),
            },
            createdAt: new Date().toISOString(),
          });
        } catch (err) {
          console.log(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      prompt();
    });
  };

  prompt();
}

async function submitViaConstruct(
  construct: Construct,
  op: ConstructOp,
): Promise<void> {
  switch (op.kind) {
    case 'user_message':
      await construct.ingest({
        lane: op.payload.lane ?? 'conversation',
        role: 'user',
        source: 'user_message',
        content: op.payload.content,
        occurredAt: new Date(op.payload.timestamp ?? op.createdAt),
        receivedAt: new Date(op.createdAt),
        metadata: op.payload.metadata,
      });
      return;
    case 'time_passed':
      await construct.ingest({
        lane: op.payload.lane ?? 'heartbeat',
        role: 'system',
        source: 'time_passed',
        content: `${op.payload.elapsed} passed`,
        occurredAt: new Date(op.payload.now ?? op.createdAt),
        receivedAt: new Date(op.createdAt),
        elapsed: op.payload.elapsed,
      });
      return;
    case 'system_event':
      await construct.ingest({
        lane:
          op.payload.lane ??
          inferReplSystemEventLane(op.payload.event, op.payload.profile),
        role: 'system',
        source: 'system_event',
        event: op.payload.event,
        content: op.payload.event,
        occurredAt: new Date(op.payload.occurredAt ?? op.createdAt),
        metadata: op.payload.payload ?? {},
        profile: op.payload.profile,
        pool: op.payload.pool,
      });
      return;
    case 'run_nap':
      await construct.nap();
      return;
    case 'start_hypno':
      await construct.startHypno();
      return;
    case 'chat_hypno_review':
      await construct.chatHypnoReview(op.payload.text);
      return;
    case 'accept_hypno':
      construct.acceptHypno();
      return;
    case 'update_hypno':
      construct.updateHypno();
      return;
    case 'cancel_hypno':
      construct.cancelHypno();
      return;
    case 'rate_response':
      await construct.rate({
        rating: op.payload.rating,
        annotation: op.payload.annotation,
        source: op.payload.source,
        lane: op.payload.lane,
      });
      return;
    case 'steer_directive':
      await construct.steer({
        directive: op.payload.directive,
        source: op.payload.source,
        lane: op.payload.lane,
      });
      return;
    default:
      throw new Error(`Unsupported REPL op kind: ${op.kind}`);
  }
}

function inferReplSystemEventLane(event: string, profile?: string): string {
  if (event === CONSTRUCT_SYSTEM_EVENT_NAME.HEARTBEAT) {
    return 'heartbeat';
  }
  if (
    event === CONSTRUCT_SYSTEM_EVENT_NAME.MAILBOX_IDLE ||
    event === CONSTRUCT_SYSTEM_EVENT_NAME.STEERING_DIRECTIVE ||
    event === CONSTRUCT_SYSTEM_EVENT_NAME.CONTEXT_PRESSURE_AUTOCLOSE
  ) {
    return 'conversation';
  }
  if (profile === 'system.self_reminder' || profile === 'system.time_passed') {
    return 'heartbeat';
  }
  return 'heartbeat';
}
