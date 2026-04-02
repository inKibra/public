const DEBUG_FACT_KEY = 'constructLiveDebugFactId';

function readGlobalDebugFactId(): string | undefined {
  if (typeof globalThis === 'undefined') {
    return undefined;
  }

  const globalValue = (globalThis as Record<string, unknown>)
    .__constructLiveDebugFactId;
  if (typeof globalValue === 'string' && globalValue.trim().length > 0) {
    return globalValue.trim();
  }

  try {
    const storageValue = globalThis.localStorage?.getItem(DEBUG_FACT_KEY);
    if (storageValue && storageValue.trim().length > 0) {
      return storageValue.trim();
    }
  } catch {
    // Ignore storage access failures outside the browser.
  }

  return undefined;
}

export function getConstructLiveDebugFactId(): string | undefined {
  return readGlobalDebugFactId();
}

export function isConstructLiveDebugFact(factId: string | undefined): boolean {
  const targetFactId = readGlobalDebugFactId();
  return Boolean(targetFactId && factId === targetFactId);
}

export function hasConstructLiveDebugTarget(): boolean {
  return Boolean(readGlobalDebugFactId());
}

export function logConstructLiveDebug(scope: string, payload: unknown): void {
  const factId = readGlobalDebugFactId();
  if (!factId) {
    return;
  }

  try {
    const normalized = {
      factId,
      ...(payload && typeof payload === 'object'
        ? (payload as Record<string, unknown>)
        : { payload }),
    };
    console.debug(
      `[construct-live-debug:${scope}] ${JSON.stringify(normalized, null, 2)}`,
    );
  } catch {
    // Ignore console failures.
  }
}
