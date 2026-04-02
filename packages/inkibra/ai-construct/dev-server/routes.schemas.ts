/**
 * Route schemas for dev-server management endpoints.
 * Must be in a .schemas.ts file for typia transform.
 */

import { defineContextSchema, defineRouteSchema } from '@inkibra/router';
import type { ConstructCombinedSnapshot } from '../backend/snapshots';

type DevAuthContract = {
  data: { id: string };
  warning: never;
  error: never;
};

export const devAuthSchema = defineContextSchema<DevAuthContract>();

type CreateConstructContract = {
  pathParams: Record<string, never>;
  pathQuery: Record<string, never>;
  body: { id?: string };
  response: { type: 'Ok'; value: { constructId: string }; statusCode: number };
};

type ListConstructsContract = {
  pathParams: Record<string, never>;
  pathQuery: Record<string, never>;
  body: Record<string, never>;
  response: { type: 'Ok'; value: { constructs: string[] }; statusCode: number };
};

type DeleteConstructContract = {
  pathParams: { constructId: string };
  pathQuery: Record<string, never>;
  body: Record<string, never>;
  response:
    | { type: 'Ok'; value: { ok: true }; statusCode: number }
    | {
        type: 'Err';
        error: { type: 'ConstructNotFound' };
        statusCode: number;
      };
};

type GetCombinedSnapshotContract = {
  pathParams: { constructId: string };
  pathQuery: { view?: string };
  body: Record<string, never>;
  response:
    | {
        type: 'Ok';
        value: ConstructCombinedSnapshot;
        statusCode: number;
      }
    | {
        type: 'Err';
        error: { type: 'ConstructNotFound' };
        statusCode: number;
      };
};

type ReadOnlyFileContract = {
  pathParams: { constructId: string };
  pathQuery: Record<string, never>;
  body: { path: string };
  response:
    | {
        type: 'Ok';
        value: { path: string; content: string };
        statusCode: number;
      }
    | { type: 'Err'; error: { type: 'FileNotFound' }; statusCode: number };
};

type ContextTraceContract = {
  pathParams: { constructId: string };
  pathQuery: { stage?: string; lane?: string };
  body: Record<string, never>;
  response:
    | { type: 'Ok'; value: unknown; statusCode: number }
    | { type: 'Err'; error: { type: 'ConstructNotFound' }; statusCode: number };
};

type LanesContract = {
  pathParams: { constructId: string };
  pathQuery: Record<string, never>;
  body: Record<string, never>;
  response:
    | { type: 'Ok'; value: unknown; statusCode: number }
    | { type: 'Err'; error: { type: 'ConstructNotFound' }; statusCode: number };
};

export const contextTraceSchema = defineRouteSchema<ContextTraceContract>();
export const lanesSchema = defineRouteSchema<LanesContract>();
export const readOnlyFileSchema = defineRouteSchema<ReadOnlyFileContract>();
export const createConstructSchema =
  defineRouteSchema<CreateConstructContract>();
export const listConstructsSchema = defineRouteSchema<ListConstructsContract>();
export const deleteConstructSchema =
  defineRouteSchema<DeleteConstructContract>();
export const getCombinedSnapshotSchema =
  defineRouteSchema<GetCombinedSnapshotContract>();
