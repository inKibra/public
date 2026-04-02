// biome-ignore lint/style/noRestrictedImports: typia is allowed in type-macro files
import typia from 'typia';

export function defineImpulsePayload<T extends Record<string, unknown>>() {
  return {
    kind: 'impulse-payload-schema' as const,
    validate: typia.createValidate<T>(),
    jsonSchema: typia.json.schema<T, '3.1'>(),
  };
}
