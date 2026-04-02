const SERVICE = 'com.inkibra.denzel-cli';
const KEY_PROJECTS = 'PROJECTS';
const KEY_DEFAULT_PROJECT = 'DEFAULT_PROJECT';

export async function getSecret(name: string): Promise<string | null> {
  return await Bun.secrets.get({ service: SERVICE, name });
}

export async function setSecret(name: string, value: string): Promise<void> {
  await Bun.secrets.set({ service: SERVICE, name, value });
}

export async function deleteSecret(name: string): Promise<boolean> {
  return await Bun.secrets.delete({ service: SERVICE, name });
}

export function mask(value: string | null | undefined): string {
  if (!value) return '';
  const v = String(value);
  if (v.length <= 8) return '*'.repeat(v.length);
  return v.slice(0, 4) + '*'.repeat(v.length - 8) + v.slice(-4);
}

export const SECRET_KEYS = [] as const;

// Project-scoped utilities
export async function listProjects(): Promise<string[]> {
  const json = await getSecret(KEY_PROJECTS);
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? (arr as string[]) : [];
  } catch {
    return [];
  }
}

export async function setProjects(projects: string[]): Promise<void> {
  await setSecret(KEY_PROJECTS, JSON.stringify(Array.from(new Set(projects))));
}

export async function getDefaultProject(): Promise<string | null> {
  return await getSecret(KEY_DEFAULT_PROJECT);
}

export async function setDefaultProject(name: string): Promise<void> {
  await setSecret(KEY_DEFAULT_PROJECT, name);
}

export async function ensureProjectRegistered(name: string): Promise<void> {
  const list = await listProjects();
  if (!list.includes(name)) {
    list.push(name);
    await setProjects(list);
  }
}

export async function getScopedSecret(
  project: string | undefined,
  key: (typeof SECRET_KEYS)[number],
): Promise<string | null> {
  if (project) {
    const v = await getSecret(`${project}:${key}`);
    if (v) return v;
  }
  return await getSecret(key);
}

export async function setScopedSecret(
  project: string | undefined,
  key: (typeof SECRET_KEYS)[number],
  value: string,
): Promise<void> {
  if (project) {
    await setSecret(`${project}:${key}`, value);
  } else {
    await setSecret(key, value);
  }
}
