import { describe, expect, test } from 'bun:test';
import {
  buildResponsePlanLanePolicy,
  canRespondToLane,
  findLaneResponsePolicy,
} from './lane-response-policy';

describe('lane response policy', () => {
  test('prefers the most specific matching lane policy', () => {
    const config = {
      'agent:*': { can_respond_to: ['conversation'] },
      'agent:frontend': { can_respond_to: ['conversation', 'agent:reviewer'] },
      conversation: {},
    };

    expect(findLaneResponsePolicy(config, 'agent:frontend')).toEqual({
      can_respond_to: ['conversation', 'agent:reviewer'],
    });
    expect(findLaneResponsePolicy(config, 'agent:backend')).toEqual({
      can_respond_to: ['conversation'],
    });
  });

  test('defaults to same-lane only when no lanes are declared', () => {
    expect(canRespondToLane({}, 'conversation', 'conversation')).toBe(true);
    expect(canRespondToLane({}, 'conversation', 'heartbeat')).toBe(false);
  });

  test('does not allow undeclared self-lane responses', () => {
    const config = {
      conversation: {},
      'agent:*': { can_respond_to: ['conversation'] },
    };

    expect(canRespondToLane(config, 'agent:frontend', 'agent:frontend')).toBe(
      true,
    );
    expect(
      canRespondToLane(config, 'workspace:frontend', 'workspace:frontend'),
    ).toBe(false);
  });

  test('builds policy from the most specific lane entry', () => {
    const config = {
      'agent:*': { can_respond_to: ['conversation'] },
      'agent:frontend': { can_respond_to: ['conversation', 'agent:reviewer'] },
      conversation: {},
    };

    expect(buildResponsePlanLanePolicy(config, 'agent:frontend')).toEqual({
      sourceLane: 'agent:frontend',
      declaredLanes: ['agent:*', 'agent:frontend', 'conversation'],
      crossLaneTargets: ['conversation', 'agent:reviewer'],
    });
  });
});
