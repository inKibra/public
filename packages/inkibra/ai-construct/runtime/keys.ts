import type {
  ConstructMailboxKeyContext,
  ConstructMailboxKeyStrategy,
} from './types';

export const defaultConstructMailboxKeyStrategy: ConstructMailboxKeyStrategy = {
  mailboxKey: ({ constructId }) => `construct:${constructId}`,
  consumerKey: ({ constructId }) => `construct-runtime:${constructId}`,
};

export function createScopedConstructMailboxKeyStrategy(options?: {
  fallbackNamespace?: string;
}): ConstructMailboxKeyStrategy {
  const fallbackNamespace = options?.fallbackNamespace ?? 'ai-construct';

  function scopePrefix(input: ConstructMailboxKeyContext): string {
    const parts = [
      input.namespace ?? fallbackNamespace,
      input.environment,
      input.tenantId,
    ].filter((part): part is string => Boolean(part && part.length > 0));

    return parts.join(':');
  }

  return {
    mailboxKey: (input) =>
      `${scopePrefix(input)}:construct:${input.constructId}`,
    consumerKey: (input) =>
      `${scopePrefix(input)}:construct-runtime:${input.constructId}`,
  };
}
