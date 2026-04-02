export type ConstructLiveConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'completed'
  | 'error';

export type ConstructLiveConnectionState = {
  latestCursor?: string;
  connectCursor?: string;
};

export function createConstructLiveConnectionState(
  initialCursor?: string,
): ConstructLiveConnectionState {
  return {
    latestCursor: initialCursor,
    connectCursor: initialCursor,
  };
}

export function observeConstructLiveCursor(
  state: ConstructLiveConnectionState,
  cursor: string | undefined,
): ConstructLiveConnectionState {
  if (!cursor || cursor === state.latestCursor) {
    return state;
  }

  return {
    ...state,
    latestCursor: cursor,
  };
}

export function isConstructLiveReconnectStatus(
  status: ConstructLiveConnectionStatus,
): boolean {
  return (
    status === 'disconnected' || status === 'error' || status === 'completed'
  );
}

export function syncConstructLiveConnectCursor(args: {
  state: ConstructLiveConnectionState;
  status: ConstructLiveConnectionStatus;
}): ConstructLiveConnectionState {
  if (!isConstructLiveReconnectStatus(args.status)) {
    return args.state;
  }

  if (args.state.connectCursor === args.state.latestCursor) {
    return args.state;
  }

  return {
    ...args.state,
    connectCursor: args.state.latestCursor,
  };
}

export function buildConstructLivePathQuery(
  basePathQuery: Record<string, string | undefined>,
  connectCursor?: string,
): Record<string, string> {
  const next = Object.fromEntries(
    Object.entries(basePathQuery).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );

  if (connectCursor) {
    next.cursor = connectCursor;
  }

  return next;
}
