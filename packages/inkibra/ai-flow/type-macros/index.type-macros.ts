// biome-ignore lint/style/noRestrictedImports: typia is allowed in type-macro files
import typia from 'typia';

export function defineAiToolParams<T extends Record<string, unknown>>() {
  return {
    parameterSchema: typia.llm.parameters<T, 'chatgpt'>(),
    parseParameters: typia.json.createValidateParse<T>(),
  };
}

export function defineAiOutputSchema<T extends Record<string, unknown>>() {
  return {
    schema: typia.llm.parameters<T, 'chatgpt'>(),
    validate: typia.json.createValidateParse<T>(),
  };
}
