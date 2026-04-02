export async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
  } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 10000;
  const intervalMs = options.intervalMs ?? 25;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Condition not met within ${timeoutMs}ms`);
}
