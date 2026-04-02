import type { Filter } from '@inkibra/observable-cache';

export type SimpleQuery = {
  limit?: number;
  offset?: number;
};

export type SimpleQueryWithFilter<T, K extends keyof T> = SimpleQuery & {
  filter?: Filter<T, K>;
};

export function encodeQuery<T extends object>(query: T) {
  const queryParams = new URLSearchParams();
  for (const key in query) {
    if (query[key] !== undefined) {
      queryParams.append(key, JSON.stringify(query[key]));
    }
  }
  return queryParams.toString();
}

export function decodeQuery(query: object) {
  const queryObject: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) {
    if (key === 'authorization') {
      continue;
    }
    try {
      queryObject[key] = JSON.parse(value);
    } catch {
      queryObject[key] = value;
    }
  }
  return queryObject;
}
