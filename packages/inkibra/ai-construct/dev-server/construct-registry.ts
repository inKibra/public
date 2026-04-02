/**
 * In-memory construct ID registry.
 *
 * Tracks which construct IDs have been created in this dev-server session.
 * Doesn't persist across restarts — the durable runtime's DB/Redis data
 * persists naturally, so reopening a known ID just works.
 */

const constructIds = new Set<string>();

export function createConstruct(id?: string): string {
  const constructId = id ?? crypto.randomUUID();
  constructIds.add(constructId);
  return constructId;
}

export function listConstructs(): string[] {
  return [...constructIds];
}

export function deleteConstruct(id: string): boolean {
  return constructIds.delete(id);
}

export function hasConstruct(id: string): boolean {
  return constructIds.has(id);
}

/**
 * Seed the default construct on boot.
 */
export function seedDefaults(): void {
  createConstruct('dev-default');
}
