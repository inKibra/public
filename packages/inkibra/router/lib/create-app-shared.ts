import type { IValidation } from 'typia/lib';
import type { AppDefinition } from './create-app';
import type { InitialStorageData } from './fetch-provider';
import type { SerializableResult } from './result';

export type AppConfigSchema<TSchema> = {
  config: (input: unknown) => IValidation<TSchema>;
};

export type AppConfigSchemaType<T> = T extends AppConfigSchema<infer C>
  ? C
  : never;

export type BaseAppConfigSchema = Record<string, unknown>;

// Type helpers for fluent builder definitions
export type InferConfig<T> = T extends AppDefinition<infer C, any> ? C : never;
export type InferRoutes<T> = T extends AppDefinition<any, infer R> ? R : never;

export function defineAppSchema<TSchema>(schema: {
  config: (input: unknown) => IValidation<TSchema>;
}): AppConfigSchema<TSchema>;

/**
 * Marker overload for type macro expansion.
 *
 * Usage:
 *   defineAppSchema<{ config: AppConfig }>()
 */
export function defineAppSchema<
  TContract extends {
    config: unknown;
  },
>(): AppConfigSchema<TContract['config']>;

export function defineAppSchema<TSchema>(schema?: {
  config: (input: unknown) => IValidation<TSchema>;
}): AppConfigSchema<TSchema> {
  if (!schema) {
    throw new Error(
      'defineAppSchema<T>() is a compile-time marker. Enable build-pack type-macro + typia transforms.',
    );
  }

  return schema;
}

export function getMetaProperties(appId: string) {
  return {
    config: `${appId}:config`,
    loaderPrefix: `${appId}:loader:`,
    sessionStorage: `${appId}:sessionStorage`,
    deviceStorage: `${appId}:deviceStorage`,
    mountPointId: `${appId}:mountPointId`,
  };
}

function readMetaTag(property: string): string | null {
  if (typeof document === 'undefined') return null;
  const meta = document.querySelector(`meta[property="${property}"]`);
  return meta?.getAttribute('content') ?? null;
}

export function parseMetaTag<T>(property: string): T | undefined {
  const content = readMetaTag(property);
  if (!content) return undefined;
  try {
    return JSON.parse(content) as T;
  } catch {
    console.error(`Failed to parse meta tag ${property}:`, content);
    return undefined;
  }
}

export type LoaderDataMap = Record<
  string,
  SerializableResult<unknown, unknown>
>;

export function readLoaderDataFromMeta(appId: string): LoaderDataMap {
  if (typeof document === 'undefined') return {};
  const loaderPrefix = `${appId}:loader:`;
  const loaderData: LoaderDataMap = {};
  const metaTags = document.querySelectorAll(
    `meta[property^="${loaderPrefix}"]`,
  );
  for (const meta of Array.from(metaTags)) {
    const property = meta.getAttribute('property');
    if (!property) continue;
    const loaderName = property.slice(loaderPrefix.length);
    const content = meta.getAttribute('content');
    if (content) {
      try {
        loaderData[loaderName] = JSON.parse(content);
      } catch {
        console.error(`Failed to parse loader ${loaderName}:`, content);
      }
    }
  }
  return loaderData;
}

export type InitialStorages = {
  initialSessionStorage?: InitialStorageData;
  initialDeviceStorage?: InitialStorageData;
  mountPointId?: string;
};
