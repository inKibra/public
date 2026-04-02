import type {
  AiFlowCreateTurn,
  AiFlowScenario,
  AiFlowStreamTurn,
} from './types';

export function createAiFlowScenario(input: {
  stream?: AiFlowStreamTurn[];
  create?: AiFlowCreateTurn[];
  strict?: boolean;
}): AiFlowScenario {
  return {
    stream: [...(input.stream ?? [])],
    create: [...(input.create ?? [])],
    strict: input.strict ?? true,
  };
}
