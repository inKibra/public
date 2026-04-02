import { describe, expect, test } from 'bun:test';
import type { AIDeps } from '@inkibra/ai-flow';
import { CORE_IMPULSE_PROFILE_NAME } from '../impulse/keys';
import { defineImpulseProfiles } from '../impulse/types';
import { createConstruct } from './construct';
import { createFileStorage } from './storage';
import type { ConcreteLaneName, LaneDefinitions } from './types';

type ExpectTrue<T extends true> = T;
type Extends<A, B> = A extends B ? true : false;

declare const deps: AIDeps;

type TypedLanePatterns = 'conversation' | 'heartbeat' | 'agent:*';

const typedLanes = {
  conversation: {},
  heartbeat: { can_respond_to: ['conversation'] },
  'agent:*': { can_respond_to: ['conversation'] },
} as const satisfies LaneDefinitions<TypedLanePatterns>;

type TypedDeclaredLane = keyof typeof typedLanes;
type TypedRuntimeLane = ConcreteLaneName<TypedDeclaredLane>;

// Compile-time assertions
export type _RuntimeLaneIncludesConversation = ExpectTrue<
  Extends<'conversation', TypedRuntimeLane>
>;
export type _RuntimeLaneIncludesHeartbeat = ExpectTrue<
  Extends<'heartbeat', TypedRuntimeLane>
>;
export type _RuntimeLaneIncludesAgentInstances = ExpectTrue<
  Extends<'agent:frontend', TypedRuntimeLane>
>;

describe('lane type inference', () => {
  test('expands declared wildcard lanes into concrete runtime lanes', () => {
    const conversationLane: TypedRuntimeLane = 'conversation';
    const heartbeatLane: TypedRuntimeLane = 'heartbeat';
    const agentLane: TypedRuntimeLane = 'agent:frontend';

    // wildcard lane families expand to agent-prefixed runtime lanes
    const wildcardLane: TypedRuntimeLane = 'agent:*';
    // @ts-expect-error undeclared lane families are rejected
    const invalidLane: TypedRuntimeLane = 'workspace:frontend';

    expect(conversationLane).toBe('conversation');
    expect(heartbeatLane).toBe('heartbeat');
    expect(agentLane).toBe('agent:frontend');
    expect(wildcardLane).toBe('agent:*');
    void invalidLane;
  });

  test('restricts can_respond_to to declared lane patterns', () => {
    type ValidPatterns = 'conversation' | 'agent:*';
    const validLanes = {
      conversation: {},
      'agent:*': { can_respond_to: ['conversation', 'agent:*'] },
    } as const satisfies LaneDefinitions<ValidPatterns>;

    const invalidLanes = {
      conversation: {},
      // @ts-expect-error undeclared lane pattern is not allowed in can_respond_to
      'agent:*': { can_respond_to: ['workspace:*'] },
    } as const satisfies LaneDefinitions<ValidPatterns>;

    expect(validLanes.conversation).toEqual({});
    void invalidLanes;
  });

  test('infers runtime lane types from createConstruct lanes', () => {
    async function compileOnly() {
      const construct = await createConstruct({
        id: 'lane-types',
        storage: createFileStorage('/tmp/ai-construct-lane-types'),
        deps,
        lanes: typedLanes,
        impulseProfiles: defineImpulseProfiles({
          [CORE_IMPULSE_PROFILE_NAME.CONVERSATION_USER_MESSAGE]: {
            pool: 'conversation',
          },
          [CORE_IMPULSE_PROFILE_NAME.BACKGROUND_DEFAULT]: {
            pool: 'background',
          },
        }),
        computerConfig: {},
      });

      await construct.ingest({
        lane: 'agent:frontend',
        role: 'user',
        source: 'user_message',
        content: 'hello',
        occurredAt: new Date(),
        receivedAt: new Date(),
      });

      construct.onResponse((response) => {
        const sourceLane: TypedRuntimeLane = response.sourceLane;
        const targetLane: TypedRuntimeLane = response.targetLane;
        void sourceLane;
        void targetLane;
      });

      const invalidPerception: Parameters<typeof construct.ingest>[0] = {
        // @ts-expect-error invalid undeclared runtime lane
        lane: 'workspace:frontend',
        role: 'user',
        source: 'user_message',
        content: 'hello',
        occurredAt: new Date(),
        receivedAt: new Date(),
      };

      void invalidPerception;
    }

    expect(typeof compileOnly).toBe('function');
  });
});
