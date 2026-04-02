import { describe, expect, test } from 'bun:test';
import {
  createScopedConstructMailboxKeyStrategy,
  defaultConstructMailboxKeyStrategy,
} from './keys';

describe('construct runtime key strategy', () => {
  test('default strategy preserves compatibility key format', () => {
    expect(
      defaultConstructMailboxKeyStrategy.mailboxKey({
        constructId: 'construct-1',
      }),
    ).toBe('construct:construct-1');

    expect(
      defaultConstructMailboxKeyStrategy.consumerKey({
        constructId: 'construct-1',
      }),
    ).toBe('construct-runtime:construct-1');
  });

  test('scoped strategy includes namespace, environment and tenant', () => {
    const strategy = createScopedConstructMailboxKeyStrategy({
      fallbackNamespace: 'inkibra',
    });

    const input = {
      constructId: 'construct-99',
      namespace: 'tempo',
      environment: 'prod',
      tenantId: 'tenant-a',
    };

    expect(strategy.mailboxKey(input)).toBe(
      'tempo:prod:tenant-a:construct:construct-99',
    );
    expect(strategy.consumerKey(input)).toBe(
      'tempo:prod:tenant-a:construct-runtime:construct-99',
    );
  });
});
