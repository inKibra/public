import { matchLanePattern } from '../vfs/context-system';

export type LaneResponsePolicyConfig = Record<
  string,
  {
    can_respond_to?: string[];
  }
>;

export type ResponsePlanLanePolicy = {
  sourceLane: string;
  declaredLanes: string[];
  crossLaneTargets: string[];
};

export function findLaneResponsePolicy(
  config: LaneResponsePolicyConfig,
  lane: string,
): LaneResponsePolicyConfig[string] | undefined {
  if (config[lane]) {
    return config[lane];
  }

  const matches = Object.keys(config)
    .filter((pattern) => pattern !== lane && matchLanePattern(lane, pattern))
    .sort(compareLanePatternSpecificity);

  if (matches.length === 0) {
    return undefined;
  }

  return config[matches[0]!];
}

export function laneExists(
  config: LaneResponsePolicyConfig,
  lane: string,
): boolean {
  return Object.keys(config).some((pattern) => matchLanePattern(lane, pattern));
}

export function canRespondToLane(
  config: LaneResponsePolicyConfig,
  sourceLane: string,
  targetLane: string,
): boolean {
  if (Object.keys(config).length === 0) {
    return targetLane === sourceLane;
  }

  if (!laneExists(config, targetLane)) {
    return false;
  }

  if (targetLane === sourceLane) {
    return true;
  }

  const sourcePolicy = findLaneResponsePolicy(config, sourceLane);
  if (
    !sourcePolicy?.can_respond_to ||
    sourcePolicy.can_respond_to.length === 0
  ) {
    return false;
  }

  return sourcePolicy.can_respond_to.some((pattern) =>
    matchLanePattern(targetLane, pattern),
  );
}

export function buildResponsePlanLanePolicy(
  config: LaneResponsePolicyConfig,
  sourceLane: string,
): ResponsePlanLanePolicy {
  const sourcePolicy = findLaneResponsePolicy(config, sourceLane);

  return {
    sourceLane,
    declaredLanes: Object.keys(config),
    crossLaneTargets: sourcePolicy?.can_respond_to
      ? [...sourcePolicy.can_respond_to]
      : [],
  };
}

function compareLanePatternSpecificity(left: string, right: string): number {
  const wildcardCountLeft = left.split('*').length - 1;
  const wildcardCountRight = right.split('*').length - 1;
  if (wildcardCountLeft !== wildcardCountRight) {
    return wildcardCountLeft - wildcardCountRight;
  }

  if (left.length !== right.length) {
    return right.length - left.length;
  }

  return left.localeCompare(right);
}
